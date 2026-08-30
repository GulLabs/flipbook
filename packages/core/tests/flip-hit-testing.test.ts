/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hit-testing and fold-seeding in `Flip` — four defects, all of them about a
 * point being measured against the wrong rectangle or the wrong corner.
 *
 *  - **FL1 (F5)** `isPointOnCorners` measured the corner bands against the
 *    two-page bounds rect, whose left half is phantom in portrait. The BACK
 *    hover band therefore sat off the host and the affordance was unreachable.
 *  - **FL2** the portrait BACK zone in `getDirectionByPoint` had no lower
 *    bound, so a click in the blank margin beside the leaf turned back.
 *  - **FL3 (F6)** `showCorner` seeded the calculation at the TOP corner even
 *    for a BOTTOM hover, so the first pose was at the wrong end of the leaf.
 *  - **FL4** `do()` left the last computed shadow on screen when the fold
 *    stopped having one.
 *
 * Every test states the geometry it depends on BEFORE it asserts behaviour:
 * the fixture's rect and `operatingDistance` are pinned, because a corner band
 * that happens to coincide with the leaf edge would make all of this pass for
 * the wrong reason. Nothing here stubs an animation — `flippingTime: 0` runs
 * the commit synchronously and the FL3/FL4 cases deliberately use a real
 * duration so the render loop is the thing under test.
 */

// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';

import { FlipCorner, FlipDirection, FlippingState } from '../src/Flip/enums';
import { FlipCalculation } from '../src/Flip/FlipCalculation';
import { Orientation } from '../src/Render/Render';
import { makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook({ usePortrait: true, ...opts });
  books.push(b);
  return b;
}

/**
 * The fixture's portrait geometry, restated as constants so a test that starts
 * agreeing with the code for the wrong reason shows up as a precondition
 * failure rather than as a silent pass.
 *
 * A 200×300 book in a 380-wide host: the bounds rect is TWO pages wide and its
 * left half is phantom, so `left` is negative and the single visible leaf
 * occupies global x ∈ [90, 290].
 */
const RECT = { left: -110, top: 0, width: 400, height: 300, pageWidth: 200 } as const;
const OPERATING_DISTANCE = Math.sqrt(200 * 200 + 300 * 300) / 5; // 72.111…
const LEAF_LEFT = RECT.left + RECT.pageWidth; // global x = 90
const LEAF_RIGHT = RECT.left + RECT.width; // global x = 290

function assertPortraitFixture(app: ReturnType<typeof book>['book'], page: number): void {
  expect(app.getOrientation()).toBe(Orientation.PORTRAIT);
  expect(app.getCurrentPageIndex()).toBe(page);
  expect(app.getBoundsRect()).toEqual(RECT);
  // The band is narrower than the leaf and narrower than half of it, so "left
  // band" and "right band" are genuinely disjoint regions of the visible page.
  expect(OPERATING_DISTANCE).toBeCloseTo(72.111, 3);
  expect(OPERATING_DISTANCE).toBeLessThan(RECT.pageWidth / 2);
}

