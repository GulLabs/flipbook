import { describe, expect, test } from 'vitest';
import { ImageFit } from '@gullabs/flipbook-core';
import { type FitRect, fitImage, insetRect } from '../src/Render/imageFit';

/**
 * Defect A3 — how a bitmap is fitted to a leaf (ADR 0001, Decision 4).
 *
 * Everything here is arithmetic on numbers. That is deliberate and it is the
 * whole reason `Render/imageFit.ts` exists as its own module: jsdom has no 2D
 * context, so a fit implemented inside `ImagePage.draw` could only be
 * "verified" by asserting that a mocked `drawImage` had been called — which
 * proves the code ran and nothing about where the picture landed. Fourteen
 * non-discriminating tests have already been caught in this area.
 *
 * What is NOT provable here: that the letterbox is actually painted with the
 * page background, and that `cover` crops rather than overflowing the spine.
 * Those are pixel claims and belong in `e2e/canvas.spec.ts`.
 */

/** 2:1 landscape bitmap — wider than any page in these tests. */
const WIDE = { w: 200, h: 100 };
/** 1:2 portrait bitmap. */
const TALL = { w: 100, h: 200 };

function aspect(rect: { width: number; height: number }): number {
  return rect.width / rect.height;
}

function contains(outer: FitRect, inner: FitRect): boolean {
  return (
    inner.x >= outer.x - 1e-9 &&
    inner.y >= outer.y - 1e-9 &&
    inner.x + inner.width <= outer.x + outer.width + 1e-9 &&
    inner.y + inner.height <= outer.y + outer.height + 1e-9
  );
}

describe('insetRect — the inset is a fraction of page WIDTH, on all four edges', () => {
  test('all four edges resolve against width, exactly like CSS percentage padding', () => {
    const box = insetRect(0.1, 200, 300);

    // The vertical pad is 20, not 30. A "sensible-looking" variant that used
    // each axis's own extent (`pad * pageHeight` vertically) gives y = 30 here
    // and is wrong for the same reason CSS percentage padding is not: the two
    // edges would stop being equal, and a square inset would render as a
    // rectangle on every non-square page.
    expect(box).toEqual({ x: 20, y: 20, width: 160, height: 260 });
  });

  test('the same fraction survives a resize — this is why it is not pixels', () => {
    const small = insetRect(0.028, 400, 600);
    const large = insetRect(0.028, 1200, 1800);

    // A pixel inset would be correct at exactly one book size. The downstream
    // consumer's only real inset is `padding: 2.8%` on a continuously resized
    // book (ADR addendum §3), so proportional identity across sizes is the
    // property, not any particular pixel count.
    expect(small.x / 400).toBeCloseTo(large.x / 1200, 12);
    expect(small.width / 400).toBeCloseTo(large.width / 1200, 12);
    expect(small.height / 600).toBeCloseTo(large.height / 1800, 12);

    // And concretely, so a bug that made both sides equally wrong still fails.
    expect(small.x).toBeCloseTo(11.2, 9);
    expect(small.y).toBeCloseTo(11.2, 9);
    expect(small.width).toBeCloseTo(377.6, 9);
    expect(small.height).toBeCloseTo(577.6, 9);
  });

  test('zero inset is the whole leaf', () => {
    expect(insetRect(0, 100, 150)).toEqual({ x: 0, y: 0, width: 100, height: 150 });
  });

  test('a hostile inset degrades to something drawable, never to NaN', () => {
    // The public boundary validates `[0, 0.5)`, but `ImagePage` is also
    // constructible directly, and a NaN here becomes a NaN destination rect and
    // a silently blank page.
    expect(insetRect(Number.NaN, 100, 150)).toEqual({ x: 0, y: 0, width: 100, height: 150 });
    expect(insetRect(-1, 100, 150)).toEqual({ x: 0, y: 0, width: 100, height: 150 });

    const collapsed = insetRect(0.5, 100, 150);
    expect(collapsed.width).toBe(0);
    expect(collapsed.height).toBe(50);
    expect(Number.isNaN(collapsed.width)).toBe(false);
  });

  test('a zero or non-finite page collapses rather than propagating', () => {
    expect(insetRect(0.1, 0, 150)).toEqual({ x: 0, y: 0, width: 0, height: 150 });
    expect(insetRect(0.1, Number.NaN, 150)).toEqual({ x: 0, y: 0, width: 0, height: 150 });
  });
});

