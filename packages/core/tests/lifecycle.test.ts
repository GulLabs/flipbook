/**
 * Destroy-path invariants.
 *
 * `UI.distElement` is declared with definite assignment (`!`) rather than
 * `| null`, which is only sound because `PageFlip.ui` stays null until a load
 * completes — so `ui.destroy()` can never observe an unassigned dist element.
 * These tests pin that invariant: if someone constructs a `UI` outside the
 * load path, or makes `destroy()` reachable earlier, this file fails instead
 * of a consumer hitting `Cannot read properties of undefined`.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PageFlip, PageFlipError, FlippingState } from '@gullabs/flipbook-core';
import type { BookSnapshot, FlipSetting } from '@gullabs/flipbook-core';
import { HTMLPageCollection } from '../src/Collection/HTMLPageCollection';
import { testCollection, testFlip, testRender, testUI, testPage } from './engine-access';
import { GET_BLOCK, REPLACE_PAGES } from '../src/internal';
import {
  installPointerCaptureShims,
  makeHtmlBook,
  makePages,
  sizeElement,
} from './html-book-fixture';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PageFlip lifecycle', () => {
  test('destroy() on a never-loaded engine does not throw', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    expect(() => {
      book.destroy();
    }).not.toThrow();
    expect(book.isDestroyed()).toBe(true);
  });

  test('destroy() is idempotent after a load', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    book.loadFromHTML([]);
    book.destroy();
    expect(() => {
      book.destroy();
    }).not.toThrow();
  });

  test('accessors throw a typed error before load rather than returning undefined', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });

    // The published .d.ts promises non-null here; the guard is what makes that
    // promise honest instead of handing callers `undefined`.
    expect(() => testCollection(book)).toThrow(PageFlipError);
    expect(() => testRender(book)).toThrow(PageFlipError);
    expect(() => testUI(book)).toThrow(PageFlipError);
    expect(testFlip(book)).toBeNull();

    book.destroy();
  });

  test('a turn requested before load is rejected, not crashed', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    const rejected: string[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data.reason));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(rejected).toEqual(['notReady', 'notReady']);

    book.destroy();
  });
});

describe('a refused turn is a boolean, a broken one is not', () => {
  /**
   * `flipNext` / `flipPrev` are what a swipe and an arrow key call, where
   * nothing is there to catch. A turn the engine *declines* is `false` plus
   * `turnRejected`. A failure that is not the engine's own still propagates —
   * hiding a broken renderer behind "the page would not turn" is the same
   * silent failure in a different place.
   *
   * Explicit navigation keeps throwing — that is the §4.6 contract.
   */
  test('an engine-internal failure is reported as a rejection, not thrown', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    // Force the engine's own index guard to fire inside the turn.
    const collection = testCollection(book) as unknown as Record<string, unknown>;
    collection['getFlippingPage'] = () => {
      throw new PageFlipError('corrupt spread', 'INVALID_SPREAD');
    };

    expect(book.flipNext()).toBe(false);
    expect(rejected).toEqual([
      expect.objectContaining({ reason: 'setup', code: 'INVALID_SPREAD' }),
    ]);

    book.destroy();
  });

  test('a non-engine error is NOT swallowed into a rejection', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const collection = testCollection(book) as unknown as Record<string, unknown>;
    collection['getFlippingPage'] = () => {
      throw new TypeError('renderer blew up');
    };

    // A real defect must reach the consumer. Converting it to `false` would
    // hide a broken renderer behind "the book just would not turn".
    expect(() => book.flipNext()).toThrow(TypeError);
    expect(rejected).toEqual([]);

    book.destroy();
  });

  test('turnToPage still throws for an unreachable page', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    expect(() => book.turnToPage(99)).toThrow(PageFlipError);

    book.destroy();
  });
});

describe('a refused click is reported, not swallowed', () => {
  function clickAt(book: PageFlip, x: number, y: number): void {
    book.startUserTouch({ x, y });
    book.userStop({ x, y });
  }

  /**
   * `turnRejected` exists to say "your turn was refused". It used to fire only
   * for programmatic turns: `userStop` discarded `flip()`'s boolean, so the'
   * most common way a turn gets refused — a click — was silent. And
   * `reason: 'disabled'` was declared in the public event type while nothing
   * anywhere emitted it.
   */
  test("flipOnClick: 'corners' reports 'disabled' for a mid-leaf click", () => {
    const book = new PageFlip(host(), {
      width: 200,
      height: 300,
      flippingTime: 0,
      flipOnClick: 'corners',
    });
    book.loadFromHTML(makePages(4));

    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    // The middle of the VISIBLE LEAF: not a corner, so policy refuses it.
    //
    // Derived from the rect rather than hard-coded, and this is T1 test debt
    // being paid off, not decoration. The literal `(100, 150)` this used to
    // pass looked like the middle of a 200x300 book and was not: jsdom gives
    // the host a permanent 0x0 layout, so the engine centres a 400x300 portrait
    // rect on the origin and that point converts to book coordinates
    // (400, 300) — the exact bottom-right CORNER of the rect. It only read as
    // "not a corner" because the bounds test excluded its own boundary, so the
    // test agreed with the code for a reason neither of them stated.
    const rect = book.getBoundsRect();
    const leafMiddleX = rect.left + rect.width - rect.pageWidth / 2;
    clickAt(book, leafMiddleX, rect.top + rect.height / 2);

    expect(rejected).toEqual([expect.objectContaining({ reason: 'disabled' })]);
    expect(book.getCurrentPageIndex()).toBe(0);

    book.destroy();
  });

  test('a click at the last page reports the boundary', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(2));
    book.turnToPage(1);

    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    // Right edge, which would turn forward if there were anywhere to go.
    const rect = book.getBoundsRect();
    clickAt(book, rect.left + rect.width - 5, 10);

    expect(rejected).toEqual([expect.objectContaining({ reason: 'boundary' })]);

    book.destroy();
  });

  test('a click that does turn stays silent', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const rect = book.getBoundsRect();
    clickAt(book, rect.left + rect.width - 5, 10);

    expect(rejected).toEqual([]);
    expect(book.getCurrentPageIndex()).toBe(1);

    book.destroy();
  });
});

/**
 * RB4 — `updateFromHtml` must clamp the retained index and report where the
 * book actually landed.
 *
 * `PageCollection.show()` silently returns for an out-of-range index, so
 * `showSpread()` never ran: `Render` kept its left/right references pointing
 * into the collection `updateFromHtml` had just destroyed, and both `update`
 * and `collectionRebuild` reported the refused index. The events are the
 * visible half; the render references are the damage, so both are asserted —
 * a fix that clamps only the number would pass an events-only test while the
 * rAF loop went on painting disposed pages.
 */
describe('updateFromHtml clamps the retained index (RB4)', () => {
  /** The renderer's own page references, which outlive a collection swap. */
  function renderRefs(book: PageFlip): unknown[] {
    const render = testRender(book) as unknown as {
      leftPage: unknown;
      rightPage: unknown;
    };
    return [render.leftPage, render.rightPage].filter((p) => p !== null);
  }

  function expectRenderInsideCollection(book: PageFlip): void {
    const live = testCollection(book).getPages() as unknown[];
    const refs = renderRefs(book);

    // Something must be shown — an empty render would satisfy "no stale page"
    // vacuously.
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(live).toContain(ref);
  }

  test('portrait: a shrinking update lands in range, and says so', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });
    book.turnToPage(5);
    expect(book.getCurrentPageIndex()).toBe(5);

    const rebuilt: { page: number; pageCount: number }[] = [];
    const updated: number[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));
    book.on('pagesChanged', (e) => updated.push(e.data.page));

    book.updateFromHtml(makePages(2));

    // Render state first: it is the actual damage. A fix that clamps only the
    // emitted number leaves the rAF loop painting pages from the destroyed
    // collection, and an assertion ordered after the index check would never
    // be reached to notice.
    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(1);

    expect(rebuilt).toEqual([expect.objectContaining({ page: 1, pageCount: 2 })]);
    expect(updated).toEqual([1]);

    destroy();
  });

  test('landscape: the reported index is the spread it resolved to, not the clamped request', () => {
    // No cover: spreads are [0,1], [2,3], ... so clamping 6 into a 4-page book
    // gives a *request* of 3, which `show()` resolves to spread [2,3] — index
    // 2. Reporting the clamped request instead of the resolved index is the
    // plausible half-fix; these numbers are chosen so the two differ.
    const { book, destroy } = makeHtmlBook({
      pageCount: 8,
      usePortrait: false,
      hardCovers: false,
    });
    expect(book.getOrientation()).toBe('landscape');
    book.turnToPage(6);
    expect(book.getCurrentPageIndex()).toBe(6);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));

    book.updateFromHtml(makePages(4));

    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(2);
    expect(rebuilt).toEqual([expect.objectContaining({ page: 2, pageCount: 4 })]);

    destroy();
  });

  test('an update that keeps the index in range does not move the book', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });
    book.turnToPage(2);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));

    book.updateFromHtml(makePages(6));

    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(2);
    expect(rebuilt).toEqual([expect.objectContaining({ page: 2, pageCount: 6 })]);

    destroy();
  });

  test('updating to an empty book reports 0 and does not throw', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });
    book.turnToPage(3);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));

    expect(() => book.updateFromHtml([])).not.toThrow();
    expect(rebuilt).toEqual([expect.objectContaining({ page: 0, pageCount: 0 })]);

    destroy();
  });
});