describe('FL1 (F5) — the BACK corner-hover band belongs to the visible leaf', () => {
  test('the leaf’s own left edge is a corner; the phantom half is not', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
    const flip = app.getFlipController()!;
    assertPortraitFixture(app, 2);

    // Where the OLD band sat: one operating distance in from `rect.left`, which
    // is at global x = -110 — off the host entirely. Nothing there is hoverable.
    expect(flip.isPointOnCorners({ x: RECT.left + 2, y: RECT.top + 2 })).toBe(false);
    expect(flip.isPointOnCorners({ x: RECT.left + 60, y: RECT.top + 2 })).toBe(false);

    // The blank host margin between x = 0 and the leaf is not the book either.
    expect(flip.isPointOnCorners({ x: 20, y: RECT.top + 2 })).toBe(false);
    expect(flip.isPointOnCorners({ x: LEAF_LEFT - 2, y: RECT.top + 2 })).toBe(false);

    // Where the band belongs: just inside the visible leaf's left edge, both
    // corners.
    expect(flip.isPointOnCorners({ x: LEAF_LEFT + 2, y: RECT.top + 2 })).toBe(true);
    expect(flip.isPointOnCorners({ x: LEAF_LEFT + 2, y: RECT.top + RECT.height - 2 })).toBe(true);

    // …and no further. The band is `operatingDistance` wide, not "the left half
    // of the leaf" — a fix that simply widened the region would pass the checks
    // above and fail here.
    expect(flip.isPointOnCorners({ x: LEAF_LEFT + OPERATING_DISTANCE + 5, y: RECT.top + 2 })).toBe(
      false,
    );
    expect(flip.isPointOnCorners({ x: LEAF_LEFT + RECT.pageWidth / 2, y: RECT.top + 2 })).toBe(
      false,
    );

    // The middle of the leaf's height is never a corner, at either edge.
    expect(flip.isPointOnCorners({ x: LEAF_LEFT + 2, y: RECT.top + RECT.height / 2 })).toBe(false);

    // The FORWARD band was always reachable and still is.
    expect(flip.isPointOnCorners({ x: LEAF_RIGHT - 2, y: RECT.top + 2 })).toBe(true);
  });

  test('hovering that edge actually opens a BACK fold', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 1000, startPage: 2 });
    const flip = app.getFlipController()!;
    assertPortraitFixture(app, 2);
    expect(flip.getState()).toBe(FlippingState.READ);

    flip.showCorner({ x: LEAF_LEFT + 2, y: RECT.top + 2 });

    expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
    const calc = flip.getCalculation();
    expect(calc).not.toBeNull();
    // Under `ltr` the geometric fold side is the semantic direction.
    expect(calc!.getDirection()).toBe(FlipDirection.BACK);
    // A hover must not commit anything.
    expect(app.getCurrentPageIndex()).toBe(2);
  });

  test('landscape is untouched — both bands are still measured off the rect', () => {
    const { book: app } = book({
      pageCount: 6,
      flippingTime: 0,
      startPage: 2,
      usePortrait: false,
      hostWidth: 420,
    });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    expect(app.getOrientation()).toBe(Orientation.LANDSCAPE);
    // In landscape the visible span IS the bounds rect: two leaves, no phantom.
    expect(rect.width).toBe(rect.pageWidth * 2);

    const od = Math.sqrt(rect.pageWidth ** 2 + rect.height ** 2) / 5;

    expect(flip.isPointOnCorners({ x: rect.left + 2, y: rect.top + 2 })).toBe(true);
    expect(flip.isPointOnCorners({ x: rect.left + rect.width - 2, y: rect.top + 2 })).toBe(true);
    expect(flip.isPointOnCorners({ x: rect.left + od + 5, y: rect.top + 2 })).toBe(false);
  });
});

describe('FL2 — the portrait BACK zone is bounded at both ends', () => {
  /** A click with no drag: `PageFlip.requestUserTurn` → `Flip.flip`. */
  function click(app: ReturnType<typeof book>['book'], x: number, y: number): void {
    app.startUserTouch({ x, y });
    app.userStop({ x, y }, false);
  }

  test('a click in the blank margin beside the leaf does not turn back', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
    assertPortraitFixture(app, 2);

    // Global x = 20 is real host area — the book is centred, so there is 90px
    // of blank margin to its left — but it is one whole page LEFT of the leaf,
    // inside the rect's phantom half.
    expect(20).toBeLessThan(LEAF_LEFT);
    expect(20 - RECT.left).toBeLessThan(RECT.pageWidth);

    click(app, 20, RECT.top + 150);

    // The defect turned this into a BACK turn (index 1). Outside the leaf there
    // is no back zone, so it falls through to the forward default.
    expect(app.getCurrentPageIndex()).toBe(3);
  });

  test('the back zone is the leaf’s left 2/5, measured from the leaf', () => {
    // Deliberately NOT normalised to half the leaf: see `getDirectionByPoint`.
    const zone = (RECT.pageWidth * 2) / 5; // 80px of a 200px leaf
    expect(zone).toBe(RECT.width / 5); // …the same number upstream computed

    {
      // The leaf's own left edge — the first pixel of the book — is inside the
      // zone. The new lower bound is inclusive, not exclusive.
      const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
      assertPortraitFixture(app, 2);
      click(app, LEAF_LEFT, RECT.top + 150);
      expect(app.getCurrentPageIndex()).toBe(1);
    }
    {
      const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
      assertPortraitFixture(app, 2);
      click(app, LEAF_LEFT + 2, RECT.top + 150);
      expect(app.getCurrentPageIndex()).toBe(1);
    }
    {
      const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
      click(app, LEAF_LEFT + zone, RECT.top + 150);
      expect(app.getCurrentPageIndex()).toBe(1);
    }
    {
      const { book: app } = book({ pageCount: 6, flippingTime: 0, startPage: 2 });
      click(app, LEAF_LEFT + zone + 1, RECT.top + 150);
      expect(app.getCurrentPageIndex()).toBe(3);
    }
  });

  test('landscape still splits the spread down the middle', () => {
    const { book: app } = book({
      pageCount: 6,
      flippingTime: 0,
      startPage: 2,
      usePortrait: false,
      hostWidth: 420,
    });
    const rect = app.getBoundsRect();
    expect(app.getOrientation()).toBe(Orientation.LANDSCAPE);

    // Landscape spreads are pairs: page 2 is spread 1, and a click on the left
    // leaf steps back to spread 0.
    click(app, rect.left + rect.width / 2 - 2, rect.top + 150);
    expect(app.getCurrentPageIndex()).toBe(0);
  });
});