describe('contain — the default, and the only fit that cannot destroy information', () => {
  test('a wide bitmap is letterboxed top and bottom, centred', () => {
    const { dest, source } = fitImage(ImageFit.CONTAIN, 0, 100, 150, WIDE.w, WIDE.h);

    // scale = min(100/200, 150/100) = 0.5 → 100 × 50, centred vertically.
    expect(dest).toEqual({ x: 0, y: 50, width: 100, height: 50 });
    // `contain` uses the whole bitmap, so there is no source crop.
    expect(source).toBeNull();
  });

  test('a tall bitmap is pillarboxed left and right, centred', () => {
    const { dest } = fitImage(ImageFit.CONTAIN, 0, 200, 100, TALL.w, TALL.h);

    // scale = min(200/100, 100/200) = 0.5 → 50 × 100, centred horizontally.
    expect(dest).toEqual({ x: 75, y: 0, width: 50, height: 100 });
  });

  test('aspect ratio is preserved and nothing leaves the leaf', () => {
    for (const [pw, ph] of [
      [100, 150],
      [300, 100],
      [512, 512],
    ] as const) {
      for (const bitmap of [WIDE, TALL, { w: 37, h: 41 }]) {
        const { dest } = fitImage(ImageFit.CONTAIN, 0, pw, ph, bitmap.w, bitmap.h);

        expect(aspect(dest)).toBeCloseTo(bitmap.w / bitmap.h, 9);
        expect(contains({ x: 0, y: 0, width: pw, height: ph }, dest)).toBe(true);
      }
    }
  });

  test('contain respects the inset — it fits the content box, not the leaf', () => {
    const { dest } = fitImage(ImageFit.CONTAIN, 0.1, 200, 300, 100, 100);

    // Box is { 20, 20, 160, 260 }; a square bitmap fits to 160 × 160 centred in
    // it, so y = 20 + (260 - 160) / 2 = 70.
    expect(dest).toEqual({ x: 20, y: 70, width: 160, height: 160 });
  });

  test('an unrecognised fit lands on contain, not on NaN and not on a throw', () => {
    const bogus = fitImage('sideways' as unknown as ImageFit, 0, 100, 150, WIDE.w, WIDE.h);
    const contain = fitImage(ImageFit.CONTAIN, 0, 100, 150, WIDE.w, WIDE.h);

    expect(bogus).toEqual(contain);
  });
});

describe('cover — fills the leaf by cropping the SOURCE', () => {
  test('the destination is the whole content box', () => {
    const { dest } = fitImage(ImageFit.COVER, 0, 100, 150, WIDE.w, WIDE.h);

    expect(dest).toEqual({ x: 0, y: 0, width: 100, height: 150 });
  });

  test('the crop is centred and has the box aspect, so nothing is distorted', () => {
    const { source } = fitImage(ImageFit.COVER, 0, 100, 150, WIDE.w, WIDE.h);

    expect(source).not.toBeNull();
    // sw = min(200, 100 × 100/150) = 66.66…, sh = min(100, 200 × 150/100) = 100
    expect(source?.width).toBeCloseTo(200 / 3, 9);
    expect(source?.height).toBeCloseTo(100, 9);
    // Centred: equal amounts fall off each side.
    expect(source?.x).toBeCloseTo((200 - 200 / 3) / 2, 9);
    expect(source?.y).toBeCloseTo(0, 9);

    // The property that makes it undistorted.
    expect(aspect(source as FitRect)).toBeCloseTo(100 / 150, 9);
  });

  test('the crop never asks for pixels the bitmap does not have', () => {
    for (const [pw, ph] of [
      [100, 150],
      [300, 100],
      [512, 512],
    ] as const) {
      for (const bitmap of [WIDE, TALL, { w: 37, h: 41 }]) {
        const { source } = fitImage(ImageFit.COVER, 0, pw, ph, bitmap.w, bitmap.h);

        expect(source).not.toBeNull();
        expect(contains({ x: 0, y: 0, width: bitmap.w, height: bitmap.h }, source as FitRect)).toBe(
          true,
        );
        // A source rect that overflowed the bitmap would be `drawImage`'s
        // problem, not ours — it clamps and silently scales, which reads as a
        // wrongly-zoomed page with nothing reporting it.
        expect((source as FitRect).width).toBeGreaterThan(0);
        expect((source as FitRect).height).toBeGreaterThan(0);
      }
    }
  });

  test('a bitmap that already matches the box is not cropped at all', () => {
    const { source } = fitImage(ImageFit.COVER, 0, 200, 300, 400, 600);

    expect(source).toEqual({ x: 0, y: 0, width: 400, height: 600 });
  });
});