/**
 * P2 / I9 — `updateFromHtml` must ABANDON an in-flight turn, not carry it over.
 *
 * `replacePages` does `render.cancelAnimation()` + `flipController.abandon()`
 * precisely because `finishAnimation()` is a *commit*: it runs `onAnimateEnd`
 * and turns the page against a collection that is about to be destroyed. The
 * older HTML path — the one the React binding actually uses — never got it.
 *
 * The observable damage is engine state, not an exception, so that is what is
 * asserted: the flip controller's state and calc, the renderer's own
 * flipping/bottom references, and — the part that actually reaches a user —
 * what the NEXT pointer move folds. `Flip.fold` skips `start()` whenever
 * `calc !== null`, so a surviving calc makes the following move keep folding
 * pages that are no longer in the book.
 */
describe('updateFromHtml abandons an in-flight turn (P2 / I9)', () => {
  interface RenderInternals {
    flippingPage: unknown;
    bottomPage: unknown;
    animation: unknown;
  }

  function renderInternals(book: PageFlip): RenderInternals {
    return testRender(book) as unknown as RenderInternals;
  }

  function livePages(book: PageFlip): unknown[] {
    return testCollection(book).getPages() as unknown[];
  }

  // Landscape on purpose: in portrait the mover is a *temporary copy* of the
  // current leaf, so the renderer's reference is never a collection member and
  // "is it still in the book?" cannot be asked of it.
  test('a user fold is dropped, and the next move folds the NEW pages', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
    });
    const flip = testFlip(book)!;
    const rect = book.getBoundsRect();
    const inside = { x: rect.left + rect.width - 40, y: rect.top + 40 };

    flip.fold(inside);
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    expect(flip.getCalculation()).not.toBeNull();
    const doomed = renderInternals(book).flippingPage;
    expect(doomed).not.toBeNull();
    expect(livePages(book)).toContain(doomed);

    book.updateFromHtml(makePages(6));

    // The fold belonged to the collection that was just destroyed.
    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(renderInternals(book).flippingPage).toBeNull();
    expect(renderInternals(book).bottomPage).toBeNull();

    // The page it was folding is gone from the book; nothing may still hold it.
    expect(livePages(book)).not.toContain(doomed);

    // And the gesture continuing must start over against the live collection,
    // not resume the stale calc. This is the assertion that fails loudest when
    // only `abandon()` is missing: `fold()` short-circuits `start()` while
    // `calc` survives, so the renderer gets handed a destroyed page.
    flip.fold(inside);
    const resumed = renderInternals(book).flippingPage;
    expect(resumed).not.toBeNull();
    expect(resumed).not.toBe(doomed);
    expect(livePages(book)).toContain(resumed);

    destroy();
  });

  test('an animating turn is cancelled, not committed, against the dead pages', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: true,
      flippingTime: 1000,
    });
    const flip = testFlip(book)!;

    expect(book.flipNext()).toBe(true);
    expect(flip.getState()).toBe(FlippingState.FLIPPING);
    expect(renderInternals(book).animation).not.toBeNull();
    expect(book.getCurrentPageIndex()).toBe(0);

    const flips: number[] = [];
    book.on('flip', (e) => flips.push(e.data.page));

    book.updateFromHtml(makePages(6));

    // NO page announcement at all: the book was on page 0 and the rebuilt
    // collection settles on page 0, so nothing changed and nothing is claimed.
    // (Was `[0]` before ADR 0003, when `flip` fired on every repaint.)
    //
    // This still separates `cancelAnimation()` from the plausible-looking
    // `finishAnimation()`, and it separates it HARDER: the latter runs
    // `onAnimateEnd` first, committing a phantom turn to page 1 on the
    // collection that is about to be destroyed. That is a real index move, so
    // it announces — the array comes back non-empty — where every other symptom
    // of it is masked by the clamp-and-show below.
    expect(flips).toEqual([]);

    // `cancelAnimation()` drops the animation; `finishAnimation()` would have
    // run `onAnimateEnd` and committed the turn onto the destroyed collection.
    expect(renderInternals(book).animation).toBeNull();
    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(book.getCurrentPageIndex()).toBe(0);
    expect(renderInternals(book).flippingPage).toBeNull();

    destroy();
  });
});

/**
 * P1 — `updateFromHtml` must refuse to work on a destroyed engine.
 *
 * `replacePages` opens with `if (this.destroyed) return;`; this path did not.
 * A late React effect or an async consumer calling it after `destroy()` rebuilt
 * the collection, and `HTMLUI.updateItems` ends in `setHandlers()` — so a
 * destroyed engine re-attached its own pointer listeners to the host and
 * retained a fresh book. The listeners are the assertion that matters: a
 * "nothing threw" test is what let this survive.
 */
describe('updateFromHtml is inert after destroy (P1)', () => {
  test('no rebuild, no retained collection, no re-attached pointer listeners', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });

    // Captured before teardown: after `destroy()` the engine no longer exposes
    // its UI, but the host element it was listening on is still right here.
    const dist = book.getBlockElement();
    const added = vi.spyOn(dist, 'addEventListener');

    const rebuilt: unknown[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));

    book.destroy();
    added.mockClear();

    expect(() => {
      book.updateFromHtml(makePages(3));
    }).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(rebuilt).toEqual([]);
    // Nothing was rebuilt, so there is no collection to hand back.
    expect(() => testCollection(book)).toThrow(PageFlipError);

    added.mockRestore();
    destroy();
  });
});

/**
 * P3 — a destroyed engine has no state, and says so.
 *
 * `destroy()` used to leave `pages` / `render` / `ui` non-null, so every
 * accessor kept "working" against a dead engine: `getPageCollection()` handed
 * back a disposed collection and `flipNext()` reached the flip controller with
 * the render loop stopped. Post-destroy is now a distinct, reported condition
 * (`code: 'DESTROYED'`) rather than `NOT_LOADED`, because the caller's remedy
 * is different: not "load first" — `attachMode` refuses to attach to a
 * destroyed engine — but "construct a new PageFlip".
 */
describe('a destroyed engine is observably dead (P3)', () => {
  function expectDestroyed(label: string, fn: () => unknown): void {
    let caught: unknown;
    expect(() => {
      try {
        fn();
      } catch (err) {
        caught = err;
        throw err;
      }
    }, label).toThrow(PageFlipError);
    expect((caught as PageFlipError).code, label).toBe('DESTROYED');
  }

  test('state accessors throw DESTROYED instead of serving a disposed engine', () => {
    const { book } = makeHtmlBook({ pageCount: 4, usePortrait: true });
    book.destroy();

    expectDestroyed('getPageCollection', () => testCollection(book));
    expectDestroyed('getRender', () => testRender(book));
    expectDestroyed('getUI', () => testUI(book));
    expectDestroyed('getPage', () => testPage(book, 0));
    // C1: content queries are TOTAL — a destroyed book has zero pages, and
    // that is an answer, not an error. Layout queries keep throwing.
    expect(book.getPageCount()).toBe(0);
    expect(book.getCurrentPageIndex()).toBe(0);
    expectDestroyed('getOrientation', () => book.getOrientation());
    expectDestroyed('getBoundsRect', () => book.getBoundsRect());
    expectDestroyed('turnToPage', () => book.turnToPage(1));
    expectDestroyed('flip', () => book.flipToPage(1));
    expectDestroyed('clear', () => book.clear());

    // C8: the instant relatives refuse like their animated twins — boolean
    // plus a notReady rejection carrying DESTROYED, never a throw.
    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));
    expect(book.turnToNextPage()).toBe(false);
    expect(book.turnToPrevPage()).toBe(false);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toMatchObject({ reason: 'notReady', code: 'DESTROYED' });
  });

  test('flipNext / flipPrev keep the boolean contract and report DESTROYED', () => {
    const { book } = makeHtmlBook({ pageCount: 4, usePortrait: true });

    book.destroy();

    // Y2 amended this ONE line: the listener is now registered AFTER
    // `destroy()`, because `destroy()` releases the ones registered before it
    // (they are closures over consumer state — see `PageFlip.destroy`). The
    // subject of this test is unchanged and still asserted in full: the
    // refusal is a boolean, the dispatch still happens, and it still carries
    // `code: 'DESTROYED'`. What a pre-registered listener now sees is pinned
    // separately, in 'Y2 — destroy() releases the listeners'.
    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(rejected).toEqual([
      expect.objectContaining({ reason: 'notReady', code: 'DESTROYED' }),
      expect.objectContaining({ reason: 'notReady', code: 'DESTROYED' }),
    ]);
  });

  test('cleanup-shaped calls stay safe: a consumer legitimately destroys twice', () => {
    const { book } = makeHtmlBook({ pageCount: 4, usePortrait: true });
    book.destroy();

    expect(() => {
      book.destroy();
      book.update();
      book.updateSettings({ flippingTime: 500 });
      book.updateFromHtml(makePages(2));
    }).not.toThrow();

    expect(book.isDestroyed()).toBe(true);
    expect(book.getState()).toBe(FlippingState.READ);
    expect(testFlip(book)).toBeNull();
    expect(book.getSettings().flippingTime).toBe(500);
    expect(book[GET_BLOCK]()).toBeInstanceOf(HTMLElement);
  });

  test('the pre-load error still says NOT_LOADED, not DESTROYED', () => {
    // The two conditions must stay distinguishable: collapsing them would make
    // "load first" and "this instance is gone" the same message.
    const book = new PageFlip(host(), { width: 200, height: 300 });
    try {
      testCollection(book);
      expect.unreachable('getPageCollection must throw before a load');
    } catch (err) {
      expect((err as PageFlipError).code).toBe('NOT_LOADED');
    }
    book.destroy();
  });
});

