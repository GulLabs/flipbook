/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'vitest';
import { PageCollection, PageFlipError, Settings } from '@gullabs/flipbook-core';
import type { FlipSetting, Page, PageFlip, Render, Segment } from '@gullabs/flipbook-core';
import { angleBetweenSegments, limitToCircle, pointsBetween } from '../src/Helper';

/* ------------------------------------------------------------------ I12 -- */

const base: Partial<FlipSetting> = { width: 300, height: 400 };

describe('I12 — Settings rejects non-finite numbers instead of leaking NaN', () => {
  // `NaN <= 0` is false, so the shipped comparison accepted NaN and the book
  // rendered nothing behind `min-width: NaNpx`. A "subtly wrong" fix that
  // checks `typeof value === 'number'` also passes NaN through, so every case
  // below asserts on NaN specifically and not merely on a wrong type.
  test.each(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)(
    'NaN %s throws PageFlipError',
    (key) => {
      expect(() => new Settings().getSettings({ ...base, [key]: NaN })).toThrow(PageFlipError);
    },
  );

  test('Infinity width and height are rejected too', () => {
    expect(() => new Settings().getSettings({ ...base, width: Infinity })).toThrow(PageFlipError);
    expect(() => new Settings().getSettings({ ...base, height: -Infinity })).toThrow(PageFlipError);
  });

  test('a NaN setting never reaches the returned object', () => {
    // The proof that matters: whatever getSettings returns must be usable for
    // arithmetic. Belt-and-braces against a fix that only throws for `width`.
    const settings = new Settings().getSettings(base);
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
    }
  });

  test('NaN swipeDistance, flippingTime and startZIndex throw', () => {
    expect(() => new Settings().getSettings({ ...base, swipeDistance: NaN })).toThrow(
      PageFlipError,
    );
    expect(() => new Settings().getSettings({ ...base, flippingTime: NaN })).toThrow(PageFlipError);
    expect(() => new Settings().getSettings({ ...base, startZIndex: NaN })).toThrow(PageFlipError);
  });

  test('negative swipeDistance throws rather than silently disabling swipes', () => {
    // `distY < -swipeDistance` can never be true for a negative threshold, so
    // upstream accepted a value that made the book unswipeable in silence.
    expect(() => new Settings().getSettings({ ...base, swipeDistance: -5 })).toThrow(PageFlipError);
    expect(new Settings().getSettings({ ...base, swipeDistance: 0 }).swipeDistance).toBe(0);
  });

  test('error codes follow the existing convention', () => {
    const codeOf = (setting: Partial<FlipSetting>): string => {
      try {
        new Settings().getSettings(setting);
      } catch (error) {
        return (error as PageFlipError).code;
      }
      return 'NO_THROW';
    };

    expect(codeOf({ ...base, width: NaN })).toBe('INVALID_SIZE');
    expect(codeOf({ ...base, minWidth: NaN })).toBe('INVALID_SIZE');
    expect(codeOf({ ...base, flippingTime: NaN })).toBe('INVALID_FLIPPING_TIME');
    expect(codeOf({ ...base, swipeDistance: -5 })).toBe('INVALID_SWIPE_DISTANCE');
    expect(codeOf({ ...base, startZIndex: Infinity })).toBe('INVALID_Z_INDEX');
  });

  test('an explicit undefined falls back to the default, it does not override it', () => {
    // A plain spread copies an undefined-valued key *over* the default. The
    // cast is the point of the test: `exactOptionalPropertyTypes` stops this at
    // compile time, but JS consumers and React bindings that forward an
    // optional prop (`width={props.width}`) hand it over at runtime anyway.
    const settings = new Settings().getSettings({
      ...base,
      flippingTime: undefined,
      swipeDistance: undefined,
      startZIndex: undefined,
      direction: undefined,
    } as unknown as Partial<FlipSetting>);

    expect(settings.flippingTime).toBe(1000);
    expect(settings.swipeDistance).toBe(30);
    expect(settings.startZIndex).toBe(0);
    expect(settings.direction).toBe('ltr');
  });

  test('an explicit undefined width is a typed error, never a NaN bounds rect', () => {
    // width has no usable default, so this must surface as INVALID_SIZE rather
    // than as `min-width: NaNpx` on the host element.
    expect(() =>
      new Settings().getSettings({
        width: undefined,
        height: 400,
      } as unknown as Partial<FlipSetting>),
    ).toThrow(PageFlipError);
  });

  test('valid values still pass, including a negative startZIndex', () => {
    // Negative z-index is legal CSS: the constraint is finiteness, not sign.
    const settings = new Settings().getSettings({ ...base, startZIndex: -3, flippingTime: 0 });
    expect(settings.startZIndex).toBe(-3);
    expect(settings.flippingTime).toBe(0);
  });
});

