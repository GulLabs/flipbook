/**
 * Flip state-machine defects I1 / I3 / I5 / I8, driven through the real HTML
 * engine. Nothing here stubs `startAnimation`, `Render` or the collection: the
 * whole point of these four is that the unit-level story looked fine while the
 * live object was wrong.
 *
 * Each test asserts what the CALLER ASKED FOR, not what the current pipeline
 * happens to produce — I5 in particular is masked in the live app by the
 * mirror-image bug in `UI.swipeDirection`'s corner test (I6), and a test
 * written against the composed behaviour would go green on either.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { FlipCorner, FlippingState, Orientation, PageDensity } from '@gullabs/flipbook-core';
import { makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

/**
 * A book whose bounds rect has a NON-ZERO `top`: 300-tall pages centred in a
 * 600-tall host. That offset is the whole of I5 — on a `top: 0` fixture the
 * broken and the fixed y coincide and the test proves nothing, so every I5
 * assertion below is preceded by an assertion that `top` is really 150.
 */
function centredBook(opts?: Parameters<typeof makeHtmlBook>[0]) {
  return book({
    width: 200,
    height: 300,
    hostWidth: 380,
    hostHeight: 600,
    ...opts,
  });
}

describe('I1 — a refused fold must not strand the state machine', () => {
  test('a forward drag on the last page ends in READ, not USER_FOLD', () => {
    const { book: app } = book({ pageCount: 4, startPage: 3, flippingTime: 0 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    expect(app.getCurrentPageIndex()).toBe(3);
    expect(app.getOrientation()).toBe(Orientation.PORTRAIT);

    const down = { x: rect.left + rect.width - 5, y: rect.top + 10 };
    const moved = { x: rect.left + rect.width - 45, y: rect.top + 12 };

    app.startUserTouch(down);
    app.userMove(moved, false); // > 5px, so PageFlip calls fold()

    // Mid-drag, and this is the assertion that matters: a refused fold must
    // never announce USER_FOLD. `UI.onPointerMove` calls `preventDefault()` on
    // every move while the state is not READ, so announcing a fold that is not
    // happening is exactly what stops the page scrolling under a finger — and
    // settling back to READ on release does not undo it.
    expect(flip.getCalculation()).toBeNull();
    expect(flip.getState()).toBe(FlippingState.READ);

    app.userStop(moved, false);

    // The turn was refused (there is no page 4), so nothing may have moved.
    expect(app.getCurrentPageIndex()).toBe(3);
    expect(flip.getCalculation()).toBeNull();
    // ...and the book must be usable again.
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('a refused fold does not kill corner hover for the rest of the session', () => {
    const { book: app } = book({ pageCount: 4, startPage: 3, flippingTime: 1000 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const down = { x: rect.left + rect.width - 5, y: rect.top + 10 };
    const moved = { x: rect.left + rect.width - 45, y: rect.top + 12 };
    app.startUserTouch(down);
    app.userMove(moved, false);
    app.userStop(moved, false);

    // Go somewhere a turn IS possible, without touching the flip state.
    app.turnToPage(0);
    expect(app.getCurrentPageIndex()).toBe(0);

    // Hover the corner. `showCorner` only works from READ / FOLD_CORNER, so a
    // state stuck in USER_FOLD makes this a permanent no-op.
    app.userMove({ x: rect.left + rect.width - 3, y: rect.top + 3 }, false);

    expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
  });

  test('rtl: a right-edge drag at page 0 is refused and still returns to READ', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, direction: 'rtl' });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const down = { x: rect.left + rect.width - 5, y: rect.top + 10 };
    const moved = { x: rect.left + rect.width - 45, y: rect.top + 12 };

    app.startUserTouch(down);
    app.userMove(moved, false);
    app.userStop(moved, false);

    expect(app.getCurrentPageIndex()).toBe(0);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('stopMove hands the state back even when no calculation is open', () => {
    // The second half of I1, exercised on its own: `start()` is public and
    // resets `calc` before it can refuse, so a caller can legitimately reach
    // "announced state, no calculation". The release path must still settle.
    const { book: app } = book({ pageCount: 4, flippingTime: 1000 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const inside = { x: rect.left + rect.width - 40, y: rect.top + 40 };
    flip.fold(inside);
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    expect(flip.getCalculation()).not.toBeNull();

    // Refused: BACK from page 0. `start()` reset `calc` on the way in.
    //
    // The point must be on the LEFT part of the visible leaf, which in
    // portrait starts one `pageWidth` into the bounds rect — the rect's left
    // half is phantom. This used to read `rect.left + 2`, a point in that
    // phantom half that `getDirectionByPoint` called BACK only because its
    // portrait test had no lower bound (FL2); the assertion below was right
    // for the wrong reason.
    app.turnToPage(0);
    expect(flip.start({ x: rect.left + rect.pageWidth + 2, y: rect.top + 10 })).toBe(false);
    expect(flip.getCalculation()).toBeNull();

    flip.stopMove();
    expect(flip.getState()).toBe(FlippingState.READ);
  });
});

describe('I3 — flipToPage must not publish a phantom spread index', () => {
  test('the public index and the spread agree while a turn is in flight', () => {
    const { book: app } = book({ pageCount: 8, flippingTime: 1000 });
    const collection = app.getPageCollection();

    expect(app.getCurrentPageIndex()).toBe(0);

    app.flip(5);

    // Mid-animation the book has not moved yet, and both accessors must say so.
    expect(app.getCurrentPageIndex()).toBe(0);
    expect(collection.getCurrentSpreadIndex()).toBe(0);
  });

  test('a second flipToPage mid-turn lands on the page it asked for', () => {
    const { book: app } = book({ pageCount: 8, flippingTime: 1000 });

    app.flip(5);
    app.flip(2); // finish-then-restart: the first turn commits, then we go to 2

    app.getRender().finishAnimation();

    expect(app.getCurrentPageIndex()).toBe(2);
  });

  test('a single flipToPage still lands exactly on its target', () => {
    const { book: app } = book({ pageCount: 8, flippingTime: 1000 });

    app.flip(6);
    app.getRender().finishAnimation();
    expect(app.getCurrentPageIndex()).toBe(6);

    app.flip(1);
    app.getRender().finishAnimation();
    expect(app.getCurrentPageIndex()).toBe(1);
  });
});

describe('I5 — a programmatic corner survives the global→book conversion', () => {
  test('the fixture really is vertically centred', () => {
    const { book: app } = centredBook({ pageCount: 6 });
    const rect = app.getBoundsRect();

    // If this is 0 the whole test is vacuous: the bug is the missing `top`.
    expect(rect.top).toBe(150);
    expect(rect.height).toBe(300);
  });

  test('flipNext(BOTTOM) turns the BOTTOM corner on a centred book', () => {
    const { book: app } = centredBook({ pageCount: 6, flippingTime: 1000 });
    const flip = app.getFlipController()!;

    expect(app.getBoundsRect().top).toBe(150);

    expect(flip.flipNext(FlipCorner.BOTTOM)).toBe(true);
    expect(flip.getCalculation()!.getCorner()).toBe(FlipCorner.BOTTOM);
  });

  test('flipNext(TOP) still turns the TOP corner', () => {
    const { book: app } = centredBook({ pageCount: 6, flippingTime: 1000 });
    const flip = app.getFlipController()!;

    expect(app.getBoundsRect().top).toBe(150);

    expect(flip.flipNext(FlipCorner.TOP)).toBe(true);
    expect(flip.getCalculation()!.getCorner()).toBe(FlipCorner.TOP);
  });

  test('flipPrev(BOTTOM) turns the BOTTOM corner on a centred book', () => {
    const { book: app } = centredBook({ pageCount: 6, flippingTime: 1000, startPage: 3 });
    const flip = app.getFlipController()!;

    expect(app.getBoundsRect().top).toBe(150);

    expect(flip.flipPrev(FlipCorner.BOTTOM)).toBe(true);
    expect(flip.getCalculation()!.getCorner()).toBe(FlipCorner.BOTTOM);
  });
});

describe('I8 — the landscape density override is temporary', () => {
  function landscapeBook(flippingTime: number) {
    // showCover + 6 pages: created densities are [hard, soft, soft, soft, soft,
    // hard], so the cover and its neighbour genuinely differ and the fix-up
    // really fires. A fixture where they already matched would pass either way.
    return book({
      pageCount: 6,
      showCover: true,
      usePortrait: false,
      width: 200,
      height: 300,
      hostWidth: 420,
      hostHeight: 600,
      flippingTime,
    });
  }

  test('the fixture creates genuinely mixed densities in landscape', () => {
    const { book: app } = landscapeBook(0);
    expect(app.getOrientation()).toBe(Orientation.LANDSCAPE);

    const pages = app.getPageCollection();
    expect(pages.getPage(0).getDensity()).toBe(PageDensity.HARD);
    expect(pages.getPage(1).getDensity()).toBe(PageDensity.SOFT);
    expect(pages.getPage(5).getDensity()).toBe(PageDensity.HARD);
  });

  test('the override IS applied while the turn is in flight', () => {
    const { book: app } = landscapeBook(1000);
    const flip = app.getFlipController()!;

    expect(flip.flipNext(FlipCorner.TOP)).toBe(true);

    // The soft page next to the hard cover has to bend like a hard page for the
    // duration of the turn — a "fix" that simply dropped this would be wrong.
    expect(app.getPageCollection().getPage(1).getDrawingDensity()).toBe(PageDensity.HARD);
  });

  test('every drawing density is back to its created value after the turn', () => {
    const { book: app } = landscapeBook(0);
    const pages = app.getPageCollection();

    expect(app.getFlipController()!.flipNext(FlipCorner.TOP)).toBe(true);

    for (let i = 0; i < pages.getPageCount(); i++) {
      const page = pages.getPage(i);
      expect([i, page.getDrawingDensity()]).toStrictEqual([i, page.getDensity()]);
    }
  });

  test('the NEIGHBOUR is restored too, on the turn where the neighbour is the soft one', () => {
    // Forward onto the trailing single-page spread: the flipping page is the
    // hard last page and the *neighbour* is the soft one, so restoring only the
    // flipping page (whose created density is hard anyway) would look fine here
    // and still leave page 4 hard forever.
    const { book: app } = landscapeBook(0);
    const pages = app.getPageCollection();

    app.turnToPage(3);
    expect(pages.getCurrentSpreadIndex()).toBe(2);
    expect(pages.getPage(4).getDensity()).toBe(PageDensity.SOFT);
    expect(pages.getPage(5).getDensity()).toBe(PageDensity.HARD);

    expect(app.getFlipController()!.flipNext(FlipCorner.TOP)).toBe(true);

    expect(pages.getPage(4).getDrawingDensity()).toBe(PageDensity.SOFT);
  });

  test('a soft page can still curl after several landscape turns', () => {
    const { book: app } = landscapeBook(0);
    const flip = app.getFlipController()!;
    const pages = app.getPageCollection();

    flip.flipNext(FlipCorner.TOP);
    flip.flipNext(FlipCorner.TOP);
    flip.flipPrev(FlipCorner.TOP);

    expect(pages.getPage(1).getDrawingDensity()).toBe(PageDensity.SOFT);
    expect(pages.getPage(2).getDrawingDensity()).toBe(PageDensity.SOFT);
  });
});

describe('R4 (real path): a turn chained from onFlip survives the old callback', () => {
  test('flipNext() called from an onFlip listener actually commits', async () => {
    const { book: flip } = book({ pageCount: 6, flippingTime: 40 });

    // Prime the frame clock: an animation binds its start to the first frame it
    // is drawn on, but the loop still has to be running.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const seen: number[] = [];
    let chained = false;
    flip.on('flip', (e) => {
      seen.push(e.data as number);
      if (!chained) {
        chained = true;
        // `turnToNextPage()` emits this SYNCHRONOUSLY from inside the old
        // turn's completion callback. Starting a turn here is the exact
        // re-entrancy that the teardown below used to destroy.
        flip.flipNext();
      }
    });

    flip.flipNext();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    // Before the fix the second turn's calc, flipping page and state were all
    // cleared by the FIRST turn's callback, so it animated to nothing and never
    // committed: the book stopped one page short, with no error anywhere.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(flip.getCurrentPageIndex()).toBeGreaterThanOrEqual(2);
    expect(flip.getState()).toBe(FlippingState.READ);
  });
});

describe('I9 — leaving a corner must not announce READ over a live snap-back', () => {
  /**
   * A book big enough that the corner bands and the "not a corner" middle are
   * genuinely distinct: 200x300 portrait leaf, `operatingDistance` 72.1.
   */
  function hoverBook() {
    return book({ pageCount: 6, flippingTime: 1000, showPageCorners: true });
  }

  test('the state stays FOLD_CORNER until the snap-back finishes', () => {
    const { book: app } = hoverBook();
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const states: string[] = [];
    app.on('changeState', (e) => states.push(String(e.data)));

    // Hover the top-right corner: the fold peels in.
    app.userMove({ x: rect.left + rect.width - 3, y: rect.top + 3 }, false);
    expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
    expect(states).toEqual(['fold_corner']);

    // Now move off the corner, into the vertical middle of the leaf — which is
    // not a corner by either band — while the fold-in animation is still
    // running. `showCorner`'s exit branch starts the snap-back.
    app.userMove({ x: rect.left + rect.width - 100, y: rect.top + rect.height / 2 }, false);

    // Reverted fix: `setState(READ)` ran BEFORE `stopMove()` started that
    // snap-back, so the book claimed to be reading while a calculation was
    // still live and animating. `UI.onPointerMove` reads READ as "not
    // flipping", so the next pointer move re-entered `showCorner`, found
    // `calc !== null` and jumped straight to `do()` — the releasing fold
    // snapping onto the pointer.
    expect(flip.getCalculation()).not.toBeNull();
    expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
    expect(states).toEqual(['fold_corner']);
  });

  test('…and READ is announced once the fold has actually settled', () => {
    // The guard against the lazy version of the fix — deleting the `setState`
    // and leaving nothing to hand the state back. The book must still settle.
    const { book: app } = hoverBook();
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const states: string[] = [];
    app.on('changeState', (e) => states.push(String(e.data)));

    app.userMove({ x: rect.left + rect.width - 3, y: rect.top + 3 }, false);
    app.userMove({ x: rect.left + rect.width - 100, y: rect.top + rect.height / 2 }, false);

    // A second move off the corner commits the snap-back through
    // `finishAnimation()` — the same thing the render loop would do a frame
    // later, without waiting on rAF.
    app.userMove({ x: rect.left + rect.width - 100, y: rect.top + rect.height / 2 }, false);

    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(states).toEqual(['fold_corner', 'read']);

    // No page was turned by any of it.
    expect(app.getCurrentPageIndex()).toBe(0);
  });

  test('a corner hover with nothing to snap back still settles immediately', () => {
    // `stopMove()`'s other path: the fold was refused, so there is no
    // calculation and no animation, and READ has to be handed back at once
    // rather than waiting for an animation that will never run.
    const { book: app } = book({ pageCount: 4, startPage: 3, flippingTime: 1000 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    // Forward corner on the last spread: `start()` refuses it.
    app.userMove({ x: rect.left + rect.width - 3, y: rect.top + 3 }, false);
    expect(flip.getState()).toBe(FlippingState.READ);

    app.userMove({ x: rect.left + rect.width - 100, y: rect.top + rect.height / 2 }, false);
    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
  });
});

describe('I10 — the corner band and the direction split cannot disagree', () => {
  /**
   * A leaf 100 wide and 600 tall. The ratio is the whole test: the band is a
   * fifth of the page DIAGONAL, so it exceeds `pageWidth` as soon as
   * `height > pageWidth * sqrt(24)` (~4.9x) — here 121.7 against a 100-wide
   * leaf. At ordinary proportions the clamp is inert and the fixture would
   * prove nothing.
   */
  function tallNarrowPortrait(opts?: Parameters<typeof makeHtmlBook>[0]) {
    return book({ width: 100, height: 600, pageCount: 6, ...opts });
  }

  test('the middle of a tall narrow leaf is not a corner', () => {
    const { book: app } = tallNarrowPortrait();
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    expect(app.getOrientation()).toBe(Orientation.PORTRAIT);
    expect(rect.pageWidth).toBe(100);
    // The precondition, asserted rather than assumed: without it this whole
    // describe block is a test of ordinary proportions, where both derivations
    // already agree.
    expect(Math.sqrt(rect.pageWidth ** 2 + rect.height ** 2) / 5).toBeGreaterThan(rect.pageWidth);

    // The visible leaf occupies the RIGHT half of the portrait bounds rect.
    const leaf = (offset: number, y: number) => ({
      x: rect.left + rect.width - rect.pageWidth + offset,
      y: rect.top + y,
    });

    // Reverted fix: `operatingDistance` (121.7) covers the entire 100-wide
    // leaf, so every one of these is a "corner" — the middle of the page
    // hover-peels, and `disableFlipByClick` stops restricting anything.
    expect(flip.isPointOnCorners(leaf(50, 5))).toBe(false);
    expect(flip.isPointOnCorners(leaf(50, rect.height - 5))).toBe(false);
    expect(flip.isPointOnCorners(leaf(45, 5))).toBe(false);
    expect(flip.isPointOnCorners(leaf(55, 5))).toBe(false);

    // …while the actual corners are all still corners.
    expect(flip.isPointOnCorners(leaf(5, 5))).toBe(true);
    expect(flip.isPointOnCorners(leaf(95, 5))).toBe(true);
    expect(flip.isPointOnCorners(leaf(5, rect.height - 5))).toBe(true);
    expect(flip.isPointOnCorners(leaf(95, rect.height - 5))).toBe(true);
  });

  test('every accepted point folds the leaf its own half of the split names', () => {
    // The invariant, swept rather than sampled: a point in the BACK half of the
    // book may only qualify through the band on the BACK edge, and vice versa.
    // A band that reaches across the split is what makes an inner-edge hover
    // peel the opposite edge.
    const { book: app } = tallNarrowPortrait();
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const visibleLeft = rect.width - rect.pageWidth;
    // The portrait split: the leading 2/5 of the leaf turns BACK, the rest
    // FORWARD. Derived from the split alone — not from the clamp — so the test
    // states the contract rather than restating the implementation.
    const splitOffset = (rect.pageWidth * 2) / 5;

    const backCorners: number[] = [];
    const forwardCorners: number[] = [];

    for (let offset = 1; offset < rect.pageWidth; offset += 1) {
      const point = { x: rect.left + visibleLeft + offset, y: rect.top + 5 };
      if (!flip.isPointOnCorners(point)) continue;

      const backHalf = offset <= splitOffset;
      (backHalf ? backCorners : forwardCorners).push(offset);

      // A corner band may not reach further from its own outer edge than the
      // split does from the same edge — otherwise a point the split assigns to
      // one leaf qualifies as a corner of the other. Reverted fix: the band is
      // 121.7 on a 100-wide leaf, so offset 50 lands in the FORWARD half while
      // sitting 50 from its own (right) edge, half the leaf away.
      const distanceToOwnEdge = backHalf ? offset : rect.pageWidth - offset;
      expect(distanceToOwnEdge).toBeLessThan(splitOffset);
    }

    // Both corners still exist — a band clamped to nothing would satisfy the
    // loop above vacuously.
    expect(backCorners.length).toBeGreaterThan(0);
    expect(forwardCorners.length).toBeGreaterThan(0);
    // …and there is a real stretch of leaf between them that is not a corner.
    expect(backCorners.length + forwardCorners.length).toBeLessThan(rect.pageWidth - 10);
  });

  test('ordinary proportions are untouched', () => {
    // The clamp must be inert where the diagonal already fits inside the leaf —
    // otherwise it is not a fix, it is a narrowing of every book's corners.
    const { book: app } = book({ pageCount: 6, width: 200, height: 300 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    // `operatingDistance` is 72.1 against a 200-wide leaf and a 2/5 split at 80.
    const leafLeft = rect.left + rect.width - rect.pageWidth;

    expect(flip.isPointOnCorners({ x: leafLeft + 70, y: rect.top + 5 })).toBe(true);
    expect(flip.isPointOnCorners({ x: leafLeft + 74, y: rect.top + 5 })).toBe(false);
    expect(flip.isPointOnCorners({ x: leafLeft + 195, y: rect.top + 5 })).toBe(true);
    expect(flip.isPointOnCorners({ x: leafLeft + 100, y: rect.top + rect.height / 2 })).toBe(false);
  });

  test('a mid-leaf click is refused when disableFlipByClick is on', () => {
    // The user-facing half, through the public surface: `PageFlip` gates
    // `disableFlipByClick` on exactly this predicate, so a band that swallows
    // the whole leaf makes the setting silently inert.
    const { book: app } = tallNarrowPortrait({ disableFlipByClick: true });
    const rect = app.getBoundsRect();

    const rejected: string[] = [];
    app.on('turnRejected', (e) => rejected.push((e.data as { reason: string }).reason));

    const mid = {
      x: rect.left + rect.width - rect.pageWidth / 2,
      y: rect.top + rect.height / 2,
    };
    app.startUserTouch(mid);
    app.userStop(mid, false);

    expect(rejected).toEqual(['disabled']);
    expect(app.getCurrentPageIndex()).toBe(0);
  });
});

describe('F7 — flipping to a page already on screen is a declared no-op', () => {
  /** Landscape, so a spread holds two pages and the case can exist at all. */
  function landscapeBook(opts?: Parameters<typeof makeHtmlBook>[0]) {
    return book({
      pageCount: 6,
      width: 200,
      height: 300,
      hostWidth: 420,
      hostHeight: 300,
      flippingTime: 0,
      ...opts,
    });
  }

  test('flip() to the partner half of the current spread does nothing, quietly', () => {
    const { book: app } = landscapeBook();
    const pages = app.getPageCollection();

    expect(app.getOrientation()).toBe(Orientation.LANDSCAPE);

    const spread = pages.getCurrentSpreadIndex();
    const partner = 1;
    // The precondition: page 1 really is the OTHER half of the spread page 0 is
    // on. On a portrait fixture this test would be vacuous.
    expect(pages.getSpreadIndexByPage(partner)).toBe(spread);

    const events: string[] = [];
    app.on('flip', () => events.push('flip'));
    app.on('changeState', (e) => events.push(`state:${String(e.data)}`));
    app.on('turnRejected', (e) => events.push(`rejected:${(e.data as { reason: string }).reason}`));

    expect(() => {
      app.flip(partner);
    }).not.toThrow();

    // Nothing animated, nothing was rejected, and the postcondition of the call
    // — "page 1 is visible" — held before it and holds after it.
    expect(events).toEqual([]);
    expect(pages.getCurrentSpreadIndex()).toBe(spread);
    expect(app.getCurrentPageIndex()).toBe(0);
    expect(pages.getSpreadIndexByPage(partner)).toBe(pages.getCurrentSpreadIndex());
  });

  test('the same call to a page on a DIFFERENT spread still turns', () => {
    // The discriminator: without it the test above is satisfied by an engine
    // that has stopped turning pages altogether.
    const { book: app } = landscapeBook();
    const pages = app.getPageCollection();

    app.flip(3);

    expect(pages.getCurrentSpreadIndex()).toBe(1);
    expect(pages.getSpreadIndexByPage(3)).toBe(pages.getCurrentSpreadIndex());
  });

  test('a page that is in no spread still throws', () => {
    // The no-op is for a request that is ALREADY satisfied; a request that
    // cannot be satisfied keeps failing loudly.
    const { book: app } = landscapeBook();

    expect(() => {
      app.flip(99);
    }).toThrow();
  });
});
