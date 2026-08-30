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
import { afterEach, describe, expect, test } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages } from './html-book-fixture';

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
