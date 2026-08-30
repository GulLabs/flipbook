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
    app.turnToPage(0);
    expect(flip.start({ x: rect.left + 2, y: rect.top + 10 })).toBe(false);
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
