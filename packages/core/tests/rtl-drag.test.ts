/**
 * `readingDirection: 'rtl'` mirrors the TURN DIRECTION and never the pointer
 * coordinates (CLAUDE.md). The defect these tests pin (inventory I2) is the
 * second-order version of that rule: `Render.convertToPage` derives local x
 * FROM the direction it is given, so handing it the already-mirrored direction
 * mirrored the coordinates too. A 30 px inward drag reported 92.5% progress in
 * RTL against 7.5% in LTR, and released into a committed page turn.
 *
 * The bar these tests are written to: every geometric assertion is made against
 * the LTR value for the *same physical edge*, so a fix that un-mirrors the
 * coordinate while also un-mirroring the page selection (the obvious wrong
 * variant) fails the index assertions rather than sliding through.
 *
 * Preconditions are asserted before behaviour on purpose — a fixture whose
 * orientation or spread silently differs is how a wrong value has coincided
 * with a right one here before.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { FlipCorner, Orientation } from '@gullabs/flipbook-core';
import type { PageFlip } from '@gullabs/flipbook-core';
import { makeHtmlBook } from './html-book-fixture';
import { testFlip, testRender, testPage } from './engine-access';
import { FlipDirection } from '../src/Flip/Flip';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

type Reading = 'ltr' | 'rtl';

/**
 * A LANDSCAPE book, deliberately: portrait puts the whole page on the book's
 * right half, so the BACK local frame lies off-screen and a BACK drag starts at
 * ~57% progress even under LTR (recorded separately — it is not this fix).
 * Landscape gives both directions a real, symmetric half to be measured on,
 * which is what makes "the same edge behaves the same" a meaningful assertion.
 */
function landscapeBook(readingDirection: Reading, initialPage = 2): PageFlip {
  const b = makeHtmlBook({
    pageCount: 6,
    flippingTime: 0,
    initialPage,
    readingDirection,
    usePortrait: false,
    hostWidth: 500,
  });
  books.push(b);
  return b.book;
}

function portraitBook(readingDirection: Reading, initialPage = 2): PageFlip {
  const b = makeHtmlBook({
    pageCount: 6,
    flippingTime: 0,
    initialPage,
    readingDirection,
    usePortrait: true,
  });
  books.push(b);
  return b.book;
}

/** Book-global point `inset` px inside the named outer edge of the book. */
function edgePoint(
  book: PageFlip,
  edge: 'left' | 'right',
  inset: number,
): { x: number; y: number } {
  const rect = book.getBoundsRect();

  return {
    x: edge === 'left' ? rect.left + inset : rect.left + rect.width - inset,
    y: rect.top + 20,
  };
}

/** Open a fold at `point` and report what the engine made of it. */
function foldAt(book: PageFlip, point: { x: number; y: number }) {
  const flip = testFlip(book);
  if (flip === null) throw new Error('no flip controller');

  flip.fold(point);

  const calc = flip.getCalculation();
  if (calc === null) throw new Error('fold did not open a calculation');

  return {
    flip,
    calc,
    localX: testRender(book).convertToPage(point).x,
    progress: calc.getFlippingProgress(),
  };
}

describe('the fixture is what the assertions assume', () => {
  test('landscape, spread [2,3], symmetric 200 px halves', () => {
    for (const reading of ['ltr', 'rtl'] as const) {
      const book = landscapeBook(reading);

      expect(book.getOrientation()).toBe(Orientation.LANDSCAPE);
      expect(book.getCurrentPageIndex()).toBe(2);
      expect(book.getBoundsRect()).toEqual({
        left: 50,
        top: 0,
        width: 400,
        height: 300,
        pageWidth: 200,
      });
    }
  });

  test('portrait fixture really is portrait, and on page 2', () => {
    for (const reading of ['ltr', 'rtl'] as const) {
      const book = portraitBook(reading);

      expect(book.getOrientation()).toBe(Orientation.PORTRAIT);
      expect(book.getCurrentPageIndex()).toBe(2);
    }
  });
});

