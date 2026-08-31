/**
 * Four defects, two files.
 *
 *  - RD1: `Render.cancelAnimation()` set `this.shadow = null` directly instead
 *         of calling `clearShadow()`. `HTMLRender` overrides `clearShadow()` to
 *         hide the four shadow ELEMENTS, and `drawFrame` only ever writes them,
 *         so nulling the field stopped recomputation and left the last shadow
 *         painted over the replacement book.
 *  - RD2: neither `cancelAnimation()` nor `releasePages()` cleared `pageRect`,
 *         the clip `HTMLRender.drawInnerShadow` cuts against — so a rect from a
 *         destroyed collection outlived it.
 *  - X9:  `limitToCircle` clamped to the wrong side of the circle horizontally.
 *  - X10: `intersectLines` threw a bare `Error` and called degenerate input
 *         collinear.
 *
 * Written so the PRE-FIX implementation fails:
 *  - the shadow assertions are on the ELEMENTS, and the fixture asserts they are
 *    painted before it asserts they are cleared (a book that never drew a shadow
 *    passes the "hidden" claim for free);
 *  - every X9 fixture uses a circle whose centre is NOT at `x: 0`, asserted
 *    before the clamp is asserted. With `c.x === 0` the broken and the correct
 *    implementations are algebraically identical — the `|dx|` and the sign flip
 *    cancel — so a centre on the y axis proves nothing. Both live callers pass
 *    such a centre, which is why this survived;
 *  - `flippingTime` is 1000, never 0: an instant turn runs `onAnimateEnd` inside
 *    `startAnimation` and never reaches the state this file is about.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import type { PageFlip } from '@gullabs/flipbook-core';
import { PageFlipError } from '@gullabs/flipbook-core';
import { intersectLines, limitToCircle } from '../src/Helper';
import type { Point } from '../src/BasicTypes';
import { makeHtmlBook, makePages } from './html-book-fixture';
import { testFlip, testRender } from './engine-access';

/* ------------------------------------------------------------------ *
 * RD1 / RD2 — abandoning a turn drops ALL of the turn's state
 * ------------------------------------------------------------------ */

const books: Array<() => void> = [];

afterEach(() => {
  while (books.length) books.pop()?.();
  document.body.innerHTML = '';
});

interface RenderInternals {
  shadow: unknown;
  pageRect: unknown;
  drawFrame: () => void;
}

function internals(book: PageFlip): RenderInternals {
  return testRender(book) as unknown as RenderInternals;
}

const SHADOW_CLASSES = [
  'stf__outerShadow',
  'stf__innerShadow',
  'stf__hardShadow',
  'stf__hardInnerShadow',
] as const;