describe('FL3 (F6) — showCorner seeds the corner it actually picked', () => {
  test('a BOTTOM hover’s first pose is at the bottom of the leaf', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 1000, startPage: 2 });
    const flip = app.getFlipController()!;
    assertPortraitFixture(app, 2);

    // A real duration, so `animateFlippingTo` installs frames instead of
    // running them: what is asserted below is the pose the FIRST rendered frame
    // would use, which is the frame the defect got wrong.
    flip.showCorner({ x: LEAF_RIGHT - 2, y: RECT.top + RECT.height - 2 });

    const calc = flip.getCalculation();
    expect(calc).not.toBeNull();
    expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
    expect(calc!.getCorner()).toBe(FlipCorner.BOTTOM);

    // The pose the seed produced, compared against a calculation seeded with
    // the point the animation itself starts from. Exact equality, not "somewhere
    // in the bottom half": an off-by-one seed is still a seed at the wrong
    // place, and `y: 1` vs `y: rect.height - 1` is what the defect was.
    const reference = new FlipCalculation(
      FlipDirection.FORWARD,
      FlipCorner.BOTTOM,
      RECT.pageWidth,
      RECT.height,
    );
    expect(reference.calc({ x: RECT.pageWidth - 1, y: RECT.height - 1 })).toBe(true);

    expect(calc!.getPosition()).toEqual(reference.getPosition());
    expect(calc!.getAngle()).toBeCloseTo(reference.getAngle(), 10);
    expect(calc!.getRect().topRight).toEqual(reference.getRect().topRight);

    // And the pose the defect produced is genuinely different — otherwise the
    // equality above would be satisfied by both.
    const topSeeded = new FlipCalculation(
      FlipDirection.FORWARD,
      FlipCorner.BOTTOM,
      RECT.pageWidth,
      RECT.height,
    );
    expect(topSeeded.calc({ x: RECT.pageWidth - 1, y: 1 })).toBe(true);
    expect(topSeeded.getPosition()).not.toEqual(reference.getPosition());
  });

  test('a TOP hover is unchanged', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 1000, startPage: 2 });
    const flip = app.getFlipController()!;
    assertPortraitFixture(app, 2);

    flip.showCorner({ x: LEAF_RIGHT - 2, y: RECT.top + 2 });

    const calc = flip.getCalculation()!;
    expect(calc.getCorner()).toBe(FlipCorner.TOP);

    const reference = new FlipCalculation(
      FlipDirection.FORWARD,
      FlipCorner.TOP,
      RECT.pageWidth,
      RECT.height,
    );
    expect(reference.calc({ x: RECT.pageWidth - 1, y: 1 })).toBe(true);
    expect(calc.getPosition()).toEqual(reference.getPosition());
  });
});

describe('FL4 — a fold with no shadow start clears the shadow it left behind', () => {
  /** Two rAF turns, so the render loop has drawn at least one full frame. */
  function frame(): Promise<void> {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  test('the painted shadow disappears on the frame that stops having one', async () => {
    // A wide, short leaf is where `getShadowStartPoint()` is reachable at all:
    // the start point is the fold's intersection with the book's border, and on
    // a 600×50 page a BOTTOM corner dragged above the top edge has none.
    const { book: app } = book({
      pageCount: 6,
      flippingTime: 1000,
      startPage: 2,
      width: 600,
      height: 50,
      drawShadow: true,
    });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();
    const dist = app.getUI().getDistElement();

    expect(app.getOrientation()).toBe(Orientation.PORTRAIT);
    expect(rect).toEqual({ left: -310, top: 0, width: 1200, height: 50, pageWidth: 600 });

    const outer = dist.querySelector<HTMLElement>('.stf__outerShadow');
    expect(outer).not.toBeNull();

    // Pose 1: a normal BOTTOM-corner fold. It has a shadow start point…
    flip.fold({ x: rect.left + rect.width - 2, y: rect.top + rect.height - 5 });
    const calc = flip.getCalculation();
    expect(calc).not.toBeNull();
    expect(calc!.getCorner()).toBe(FlipCorner.BOTTOM);
    expect(calc!.getShadowStartPoint()).not.toBeNull();

    await frame();
    // …and the renderer paints it.
    expect(outer!.style.cssText).toMatch(/display:\s*block/i);
    expect(outer!.style.cssText).toMatch(/linear-gradient/i);

    // Pose 2: the same fold dragged above the top edge of the book. The
    // calculation still succeeds — this is a live fold, not a rejected one —
    // but there is no border intersection to hang a shadow on.
    flip.fold({ x: rect.left + rect.width, y: rect.top - 50 });
    expect(flip.getCalculation()).toBe(calc);
    expect(calc!.getShadowStartPoint()).toBeNull();

    await frame();
    expect(outer!.style.cssText).toMatch(/display:\s*none/i);
    expect(outer!.style.cssText).not.toMatch(/linear-gradient/i);

    // Still a live fold: the shadow went, the turn did not.
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    expect(app.getCurrentPageIndex()).toBe(2);
  });
});
