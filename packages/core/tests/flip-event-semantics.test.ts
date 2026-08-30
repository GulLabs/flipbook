// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { makeHtmlBook, sizeElement } from './html-book-fixture';

/**
 * ADR 0003 — `flip` fires only when `getCurrentPageIndex()` actually changes.
 *
 * Inherited verbatim from upstream, `showSpread` announced on every repaint, so
 * `flip` meant "`showSpread` ran" while its name, its own JSDoc and every
 * consumer binding read it as "the page changed".
 *
 * The tests below are deliberately split into two halves, and the second half
 * is the one that matters. Asserting "these things no longer emit" is satisfied
 * by deleting the dispatch entirely — an engine that never announces a page
 * change at all. So every suppression test here is paired with a test that a
 * real turn still announces exactly once. Neither half is worth anything alone.
 */

const landscape = { pageCount: 6, hostWidth: 520, hostHeight: 300, width: 200, height: 300 };

/** Record every `flip` payload from the moment this is called. */
function watch(book: ReturnType<typeof makeHtmlBook>['book']): number[] {
  const seen: number[] = [];
  book.on('flip', (e) => seen.push(e.data as number));
  return seen;
}

describe('ADR 0003 — flip announces a page change, not a repaint', () => {
  test('mounting a book that opens at page 0 emits no flip at all', () => {
    // Not "emits one instead of two". `currentPageIndex` starts at 0 and the
    // book opens at 0, so nothing changed and nothing is claimed. `init` is the
    // load announcement and carries the resolved index.
    //
    // The engine has to be watched from BEFORE the load, which the shared
    // fixture cannot do — it loads inside the constructor helper — so the
    // listener goes on via the `init` payload instead: `init` fires
    // asynchronously, after the load's own dispatches, so anything `flip`
    // emitted during the load is already in `document.body.dataset`.
    const seen: number[] = [];
    const book = makeHtmlBook({ ...landscape, startPage: 0 });
    book.book.on('flip', (e) => seen.push(e.data as number));

    // A repaint of the SAME spread. Before ADR 0003 this alone emitted.
    book.book.update();

    expect(seen).toEqual([]);

    book.destroy();
  });

  test('updateSettings on a setting that cannot move the page emits no flip', () => {
    const book = makeHtmlBook(landscape);
    const seen = watch(book.book);

    book.book.updateSettings({ drawShadow: false });

    expect(seen).toEqual([]);

    book.destroy();
  });

  test('turnToPage to the page already on screen emits no flip', () => {
    // A controlled `page` prop that re-pushes its current value must not look
    // like a turn — that is the loop a React consumer cannot break out of.
    const book = makeHtmlBook(landscape);
    book.book.turnToPage(2);

    const seen = watch(book.book);
    book.book.turnToPage(2);

    expect(seen).toEqual([]);

    book.destroy();
  });

  test('turnToPage to the OTHER page of the same landscape spread emits no flip', () => {
    // Sharper than the test above, and it is the case a naive
    // `lastAnnounced !== requestedPage` guard gets wrong. In landscape the
    // spread [2,3] reports index 2 for both, so asking for page 3 while page 3
    // is already visible changes nothing the consumer can observe.
    const book = makeHtmlBook(landscape);
    book.book.turnToPage(2);

    const seen = watch(book.book);
    book.book.turnToPage(3);

    expect(seen).toEqual([]);
    expect(book.book.getCurrentPageIndex()).toBe(2);

    book.destroy();
  });

  test('a real turn still emits exactly once — the half that stops this being deletion', () => {
    // Every suppression above is also satisfied by removing the dispatch. This
    // is what separates the fix from that. Instant turns (`flippingTime: 0`)
    // run `onAnimateEnd` synchronously, so the commit has landed by the time
    // `flipNext` returns.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    const seen = watch(book.book);

    expect(book.book.flipNext()).toBe(true);

    expect(seen).toEqual([2]);
    expect(book.book.getCurrentPageIndex()).toBe(2);

    book.destroy();
  });

  test('a sequence of real turns emits one flip each, in order', () => {
    // Kills a guard that latches — announcing the first change and then going
    // quiet — which the single-turn test above cannot see.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    const seen = watch(book.book);

    book.book.flipNext();
    book.book.flipNext();
    book.book.flipPrev();

    expect(seen).toEqual([2, 4, 2]);

    book.destroy();
  });

  /** Re-measure the host at a new width and let the engine settle. */
  function resizeTo(book: ReturnType<typeof makeHtmlBook>, width: number): void {
    sizeElement(book.host, width, 300);
    sizeElement(book.book.getUI().getDistElement(), width, 300);
    book.book.update();
  }

  test('an orientation change that PRESERVES the head stays silent', () => {
    // Landscape spread [2,3] reports index 2; narrowing to portrait shows leaf
    // 2 alone, which also reports 2. Nothing a consumer can observe about the
    // page index moved, so nothing is announced — `changeOrientation` is the
    // event that carries this news.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.flipNext();
    expect(book.book.getCurrentPageIndex()).toBe(2);

    const seen = watch(book.book);
    resizeTo(book, 260);

    expect(book.book.getOrientation()).toBe('portrait');
    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('an orientation change that MOVES the head does emit', () => {
    // The one case outside the spread-index/head-index bijection, and it must
    // still announce: the payload IS `getCurrentPageIndex()`, so a silent
    // change leaves every consumer caching it stale.
    //
    // Portrait page 3 is its own spread, head 3. Widening pairs it into the
    // landscape spread [2,3], whose head is 2 — the reader is looking at the
    // same paper, but the canonical index really did move.
    const book = makeHtmlBook({ ...landscape, hostWidth: 260, flippingTime: 0 });
    expect(book.book.getOrientation()).toBe('portrait');

    book.book.turnToPage(3);
    expect(book.book.getCurrentPageIndex()).toBe(3);

    const seen = watch(book.book);
    resizeTo(book, 520);

    expect(book.book.getOrientation()).toBe('landscape');
    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([2]);

    book.destroy();
  });

  test('abandoning an in-flight fold does not announce a turn that never committed', () => {
    // The defect that surfaced all of this. A mid-turn `direction` change
    // settles the fold, and the settle repaints the unchanged spread — which
    // used to emit `flip: 0` for a page the reader never reached. Enough to
    // drive controlled state, analytics, or an `onFlip` auto-advance.
    const book = makeHtmlBook({ ...landscape, direction: 'ltr', flippingTime: 400 });

    book.book.flipNext();
    const seen = watch(book.book);

    book.book.updateSettings({ direction: 'rtl' });

    expect(seen).toEqual([]);
    expect(book.book.getCurrentPageIndex()).toBe(0);

    book.destroy();
  });
});