/**
 * I13 — `init` must report where the book actually landed.
 *
 * `pages.show(initialPage)` silently returns for an out-of-range index, but the
 * event fired with `this.setting.initialPage` regardless: `initialPage: 99` on a
 * 4-page book announced `{ page: 99 }` while `getCurrentPageIndex()` was 0, so
 * a consumer seeding its state from `init` started desynced — and `Render` had
 * never been given a spread at all.
 *
 * Same clamp-then-report-resolved contract as `replacePages` /
 * `updateFromHtml`, and "resolved" is deliberately not "the clamped request":
 * in landscape a request for page 3 settles on spread [2, 3], whose canonical
 * index is 2.
 */
describe('loaded reports the resolved start page (I13)', () => {
  function loadAndCollectLoaded(opts: Partial<FlipSetting> & { pageCount: number }): {
    book: PageFlip;
    loaded: BookSnapshot[];
  } {
    const { pageCount, ...setting } = opts;
    const width = 200;
    const height = 300;
    const hostW = width * 2 - 20;

    const el = host();
    sizeElement(el, hostW, height);

    const pages = makePages(pageCount);
    for (const p of pages) el.appendChild(p);

    const book = new PageFlip(el, {
      width,
      height,
      sizing: 'fixed',
      flippingTime: 0,
      usePortrait: true,
      hardCovers: false,
      ...setting,
    });

    const loaded: BookSnapshot[] = [];
    // Subscribed before the load: `loaded` is what a consumer seeds page state from.
    // It is synchronous — no timer to await.
    book.on('loaded', (e) => loaded.push(e.data));

    book.loadFromHTML(pages);
    if (pageCount > 0) {
      sizeElement(book.getBlockElement(), hostW, height);
      book.update();
    }

    return { book, loaded };
  }

  test('an out-of-range initialPage lands in the book and is reported as such', () => {
    const { book, loaded } = loadAndCollectLoaded({ pageCount: 4, initialPage: 99 });

    expect(loaded).toHaveLength(1);
    // The announced page and the real page must be the same number. Asserting
    // only `getCurrentPageIndex()` would pass with the old event untouched.
    expect(loaded[0]!.page).toBe(book.getCurrentPageIndex());
    expect(loaded[0]!.page).toBe(3);
    expect(loaded[0]!.pageCount).toBe(4);

    book.destroy();
  });

  test('a negative initialPage is rejected at construction', () => {
    // D19: initialPage must be a non-negative integer — no silent clamp of -5.
    expect(() => {
      new PageFlip(host(), {
        width: 200,
        height: 300,
        sizing: 'fixed',
        initialPage: -5,
      });
    }).toThrow(PageFlipError);
  });

  test('landscape reports the spread it resolved to, not the request', () => {
    // Spreads without a cover are [0,1], [2,3], ... so a *valid* request for
    // page 3 resolves to index 2. Reporting the request — even clamped — is the
    // plausible half-fix, and these numbers are chosen so the two differ.
    const { book, loaded } = loadAndCollectLoaded({
      pageCount: 8,
      usePortrait: false,
      initialPage: 3,
    });

    expect(book.getOrientation()).toBe('landscape');
    expect(loaded[0]!.page).toBe(book.getCurrentPageIndex());
    expect(loaded[0]!.page).toBe(2);
    expect(loaded[0]!.orientation).toBe('landscape');

    book.destroy();
  });

  test('an empty book never announces loaded', () => {
    // Empty `loadFromHTML([])` is a shell, not a book — ready/loaded stay quiet.
    const { book, loaded } = loadAndCollectLoaded({ pageCount: 0, initialPage: 2 });

    expect(loaded).toEqual([]);
    expect(book.getPageCount()).toBe(0);
    expect(book.getCurrentPageIndex()).toBe(0);

    book.destroy();
  });
});

/**
 * I13, continued — the resolved index is read AFTER `ui.update()` inside
 * `attachMode`, not at `show()` time.
 *
 * `loaded` is synchronous and carries a BookSnapshot. Capturing the index at
 * `show()` would bake in the pre-layout answer; reading after `ui.update()` is
 * what makes a host sized at load report the landscape head.
 */
describe('loaded reports the index the book actually settled on (I13)', () => {
  test('loaded snapshot matches the settled landscape head', () => {
    // `usePortrait: false` forces landscape spreads so the head/request split
    // is observable without depending on host-width heuristics at load time.
    // `loaded` is read AFTER attachMode's `ui.update()`, so the snapshot must
    // agree with the public getters — not with the raw `initialPage` request.
    const el = host();
    sizeElement(el, 520, 300);
    const pages = makePages(8);
    for (const p of pages) el.appendChild(p);

    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      sizing: 'fixed',
      flippingTime: 0,
      usePortrait: false,
      hardCovers: false,
      initialPage: 3,
    });

    const loaded: BookSnapshot[] = [];
    book.on('loaded', (e) => loaded.push(e.data));

    book.loadFromHTML(pages);
    sizeElement(book.getBlockElement(), 520, 300);
    book.update();

    expect(book.getOrientation()).toBe('landscape');
    // Spread [2, 3]: the requested page is on screen under head 2.
    expect(book.getCurrentPageIndex()).toBe(2);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({
      page: book.getCurrentPageIndex(),
      pageCount: book.getPageCount(),
      orientation: book.getOrientation(),
      visiblePages: book.getVisiblePages(),
    });
    expect(loaded[0]!.page).toBe(2);
    expect(loaded[0]!.pageCount).toBe(8);

    book.destroy();
  });
});

describe('emptying a book releases the renderer (Codex round 2)', () => {
  test('updateFromHtml to zero pages drops the render references', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 400, 300);

    const pages = makePages(4);
    for (const p of pages) host.appendChild(p);

    const flip = new PageFlip(host, {
      width: 200,
      height: 300,
      sizing: 'fixed',
      usePortrait: false,
    });
    flip.loadFromHTML(pages);
    flip.turnToPage(2);

    const render = testRender(flip) as unknown as { leftPage: unknown; rightPage: unknown };

    // BOTH must be populated before the update, or a fix that clears only one
    // of them passes vacuously — which is exactly what the first version of
    // this test allowed. A 400-wide host with 200-wide pages is landscape, so
    // spread [0, 1] sets left and right.
    expect(render.rightPage).not.toBeNull();
    expect(render.leftPage).not.toBeNull();

    flip.updateFromHtml([]);

    // `show()` returns early for ANY index on an empty collection, so nothing
    // re-seeded the renderer: it kept painting left/right pages belonging to
    // the collection that had just been destroyed. `reload()` does not cover
    // it — that only recreates the shadow elements. The previous empty-book
    // test asserted no-throw and the event payload, which this passes either
    // way.
    expect(render.rightPage).toBeNull();
    expect(render.leftPage).toBeNull();

    flip.destroy();
    host.remove();
  });
});

/**
 * L1–L4: the lifecycle holes left after the `destroyed`-guard /
 * clamp-then-report-resolved work landed on the other paths.
 */
