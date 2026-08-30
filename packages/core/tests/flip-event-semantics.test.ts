// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { HTMLPageCollection, PageFlip } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages, sizeElement } from './html-book-fixture';
import {
  ADOPT_ORIENTATION,
  DROP_POINTER_GESTURE,
  EMIT_PAGE_INDEX,
  EMIT_STATE,
  INHERIT_PAGE_INDEX,
  SEED_OPENING_INDEX,
  SET_ORIENTATION_STYLE,
  SET_SPREAD_INDEX,
} from '../src/internal';

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
    // Built by hand rather than through `makeHtmlBook`, and that is the whole
    // point of the test: the fixture calls `loadFromHTML` inside itself, so a
    // listener attached to its return value has already MISSED the mount. A
    // first-load exception that kept the old double-emit passed the earlier
    // version of this test for exactly that reason.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = makePages(6);
    for (const p of pages) host.appendChild(p);

    const book = new PageFlip(host, { width: 200, height: 300, size: 'fixed' });

    const seen: number[] = [];
    book.on('flip', (e) => seen.push(e.data as number));

    book.loadFromHTML(pages);

    expect(seen).toEqual([]);
    expect(book.getCurrentPageIndex()).toBe(0);

    // A repaint of the SAME spread. Before ADR 0003 this alone emitted.
    book.update();
    expect(seen).toEqual([]);

    book.destroy();
    host.remove();
  });

  test('mounting at a nonzero startPage emits no flip either — and none before init', async () => {
    // C2. The sibling above passes because the book opens where the fresh
    // collection already sits. With `startPage: 4` the head moves 0 -> 4 during
    // the synchronous `pages.show(...)` in `attachMode`, so the ADR 0003 guard
    // announced `flip(4)` — for a book no reader has touched, and BEFORE `init`,
    // which ADR 0003 makes the seeding event. A consumer binding `flip` to
    // controlled state is driven to page 4 by a mount.
    //
    // The ordering half matters independently: `init` is dispatched from a
    // `setTimeout`, so any synchronous emit necessarily precedes it. An `init`
    // handler that seeds state therefore runs AFTER the `flip` it is supposed
    // to be the baseline for, and overwrites nothing — the desync is silent.
    //
    // Built by hand for the same reason as the sibling: `makeHtmlBook` loads
    // inside itself, so a listener on its return value has already missed this.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = makePages(6);
    for (const p of pages) host.appendChild(p);

    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      startPage: 4,
    });

    const order: string[] = [];
    const flips: number[] = [];
    book.on('flip', (e) => {
      order.push('flip');
      flips.push(e.data as number);
    });
    book.on('init', () => order.push('init'));

    book.loadFromHTML(pages);

    expect(flips).toEqual([]);
    expect(book.getCurrentPageIndex()).toBe(4);

    // MUST await the timer. `init` is dispatched from `setTimeout(..., 1)`, so
    // asserting `order` synchronously can only ever observe an empty array —
    // the ordering claim was vacuous, and a mutant that moved the spurious
    // `flip` INTO the init timer, ahead of `init`, passed. Measured.
    //
    // `['init']` is strictly stronger than `[]`: it proves the flip is absent
    // AND that `init` still arrives AND that nothing precedes it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['init']);

    book.destroy();
    host.remove();
  });

  test('clear() then reload at a nonzero startPage is silent too', async () => {
    // The gap the engine expert found in the first C2 fix. `isFirstLoad` was
    // `this.pages === null`, and `clear()` does NOT null it — `PageCollection`
    // is emptied in place and keeps the index it held when full. So a reload
    // after a clear took the RELOAD branch, where `outgoing` is the placeholder
    // 0 that `resolvedPageIndex` returns for an empty collection, and the guard
    // announced `flip(4)` before `init` all over again.
    //
    // An emptied collection is not a book the reader was on. For the purpose of
    // the baseline it is the same as no collection at all, which is what the
    // condition now says.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = makePages(6);
    for (const p of pages) host.appendChild(p);

    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      startPage: 4,
    });
    book.loadFromHTML(pages);
    book.clear();

    // Only what happens from HERE is under test; `clear()` announces its own
    // move to an empty book, which is a real change and correctly reported.
    const order: string[] = [];
    book.on('flip', (e) => order.push(`flip:${String(e.data)}`));
    book.on('init', () => order.push('init'));

    const reloaded = makePages(6);
    for (const p of reloaded) host.appendChild(p);
    book.loadFromHTML(reloaded);

    expect(book.getCurrentPageIndex()).toBe(4);

    // Same reason as the sibling: assert AFTER the init timer, or the ordering
    // half of this test proves nothing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['init']);

    book.destroy();
    host.remove();
  });

  test('LANDSCAPE: the baseline is the spread HEAD, not the requested page', () => {
    // A guard on the SHAPE of the C2 fix, not a second reproduction of it —
    // stated plainly because a test whose comment overclaims is worse than no
    // test. The unfixed engine passes this one: its baseline is 0 and the head
    // is 0, so it stays silent by luck.
    //
    // What it kills is the obvious wrong fix. Seeding the REQUESTED page rather
    // than the head looks identical in the sibling above, because that book is
    // portrait — jsdom leaves the host at 0x0 — and every portrait spread is one
    // page, so head === request. Here spread [0, 1] has head 0 while the request
    // is 1, and seeding 1 trades a spurious `flip(4)` for a spurious `flip(0)`.
    // That is why the resolution lives inside the collection: it is the only
    // thing that can see the spread table.
    //
    // `usePortrait: false` rather than a post-load resize, and that is load-
    // bearing: sizing the dist element after `loadFromHTML` makes the book
    // portrait AT LOAD and landscape only on the following `update()`, and that
    // orientation re-canonicalisation moves the head 1 -> 0, which ADR 0003
    // requires to emit. The first draft of this test did exactly that and read
    // the correct emit as a failure.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = makePages(landscape.pageCount);
    for (const p of pages) host.appendChild(p);

    const book = new PageFlip(host, {
      width: landscape.width,
      height: landscape.height,
      size: 'fixed',
      usePortrait: false,
      startPage: 1,
    });

    const seen: number[] = [];
    book.on('flip', (e) => seen.push(e.data as number));

    book.loadFromHTML(pages);

    expect(book.getOrientation()).toBe('landscape');
    // Spread [0, 1]: the requested page is on screen, under a different index.
    expect(book.getCurrentPageIndex()).toBe(0);
    expect(seen).toEqual([]);

    book.destroy();
    host.remove();
  });

  test('replacing the page NODES at the same index emits no flip', () => {
    // Codex's blocker, and the most common call the React binding makes: every
    // time children change, `updateFromHtml` builds a FRESH collection, which
    // starts at index 0, and re-shows the preserved index. The guard then
    // compared 0 against 2 and announced a turn to page 2 for a reader already
    // on page 2 — a false `onPageChange` on every re-render that swaps nodes.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.turnToPage(2);
    expect(book.book.getCurrentPageIndex()).toBe(2);

    const seen = watch(book.book);

    const replacement = makePages(6);
    for (const p of replacement) book.host.appendChild(p);
    book.book.updateFromHtml(replacement);

    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('replacePages seeds too — its own call site, its own test', () => {
    // `updateFromHtml` and `replacePages` seed at SEPARATE call sites, so the
    // test above covers only one of them: deleting the `replacePages` seed
    // passed the whole suite. `replacePages` is the public entry a non-HTML
    // renderer would use, and it takes an already-built collection, which is
    // why the seed cannot simply live in a constructor.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.turnToPage(2);
    expect(book.book.getCurrentPageIndex()).toBe(2);

    const seen = watch(book.book);

    const replacement = makePages(6);
    for (const p of replacement) book.host.appendChild(p);
    book.book.replacePages(
      new HTMLPageCollection(
        book.book,
        book.book.getRender(),
        book.book.getUI().getDistElement(),
        replacement,
      ),
      2,
    );

    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('replacing with a SHORTER book that clamps the index does emit', () => {
    // The negative control for the seeding, and it is what stops the fix from
    // being "never announce on a replacement". The book is on page 4; the new
    // one has three pages, so the index really does move and must be reported.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.turnToPage(4);
    expect(book.book.getCurrentPageIndex()).toBe(4);

    const seen = watch(book.book);

    const replacement = makePages(3);
    for (const p of replacement) book.host.appendChild(p);
    book.book.updateFromHtml(replacement);

    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([2]);

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

  test('a consumer cannot fabricate or suppress a flip through the public surface', () => {
    // The two seams that implement ADR 0003 both used to be public methods,
    // and each handed a consumer the power to break the invariant it exists to
    // enforce: `updatePageIndex(4)` FABRICATED a flip for a book on page 0
    // (which a controlled React binding then acts on, navigating itself to a
    // page nothing turned to), and `adoptCurrentPageIndex(4)` SUPPRESSED a real
    // one by pre-loading the baseline. Both are now symbol-keyed in
    // `internal.ts` and unreachable by name.
    const book = makeHtmlBook(landscape);

    const api = book.book as unknown as Record<string, unknown>;
    const collection = book.book.getPageCollection() as unknown as Record<string, unknown>;

    // Every engine-to-engine seam that used to be a named `public` member.
    // `@internal` on one of those is documentation, not a fence: it survives
    // into the emitted `.d.ts` and a consumer can call it.
    // The named seams are gone. Kept as a direct check because these four are
    // the ones that actually shipped public, but the real guard is the frozen
    // surface in `public-surface.test.ts` — see the note there.
    const ui = book.book.getUI() as unknown as Record<string, unknown>;
    for (const name of ['updatePageIndex', 'updateState', 'updateOrientation']) {
      expect(typeof api[name], `PageFlip.${name} is reachable by name`).toBe('undefined');
    }
    expect(typeof ui['setOrientationStyle']).toBe('undefined');
    expect(typeof collection['setCurrentSpreadIndex']).toBe('undefined');
    expect(typeof collection['adoptCurrentPageIndex']).toBe('undefined');

    // …and they MOVED rather than vanished. Without this the block above is
    // satisfied by deleting the seams outright, which would take the engine
    // with them — it pins a NAME, and a name alone is not a behaviour. The
    // symbols are module-private, so this is the one place that can check.
    const seamed = book.book as unknown as Record<symbol, unknown>;
    expect(typeof seamed[EMIT_PAGE_INDEX]).toBe('function');
    expect(typeof seamed[EMIT_STATE]).toBe('function');
    expect(typeof seamed[ADOPT_ORIENTATION]).toBe('function');
    expect(typeof seamed[DROP_POINTER_GESTURE]).toBe('undefined'); // that one lives on UI

    const coll = book.book.getPageCollection() as unknown as Record<symbol, unknown>;
    expect(typeof coll[INHERIT_PAGE_INDEX]).toBe('function');
    expect(typeof coll[SEED_OPENING_INDEX]).toBe('function');
    expect(typeof coll[SET_SPREAD_INDEX]).toBe('function');

    const uiSeams = book.book.getUI() as unknown as Record<symbol, unknown>;
    expect(typeof uiSeams[SET_ORIENTATION_STYLE]).toBe('function');
    expect(typeof uiSeams[DROP_POINTER_GESTURE]).toBe('function');

    book.destroy();
  });

  test('DIRECT navigation announces too, not just animated flipNext/flipPrev', () => {
    // Every emission test so far went through `flipNext` / `flipPrev`. An
    // implementation that announced only from an animation's commit passed all
    // twelve of them while `turnToPage` moved the book silently — and
    // `turnToPage` is what a controlled React `page` prop drives.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    const seen = watch(book.book);

    book.book.turnToPage(4);
    book.book.turnToPage(0);

    expect(seen).toEqual([4, 0]);

    book.destroy();
  });

  test('turnToNextPage / turnToPrevPage announce as well', () => {
    // The commit seams the animation calls into. Reached directly here so that
    // an announcement wired only to the animation path cannot hide.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    const seen = watch(book.book);

    book.book.turnToNextPage();
    book.book.turnToPrevPage();

    expect(seen).toEqual([2, 0]);

    book.destroy();
  });

  test('replacing with a LONGER book that keeps the index stays silent', () => {
    // The third replacement shape. Equal-size and shrinking were covered;
    // growing was not, so an implementation that announced `flip(current)` only
    // when the collection GREW passed every other test while firing an event
    // for an index that did not move.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.turnToPage(2);

    const seen = watch(book.book);

    const replacement = makePages(10);
    for (const p of replacement) book.host.appendChild(p);
    book.book.updateFromHtml(replacement);

    expect(book.book.getCurrentPageIndex()).toBe(2);
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('replacePages to a DIFFERENT page announces', () => {
    // The negative control for seeding `replacePages` from the OUTGOING index
    // rather than the caller's destination. Seeding the destination makes the
    // guard compare 4 against 4 and stay silent through a real 2 -> 4 move.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    book.book.turnToPage(2);

    const seen = watch(book.book);

    const replacement = makePages(6);
    for (const p of replacement) book.host.appendChild(p);
    book.book.replacePages(
      new HTMLPageCollection(
        book.book,
        book.book.getRender(),
        book.book.getUI().getDistElement(),
        replacement,
      ),
      4,
    );

    expect(book.book.getCurrentPageIndex()).toBe(4);
    expect(seen).toEqual([4]);

    book.destroy();
  });

  test('a RELOAD that moves the page announces, and one that does not stays silent', () => {
    // A reload is a collection replacement as far as the consumer is concerned.
    // Without a baseline it was wrong in both directions: reloading a page-4
    // book to `startPage: 0` moved the visible index with no event, and
    // reloading it to `startPage: 4` announced a turn for a book that had not
    // moved.
    const moved = makeHtmlBook({ ...landscape, flippingTime: 0 });
    moved.book.turnToPage(4);
    const movedSeen = watch(moved.book);

    const freshA = makePages(6);
    for (const p of freshA) moved.host.appendChild(p);
    moved.book.loadFromHTML(freshA);

    expect(moved.book.getCurrentPageIndex()).toBe(0);
    expect(movedSeen).toEqual([0]);
    moved.destroy();

    const stayed = makeHtmlBook({ ...landscape, flippingTime: 0, startPage: 4 });
    stayed.book.turnToPage(4);
    const stayedSeen = watch(stayed.book);

    const freshB = makePages(6);
    for (const p of freshB) stayed.host.appendChild(p);
    stayed.book.loadFromHTML(freshB);

    expect(stayed.book.getCurrentPageIndex()).toBe(4);
    expect(stayedSeen).toEqual([]);
    stayed.destroy();
  });

  test('a sequence of real turns emits one flip each, in order', () => {
    // Kills a guard that latches — announcing the first change and then going
    // quiet — which the single-turn test above cannot see.
    const book = makeHtmlBook({ ...landscape, flippingTime: 0 });
    const seen = watch(book.book);

    book.book.flipNext();
    book.book.flipNext();
    book.book.flipPrev();
    book.book.flipPrev();

    // Returning to head 0 is deliberate: `changed && headIdx` — a truthiness
    // guard instead of a comparison — swallows exactly this turn and passes
    // every other assertion in this file.
    expect(seen).toEqual([2, 4, 2, 0]);

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