describe('the fold follows the finger under rtl (I2)', () => {
  test('a 30 px inward drag measures 30 px of fold on every edge, both readings', () => {
    const inset = 30;

    for (const reading of ['ltr', 'rtl'] as const) {
      for (const edge of ['left', 'right'] as const) {
        const book = landscapeBook(reading);
        const { localX, progress } = foldAt(book, edgePoint(book, edge, inset));

        // Local x is the distance from the spine along the half being folded,
        // so a finger 30 px inside the outer edge sits at pageWidth - 30.
        expect(localX, `${reading} ${edge}`).toBeCloseTo(200 - inset, 5);
        expect(progress, `${reading} ${edge}`).toBeCloseTo(7.5, 5);
      }
    }
  });

  test('rtl progress equals ltr progress for the same edge, at every drag depth', () => {
    for (const inset of [5, 30, 80, 150]) {
      for (const edge of ['left', 'right'] as const) {
        const ltr = landscapeBook('ltr');
        const rtl = landscapeBook('rtl');

        const a = foldAt(ltr, edgePoint(ltr, edge, inset));
        const b = foldAt(rtl, edgePoint(rtl, edge, inset));

        expect(b.localX, `${edge} @${inset}`).toBeCloseTo(a.localX, 5);
        expect(b.progress, `${edge} @${inset}`).toBeCloseTo(a.progress, 5);
        // Guard against a fixture where the two coincide trivially: none of
        // these drags reaches the half-way mark, so "equal" cannot mean
        // "both pinned at 100".
        expect(a.progress, `${edge} @${inset}`).toBeLessThan(50);
      }
    }
  });

  test('portrait rtl matches portrait ltr on the same edge of the visible page', () => {
    // The visible portrait page occupies the book's RIGHT half, so its own
    // edges are `pageWidth` and `width` in book coordinates.
    for (const inset of [30, 230] as const) {
      const ltr = portraitBook('ltr');
      const rtl = portraitBook('rtl');

      const a = foldAt(ltr, edgePoint(ltr, 'right', inset));
      const b = foldAt(rtl, edgePoint(rtl, 'right', inset));

      expect(b.localX, `inset ${inset}`).toBeCloseTo(a.localX, 5);
      expect(b.progress, `inset ${inset}`).toBeCloseTo(a.progress, 5);
    }
  });

  test('a small rtl drag releases without committing a turn', () => {
    for (const edge of ['left', 'right'] as const) {
      const book = landscapeBook('rtl');
      const before = book.getCurrentPageIndex();

      const { flip } = foldAt(book, edgePoint(book, edge, 8));
      flip.stopMove();

      expect(book.getCurrentPageIndex(), edge).toBe(before);
    }
  });

  test('the geometric side and the semantic direction are opposites under rtl', () => {
    // Locks the two places the mirror is applied — `Render.setDirection` and
    // the `FlipCalculation` built in `Flip.start` — to each other. If they ever
    // drift, the fold and the shadows disagree about which half is moving.
    const book = landscapeBook('rtl');
    const { calc } = foldAt(book, edgePoint(book, 'left', 30));

    expect(testRender(book).getDirection()).toBe(calc.getDirection());
    // The left edge under rtl is a FORWARD *turn*, folded as a BACK *side*.
    expect(calc.getDirection()).toBe(FlipDirection.BACK);
  });

  test('ltr is untouched: the geometric side equals the turn direction', () => {
    const book = landscapeBook('ltr');
    const { calc } = foldAt(book, edgePoint(book, 'left', 30));

    expect(testRender(book).getDirection()).toBe(FlipDirection.BACK);
    expect(calc.getDirection()).toBe(FlipDirection.BACK);
  });
});

describe('rtl still mirrors what it is supposed to mirror', () => {
  /** Drag from `edge` across the spine and release, so `stopMove` commits. */
  function dragAcross(book: PageFlip, edge: 'left' | 'right'): void {
    const rect = book.getBoundsRect();
    const flip = testFlip(book);
    if (flip === null) throw new Error('no flip controller');

    flip.fold(edgePoint(book, edge, 10));
    flip.fold({
      x: rect.left + rect.width / 2 + (edge === 'left' ? 10 : -10),
      y: rect.top + 20,
    });
    flip.stopMove();
  }

  test('a full drag from the left edge turns FORWARD in rtl and BACK in ltr', () => {
    const rtl = landscapeBook('rtl');
    dragAcross(rtl, 'left');
    expect(rtl.getCurrentPageIndex()).toBe(4);

    const ltr = landscapeBook('ltr');
    dragAcross(ltr, 'left');
    expect(ltr.getCurrentPageIndex()).toBe(0);
  });

  test('a full drag from the right edge turns BACK in rtl and FORWARD in ltr', () => {
    const rtl = landscapeBook('rtl');
    dragAcross(rtl, 'right');
    expect(rtl.getCurrentPageIndex()).toBe(0);

    const ltr = landscapeBook('ltr');
    dragAcross(ltr, 'right');
    expect(ltr.getCurrentPageIndex()).toBe(4);
  });

  test('the leaves that move under rtl are the ones the page index is heading for', () => {
    // The index assertions above cannot see this: the collection steps one
    // spread whatever leaves were animated, so a fix that un-mirrors the
    // coordinate *and* the page selection lands on the right page while
    // animating the wrong one. Identity of the mover is the only witness.
    const book = landscapeBook('rtl');
    const render = testRender(book);

    let flipping: unknown = null;
    let bottom: unknown = null;
    const setFlipping = render.setFlippingPage.bind(render);
    const setBottom = render.setBottomPage.bind(render);
    render.setFlippingPage = (page) => {
      if (page !== null) flipping ??= page;
      setFlipping(page);
    };
    render.setBottomPage = (page) => {
      if (page !== null) bottom ??= page;
      setBottom(page);
    };

    // Left edge under rtl is a FORWARD turn: spread [2,3] → spread [4,5].
    foldAt(book, edgePoint(book, 'left', 30));

    // Asserted as a SET, deliberately. Which of the two faces should be the
    // mover and which the page underneath is the open landscape-RTL question
    // recorded alongside this fix; that the pair comes from the destination
    // spread at all is not open, and is what a geometric page selection breaks.
    expect(new Set([flipping, bottom])).toEqual(new Set([testPage(book, 4), testPage(book, 5)]));
  });

  test('programmatic turns stay index-ordered under rtl', () => {
    const book = landscapeBook('rtl');
    const flip = testFlip(book);
    if (flip === null) throw new Error('no flip controller');

    expect(flip.flipNext(FlipCorner.TOP)).toBe(true);
    expect(book.getCurrentPageIndex()).toBe(4);

    expect(flip.flipPrev(FlipCorner.TOP)).toBe(true);
    expect(book.getCurrentPageIndex()).toBe(2);
  });

  test('turnToPage lands on the requested page under rtl', () => {
    const book = landscapeBook('rtl');

    book.flipToPage(4, FlipCorner.TOP);
    expect(book.getCurrentPageIndex()).toBe(4);

    book.flipToPage(0, FlipCorner.TOP);
    expect(book.getCurrentPageIndex()).toBe(0);
  });
});
