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
import type { FlipSetting } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages, sizeElement } from './html-book-fixture';

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
    expect(() => book.getPageCollection()).toThrow(PageFlipError);
    expect(() => book.getRender()).toThrow(PageFlipError);
    expect(() => book.getUI()).toThrow(PageFlipError);
    expect(book.getFlipController()).toBeNull();

    book.destroy();
  });

  test('a turn requested before load is rejected, not crashed', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    const rejected: string[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data.reason));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(rejected).toEqual(['setup', 'setup']);

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
    const collection = book.getPageCollection() as unknown as Record<string, unknown>;
    collection['getFlippingPage'] = () => {
      throw new PageFlipError('corrupt spread', 'INVALID_SPREAD');
    };

    expect(book.flipNext()).toBe(false);
    expect(rejected).toEqual([{ reason: 'setup', code: 'INVALID_SPREAD' }]);

    book.destroy();
  });

  test('a non-engine error is NOT swallowed into a rejection', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const collection = book.getPageCollection() as unknown as Record<string, unknown>;
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
   * for programmatic turns: `userStop` discarded `flip()`'s boolean, so the
   * most common way a turn gets refused — a click — was silent. And
   * `reason: 'disabled'` was declared in the public event type while nothing
   * anywhere emitted it.
   */
  test("disableFlipByClick reports 'disabled' instead of nothing", () => {
    const book = new PageFlip(host(), {
      width: 200,
      height: 300,
      flippingTime: 0,
      disableFlipByClick: true,
    });
    book.loadFromHTML(makePages(4));

    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    // Middle of the book: not a corner, so policy refuses it.
    clickAt(book, 100, 150);

    expect(rejected).toEqual([{ reason: 'disabled' }]);
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

    expect(rejected).toEqual([{ reason: 'boundary' }]);

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
    const render = book.getRender() as unknown as {
      leftPage: unknown;
      rightPage: unknown;
    };
    return [render.leftPage, render.rightPage].filter((p) => p !== null);
  }

  function expectRenderInsideCollection(book: PageFlip): void {
    const live = book.getPageCollection().getPages() as unknown[];
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
    book.on('collectionRebuild', (e) => rebuilt.push(e.data));
    book.on('update', (e) => updated.push(e.data.page));

    book.updateFromHtml(makePages(2));

    // Render state first: it is the actual damage. A fix that clamps only the
    // emitted number leaves the rAF loop painting pages from the destroyed
    // collection, and an assertion ordered after the index check would never
    // be reached to notice.
    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(1);

    expect(rebuilt).toEqual([{ page: 1, pageCount: 2 }]);
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
      showCover: false,
    });
    expect(book.getOrientation()).toBe('landscape');
    book.turnToPage(6);
    expect(book.getCurrentPageIndex()).toBe(6);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('collectionRebuild', (e) => rebuilt.push(e.data));

    book.updateFromHtml(makePages(4));

    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(2);
    expect(rebuilt).toEqual([{ page: 2, pageCount: 4 }]);

    destroy();
  });

  test('an update that keeps the index in range does not move the book', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, usePortrait: true });
    book.turnToPage(2);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('collectionRebuild', (e) => rebuilt.push(e.data));

    book.updateFromHtml(makePages(6));

    expectRenderInsideCollection(book);
    expect(book.getCurrentPageIndex()).toBe(2);
    expect(rebuilt).toEqual([{ page: 2, pageCount: 6 }]);

    destroy();
  });

  test('updating to an empty book reports 0 and does not throw', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, usePortrait: true });
    book.turnToPage(3);

    const rebuilt: { page: number; pageCount: number }[] = [];
    book.on('collectionRebuild', (e) => rebuilt.push(e.data));

    expect(() => book.updateFromHtml([])).not.toThrow();
    expect(rebuilt).toEqual([{ page: 0, pageCount: 0 }]);

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
    return book.getRender() as unknown as RenderInternals;
  }

  function livePages(book: PageFlip): unknown[] {
    return book.getPageCollection().getPages() as unknown[];
  }

  // Landscape on purpose: in portrait the mover is a *temporary copy* of the
  // current leaf, so the renderer's reference is never a collection member and
  // "is it still in the book?" cannot be asked of it.
  test('a user fold is dropped, and the next move folds the NEW pages', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      usePortrait: false,
      showCover: false,
      flippingTime: 1000,
    });
    const flip = book.getFlipController()!;
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
    const flip = book.getFlipController()!;

    expect(book.flipNext()).toBe(true);
    expect(flip.getState()).toBe(FlippingState.FLIPPING);
    expect(renderInternals(book).animation).not.toBeNull();
    expect(book.getCurrentPageIndex()).toBe(0);

    const flips: number[] = [];
    book.on('flip', (e) => flips.push(e.data as number));

    book.updateFromHtml(makePages(6));

    // Exactly ONE page announcement: the one the rebuilt collection settled on.
    // This is the assertion that separates `cancelAnimation()` from the
    // plausible-looking `finishAnimation()` — the latter runs `onAnimateEnd`
    // first, committing a phantom turn to page 1 on the collection that is
    // about to be destroyed, and every other symptom of that is then masked by
    // the clamp-and-show below it.
    expect(flips).toEqual([0]);

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
    const dist = book.getUI().getDistElement();
    const added = vi.spyOn(dist, 'addEventListener');

    const rebuilt: unknown[] = [];
    book.on('collectionRebuild', (e) => rebuilt.push(e.data));

    book.destroy();
    added.mockClear();

    expect(() => {
      book.updateFromHtml(makePages(3));
    }).not.toThrow();

    expect(added).not.toHaveBeenCalled();
    expect(rebuilt).toEqual([]);
    // Nothing was rebuilt, so there is no collection to hand back.
    expect(() => book.getPageCollection()).toThrow(PageFlipError);

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

    expectDestroyed('getPageCollection', () => book.getPageCollection());
    expectDestroyed('getRender', () => book.getRender());
    expectDestroyed('getUI', () => book.getUI());
    expectDestroyed('getPage', () => book.getPage(0));
    expectDestroyed('getPageCount', () => book.getPageCount());
    expectDestroyed('getCurrentPageIndex', () => book.getCurrentPageIndex());
    expectDestroyed('getOrientation', () => book.getOrientation());
    expectDestroyed('getBoundsRect', () => book.getBoundsRect());
    expectDestroyed('turnToPage', () => book.turnToPage(1));
    expectDestroyed('turnToNextPage', () => book.turnToNextPage());
    expectDestroyed('turnToPrevPage', () => book.turnToPrevPage());
    expectDestroyed('flip', () => book.flip(1));
    expectDestroyed('clear', () => book.clear());
  });

  test('flipNext / flipPrev keep the boolean contract and report DESTROYED', () => {
    const { book } = makeHtmlBook({ pageCount: 4, usePortrait: true });
    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    book.destroy();

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(rejected).toEqual([
      { reason: 'setup', code: 'DESTROYED' },
      { reason: 'setup', code: 'DESTROYED' },
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
    expect(book.getFlipController()).toBeNull();
    expect(book.getSettings().flippingTime).toBe(500);
    expect(book.getBlock()).toBeInstanceOf(HTMLElement);
  });

  test('the pre-load error still says NOT_LOADED, not DESTROYED', () => {
    // The two conditions must stay distinguishable: collapsing them would make
    // "load first" and "this instance is gone" the same message.
    const book = new PageFlip(host(), { width: 200, height: 300 });
    try {
      book.getPageCollection();
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
 * `pages.show(startPage)` silently returns for an out-of-range index, but the
 * event fired with `this.setting.startPage` regardless: `startPage: 99` on a
 * 4-page book announced `{ page: 99 }` while `getCurrentPageIndex()` was 0, so
 * a consumer seeding its state from `init` started desynced — and `Render` had
 * never been given a spread at all.
 *
 * Same clamp-then-report-resolved contract as `replacePages` /
 * `updateFromHtml`, and "resolved" is deliberately not "the clamped request":
 * in landscape a request for page 3 settles on spread [2, 3], whose canonical
 * index is 2.
 */
describe('init reports the resolved start page (I13)', () => {
  interface Init {
    page: number;
    mode: string;
  }

  async function loadAndAwaitInit(
    opts: Partial<FlipSetting> & { pageCount: number },
  ): Promise<{ book: PageFlip; inits: Init[] }> {
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
      size: 'fixed',
      flippingTime: 0,
      usePortrait: true,
      showCover: false,
      ...setting,
    });

    const inits: Init[] = [];
    // Subscribed before the load, which is the whole point: `init` is what a
    // consumer seeds its own page state from.
    book.on('init', (e) => inits.push(e.data as Init));

    book.loadFromHTML(pages);
    sizeElement(book.getUI().getDistElement(), hostW, height);
    book.update();

    await new Promise((resolve) => setTimeout(resolve, 10));
    return { book, inits };
  }

  test('an out-of-range startPage lands in the book and is reported as such', async () => {
    const { book, inits } = await loadAndAwaitInit({ pageCount: 4, startPage: 99 });

    expect(inits).toHaveLength(1);
    // The announced page and the real page must be the same number. Asserting
    // only `getCurrentPageIndex()` would pass with the old event untouched.
    expect(inits[0]!.page).toBe(book.getCurrentPageIndex());
    expect(inits[0]!.page).toBe(3);

    book.destroy();
  });

  test('a negative startPage is clamped, not reported back', async () => {
    const { book, inits } = await loadAndAwaitInit({ pageCount: 4, startPage: -5 });

    expect(inits[0]!.page).toBe(book.getCurrentPageIndex());
    expect(inits[0]!.page).toBe(0);

    book.destroy();
  });

  test('landscape reports the spread it resolved to, not the request', async () => {
    // Spreads without a cover are [0,1], [2,3], ... so a *valid* request for
    // page 3 resolves to index 2. Reporting the request — even clamped — is the
    // plausible half-fix, and these numbers are chosen so the two differ.
    const { book, inits } = await loadAndAwaitInit({
      pageCount: 8,
      usePortrait: false,
      startPage: 3,
    });

    expect(book.getOrientation()).toBe('landscape');
    expect(inits[0]!.page).toBe(book.getCurrentPageIndex());
    expect(inits[0]!.page).toBe(2);

    book.destroy();
  });

  test('an empty book reports 0 rather than the requested page', async () => {
    const { book, inits } = await loadAndAwaitInit({ pageCount: 0, startPage: 2 });

    expect(inits[0]!.page).toBe(0);

    book.destroy();
  });
});

/**
 * I13, continued — the resolved index has to be read when `init` FIRES, not
 * when `show()` ran.
 *
 * `attachMode` shows the start page immediately but emits `init` a tick later,
 * after `ui.update()`. In the real world the host is frequently measured only
 * after the load (CSS applies, React commits, a ResizeObserver fires), so that
 * `update()` is exactly where the book flips portrait → landscape — and the
 * landscape spread resolves the very same page index to a different canonical
 * one. Capturing the index at `show()` time bakes in the pre-layout answer.
 */
describe('init reports the index the book actually settled on (I13)', () => {
  test('an orientation change between load and init is reflected in the event', async () => {
    const el = host();
    // Deliberately unmeasured at load time: jsdom reports 0×0, so the engine
    // attaches in portrait.
    const pages = makePages(8);
    for (const p of pages) el.appendChild(p);

    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      size: 'fixed',
      flippingTime: 0,
      usePortrait: true,
      showCover: false,
      startPage: 3,
    });

    const inits: { page: number; mode: string }[] = [];
    book.on('init', (e) => inits.push(e.data as { page: number; mode: string }));

    book.loadFromHTML(pages);
    expect(book.getOrientation()).toBe('portrait');
    // Portrait spreads are one page each, so the start page resolves to itself.
    expect(book.getCurrentPageIndex()).toBe(3);

    // Now the layout lands, exactly as it does when CSS or a ResizeObserver
    // arrives after mount.
    const dist = book.getUI().getDistElement();
    sizeElement(dist, 800, 300);
    sizeElement(el, 800, 300);
    book.update();
    expect(book.getOrientation()).toBe('landscape');
    // Spread [2, 3]: the same page, a different canonical index.
    expect(book.getCurrentPageIndex()).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(inits).toHaveLength(1);
    expect(inits[0]!.mode).toBe('landscape');
    expect(inits[0]!.page).toBe(2);

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
      size: 'fixed',
      usePortrait: false,
    });
    flip.loadFromHTML(pages);
    flip.turnToPage(2);

    const render = flip.getRender() as unknown as { leftPage: unknown; rightPage: unknown };

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
describe('PageFlip lifecycle — load, init timer, clear and settings', () => {
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

    const book = new PageFlip(hostEl, { width: 200, height: 300, size: 'fixed' });
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
    expect(() => book.getPageCollection()).toThrow(PageFlipError);

    origin.remove();
    hostEl.remove();
  });

  test('L2: clear() cancels the pending init event', async () => {
    vi.useFakeTimers();
    try {
      const hostEl = host();
      sizeElement(hostEl, 380, 300);
      const pages = makePages(4);
      const book = new PageFlip(hostEl, { width: 200, height: 300, size: 'fixed' });

      const inits: unknown[] = [];
      book.on('init', (e) => inits.push(e.data));

      book.loadFromHTML(pages);
      book.turnToPage(2);
      book.clear();

      // The assertion is about the EVENT, not about "nothing threw": the timer
      // fires ~1 ms later, and `PageCollection.destroy()` leaves
      // `currentPageIndex` alone, so this used to announce a non-zero page for
      // a book with no pages in it.
      await vi.advanceTimersByTimeAsync(50);
      expect(inits).toHaveLength(0);

      book.destroy();
      hostEl.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  test('L2 control: a load that is NOT cleared still emits init', async () => {
    vi.useFakeTimers();
    try {
      const hostEl = host();
      sizeElement(hostEl, 380, 300);
      const pages = makePages(4);
      const book = new PageFlip(hostEl, { width: 200, height: 300, size: 'fixed' });

      const inits: unknown[] = [];
      book.on('init', (e) => inits.push(e.data));

      book.loadFromHTML(pages);
      await vi.advanceTimersByTimeAsync(50);

      // Without this, "cancel the timer everywhere" would pass the test above
      // while deleting the event outright.
      expect(inits).toHaveLength(1);

      book.destroy();
      hostEl.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  test('L2 control: updateFromHtml keeps the pending init, reporting the new book', async () => {
    vi.useFakeTimers();
    try {
      const hostEl = host();
      sizeElement(hostEl, 380, 300);
      const book = new PageFlip(hostEl, { width: 200, height: 300, size: 'fixed' });

      const inits: { page: number }[] = [];
      book.on('init', (e) => inits.push(e.data as { page: number }));

      // This is exactly what the React binding does: build the shell empty,
      // then fill it in the same tick. Cancelling the timer here would mean a
      // React consumer never receives `init` at all.
      book.loadFromHTML([]);
      book.updateFromHtml(makePages(4));

      await vi.advanceTimersByTimeAsync(50);
      expect(inits).toHaveLength(1);
      expect(inits[0]?.page).toBe(0);

      book.destroy();
      hostEl.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  test('L3: clear() reports the emptied book and resets the index', () => {
    const hostEl = host();
    sizeElement(hostEl, 380, 300);
    const pages = makePages(4);
    const book = new PageFlip(hostEl, {
      width: 200,
      height: 300,
      size: 'fixed',
      usePortrait: false,
    });
    book.loadFromHTML(pages);
    book.turnToPage(2);
    expect(book.getCurrentPageIndex()).toBe(2);

    const updates: { page: number }[] = [];
    const rebuilds: { page: number; pageCount: number }[] = [];
    book.on('update', (e) => updates.push(e.data as { page: number }));
    book.on('collectionRebuild', (e) =>
      rebuilds.push(e.data as { page: number; pageCount: number }),
    );

    book.clear();

    // Same pair, same shape as `updateFromHtml` / `replacePages`, so a listener
    // needs no special case for "the book emptied".
    expect(rebuilds).toEqual([{ page: 0, pageCount: 0 }]);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.page).toBe(0);

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
        size: 'fixed',
        showCover: false,
        startPage: 0,
      });
      book.loadFromHTML(makePages(4));

      const returned = book.updateSettings({ showCover: true, startPage: 3, flippingTime: 7 });

      // `showCover` is baked into the collection's spreads and `startPage` is
      // read once in `attachMode`, so accepting them into `this.setting` made
      // `getSettings()` report a value that is not in force anywhere.
      expect(returned.showCover).toBe(false);
      expect(returned.startPage).toBe(0);
      expect(book.getSettings().showCover).toBe(false);
      expect(book.getSettings().startPage).toBe(0);
      // A genuinely live setting in the same call still applies.
      expect(book.getSettings().flippingTime).toBe(7);

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('showCover');
      expect(message).toContain('startPage');

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

    const flip = new PageFlip(host, { width: 200, height: 300, size: 'fixed' });
    flip.loadFromHTML(pages);

    const render = flip.getRender() as unknown as {
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

    for (let i = 0; i < 12 && !tornDown; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    // One more tick: this is the frame the loop used to have already re-armed.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    expect(tornDown).toBe(true);

    // The loop used to draw unconditionally after `onAnimateEnd`, painting into
    // a released collection and a detached canvas — and then re-arm, keeping
    // the closure and the engine it captures alive for another frame.
    expect(drawsAfterTeardown).toBe(0);

    host.remove();
  });
});