describe('fill — the legacy stretch, kept but no longer the default', () => {
  test('the bitmap is stretched to the content box and nothing is cropped', () => {
    const { dest, source } = fitImage(ImageFit.FILL, 0, 100, 150, WIDE.w, WIDE.h);

    expect(dest).toEqual({ x: 0, y: 0, width: 100, height: 150 });
    expect(source).toBeNull();
  });

  test('fill and contain genuinely differ — otherwise the default change is a no-op', () => {
    const fill = fitImage(ImageFit.FILL, 0, 100, 150, WIDE.w, WIDE.h);
    const contain = fitImage(ImageFit.CONTAIN, 0, 100, 150, WIDE.w, WIDE.h);

    expect(fill.dest).not.toEqual(contain.dest);
  });

  test('fill still honours the inset', () => {
    const { dest } = fitImage(ImageFit.FILL, 0.1, 200, 300, WIDE.w, WIDE.h);

    expect(dest).toEqual({ x: 20, y: 20, width: 160, height: 260 });
  });
});

describe('totality — an unknowable intrinsic size falls back, it does not produce NaN', () => {
  const unknowable = [
    [0, 0],
    [0, 100],
    [100, 0],
    [Number.NaN, Number.NaN],
    [Number.POSITIVE_INFINITY, 100],
    [-10, 100],
  ] as const;

  test.each(unknowable)('natural %s × %s yields the inset rect', (nw, nh) => {
    for (const fit of [ImageFit.CONTAIN, ImageFit.COVER, ImageFit.FILL]) {
      const { dest, source } = fitImage(fit, 0.1, 200, 300, nw, nh);

      expect(dest).toEqual({ x: 20, y: 20, width: 160, height: 260 });
      expect(source).toBeNull();
    }
  });

  test('a collapsed content box yields a zero-area destination and no source', () => {
    // `drawImage` with a zero-area SOURCE is specified to throw
    // `IndexSizeError`, so `cover` must not hand one back.
    const { dest, source } = fitImage(ImageFit.COVER, 0.5, 100, 150, WIDE.w, WIDE.h);

    expect(dest.width).toBe(0);
    expect(source).toBeNull();
  });

  test('no result anywhere contains a NaN', () => {
    const insets = [0, 0.028, 0.1, 0.49, 0.5, -1, Number.NaN];
    const pages = [
      [100, 150],
      [0, 0],
      [Number.NaN, 300],
    ] as const;

    for (const fit of [ImageFit.CONTAIN, ImageFit.COVER, ImageFit.FILL]) {
      for (const inset of insets) {
        for (const [pw, ph] of pages) {
          for (const bitmap of [WIDE, TALL, { w: 0, h: 0 }]) {
            const { dest, source } = fitImage(fit, inset, pw, ph, bitmap.w, bitmap.h);

            for (const value of Object.values(dest)) expect(Number.isNaN(value)).toBe(false);
            if (source !== null) {
              for (const value of Object.values(source)) expect(Number.isNaN(value)).toBe(false);
            }
          }
        }
      }
    }
  });
});