describe('PageFlip lifecycle — load, loaded, clear and settings', () => {
  test('L1: loadFromHTML on a destroyed engine does not touch the caller DOM', () => {
    const hostEl = host();
    sizeElement(hostEl, 380, 300);

    // The pages start in a container the CALLER owns. That is the thing the
    // guard protects: a load on a dead engine built the whole shell, adopted
    // these nodes into `.stf__block`, and the teardown then handed them back to
    // the HOST element instead of here — silently relocating consumer DOM.
    const origin = document.createElement('div');
    document.body.appendChild(origin);
    const pages = makePages(4);
    for (const p of pages) origin.appendChild(p);

    const book = new PageFlip(hostEl, { width: 200, height: 300, sizing: 'fixed' });
    book.destroy();

    expect(() => {
      book.loadFromHTML(pages);
    }).not.toThrow();

    for (const p of pages) expect(p.parentElement).toBe(origin);
    expect(origin.children).toHaveLength(4);
    // No shell was built, so nothing was mounted into (or stamped onto) the host.
    expect(hostEl.children).toHaveLength(0);
    expect(hostEl.classList.contains('stf__parent')).toBe(false);
    expect(hostEl.querySelector('.stf__block')).toBeNull();

    // Still dead, and still refusing to serve state.
    expect(book.isDestroyed()).toBe(true);
    expect(() => testCollection(book)).toThrow(PageFlipError);

    origin.remove();
    hostEl.remove();
  });

  test('L2: an empty shell never announces loaded; clear stays silent too', () => {
    // `loaded` is synchronous now. An empty `loadFromHTML([])` is a portal
    // shell, not a book — neither ready nor loaded fire. clear() on that shell
    // must not invent a loaded event either.
    const hostEl = host();
    sizeElement(hostEl, 380, 300);
    const book = new PageFlip(hostEl, { width: 200, height: 300, sizing: 'fixed' });

    const loaded: BookSnapshot[] = [];
    book.on('loaded', (e) => loaded.push(e.data));

    book.loadFromHTML([]);
    book.clear();

    expect(loaded).toHaveLength(0);

    book.destroy();
    hostEl.remove();
  });

  test('L2 control: a non-empty load emits loaded synchronously', () => {
    const hostEl = host();
    sizeElement(hostEl, 380, 300);
    const pages = makePages(4);
    const book = new PageFlip(hostEl, { width: 200, height: 300, sizing: 'fixed' });

    const loaded: BookSnapshot[] = [];
    book.on('loaded', (e) => loaded.push(e.data));

    book.loadFromHTML(pages);

    // Without this, "never announce" would pass the empty-shell test above
    // while deleting the event outright.
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(expect.objectContaining({ page: 0, pageCount: 4 }));

    book.destroy();
    hostEl.remove();
  });

  test('L2 control: empty shell then updateFromHtml announces when pages arrive', () => {
    const hostEl = host();
    sizeElement(hostEl, 380, 300);
    const book = new PageFlip(hostEl, { width: 200, height: 300, sizing: 'fixed' });

    const loaded: BookSnapshot[] = [];
    book.on('loaded', (e) => loaded.push(e.data));

    // React binding path: build the shell empty, then fill it in the same tick.
    book.loadFromHTML([]);
    expect(loaded).toHaveLength(0);

    book.updateFromHtml(makePages(4));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.page).toBe(0);
    expect(loaded[0]?.pageCount).toBe(4);

    book.destroy();
    hostEl.remove();
  });

  test('L3: clear() reports the emptied book and resets the index', () => {
    const hostEl = host();
    sizeElement(hostEl, 380, 300);
    const pages = makePages(4);
    const book = new PageFlip(hostEl, {
      width: 200,
      height: 300,
      sizing: 'fixed',
      usePortrait: false,
    });
    book.loadFromHTML(pages);
    book.turnToPage(2);
    expect(book.getCurrentPageIndex()).toBe(2);

    const changes: BookSnapshot[] = [];
    book.on('pagesChanged', (e) => changes.push(e.data));

    book.clear();

    // Single pagesChanged event (replaces update + collectionRebuild).
    expect(changes).toEqual([expect.objectContaining({ page: 0, pageCount: 0 })]);

    // And the getter agrees with what was announced. `PageCollection.destroy()`
    // empties the pages but leaves `currentPageIndex` at 2, so the boundary is
    // where this has to be resolved.
    expect(book.getPageCount()).toBe(0);
    expect(book.getCurrentPageIndex()).toBe(0);

    book.destroy();
    hostEl.remove();
  });

  test('L4: updateSettings refuses construction-time settings instead of lying', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const hostEl = host();
      sizeElement(hostEl, 380, 300);
      const book = new PageFlip(hostEl, {
        width: 200,
        height: 300,
        sizing: 'fixed',
        hardCovers: false,
        initialPage: 0,
      });
      book.loadFromHTML(makePages(4));

      // Construction-time keys are omitted from LiveSetting (compile error for
      // typed callers). The runtime path still refuses them for JS callers —
      // cast so this test can exercise that refusal without fighting the type.
      const returned = book.updateSettings({
        hardCovers: true,
        initialPage: 3,
        flippingTime: 7,
      } as unknown as Parameters<typeof book.updateSettings>[0]);

      // `hardCovers` is baked into the collection's spreads and `initialPage` is
      // read once in `attachMode`, so accepting them into `this.setting` made
      // `getSettings()` report a value that is not in force anywhere.
      expect(returned.hardCovers).toBe(false);
      expect(returned.initialPage).toBe(0);
      expect(book.getSettings().hardCovers).toBe(false);
      expect(book.getSettings().initialPage).toBe(0);
      // A genuinely live setting in the same call still applies.
      expect(book.getSettings().flippingTime).toBe(7);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('hardCovers');
      expect(message).toContain('initialPage');

      // Echoing the current values back — what a caller spreading the whole
      // settings object does — is not a mistake and must stay silent.
      warn.mockClear();
      book.updateSettings({ ...book.getSettings(), flippingTime: 9 });
      expect(warn).not.toHaveBeenCalled();
      expect(book.getSettings().flippingTime).toBe(9);

      book.destroy();
      hostEl.remove();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('U6 — no trailing frame after a teardown from onAnimateEnd', () => {
  test('destroying from the completion callback stops the frame at source', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 400, 300);
    const pages = makePages(4);
    for (const p of pages) host.appendChild(p);

    const flip = new PageFlip(host, { width: 200, height: 300, sizing: 'fixed' });
    flip.loadFromHTML(pages);

    const render = testRender(flip) as unknown as {
      drawFrame: () => void;
      startAnimation: (f: (() => void)[], d: number, cb: () => void) => void;
    };

    let drawsAfterTeardown = 0;
    let tornDown = false;
    const realDraw = render.drawFrame.bind(render);
    render.drawFrame = () => {
      if (tornDown) drawsAfterTeardown += 1;
      realDraw();
    };

    // A REAL animation with a duration, so `onAnimateEnd` fires from inside
    // `render()` on an rAF tick. An instant turn runs the callback inside
    // `startAnimation` instead and never reaches the loop at all — which is why
    // the first version of this test passed against the unfixed code.
    const frames = Array.from({ length: 3 }, () => () => undefined);
    render.startAnimation(frames, 30, () => {
      tornDown = true;
      flip.destroy();
    });

    // Count the engine's OWN rAF requests. Asserting only that no draw happened
    // could not see the re-arm at all: the extra scheduled callback exits at
    // the loop's entry check without drawing, so the count stayed at 0 either
    // way. Codex caught this — the eighth non-discriminating test found here.
    let rafAfterTeardown = 0;
    const realRaf = globalThis.requestAnimationFrame.bind(globalThis);
    const countingRaf = ((cb: FrameRequestCallback) => {
      if (tornDown) rafAfterTeardown += 1;
      return realRaf(cb);
    }) as typeof globalThis.requestAnimationFrame;

    for (let i = 0; i < 12 && !tornDown; i++) {
      globalThis.requestAnimationFrame = countingRaf;
      await new Promise((r) => realRaf(() => r(null)));
      globalThis.requestAnimationFrame = realRaf;
    }

    expect(tornDown).toBe(true);

    // Two distinct claims. The loop used to draw unconditionally after
    // `onAnimateEnd`, painting into a released collection and a detached
    // canvas...
    expect(drawsAfterTeardown).toBe(0);

    // ...and then re-arm regardless, scheduling one more frame and keeping the
    // closure — and the engine it captures — alive until it fired.
    expect(rafAfterTeardown).toBe(0);

    host.remove();
  });
});

describe('L6 — a collection swap forgets the pointer gesture', () => {
  function flippingPageOf(book: PageFlip): unknown {
    return (testRender(book) as unknown as { flippingPage: unknown }).flippingPage;
  }

  /**
   * The pointer is still physically down across the swap — that is the whole
   * scenario: React re-renders the pages mid-drag, or an async page fetch
   * lands. Asserting that a private field was cleared would pass against a
   * `mousePosition = pos` "reset" that leaves the gesture live; what has to
   * hold is that the next move does not fold the NEW book from the OLD anchor.
   *
   * Landscape, 6 pages, a slow `flippingTime`: in portrait the mover is a
   * temporary copy, and with `flippingTime: 0` there is no fold state left to
   * inspect.
   */
  test('updateFromHtml: the next move does not fold the new book from the stale anchor', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
    });
    const flip = testFlip(book)!;
    const rect = book.getBoundsRect();

    // Anchored on the right corner of the OLD book, as a pointerdown would.
    book.startUserTouch({ x: rect.left + rect.width - 10, y: rect.top + 10 });

    book.updateFromHtml(makePages(6));

    // The finger keeps moving; `isTouch` so the corner-hover branch is not
    // what answers here.
    book.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true);

    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(flippingPageOf(book)).toBeNull();

    // And a gesture that properly starts on the NEW book still works — the fix
    // drops the stale gesture, it does not deaden the engine.
    book.startUserTouch({ x: rect.left + rect.width - 10, y: rect.top + 10 });
    book.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true);
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);

    destroy();
  });

  test('replacePages: same, on the collection-swap seam', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
    });
    const flip = testFlip(book)!;
    const rect = book.getBoundsRect();
    const dist = book.getBlockElement();

    book.startUserTouch({ x: rect.left + rect.width - 10, y: rect.top + 10 });

    const items = makePages(6);
    for (const el of items) dist.appendChild(el);
    book[REPLACE_PAGES](new HTMLPageCollection(book, testRender(book), dist, items), 0);

    book.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true);

    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(flippingPageOf(book)).toBeNull();

    destroy();
  });
});

