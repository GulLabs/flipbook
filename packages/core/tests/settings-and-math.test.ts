/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'vitest';
import { PageCollection, PageFlipError, Settings, SizeMode } from '@gullabs/flipbook-core';
import type {
  FlipOptions,
  FlipSetting,
  Page,
  PageFlip,
  Render,
  Segment,
} from '@gullabs/flipbook-core';
import { angleBetweenSegments, limitToCircle, pointsBetween } from '../src/Helper';

/* ------------------------------------------------------------------ I12 -- */

const base: FlipOptions = { width: 300, height: 400 };

const resolve = (partial: Record<string, unknown> = {}): FlipSetting =>
  new Settings().resolve({ ...base, ...partial } as FlipOptions);

const codeOf = (setting: Record<string, unknown>): string => {
  try {
    resolve(setting);
  } catch (error) {
    return (error as PageFlipError).code;
  }
  return 'NO_THROW';
};

const settingOf = (setting: Record<string, unknown>): string | undefined => {
  try {
    resolve(setting);
  } catch (error) {
    return (error as PageFlipError).setting;
  }
  return undefined;
};

describe('I12 — Settings rejects non-finite numbers instead of leaking NaN', () => {
  // `NaN <= 0` is false, so the shipped comparison accepted NaN and the book
  // rendered nothing behind `min-width: NaNpx`. A "subtly wrong" fix that
  // checks `typeof value === 'number'` also passes NaN through, so every case
  // below asserts on NaN specifically and not merely on a wrong type.
  test.each(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const)(
    'NaN %s throws PageFlipError',
    (key) => {
      expect(() => resolve({ [key]: NaN })).toThrow(PageFlipError);
      expect(codeOf({ [key]: NaN })).toBe('INVALID_SETTING');
      expect(settingOf({ [key]: NaN })).toBe(key);
    },
  );

  test('Infinity width and height are rejected too', () => {
    expect(() => resolve({ width: Infinity })).toThrow(PageFlipError);
    expect(() => resolve({ height: -Infinity })).toThrow(PageFlipError);
  });

  test('a NaN setting never reaches the returned object', () => {
    // The proof that matters: whatever resolve returns must be usable for
    // arithmetic. Belt-and-braces against a fix that only throws for `width`.
    const settings = resolve();
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
    }
  });

  test('NaN swipeDistance, flippingTime and startZIndex throw', () => {
    expect(() => resolve({ swipeDistance: NaN })).toThrow(PageFlipError);
    expect(() => resolve({ flippingTime: NaN })).toThrow(PageFlipError);
    expect(() => resolve({ startZIndex: NaN })).toThrow(PageFlipError);
  });

  test('negative swipeDistance throws rather than silently disabling swipes', () => {
    // `distY < -swipeDistance` can never be true for a negative threshold, so
    // upstream accepted a value that made the book unswipeable in silence.
    expect(() => resolve({ swipeDistance: -5 })).toThrow(PageFlipError);
    expect(resolve({ swipeDistance: 0 }).swipeDistance).toBe(0);
  });

  test('error codes collapse to INVALID_SETTING with a .setting key', () => {
    // D20. The eight `INVALID_*` settings codes collapsed into one
    // `INVALID_SETTING` carrying a machine-readable `.setting`. That is
    // strictly MORE information from a smaller union: a consumer wanting to
    // highlight the offending field no longer has to parse the message.
    expect(codeOf({ sizing: 'huge' as SizeMode })).toBe('INVALID_SETTING');
    expect(settingOf({ sizing: 'huge' })).toBe('sizing');

    expect(codeOf({ width: NaN })).toBe('INVALID_SETTING');
    expect(settingOf({ width: NaN })).toBe('width');

    expect(codeOf({ minWidth: NaN })).toBe('INVALID_SETTING');
    expect(settingOf({ minWidth: NaN })).toBe('minWidth');

    expect(codeOf({ flippingTime: NaN })).toBe('INVALID_SETTING');
    expect(settingOf({ flippingTime: NaN })).toBe('flippingTime');

    expect(codeOf({ swipeDistance: -5 })).toBe('INVALID_SETTING');
    expect(settingOf({ swipeDistance: -5 })).toBe('swipeDistance');

    expect(codeOf({ startZIndex: Infinity })).toBe('INVALID_SETTING');
    expect(settingOf({ startZIndex: Infinity })).toBe('startZIndex');
  });

  test('an explicit undefined falls back to the default, it does not override it', () => {
    // A plain spread copies an undefined-valued key *over* the default. The
    // cast is the point of the test: `exactOptionalPropertyTypes` stops this at
    // compile time, but JS consumers and React bindings that forward an
    // optional prop (`width={props.width}`) hand it over at runtime anyway.
    const settings = new Settings().resolve({
      ...base,
      flippingTime: undefined,
      swipeDistance: undefined,
      startZIndex: undefined,
      readingDirection: undefined,
    } as unknown as FlipOptions);

    expect(settings.flippingTime).toBe(1000);
    expect(settings.swipeDistance).toBe(30);
    expect(settings.startZIndex).toBe(0);
    expect(settings.readingDirection).toBe('ltr');
  });

  test('an explicit undefined width is a typed error, never a NaN bounds rect', () => {
    // width has no usable default, so this must surface as INVALID_SETTING
    // rather than as `min-width: NaNpx` on the host element.
    expect(() =>
      new Settings().resolve({
        width: undefined,
        height: 400,
      } as unknown as FlipOptions),
    ).toThrow(PageFlipError);
    expect(
      (() => {
        try {
          new Settings().resolve({
            width: undefined,
            height: 400,
          } as unknown as FlipOptions);
        } catch (error) {
          return (error as PageFlipError).setting;
        }
        return undefined;
      })(),
    ).toBe('width');
  });

  test('valid values still pass, including a negative startZIndex', () => {
    // Negative z-index is legal CSS: the constraint is integer-ness, not sign.
    const settings = resolve({ startZIndex: -3, flippingTime: 0 });
    expect(settings.startZIndex).toBe(-3);
    expect(settings.flippingTime).toBe(0);
  });
});