/* ------------------------------------------------------------------ I15 -- */

/** Minimal concrete collection: the assertions are purely about list lookup. */
class TestCollection extends PageCollection {
  public constructor(pages: Page[]) {
    super({ getSettings: () => ({ showCover: false }) } as unknown as PageFlip, {} as Render);
    this.pages = pages;
  }

  public load(): void {
    /* nothing to load: pages are injected */
  }
}

const fakePage = (id: string): Page => ({ id }) as unknown as Page;

describe('I15 — nextBy returns null for a page outside the collection (latent contract fix)', () => {
  // Latent: no in-engine caller can reach this today. It is fixed because
  // `nextBy` is public API and `prevBy` already answered null for this input.
  const a = fakePage('a');
  const b = fakePage('b');
  const stranger = fakePage('stranger');
  const collection = new TestCollection([a, b]);

  test('a page not in the collection yields null, not pages[0]', () => {
    // `indexOf` gives -1, and `-1 < length - 1` is true.
    expect(collection.nextBy(stranger)).toBeNull();
  });

  test('nextBy and prevBy agree on the stranger', () => {
    expect(collection.nextBy(stranger)).toBe(collection.prevBy(stranger));
  });

  test('normal lookups are unaffected', () => {
    expect(collection.nextBy(a)).toBe(b);
    expect(collection.nextBy(b)).toBeNull();
    expect(collection.prevBy(b)).toBe(a);
    expect(collection.prevBy(a)).toBeNull();
  });

  test('an empty collection yields null for any page', () => {
    expect(new TestCollection([]).nextBy(a)).toBeNull();
  });
});

/* ------------------------------------------------------------------ I16 -- */