describe('PF3 — a rebuild after clear() opens where clear() said it was', () => {
  test('portrait: clear() then updateFromHtml lands on page 0', () => {
    const { book, host: hostEl, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });

    book.turnToPage(3);
    expect(book.getCurrentPageIndex()).toBe(3);

    book.clear();
    // The contract `clear()` just published, and the one the new book has to
    // agree with.
    expect(book.getCurrentPageIndex()).toBe(0);

    const rebuilt: { page: number; pageCount: number }[] = [];
    const updated: number[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));
    book.on('pagesChanged', (e) => updated.push(e.data.page));

    const fresh = makePages(6);
    for (const p of fresh) hostEl.appendChild(p);
    book.updateFromHtml(fresh);

    expect(book.getCurrentPageIndex()).toBe(0);
    expect(rebuilt).toEqual([expect.objectContaining({ page: 0, pageCount: 6 })]);
    expect(updated).toEqual([0]);

    // Not vacuous: the renderer is showing the FIRST page, not merely
    // reporting 0 while painting page 3.
    const render = testRender(book) as unknown as { rightPage: unknown; leftPage: unknown };
    const shown = [render.leftPage, render.rightPage].filter((p) => p !== null);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toContain(testPage(book, 0));

    destroy();
  });

  test('landscape: same, on a spread book where the stale index is well in range', () => {
    const {
      book,
      host: hostEl,
      destroy,
    } = makeHtmlBook({ pageCount: 8, usePortrait: false, hardCovers: false });

    expect(book.getOrientation()).toBe('landscape');
    book.turnToPage(4);
    expect(book.getCurrentPageIndex()).toBe(4);

    book.clear();

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('pagesChanged', (e) => rebuilt.push(e.data));

    const fresh = makePages(8);
    for (const p of fresh) hostEl.appendChild(p);
    book.updateFromHtml(fresh);

    expect(book.getCurrentPageIndex()).toBe(0);
    expect(rebuilt).toEqual([expect.objectContaining({ page: 0, pageCount: 8 })]);

    destroy();
  });

  test('control: an update on a NON-empty book still keeps its place', () => {
    // The half-fix this separates from the real one: zeroing the carried index
    // unconditionally. `updateFromHtml` on a live book must preserve where the
    // reader was — that is the whole point of carrying the index.
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });

    book.turnToPage(3);
    book.updateFromHtml(makePages(6));

    expect(book.getCurrentPageIndex()).toBe(3);

    destroy();
  });
});

/**
 * PF4 — `pagesChanged` delivery + throw propagation.
 *
 * D10 collapsed the old `update` + `collectionRebuild` pair into one
 * `pagesChanged` event. The pair machinery is gone; what remains is that a
 * throwing listener still propagates (E2) and a second listener on the same
 * event still runs (snapshot iteration).
 */
describe('PF4 — pagesChanged delivery and throw propagation', () => {
  const boom = new Error('listener blew up');

  test('updateFromHtml: later listeners still run, and the throw still escapes', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });

    book.turnToPage(5);

    const seen: string[] = [];
    const snaps: BookSnapshot[] = [];

    book.on('pagesChanged', () => {
      seen.push('A');
      throw boom;
    });
    book.on('pagesChanged', (e) => {
      seen.push('B');
      snaps.push(e.data);
    });

    expect(() => book.updateFromHtml(makePages(2))).toThrow(boom);

    // Snapshot iteration: B still runs after A throws.
    expect(seen).toEqual(['A', 'B']);
    expect(snaps).toEqual([expect.objectContaining({ page: 1, pageCount: 2 })]);

    destroy();
  });

  test('clear(): same delivery + throw guarantee', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });

    const seen: string[] = [];
    const snaps: BookSnapshot[] = [];

    book.on('pagesChanged', () => {
      seen.push('A');
      throw boom;
    });
    book.on('pagesChanged', (e) => {
      seen.push('B');
      snaps.push(e.data);
    });

    expect(() => book.clear()).toThrow(boom);

    expect(seen).toEqual(['A', 'B']);
    expect(snaps).toEqual([expect.objectContaining({ page: 0, pageCount: 0 })]);

    destroy();
  });

  test('a throwing pagesChanged listener still propagates', () => {
    // The subtly-wrong variant this catches: swallowing listener errors
    // outright, which would make this call succeed and hide a consumer defect.
    const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });

    book.on('pagesChanged', () => {
      throw boom;
    });

    expect(() => book.clear()).toThrow(boom);

    destroy();
  });

  test('both listeners throwing reports the FIRST error', () => {
    // Later listener errors are rethrown on a fresh task (E2). Own the timer
    // so the deferred second error does not become an unhandled rejection.
    vi.useFakeTimers();
    try {
      const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });

      const first = new Error('from first');
      const second = new Error('from second');

      book.on('pagesChanged', () => {
        throw first;
      });
      book.on('pagesChanged', () => {
        throw second;
      });

      expect(() => book.clear()).toThrow(first);

      expect(() => {
        vi.runAllTimers();
      }).toThrow(second);

      destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  test('control: nobody throwing delivers pagesChanged once, engine not mid-swap', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });

    const seen: string[] = [];
    book.on('pagesChanged', () => seen.push('pagesChanged'));

    expect(() => book.updateFromHtml(makePages(3))).not.toThrow();

    expect(seen).toEqual(['pagesChanged']);
    expect(book.getPageCount()).toBe(3);

    destroy();
  });
});

describe('initialPage resolution at load', () => {
  /*
   * HONEST NOTE — the reported failure mode did NOT reproduce.
   *
   * Codex round 5 reported that `NaN` / `0.5` survive the numeric clamp, that
   * `PageCollection.show()` then silently declines them, and that a raw core
   * consumer is therefore left with an unseeded renderer and a blank book.
   *
   * The first two are true. The third is not: measured with and against the
   * fix, `initialPage: NaN` on a 4-page book gives `getCurrentPageIndex() === 0`
   * and a populated `rightPage` EITHER WAY, because the collection already sits
   * on spread 0 and the declined `show()` simply leaves it there. So there is
   * no blank book to fix.
   *
   * `resolveStartPage` is kept because asking the collection whether a spread
   * actually contains the index is more honest than a numeric clamp that `NaN`
   * survives — but the tests below assert only what is genuinely observable.
   * The tests that would have "proved" the defect are deliberately absent: they
   * passed against the unfixed code, and this repo has shipped ten of those
   * already.
   */
  test('an Infinity initialPage is rejected at construction', () => {
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);

    expect(() => {
      new PageFlip(hostEl, {
        width: 200,
        height: 300,
        sizing: 'fixed',
        initialPage: Number.POSITIVE_INFINITY,
      });
    }).toThrow(PageFlipError);

    hostEl.remove();
  });

  test('a valid initialPage is still honoured', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 400, 300);
    const pages = makePages(6);
    for (const p of pages) host.appendChild(p);

    const flip = new PageFlip(host, { width: 200, height: 300, sizing: 'fixed', initialPage: 2 });
    flip.loadFromHTML(pages);

    // The control that matters: `resolveStartPage` must not deaden initialPage.
    // Making it always return 0 fails this and three existing tests.
    expect(flip.getCurrentPageIndex()).toBe(2);

    flip.destroy();
    host.remove();
  });

  test('a NaN initialPage is rejected at construction', () => {
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);

    // D19: non-integer / non-finite initialPage is INVALID_SETTING, not a
    // silent open-at-0 that looked like a blank-book fix.
    expect(() => {
      new PageFlip(hostEl, { width: 200, height: 300, sizing: 'fixed', initialPage: NaN });
    }).toThrow(PageFlipError);

    hostEl.remove();
  });
});

/**
 * Y1 — `attachMode` is the one collection-replacing path that never opted
 * into L6.
 *
 * `replacePages` and `updateFromHtml` both `abandon()` the flip and
 * `resetUserGesture()` before they swap; `attachMode` only tore down the old
 * `ui` / `render` / `pages`. So a second `loadFromHTML` (or a mode switch)
 * while a gesture is live left `isUserTouch` set and `mousePosition` anchored
 * in a book that no longer exists.
 *
 * ## What reproduces, and what does not
 *
 * Measured, not assumed: driving a REAL pointer gesture (`pointerdown` on the
 * block) across a second `loadFromHTML` does **not** reproduce it. The old
 * `UI` is destroyed first, `UI.destroy()` → `removeHandlers()` →
 * `cancelGesture()` → `PageFlip.userStop(pos, true)`, and that already unwinds
 * `isUserTouch`. Probed against the unfixed engine: `isUserTouch` was `false`
 * immediately after the second load, the following move produced no fold, and
 * the state stayed `READ`. That control is kept below, because it is the
 * property that makes the real-pointer path safe and nothing else pins it.
 *
 * What DOES reproduce is the same swap driven through the public
 * `startUserTouch` / `userMove` / `userStop` surface — a custom input layer, a
 * synthetic gesture, a test harness — which reaches the engine's gesture
 * fields without any `UI` in the loop, and so has no `cancelGesture()` behind
 * it. That is the discriminating test, and it is the same surface the existing
 * L6 tests for `updateFromHtml` / `replacePages` drive.
 */