/* ------------------------------------------------------------------ I15 -- */

/** Minimal concrete collection: the assertions are purely about list lookup. */
class TestCollection extends PageCollection {
  public constructor(pages: Page[]) {
    super({ getSettings: () => ({ hardCovers: false }) } as unknown as PageFlip, {} as Render);
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

describe('validation gaps Codex round 3 found', () => {
  test('a fractional startZIndex is rejected — z-index takes an integer', () => {
    // `z-index:5.5` is discarded by the browser exactly as quietly as
    // `z-index:NaN`, so finiteness alone was not enough.
    expect(() => resolve({ width: 100, height: 100, startZIndex: 5.5 })).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 100, startZIndex: 5.5 })).toBe('startZIndex');
    expect(() => resolve({ width: 100, height: 100, startZIndex: -3 })).not.toThrow();
  });

  test('initialPage IS validated at resolve — non-negative integer only', () => {
    // Design tranche: initialPage is now checked here rather than deferred to
    // the load path. Fractional / negative / NaN throw INVALID_SETTING with
    // `.setting === 'initialPage'`.
    expect(() => resolve({ width: 100, height: 100, initialPage: 0.5 })).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 100, initialPage: 0.5 })).toBe('initialPage');
    expect(() => resolve({ width: 100, height: 100, initialPage: -4 })).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 100, initialPage: -4 })).toBe('initialPage');
    expect(resolve({ width: 100, height: 100, initialPage: 0 }).initialPage).toBe(0);
    expect(resolve({ width: 100, height: 100, initialPage: 3 }).initialPage).toBe(3);
  });

  test('a non-finite maxShadowOpacity is rejected', () => {
    // It feeds `opacity` and the canvas gradient alpha. A dropped declaration
    // reads as a shadow at FULL opacity rather than as an error.
    expect(() => resolve({ width: 100, height: 100, maxShadowOpacity: NaN })).toThrow(
      PageFlipError,
    );
    expect(() => resolve({ width: 100, height: 100, maxShadowOpacity: -0.5 })).toThrow(
      PageFlipError,
    );

    // The declared range is [0, 1]. Rejecting only negatives let `2` through to
    // produce alphas above 1, which browsers clamp silently — so the setting
    // looked inert past 1 rather than invalid.
    expect(() => resolve({ width: 100, height: 100, maxShadowOpacity: 2 })).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 100, maxShadowOpacity: 2 })).toBe('maxShadowOpacity');
    expect(() => resolve({ width: 100, height: 100, maxShadowOpacity: 1 })).not.toThrow();
  });
});