describe('I16 — limitToCircle handles the vertical case', () => {
  const onCircle = (c: { x: number; y: number }, r: number, p: { x: number; y: number }): number =>
    Math.hypot(p.x - c.x, p.y - c.y) - r;

  test('a point directly above the centre clamps onto the circle, not to NaN', () => {
    const c = { x: 0, y: 300 };
    const out = limitToCircle(c, 200, { x: 0, y: 50 });

    expect(Number.isNaN(out.y)).toBe(false);
    expect(out).toEqual({ x: 0, y: 100 });
    expect(onCircle(c, 200, out)).toBeCloseTo(0, 10);
  });

  test('a point directly below the centre keeps its sign', () => {
    // The shipped guard substituted `radius` as an absolute y, discarding the
    // side the point was on; a fix that always adds `radius` looks right here
    // only if the sign is asserted in both directions.
    const c = { x: 0, y: 0 };
    const out = limitToCircle(c, 200, { x: 0, y: 250 });

    expect(out).toEqual({ x: 0, y: 200 });
    expect(onCircle(c, 200, out)).toBeCloseTo(0, 10);
  });

  test('a vertical clamp off the y axis still lands on the circle', () => {
    const c = { x: 40, y: 40 };
    const out = limitToCircle(c, 10, { x: 40, y: 90 });

    expect(out).toEqual({ x: 40, y: 50 });
    expect(onCircle(c, 10, out)).toBeCloseTo(0, 10);
  });

  test('points inside the circle and the non-vertical path are untouched', () => {
    expect(limitToCircle({ x: 0, y: 0 }, 200, { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
    expect(limitToCircle({ x: 0, y: 0 }, 10, { x: 20, y: 0 })).toEqual({ x: 10, y: 0 });
  });
});

/* ------------------------------------------------------------------ I17 -- */

describe('I17 — pointsBetween always reaches its destination', () => {
  test('a fractional delta emits the destination exactly', () => {
    const points = pointsBetween({ x: 0, y: 0 }, { x: 2.5, y: 0 });
    const last = points[points.length - 1];

    expect(last).toEqual({ x: 2.5, y: 0 });
  });

  test('a fractional delta on both axes lands on the target', () => {
    const dest = { x: 10.25, y: -3.75 };
    const points = pointsBetween({ x: 0, y: 0 }, dest);
    const last = points[points.length - 1];

    expect(last?.x).toBeCloseTo(dest.x, 10);
    expect(last?.y).toBeCloseTo(dest.y, 10);
  });

  test('the sub-pixel case is not silently dropped', () => {
    // len < 1: upstream emitted only the start point, so a 0.4px move never
    // moved at all.
    const points = pointsBetween({ x: 0, y: 0 }, { x: 0.4, y: 0 });

    expect(points[points.length - 1]).toEqual({ x: 0.4, y: 0 });
  });

  test('the point count is unchanged for integral deltas', () => {
    // The count feeds Flip.getAnimationDuration(points.length), so timing for
    // the ordinary (integral) case must not move.
    expect(pointsBetween({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(101);
    expect(pointsBetween({ x: 0, y: 0 }, { x: 30, y: 100 })).toHaveLength(101);
    expect(pointsBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(1);
  });

  test('intermediate points still step by ~1px and start at the origin', () => {
    const points = pointsBetween({ x: 10, y: 20 }, { x: 14, y: 20 });

    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points.map((p) => p.x)).toEqual([10, 11, 12, 13, 14]);
  });

  test('a negative direction is interpolated, not mirrored', () => {
    const points = pointsBetween({ x: 4, y: 0 }, { x: 0, y: -2 });

    expect(points[0]).toEqual({ x: 4, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 0, y: -2 });
    expect(points[2]).toEqual({ x: 2, y: -1 });
  });
});

/* ------------------------------------------------------------------ I18 -- */

describe('I18 — angleBetweenSegments is total', () => {
  test('a zero-length segment yields 0, not NaN', () => {
    // FlipCalculation.getSegmentToShadowLine's `?? first` can build exactly
    // this segment; a NaN here poisons the shadow transform for the frame.
    const degenerate: Segment = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ];
    const normal: Segment = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];

    expect(angleBetweenSegments(degenerate, normal)).toBe(0);
    expect(angleBetweenSegments(normal, degenerate)).toBe(0);
    expect(angleBetweenSegments(degenerate, degenerate)).toBe(0);
  });

  test('collinear segments whose cosine rounds past 1 yield 0, not NaN', () => {
    // Real float case: the unclamped quotient is 1 + 2.22e-16 here.
    const a: Segment = [
      { x: 0, y: 0 },
      { x: 0.14285714285714285, y: 0.3076923076923077 },
    ];
    const b: Segment = [
      { x: 0, y: 0 },
      { x: 0.42857142857142855, y: 0.9230769230769231 },
    ];

    const angle = angleBetweenSegments(a, b);
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeCloseTo(0, 10);
  });

  test('ordinary angles are unchanged', () => {
    const horizontal: Segment = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const vertical: Segment = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ];

    expect(angleBetweenSegments(horizontal, vertical)).toBeCloseTo(Math.PI / 2, 10);
    expect(angleBetweenSegments(horizontal, horizontal)).toBeCloseTo(0, 10);
  });
});