describe('Y1 — a second load forgets the pointer gesture', () => {
  function flippingPageOf(book: PageFlip): unknown {
    return (testRender(book) as unknown as { flippingPage: unknown }).flippingPage;
  }

  /** Size the block the CURRENT load created, so geometry is real again. */
  function relayout(book: PageFlip, width: number, height: number): void {
    sizeElement(book.getBlockElement(), width, height);
    book.update();
  }

  test('loadFromHTML: the next move does not fold the new book from the stale anchor', () => {
    const { host, book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
      hostWidth: 400,
      hostHeight: 300,
    });

    const rect = book.getBoundsRect();
    // Anchored on the right corner of the OLD book, as a pointerdown would.
    book.startUserTouch({ x: rect.left + rect.width - 10, y: rect.top + 10 });

    const next = makePages(6);
    for (const p of next) host.appendChild(p);
    book.loadFromHTML(next);
    relayout(book, 400, 300);

    // The finger keeps moving — the swap came from a re-render or a fetch, not
    // from the user lifting it.
    book.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true);

    // The controller is a new one: `attachMode` builds it with the new render.
    const flip = testFlip(book)!;
    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();
    expect(flippingPageOf(book)).toBeNull();

    // And the engine is not deadened — a gesture that properly starts on the
    // NEW book still folds it.
    book.startUserTouch({ x: rect.left + rect.width - 10, y: rect.top + 10 });
    book.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true);
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);

    destroy();
  });

  test('control: a REAL pointer gesture is already ended by the old UI teardown', () => {
    installPointerCaptureShims();
    const { host, book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
      hostWidth: 400,
      hostHeight: 300,
    });
    const dist = book.getBlockElement();
    const rect = book.getBoundsRect();

    const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    pointer('pointerdown', dist, rect.left + rect.width - 5, rect.top + 5);
    // The press really reached the engine — otherwise the rest proves nothing.
    expect((book as unknown as { isUserTouch: boolean }).isUserTouch).toBe(true);

    const next = makePages(6);
    for (const p of next) host.appendChild(p);
    book.loadFromHTML(next);
    relayout(book, 400, 300);

    // `UI.destroy()` cancelled it, so this holds with or without the Y1 fix.
    expect((book as unknown as { isUserTouch: boolean }).isUserTouch).toBe(false);

    // The physical pointer moves on, landing on the block the new load built.
    pointer(
      'pointermove',
      book.getBlockElement(),
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );

    const flip = testFlip(book)!;
    expect(flip.getState()).toBe(FlippingState.READ);
    expect(flip.getCalculation()).toBeNull();

    destroy();
  });
});

/**
 * Y2 — `destroy()` forgets every listener.
 *
 * Asserting the map is empty would prove nothing about reachability (and would
 * pass against a `new Map()` swapped in while `trigger` still read a captured
 * one). What has to hold is that the engine can no longer CALL the callback,
 * through the only dispatch a destroyed engine still performs: `flipNext()`
 * reports its refusal as `turnRejected` with `code: 'DESTROYED'`.
 */
describe('Y2 — destroy() releases the listeners', () => {
  test('a listener registered before destroy is no longer reachable by dispatch', () => {
    const { book } = makeHtmlBook({ pageCount: 4 });

    const seen: unknown[] = [];
    book.on('turnRejected', (e) => seen.push(e.data));
    book.on('flip', (e) => seen.push(e.data));
    book.on('pagesChanged', (e) => seen.push(e.data));

    book.destroy();

    // The refusal contract is unchanged: still `false`, still a dispatch — it
    // simply has nobody left to deliver to.
    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(seen).toEqual([]);
  });

  test('the same dispatch DOES reach a listener registered after destroy', () => {
    const { book } = makeHtmlBook({ pageCount: 4 });
    book.destroy();

    // The decision, pinned: `EventObject` is a plain emitter with no notion of
    // a destroyed owner, so `on()` after `destroy()` still registers. This is
    // also the control for the test above — it proves the dispatch really does
    // happen, so "nobody heard it" is about the listeners and not about a
    // `flipNext` that quietly stopped emitting.
    const seen: unknown[] = [];
    book.on('turnRejected', (e) => seen.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(seen).toEqual([expect.objectContaining({ reason: 'notReady', code: 'DESTROYED' })]);
  });

  test('a live engine still delivers to its listeners', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4 });

    const seen: string[] = [];
    book.on('pagesChanged', () => seen.push('pagesChanged'));

    book.updateFromHtml(makePages(4));

    // Clearing on destroy must not become clearing on any teardown-shaped
    // path: `updateFromHtml` tears down a collection too.
    expect(seen).toEqual(['pagesChanged']);

    destroy();
  });
});

/**
 * Ordering, and it is observable: `destroy()` is not silent. Tearing the UI
 * down abandons a gesture in flight, which reports `changeState: READ` — so
 * clearing the listeners must be the LAST thing `destroy()` does, or a
 * consumer's own state machine never hears the book leave `USER_FOLD` and is
 * left believing a drag is still running.
 */
describe('Y2 — the listeners survive until the teardown is finished', () => {
  test('a drag abandoned by destroy() still reports the state change', () => {
    installPointerCaptureShims();
    const { book } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 1000,
      hostWidth: 400,
      hostHeight: 300,
    });
    const dist = book.getBlockElement();
    const rect = book.getBoundsRect();

    const pointer = (type: string, x: number, y: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    pointer('pointerdown', rect.left + rect.width - 5, rect.top + 5);
    pointer('pointermove', rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(book.getState()).toBe(FlippingState.USER_FOLD);

    const seen: unknown[] = [];
    book.on('changeState', (e) => seen.push(e.data.state));

    book.destroy();

    expect(seen).toEqual([FlippingState.READ]);
  });
});

/**
 * The edge `clearListeners()` inherits from `EventObject.trigger`, pinned
 * because it is a consequence of Y2 and not obvious: `trigger` iterates the
 * listener ARRAY it looked up, so clearing the map mid-dispatch does not
 * truncate the dispatch already running. Destroying from inside a handler —
 * the X4 case this engine explicitly supports — therefore still delivers that
 * event to the consumer's remaining handlers, and only later events are lost.
 */
describe('Y2 — destroying from inside a handler does not truncate that dispatch', () => {
  test('a second flip listener still runs after the first one destroys the book', () => {
    const { book } = makeHtmlBook({ pageCount: 6, usePortrait: false, hardCovers: false });

    const seen: string[] = [];
    book.on('flip', () => {
      seen.push('first');
      book.destroy();
    });
    book.on('flip', () => seen.push('second'));

    // `flippingTime: 0` from the fixture: the turn commits synchronously
    // inside `flipNext`, so `flip` is emitted from within this call.
    book.flipNext();

    expect(seen).toEqual(['first', 'second']);
    expect(book.isDestroyed()).toBe(true);
  });
});

/**
 * L8 — a listener cannot take the teardown down with it.
 *
 * Found by a test whose `changeState` listener happened to read
 * `getPageCollection()`, not by reading the code.
 */
describe('L8 — destroy() completes even when a listener throws', () => {
  test('a state listener that reads engine state does not break destroy()', () => {
    // FAKE TIMERS, and not for speed. The deferred error is real: L8 rethrows a
    // teardown listener's error on a later task ON PURPOSE, so it reaches
    // `window.onerror` rather than being silenced. In a test runner that same
    // task surfaces as an UNHANDLED error and fails the suite — `pnpm test`
    // reported `644 passed` and `Errors 1 error`, and exited non-zero, while
    // every assertion here passed. Owning the timer is how the test consumes
    // the error it is deliberately provoking.
    vi.useFakeTimers();

    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 400 });
    book.loadFromHTML(makePages(6));

    // A turn IN FLIGHT, and this is load-bearing: `setState` only dispatches on
    // a real transition, so a book at rest emits nothing during teardown and
    // the whole test passes vacuously. Both of the first drafts here did.
    book.flipNext();
    expect(book.getState()).toBe(FlippingState.FLIPPING);

    // The natural shape: a listener that mirrors engine state into consumer UI.
    book.on('changeState', () => {
      testCollection(book).getCurrentSpreadIndex();
    });

    // Reverted fix: throws `PageFlipError('DESTROYED')`. `destroy()` sets
    // `destroyed` first and then emits — `ui.destroy()` abandons an in-flight
    // gesture, `abandon()` announces READ — so the listener gets exactly the
    // error the contract promises it, and E2's synchronous rethrow carried it
    // straight back out of `destroy()`. Under React that is a `useEffect`
    // cleanup throwing on unmount, with the rest of the cleanup skipped.
    expect(() => {
      book.destroy();
    }).not.toThrow();

    // …and the teardown actually FINISHED rather than bailing out midway.
    expect(book.isDestroyed()).toBe(true);
    expect(() => testCollection(book)).toThrow(PageFlipError);
    expect(book.flipNext()).toBe(false);

    // The listener's `DESTROYED` is still out there, on the task L8 put it on.
    // Asserting it here is not bookkeeping — it is the other half of the
    // contract: deferred, never swallowed.
    expect(() => {
      vi.runAllTimers();
    }).toThrow(PageFlipError);

    vi.useRealTimers();
  });

  test('the error is deferred, not swallowed', () => {
    vi.useFakeTimers();

    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 400 });
    book.loadFromHTML(makePages(6));

    book.flipNext(); // a live state, so teardown has a transition to announce

    const boom = new Error('listener blew up');
    book.on('changeState', () => {
      throw boom;
    });

    book.destroy();

    // Deferring is not silencing — this engine's rule is that a failure which
    // is not its own is never converted into silence (see `requestTurn`). It
    // lands on a fresh task, where it becomes `window.onerror` /
    // `uncaughtException`, instead of aborting the cleanup. Driven with fake
    // timers like the E2 tests, because jsdom's uncaught-error plumbing is not
    // the contract — "on a later task" is.
    expect(() => {
      vi.runAllTimers();
    }).toThrow(boom);

    vi.useRealTimers();
  });

  test('outside teardown the first error is still thrown synchronously', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const boom = new Error('still synchronous');
    book.on('pagesChanged', () => {
      throw boom;
    });

    // The control, and the reason this is a narrow exception rather than a
    // policy change: E2's synchronous rethrow is what keeps
    // `try { book.updateFromHtml(…) } catch` working, and only teardown is
    // exempt.
    expect(() => {
      book.updateFromHtml(makePages(6));
    }).toThrow(boom);

    book.destroy();
  });
});