function shadowEl(cls: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.${cls}`);
  expect(el, `missing ${cls}`).not.toBeNull();
  return el!;
}

/** Is this shadow element currently painting anything? */
function isPainted(cls: string): boolean {
  const css = shadowEl(cls).style.cssText;
  return css !== '' && !/display:\s*none/.test(css);
}

/**
 * A landscape book with a REAL fold in progress: `Flip.fold` runs `do()`
 * synchronously, which is what sets `pageRect` and the shadow data, and
 * `drawFrame()` is what turns that data into painted shadow elements.
 */
function foldedBook(): PageFlip {
  const { book, destroy } = makeHtmlBook({
    pageCount: 6,
    usePortrait: false,
    hardCovers: false,
    hostWidth: 520,
    hostHeight: 460,
    flippingTime: 1000,
  });
  books.push(destroy);

  const flip = testFlip(book)!;
  const rect = book.getBoundsRect();

  flip.fold({ x: rect.left + rect.width - 40, y: rect.top + 40 });
  internals(book).drawFrame();

  return book;
}

describe('RD1 — cancelAnimation clears the shadow ELEMENTS, not just the field', () => {
  test('replacing the collection mid-fold leaves no shadow painted over the new book', () => {
    const book = foldedBook();

    // FIXTURE CHECK. Everything below is vacuous if the fold never painted a
    // shadow: an element that was already `display: none` passes the cleared
    // assertion under the broken implementation too.
    expect(internals(book).shadow).not.toBeNull();
    expect(isPainted('stf__outerShadow')).toBe(true);
    expect(isPainted('stf__innerShadow')).toBe(true);

    book.updateFromHtml(makePages(6));

    // The field — necessary, and what the broken code already did.
    expect(internals(book).shadow).toBeNull();

    // The elements — the actual pixels. This is the assertion the pre-fix
    // implementation fails, and it covers all four so that hiding only the two
    // the soft path happened to paint is not enough either.
    for (const cls of SHADOW_CLASSES) {
      expect(isPainted(cls), `${cls} is still painted`).toBe(false);
    }
  });

  test('releasePages clears them too — it is the same teardown', () => {
    // `PageFlip.destroy()` and `loadFromHTML` both go through `releasePages()`,
    // which delegates to `cancelAnimation()`. Driven directly because `destroy()`
    // also detaches the DOM, which would hide the defect rather than test it.
    const book = foldedBook();
    expect(isPainted('stf__outerShadow')).toBe(true);

    testRender(book).releasePages();

    for (const cls of SHADOW_CLASSES) {
      expect(isPainted(cls), `${cls} is still painted`).toBe(false);
    }
  });
});

describe('RD2 — the fold rect belongs to the turn, not to the renderer', () => {
  test('replacing the collection mid-fold drops pageRect', () => {
    const book = foldedBook();

    // FIXTURE CHECK: there is a rect to lose.
    expect(internals(book).pageRect).not.toBeNull();

    book.updateFromHtml(makePages(6));

    expect(internals(book).pageRect).toBeNull();
  });

  test('releasePages drops it as well', () => {
    const book = foldedBook();
    expect(internals(book).pageRect).not.toBeNull();

    testRender(book).releasePages();

    expect(internals(book).pageRect).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * X9 — limitToCircle clamps towards the point, not away from it
 * ------------------------------------------------------------------ */

const onCircle = (c: Point, r: number, p: Point): number => Math.hypot(p.x - c.x, p.y - c.y) - r;

/** Is `p` on the ray from `c` through `q` (rather than 180° opposite it)? */
const sameSide = (c: Point, q: Point, p: Point): number =>
  (q.x - c.x) * (p.x - c.x) + (q.y - c.y) * (p.y - c.y);

describe('X9 — limitToCircle clamps to the near side of the circle', () => {
  test('a point to the LEFT of an off-axis centre clamps left, not right', () => {
    const c = { x: 100, y: 0 };
    const p = { x: 0, y: 0 };

    // FIXTURE CHECK — with `c.x === 0` the broken form and this one agree
    // exactly, so a centre on the y axis would make this test prove nothing.
    expect(c.x).not.toBe(0);

    const out = limitToCircle(c, 10, p);

    // The shipped code returned { x: 110 }: on the circle, 180° from `p`.
    expect(out).toEqual({ x: 90, y: 0 });
    expect(onCircle(c, 10, out)).toBeCloseTo(0, 10);
    expect(sameSide(c, p, out)).toBeGreaterThan(0);
  });

  test('a circle entirely at negative x is not mirrored into positive x', () => {
    const c = { x: -100, y: 0 };
    const p = { x: -200, y: 0 };

    expect(c.x).not.toBe(0);

    const out = limitToCircle(c, 10, p);

    // The shipped code flipped the sign of the whole absolute coordinate when
    // `p.x < 0` and returned { x: 90 } — the far side of the y axis, 210px from
    // where the clamp belongs.
    expect(out).toEqual({ x: -110, y: 0 });
    expect(onCircle(c, 10, out)).toBeCloseTo(0, 10);
    expect(sameSide(c, p, out)).toBeGreaterThan(0);
  });

  test('a diagonal clamp keeps x and y on the same ray', () => {
    const c = { x: 100, y: 100 };
    const p = { x: 0, y: 200 };

    expect(c.x).not.toBe(0);

    const out = limitToCircle(c, 50, p);

    // Broken: { x: 135.35, y: 64.64 } — both coordinates reflected through the
    // centre. Correct: the point 50px along c → p.
    expect(out.x).toBeCloseTo(64.6446609, 6);
    expect(out.y).toBeCloseTo(135.3553391, 6);
    expect(onCircle(c, 50, out)).toBeCloseTo(0, 10);
    expect(sameSide(c, p, out)).toBeGreaterThan(0);
  });

  test('the vertical case still lands on the circle, on the right side of it', () => {
    // The dedicated `dx === 0` branch is gone; the general form has to cover it.
    const above = limitToCircle({ x: 40, y: 40 }, 10, { x: 40, y: 90 });
    expect(above).toEqual({ x: 40, y: 50 });

    const below = limitToCircle({ x: 40, y: 40 }, 10, { x: 40, y: -60 });
    expect(below).toEqual({ x: 40, y: 30 });
  });

  test('points inside the circle are returned untouched, by identity', () => {
    const p = { x: 103, y: 4 };
    expect(limitToCircle({ x: 100, y: 0 }, 200, p)).toBe(p);
  });

  test('a centre on the y axis is unchanged — this fix moves no live geometry', () => {
    // Both live callers (`FlipCalculation.checkPositionAtCenterLine`) pass a
    // centre at x: 0. Pinning that here is what says the flip path, and the
    // golden screenshots with it, cannot have moved.
    expect(limitToCircle({ x: 0, y: 0 }, 10, { x: 100, y: 0 })).toEqual({ x: 10, y: 0 });
    expect(limitToCircle({ x: 0, y: 300 }, 200, { x: 0, y: 50 })).toEqual({ x: 0, y: 100 });

    const skew = limitToCircle({ x: 0, y: 400 }, 200, { x: -300, y: 120 });
    expect(skew.x).toBeCloseTo(-146.2110536, 6);
    expect(skew.y).toBeCloseTo(263.5363499, 6);
  });
});

/* ------------------------------------------------------------------ *
 * X10 — intersectLines reports what actually went wrong, with a code
 * ------------------------------------------------------------------ */

const seg = (a: Point, b: Point): [Point, Point] => [a, b];

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err: unknown) {
    return err;
  }
  return null;
}

describe('X10 — intersectLines failure reporting', () => {
  test('two crossing lines still intersect', () => {
    expect(
      intersectLines(seg({ x: 0, y: 0 }, { x: 10, y: 10 }), seg({ x: 0, y: 10 }, { x: 10, y: 0 })),
    ).toEqual({ x: 5, y: 5 });
  });

  test('a zero-length segment is degenerate, NOT collinear', () => {
    const err = thrownBy(() =>
      intersectLines(seg({ x: 5, y: 5 }, { x: 5, y: 5 }), seg({ x: 0, y: 0 }, { x: 10, y: 0 })),
    );

    expect(err).toBeInstanceOf(PageFlipError);
    // The point of the fix: a degenerate segment has A = B = C = 0, so BOTH
    // Cramer numerators vanish and the honest collinearity test would call it
    // collinear too. It has to be separated out ahead of that test.
    expect((err as PageFlipError).code).toBe('DEGENERATE_SEGMENT');
    expect((err as PageFlipError).code).not.toBe('COLLINEAR_SEGMENTS');
  });

  test('a degenerate SECOND segment is caught as well', () => {
    const err = thrownBy(() =>
      intersectLines(seg({ x: 0, y: 0 }, { x: 10, y: 0 }), seg({ x: 5, y: 5 }, { x: 5, y: 5 })),
    );

    expect((err as PageFlipError).code).toBe('DEGENERATE_SEGMENT');
  });

  test('genuinely coincident lines throw a typed, coded collinear error', () => {
    const err = thrownBy(() =>
      intersectLines(seg({ x: 0, y: 0 }, { x: 10, y: 0 }), seg({ x: 2, y: 0 }, { x: 7, y: 0 })),
    );

    expect(err).toBeInstanceOf(PageFlipError);
    expect((err as PageFlipError).code).toBe('COLLINEAR_SEGMENTS');

    // `FlipCalculation.calc` catches this untyped and broadly — that is how a
    // position with no valid fold skips its frame. A `PageFlipError` is still an
    // `Error`, so the throw type change skips exactly the frames it always did.
    expect(err).toBeInstanceOf(Error);
  });

  test('parallel lines a hair apart are parallel, not collinear', () => {
    // The shipped test was `|det1 - det2| < 0.1`, comparing the y numerator
    // against the x numerator. Here det1 = 0 and det2 = 0.001, so it threw
    // "collinear" for two lines that never meet. Both are non-degenerate, so
    // nothing else can absorb this case.
    expect(
      intersectLines(
        seg({ x: 0, y: 0.001 }, { x: 1, y: 0.001 }),
        seg({ x: 0, y: 0 }, { x: 1, y: 0 }),
      ),
    ).toBeNull();
  });

  test('parallel lines far apart stay null (no behaviour drift)', () => {
    expect(
      intersectLines(seg({ x: 0, y: 5 }, { x: 1, y: 5 }), seg({ x: 0, y: 0 }, { x: 1, y: 0 })),
    ).toBeNull();
  });
});