/**
 * Codex round 9 — four ownership failures across the lifecycle methods.
 * All four were reproduced against the built engine before being fixed.
 */
describe('round 9 — lifecycle ownership', () => {
  test('attachMode abandons the outgoing turn, target and all', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(8));

    let swapped = false;
    book.on('changeState', (e) => {
      if ((e.data as { state: string }).state !== 'flipping' || swapped) return;
      swapped = true;
      book.loadFromHTML(makePages(4));
    });

    book.flipToPage(5);

    // Reverted fix: the old turn resumed after the swap and applied its
    // destination through `getPageCollection()` — the NEW collection. Measured
    // on the built engine: the first page read "new0" while
    // `getCurrentPageIndex()` and `getCurrentSpreadIndex()` both said 5. A
    // destination computed for a book that no longer exists, applied to one
    // that does. `replacePages`, `updateFromHtml` and `clear` all abandon;
    // `attachMode` relied on `cancelGesture()`, which only fires for a POINTER,
    // and a programmatic turn has none.
    const index = book.getCurrentPageIndex();
    expect(index).toBeLessThan(book.getPageCount());
    expect(testCollection(book).getSpreadIndexByPage(index)).toBe(
      testCollection(book).getCurrentSpreadIndex(),
    );

    book.destroy();
  });

  test('clear() finishes its destructive work even if a listener throws', () => {
    const hostEl = host();
    const book = new PageFlip(hostEl, { width: 200, height: 300, flippingTime: 400 });
    const pages = makePages(6);
    book.loadFromHTML(pages);

    book.flipNext(); // a live state, so `abandon()` has a transition to announce
    book.on('changeState', () => {
      throw new Error('read listener');
    });

    // Outside `destroy()` the error is still synchronous — that is the L8
    // contract and it is deliberate. What must not happen is the throw landing
    // MID-teardown.
    expect(() => {
      book.clear();
    }).toThrow('read listener');

    // Reverted fix: `abandon()` sat before `HTMLUI.clear()`, so the throw
    // aborted with six leaves still parented to `.stf__block` and none handed
    // back — a half-cleared book that every listener still believes is whole.
    const block = book.getBlockElement();
    expect(block.querySelectorAll('.stf__item').length).toBe(0);
    expect(book.getPageCount()).toBe(0);

    book.destroy();
  });

  test('a listener registered AFTER destroy still gets synchronous errors', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));
    book.destroy();

    const boom = new Error('post-destroy listener');
    book.on('turnRejected', () => {
      throw boom;
    });

    // MIGRATION.md documents that `on()` after `destroy()` registers and that
    // such a listener receives the `turnRejected` a dead engine emits. That
    // dispatch is not teardown, so its errors belong on the synchronous path.
    // Reverted fix: `deferListenerErrors()` was one-way, so this error was
    // deferred and `flipNext()` returned quietly — contradicting a guarantee
    // documented two lines away.
    expect(() => {
      book.flipNext();
    }).toThrow(boom);
  });

  test('a teardown listener re-entering destroy() does not un-defer the outer teardown', () => {
    vi.useFakeTimers();
    try {
      const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 400 });
      book.loadFromHTML(makePages(6));
      book.flipNext(); // a live state, so `abandon()` has a transition to announce

      const seen: string[] = [];

      // Re-entrancy this engine documents as legal: a listener may call back
      // into the engine, `destroy()` included. It is also not hypothetical —
      // a React cleanup that destroys on a state change is exactly this shape.
      book.on('changeState', () => {
        seen.push('reenter');
        book.destroy();
      });
      book.on('changeState', () => {
        seen.push('throw');
        throw new Error('second listener');
      });

      // Reverted fix: `deferErrors` was a boolean, so the INNER `destroy()`'s'
      // `finally` cleared the deferral while the OUTER teardown was still
      // running. The second listener's error then took the synchronous path and
      // escaped `destroy()` — the precise failure L8 exists to prevent, and it
      // aborted the rest of the outer cleanup on the way out.
      expect(() => {
        book.destroy();
      }).not.toThrow();

      // Both listeners ran: `trigger` snapshots the list, so the inner
      // `clearListeners()` cannot cancel the rest of the current dispatch.
      // Without this the assertion above passes for the wrong reason — a
      // dispatch that never reached the throwing listener also does not throw.
      expect(seen).toEqual(['reenter', 'throw']);

      // Deferred is not silenced: it must still reach the host's uncaught
      // handler on the next task.
      expect(() => {
        vi.runAllTimers();
      }).toThrow('second listener');

      expect(book.isDestroyed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('round 9 — two engines on one host', () => {
  test('destroying the first does not strip the class from the second', () => {
    const shared = host();

    const a = new PageFlip(shared, { width: 200, height: 300 });
    a.loadFromHTML(makePages(4));
    const b = new PageFlip(shared, { width: 200, height: 300 });
    b.loadFromHTML(makePages(4));

    expect(shared.classList.contains('stf__parent')).toBe(true);

    a.destroy();

    // Reverted fix: the first engine recorded `hostHadParentClass = false` and
    // the second recorded `true`, so destroying the FIRST removed the class
    // from a host the second is still rendering into — the book lost its
    // positioning context while live. This is the multi-mount case the fix's
    // own comment named as its motivation.
    expect(shared.classList.contains('stf__parent')).toBe(true);
    expect(b.getPageCount()).toBe(4);

    b.destroy();

    // …and the last one out still cleans up.
    expect(shared.classList.contains('stf__parent')).toBe(false);
  });
});

/**
 * RE-1 / RE-4 — the LOAD path dispatches too, and the guards did not cover it.
 *
 * Seven reentrancy defects had been fixed on the turn and teardown paths. These
 * two are the load path: `Render.start()` calls `update()`, which on a fresh
 * render always reports an orientation change, so `updateOrientation` dispatches
 * while `start()` is halfway through installing the loop.
 *
 * These hooked `flip` until ADR 0003, which stopped it firing for a book that
 * loads at page 0 — nothing changed, so nothing is announced. `changeOrientation`
 * is dispatched from the same `updateOrientation` call and lands in the same
 * reentrancy window, so it replaces it. Each test now asserts that its listener
 * actually RAN: a re-anchored hook that silently never fires turns a reentrancy
 * test into a test that passes because nothing happened.
 */
describe('RE-1 — a listener during the first paint cannot leave a zombie loop', () => {
  test('destroy() from the first `flip` leaves nothing scheduled', () => {
    // Own the frame queue, so the frame the bug schedules can actually be RUN.
    // Asserting "nothing was scheduled" would be weaker: the failure is not the
    // scheduling, it is what the frame does when it runs.
    const queued: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof globalThis.requestAnimationFrame;

    const book = new PageFlip(host(), { width: 200, height: 300 });

    let reentered = false;
    book.on('changeOrientation', () => {
      reentered = true;
      book.destroy();
    });

    // Destroy mid-`start()` can surface DESTROYED out of the rest of
    // `attachMode` after the orientation dispatch returns — that is distinct
    // from the zombie-frame failure this test pins. Accept either outcome as
    // long as the hook ran and the engine is dead.
    try {
      book.loadFromHTML(makePages(6));
    } catch (err) {
      expect(err).toBeInstanceOf(PageFlipError);
      expect((err as PageFlipError).code).toBe('DESTROYED');
    }

    // The hook fired, so the reentrancy below was actually exercised.
    expect(reentered).toBe(true);
    expect(book.isDestroyed()).toBe(true);

    // Run whatever was queued. THIS is the assertion: the zombie frame called
    // `HTMLRender.clear()`, which reaches `testCollection(app)` on a
    // destroyed engine and throws.
    expect(() => {
      for (const cb of queued.splice(0, queued.length)) cb(0);
    }).not.toThrow();

    globalThis.requestAnimationFrame = realRaf;
  });

  test('loadFromHTML() from the first `flip` does not blank the new book', () => {
    const scheduled: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      scheduled.push(cb);
      return scheduled.length;
    }) as typeof globalThis.requestAnimationFrame;

    const book = new PageFlip(host(), { width: 200, height: 300 });

    let swapped = false;
    book.on('changeOrientation', () => {
      if (swapped) return;
      swapped = true;
      book.loadFromHTML(makePages(6));
    });

    book.loadFromHTML(makePages(4));

    expect(swapped).toBe(true);

    // Reverted fix: the nested load installed a new UI, render and collection,
    // and then the OUTER `start()` revived the old, detached render. Its
    // `clear()` iterates the NEW collection and hides every page that is not
    // one of the OLD render's references — measured, all six pages ended
    // `display: none`, both loops parked, and nothing scheduled another frame.
    // A permanently blank book until a resize or a turn.
    expect(book.getPageCount()).toBe(6);

    // THE LOOP MUST ACTUALLY BE RUNNING. Without this, the whole block is
    // satisfied by a `start()` that returns early and never installs anything —
    // which is exactly what happens if the generation check is placed after
    // `stop()`, since `stop()` bumps the generation itself. That variant
    // shipped for several minutes and was caught by an unrelated test, not by
    // this one.
    expect(testRender(book).isAnimating() || scheduled.length > 0).toBe(true);

    const pages = testCollection(book).getPages();
    const hidden = pages.filter(
      (p) => (p as unknown as { element?: HTMLElement }).element?.style.display === 'none',
    );
    expect(hidden.length).toBeLessThan(pages.length);

    globalThis.requestAnimationFrame = realRaf;
    book.destroy();
  });
});

describe('RE-4 — a teardown supersedes a turn, and the refusal says so', () => {
  test('destroy() from `changeState` makes the turn report its refusal', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 400 });
    book.loadFromHTML(makePages(8));

    let torn = false;
    book.on('changeState', (e) => {
      if ((e.data as { state: string }).state !== 'flipping' || torn) return;
      torn = true;
      book.destroy();
    });

    // Reverted fix: `true`, with no `turnRejected` at all. `turnGeneration` was
    // bumped only by `start()`, so the three reentrancy guards fired for a
    // listener that started another TURN and not for one that tore the book
    // down. Nothing corrupted — the downstream `calc === null` checks caught it
    // — but the contract lied, and `runFlip` still installed a ghost animation
    // on a stopped render.
    expect(book.flipNext()).toBe(false);
    expect(book.isDestroyed()).toBe(true);
  });

  test('a nested TURN still supersedes, so the guard did not just get narrower', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 400 });
    book.loadFromHTML(makePages(8));

    let chained = false;
    book.on('changeState', (e) => {
      if ((e.data as { state: string }).state !== 'flipping' || chained) return;
      chained = true;
      book.flipNext();
    });

    // The control: bumping the generation in `abandon()` must not disturb the
    // AN4 path it shares a counter with.
    expect(book.flipNext()).toBe(false);
    expect(book.getState()).toBe(FlippingState.FLIPPING);
    expect(testFlip(book)!.getCalculation()).not.toBeNull();

    book.destroy();
  });
});

describe('RE-2 — nested pagesChanged delivery (single event)', () => {
  test('a listener that replaces the collection leaves the book at the nested count', () => {
    // D10: one `pagesChanged` event. Nested updateFromHtml runs to completion
    // (trigger snapshots listeners per dispatch). The book ends at the nested
    // page count; a nested emit reports that count.
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(6));

    const counts: number[] = [];
    let once = false;

    book.on('pagesChanged', (e) => {
      counts.push(e.data.pageCount);
      if (once) return;
      once = true;
      book.updateFromHtml(makePages(2));
    });

    book.updateFromHtml(makePages(4));

    expect(book.getPageCount()).toBe(2);
    // Outer starts (4), nested runs fully (2).
    expect(counts).toEqual([4, 2]);
    expect(counts).not.toContain(6);

    book.destroy();
  });

  test('a nested replace does not swallow the listener’s own error', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(6));

    const boom = new Error('pagesChanged listener');
    let once = false;
    book.on('pagesChanged', () => {
      if (!once) {
        once = true;
        book.updateFromHtml(makePages(2));
      }
      throw boom;
    });

    // E2: a failure which is not the engine's own never becomes silence.
    expect(() => {
      book.updateFromHtml(makePages(4));
    }).toThrow(boom);

    book.destroy();
  });

  test('a nested full load still leaves a page-count event behind', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(6));

    const loadedCounts: number[] = [];
    let once = false;

    book.on('pagesChanged', () => {
      if (once) return;
      once = true;
      // A FULL LOAD, not an update. `loadFromHTML` announces `loaded`, not
      // `pagesChanged` — so a consumer listening only for collection changes
      // still gets a page-count signal via loaded.
      book.loadFromHTML(makePages(3));
    });
    book.on('loaded', (e) => {
      loadedCounts.push(e.data.pageCount);
    });

    book.updateFromHtml(makePages(4));

    expect(book.getPageCount()).toBe(3);
    expect(loadedCounts.length).toBeGreaterThan(0);
    expect(loadedCounts[loadedCounts.length - 1]).toBe(3);

    book.destroy();
  });

  test('an unraced pagesChanged still delivers', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(6));

    const events: string[] = [];
    book.on('pagesChanged', () => events.push('pagesChanged'));

    book.updateFromHtml(makePages(4));

    // Control: presence of a listener must not suppress the event.
    expect(events).toEqual(['pagesChanged']);

    book.destroy();
  });
});

describe('RE-3 — updateSettings survives a listener destroying mid-call', () => {
  test('a destroy from a refreshHandlers dispatch does not throw a TypeError', () => {
    installPointerCaptureShims();
    const { host: hostEl, book } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 400,
      hostWidth: 400,
      hostHeight: 300,
    });
    const dist = book.getBlockElement();
    const rect = book.getBoundsRect();

    const pointer = (type: string, x: number, y: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    // A REAL captured pointer. `cancelGesture()` only abandons when the UI
    // itself believes a pointer is down — driving `startUserTouch`/`userMove`
    // through the public surface sets `PageFlip`'s flags and leaves the UI's
    // pointer state untouched, so `refreshHandlers()` announces nothing and the
    // whole test passes vacuously. That is what the first draft did.
    pointer('pointerdown', rect.left + rect.width - 5, rect.top + 5);
    pointer('pointermove', rect.left + rect.width - 45, rect.top + 8);
    expect((book as unknown as { isUserTouch: boolean }).isUserTouch).toBe(true);

    book.on('changeState', () => {
      if (!book.isDestroyed()) book.destroy();
    });

    // Reverted fix: `TypeError: Cannot read properties of null (reading
    // 'applyHostSize')` — not a `PageFlipError`, out of a public method the
    // destroy contract lists as a safe no-op.
    expect(() => {
      book.updateSettings({ pointerInput: [] });
    }).not.toThrow();

    expect(book.isDestroyed()).toBe(true);

    // …AND the host was handed back. Hoisting the reference stops the
    // `TypeError`, but the hoisted UI must not then restyle a host its own
    // `destroy()` has already restored — that trades a loud failure for a
    // silent ownership violation, which is worse.
    expect(hostEl.style.minWidth).toBe('');
    expect(hostEl.classList.contains('stf__parent')).toBe(false);

    expect(book.isDestroyed()).toBe(true);
  });

  test('a listener that REPLACES the UI leaves the new one sized, not the old one', () => {
    installPointerCaptureShims();
    const { host: hostEl, book } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      hardCovers: false,
      flippingTime: 400,
      hostWidth: 400,
      hostHeight: 300,
    });
    const dist = book.getBlockElement();
    const rect = book.getBoundsRect();

    const pointer = (type: string, x: number, y: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    // Same real captured pointer as above, for the same reason: without it
    // `refreshHandlers()` announces nothing and the re-entrant listener never
    // runs, so the whole test passes vacuously.
    pointer('pointerdown', rect.left + rect.width - 5, rect.top + 5);
    pointer('pointermove', rect.left + rect.width - 45, rect.top + 8);
    expect((book as unknown as { isUserTouch: boolean }).isUserTouch).toBe(true);

    // REPLACES rather than destroys — a reload from a listener is legal, and it
    // builds a whole new UI. This is the case the destroyed-check conflated.
    let reloaded = false;
    book.on('changeState', () => {
      if (reloaded) return;
      reloaded = true;
      const pages = Array.from({ length: 4 }, () => {
        const el = document.createElement('div');
        hostEl.appendChild(el);
        return el;
      });
      book.loadFromHTML(pages);
    });

    expect(() => {
      book.updateSettings({ pointerInput: [], width: 320, height: 480 });
    }).not.toThrow();

    expect(reloaded).toBe(true);
    expect(book.isDestroyed()).toBe(false);

    // Reverted fix: `if (this.ui !== ui || this.destroyed) return` treated
    // REPLACED as DESTROYED and bailed, so the new UI never got sized — and the
    // old UI's `destroy()` had already restored its host-style snapshot on top
    // of it. The book was left at the pre-engine sizing with no way back short
    // of another `updateSettings`. Measured: `minWidth`/`minHeight` empty.
    expect(hostEl.style.minWidth).not.toBe('');
    expect(hostEl.style.minHeight).not.toBe('');

    // …and sized by the CURRENT owner from the settings just applied, not by
    // the stale 400x300 snapshot the old UI restored. This is the assertion
    // that fails for a fix which merely re-stamps the captured `ui`.
    //
    // `640px`, not `320px`: this book is landscape (`usePortrait: false`), so
    // the host has to hold TWO pages. The first draft asserted `320px` and
    // failed — the engine was right and the expectation was wrong, which is
    // worth recording, because "fix the assertion" is also how a real defect
    // gets talked away.
    expect(hostEl.style.minWidth).toBe('640px');
    expect(hostEl.style.minHeight).toBe('480px');

    // The host is still the engine's — a replacement is not a handback.
    expect(hostEl.classList.contains('stf__parent')).toBe(true);

    book.destroy();
  });
});
