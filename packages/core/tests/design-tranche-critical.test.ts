/**
 * Critical-fix coverage for the design-tranche review round
 * (c4ecdb1, 90aa7a9 and the product code they landed against).
 *
 * Each case pins a defect that shipped under a renamed API while the behaviour
 * still did the old wrong thing. Comments name the revert that must FAIL the
 * assertion — that is the gate this suite exists for, not decoration.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  PageFlip,
  PageFlipError,
  Settings,
  FlippingState,
  ALL_POINTERS,
} from '@gullabs/flipbook-core';
import type { BookSnapshot, TurnRejected } from '@gullabs/flipbook-core';
import {
  installPointerCaptureShims,
  makeHtmlBook,
  makePages,
  sizeElement,
} from './html-book-fixture';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

beforeEach(() => {
  installPointerCaptureShims();
});

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  sizeElement(el, 400, 300);
  return el;
}

function clickAt(book: PageFlip, x: number, y: number): void {
  book.startUserTouch({ x, y });
  book.userStop({ x, y });
}

function leafMiddle(book: PageFlip): { x: number; y: number } {
  // Derived from the live rect — a hard-coded (100, 150) is the corner of a
  // jsdom 0×0 host after the engine centres the page rect (see lifecycle tests).
  const rect = book.getBoundsRect();
  return {
    x: rect.left + rect.width - rect.pageWidth / 2,
    y: rect.top + rect.height / 2,
  };
}

function cornerForward(book: PageFlip): { x: number; y: number } {
  const rect = book.getBoundsRect();
  return { x: rect.left + rect.width - 5, y: rect.top + 6 };
}

function pointer(
  type: string,
  target: EventTarget,
  init: PointerEventInit & { clientX: number; clientY: number },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
      pointerType: 'mouse',
      ...init,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* c4ecdb1 BLOCKER — openingFresh captured before destroy()                   */
/* -------------------------------------------------------------------------- */

describe('C7 — openingFresh is captured BEFORE destroy empties the collection', () => {
  test('a live content replacement keeps the reader where they were', () => {
    // Reverted fix: ask `previous.getPageCount() === 0` AFTER `destroy()`.
    // destroy() empties in place (C2), so every replacement looked "fresh" and
    // jumped to initialPage while SEED_OPENING_INDEX suppressed the flip for a
    // real visible move.
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      flippingTime: 0,
      usePortrait: true,
      initialPage: 0,
    });

    book.turnToPage(3);
    expect(book.getCurrentPageIndex()).toBe(3);

    const flips: number[] = [];
    book.on('flip', (e) => flips.push(e.data.page));

    book.updateFromHtml(makePages(6));

    expect(book.getCurrentPageIndex()).toBe(3);
    // A fresh-opening seed would suppress flip; a place-keeping update must not
    // invent one either. The index stays put without an announcement.
    expect(flips).toEqual([]);

    destroy();
  });

  test('filling an empty shell honours initialPage without announcing a turn', () => {
    // The React path: loadFromHTML([]) then updateFromHtml(real pages). That is
    // the only openingFresh case that SHOULD jump, and it must not fire flip.
    const el = host();
    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      flippingTime: 0,
      usePortrait: true,
      initialPage: 2,
    });

    const flips: number[] = [];
    const ready: BookSnapshot[] = [];
    const loaded: BookSnapshot[] = [];
    book.on('flip', (e) => flips.push(e.data.page));
    book.on('ready', (e) => ready.push(e.data));
    book.on('loaded', (e) => loaded.push(e.data));

    book.loadFromHTML([]);
    // Empty shell must not announce — pageCount: 0 is not a book (90aa7a9).
    expect(ready).toEqual([]);
    expect(loaded).toEqual([]);

    const pages = makePages(4);
    for (const p of pages) el.appendChild(p);
    book.updateFromHtml(pages);

    expect(book.getCurrentPageIndex()).toBe(2);
    expect(flips).toEqual([]);
    expect(ready).toEqual([expect.objectContaining({ page: 2, pageCount: 4 })]);
    expect(loaded).toEqual([expect.objectContaining({ page: 2, pageCount: 4 })]);

    book.destroy();
  });

  test('hostile: a non-empty → non-empty replacement does NOT re-apply initialPage', () => {
    // Discriminates "always honour initialPage on update" from the real fix.
    // That half-fix would keep this green for the empty-shell case above while
    // still jumping every live refresh back to the opening page.
    const { book, destroy } = makeHtmlBook({
      pageCount: 6,
      flippingTime: 0,
      usePortrait: true,
      initialPage: 1,
    });

    book.turnToPage(4);
    book.updateFromHtml(makePages(6));

    expect(book.getCurrentPageIndex()).toBe(4);
    expect(book.getCurrentPageIndex()).not.toBe(1);

    destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* c4ecdb1 BLOCKER — pointerInput filters per pointer                         */
/* -------------------------------------------------------------------------- */

describe('D2 — pointerInput filters each pointer, not just empty-vs-not', () => {
  test("pointerInput: ['touch'] refuses a mouse click-turn", () => {
    // Reverted fix: register the one path whenever the array is non-empty and
    // never test e.pointerType. Then ['touch'] still lets mouse and pen turn —
    // the exact defect the rename was supposed to remove, wearing the new name.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['touch'],
    });

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);

    pointer('pointerdown', dist, {
      clientX: c.x,
      clientY: c.y,
      pointerType: 'mouse',
    });
    pointer('pointerup', dist, {
      clientX: c.x,
      clientY: c.y,
      pointerType: 'mouse',
    });

    expect(book.getCurrentPageIndex()).toBe(0);
    expect(book.getState()).toBe(FlippingState.READ);

    destroy();
  });

  test("pointerInput: ['touch'] still accepts a touch turn — negative control", () => {
    // Without this, a filter that rejects EVERY pointer goes green above.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['touch'],
    });

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);

    pointer('pointerdown', dist, {
      clientX: c.x,
      clientY: c.y,
      pointerType: 'touch',
      pointerId: 2,
    });
    pointer('pointerup', dist, {
      clientX: c.x,
      clientY: c.y,
      pointerType: 'touch',
      pointerId: 2,
    });

    expect(book.getCurrentPageIndex()).toBe(1);

    destroy();
  });

  test('a disallowed mouse cannot peel a hover corner either', () => {
    // onPointerMove also filters. Without it a refused mouse still folds the
    // corner up — a book that "half responds" to the wrong device.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['touch'],
      foldCornerOnHover: true,
    });

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);

    pointer('pointermove', dist, {
      clientX: c.x,
      clientY: c.y,
      buttons: 0,
      pointerType: 'mouse',
    });

    expect(book.getState()).toBe(FlippingState.READ);

    destroy();
  });

  test('empty pointerInput registers no handlers at all', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: [],
    });

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);

    pointer('pointerdown', dist, { clientX: c.x, clientY: c.y, pointerType: 'touch' });
    pointer('pointerup', dist, { clientX: c.x, clientY: c.y, pointerType: 'touch' });

    expect(book.getCurrentPageIndex()).toBe(0);

    destroy();
  });

  test('default pointerInput still admits mouse — the rename is not a break', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0 });
    expect(book.getSettings().pointerInput).toEqual([...ALL_POINTERS]);

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);
    pointer('pointerdown', dist, { clientX: c.x, clientY: c.y });
    pointer('pointerup', dist, { clientX: c.x, clientY: c.y });

    expect(book.getCurrentPageIndex()).toBe(1);
    destroy();
  });

  test("pointerInput: ['touch'] also refuses pen — the filter is not mouse-only", () => {
    // A mouse-only special-case would leave pen turning under a touch-only book.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['touch'],
    });

    const dist = book.getUI().getDistElement();
    const c = cornerForward(book);
    pointer('pointerdown', dist, { clientX: c.x, clientY: c.y, pointerType: 'pen', pointerId: 3 });
    pointer('pointerup', dist, { clientX: c.x, clientY: c.y, pointerType: 'pen', pointerId: 3 });

    expect(book.getCurrentPageIndex()).toBe(0);
    destroy();
  });

  test('an unrecognised pointerType is admitted only when the list is un-narrowed', () => {
    // Reverted fix: drop every non-(mouse|touch|pen). Spec permits UA-specific
    // strings; a book that cannot be turned by hardware nobody anticipated is
    // worse than one extra accepted pointer — but only while the consumer has
    // not narrowed the list.
    const open = makeHtmlBook({ pageCount: 4, flippingTime: 0 });
    const distOpen = open.book.getUI().getDistElement();
    const cOpen = cornerForward(open.book);
    pointer('pointerdown', distOpen, {
      clientX: cOpen.x,
      clientY: cOpen.y,
      pointerType: 'xr-controller',
    });
    pointer('pointerup', distOpen, {
      clientX: cOpen.x,
      clientY: cOpen.y,
      pointerType: 'xr-controller',
    });
    expect(open.book.getCurrentPageIndex()).toBe(1);
    open.destroy();

    const closed = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['touch'],
    });
    const distClosed = closed.book.getUI().getDistElement();
    const cClosed = cornerForward(closed.book);
    pointer('pointerdown', distClosed, {
      clientX: cClosed.x,
      clientY: cClosed.y,
      pointerType: 'xr-controller',
    });
    pointer('pointerup', distClosed, {
      clientX: cClosed.x,
      clientY: cClosed.y,
      pointerType: 'xr-controller',
    });
    expect(closed.book.getCurrentPageIndex()).toBe(0);
    closed.destroy();
  });

  test('reordering pointerInput is the same policy and does not drop an in-flight fold', () => {
    // Compared as a Set. Elementwise, mouse→touch reordering looked like a
    // change, ran refreshHandlers → cancelGesture, and abandoned the drag.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['mouse', 'touch', 'pen'],
    });

    const dist = book.getUI().getDistElement();
    const rect = book.getBoundsRect();
    const y = rect.top + rect.height / 2;
    const startX = rect.left + rect.width - 10;

    pointer('pointerdown', dist, { clientX: startX, clientY: y, buttons: 1 });
    pointer('pointermove', dist, { clientX: startX - 40, clientY: y, buttons: 1 });
    expect(book.getState()).toBe(FlippingState.USER_FOLD);

    expect(() => book.updateSettings({ pointerInput: ['pen', 'touch', 'mouse'] })).not.toThrow();
    expect(book.getState()).toBe(FlippingState.USER_FOLD);

    pointer('pointerup', dist, { clientX: startX - 40, clientY: y, buttons: 0 });
    expect(book.getCurrentPageIndex()).toBe(1);

    destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* c4ecdb1 MAJOR — flipOnClick: 'never'                                       */
/* -------------------------------------------------------------------------- */

describe("flipOnClick — all three states, and 'never' was the point of the rename", () => {
  test("'never' refuses a click and reports disabled", () => {
    // Reverted fix: only the 'corners' branch existed; every other value fell
    // through to the turn. 'never' is the drag-only state the old boolean could
    // not express — advertising it and then falling through is the same defect
    // with a better name.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'never',
    });

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const c = cornerForward(book);
    clickAt(book, c.x, c.y);

    expect(book.getCurrentPageIndex()).toBe(0);
    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'disabled',
        direction: null,
        targetPage: null,
        landedOn: 0,
      }),
    ]);

    destroy();
  });

  test("'never' still refuses the leaf middle, not only the corner", () => {
    // A filter that only special-cased the corner path would leave a mid-leaf
    // click turning under 'never'.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'never',
    });

    const rejected: string[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data.reason));

    const mid = leafMiddle(book);
    clickAt(book, mid.x, mid.y);

    expect(rejected).toEqual(['disabled']);
    expect(book.getCurrentPageIndex()).toBe(0);

    destroy();
  });

  test("'corners' refuses a mid-leaf click and still turns from a corner", () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'corners',
    });

    const rejected: string[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data.reason));

    const mid = leafMiddle(book);
    clickAt(book, mid.x, mid.y);
    expect(rejected).toEqual(['disabled']);
    expect(book.getCurrentPageIndex()).toBe(0);

    const c = cornerForward(book);
    clickAt(book, c.x, c.y);
    expect(book.getCurrentPageIndex()).toBe(1);

    destroy();
  });

  test("'anywhere' still turns from the leaf middle — negative control", () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'anywhere',
    });

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const mid = leafMiddle(book);
    clickAt(book, mid.x, mid.y);

    expect(rejected).toEqual([]);
    expect(book.getCurrentPageIndex()).toBe(1);

    destroy();
  });

  test("'never' is drag-only: a real fold still commits", () => {
    // The whole point of the third state. A filter that refused every
    // userStop path would keep the click tests green while deleting drag.
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'never',
    });

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const rect = book.getBoundsRect();
    // Corner start + deep pull past the page midpoint so stopMove commits
    // rather than snapping back (a shallow fold is a cancel, not a turn).
    const start = { x: rect.left + rect.width - 5, y: rect.top + 10 };
    const end = {
      x: rect.left + rect.width - rect.pageWidth - 20,
      y: rect.top + 40,
    };

    book.startUserTouch(start);
    book.userMove(end, false);
    expect(book.getState()).toBe(FlippingState.USER_FOLD);
    book.userStop(end);

    expect(rejected).toEqual([]);
    expect(book.getCurrentPageIndex()).toBe(1);
    expect(book.getState()).toBe(FlippingState.READ);

    destroy();
  });

  test('a click before load reports notReady, not a silent discard', () => {
    // requestUserTurn falls through to requestTurn when there is no controller,
    // so a pre-load click must match flipNext's notReady contract.
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    clickAt(book, 100, 150);

    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'notReady',
        code: 'NOT_LOADED',
        landedOn: null,
      }),
    ]);

    book.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 90aa7a9 BLOCKER — Settings.resolve is idempotent                           */
/* -------------------------------------------------------------------------- */

describe('D4 — resolve is idempotent; updateSettings(getSettings()) is safe', () => {
  test('feeding resolved settings back into resolve does not throw', () => {
    // Reverted fix: any authored responsive bound under sizing:'fixed' threw.
    // Resolved settings always carry derived bounds, so the round-trip that
    // keeping `authored` exists to enable was itself illegal.
    const first = new Settings().resolve({
      width: 320,
      height: 480,
      sizing: 'fixed',
    });

    expect(() => new Settings().resolve(first)).not.toThrow();
    const second = new Settings().resolve(first);
    expect(second.width).toBe(320);
    expect(second.minWidth).toBe(320);
    expect(second.maxWidth).toBe(320);
  });

  test('updateSettings(getSettings()) on a live book is a no-op, not a throw', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0 });

    expect(() => book.updateSettings(book.getSettings())).not.toThrow();
    expect(book.getSettings().width).toBe(200);
    expect(book.getCurrentPageIndex()).toBe(0);

    destroy();
  });

  test('a CONFLICTING bound under fixed still throws — the diagnostic stays', () => {
    // Without this, "accept every bound" makes the two tests above green while
    // deleting the real error for `sizing:'fixed', width:400, minWidth:200`.
    expect(() =>
      new Settings().resolve({
        width: 400,
        height: 300,
        sizing: 'fixed',
        minWidth: 200,
      }),
    ).toThrow(PageFlipError);

    try {
      new Settings().resolve({
        width: 400,
        height: 300,
        sizing: 'fixed',
        minWidth: 200,
      });
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PageFlipError);
      expect((error as PageFlipError).code).toBe('INVALID_SETTING');
      expect((error as PageFlipError).setting).toBe('minWidth');
    }
  });

  test('responsive → fixed live transition keeps going when bounds match width', () => {
    const el = host();
    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      sizing: 'responsive',
      minWidth: 200,
      maxWidth: 200,
      flippingTime: 0,
    });
    book.loadFromHTML(makePages(2));

    // Bounds equal to width/height are what fixed mode would derive, so the
    // transition is not a conflict.
    expect(() => book.updateSettings({ sizing: 'fixed' })).not.toThrow();
    expect(book.getSettings().sizing).toBe('fixed');

    book.destroy();
  });

  test('new PageFlip(host, getSettings()) round-trips the resolved object', () => {
    // The third legitimate call the first reject-any-bound version broke.
    // Keeping `authored` exists so this construction stays legal.
    const first = new Settings().resolve({
      width: 240,
      height: 360,
      sizing: 'fixed',
      flippingTime: 0,
      pageBackground: '#fff',
    });

    const el = host();
    expect(() => new PageFlip(el, first)).not.toThrow();
    const book = new PageFlip(el, first);
    book.loadFromHTML(makePages(2));
    expect(book.getSettings().width).toBe(240);
    expect(book.getSettings().minWidth).toBe(240);
    book.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* 90aa7a9 MAJOR — ready/loaded generation guard + empty-shell deferral       */
/* -------------------------------------------------------------------------- */

describe('ready/loaded — generation guard and empty-shell deferral', () => {
  test('a ready listener that reloads does not leave a stale loaded last', () => {
    // Reverted fix: attachMode claimed a generation and never read it back.
    // A ready listener that reloads produced loaded{2} then loaded{6} for a
    // two-page book — the stale event last. That is RE-2 again after the
    // dispatchCollectionChange pair (and its guard) was deleted.
    const el = host();
    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      flippingTime: 0,
      usePortrait: true,
    });

    const loadedCounts: number[] = [];
    let reloaded = false;

    book.on('ready', () => {
      if (reloaded) return;
      reloaded = true;
      book.loadFromHTML(makePages(2));
    });
    book.on('loaded', (e) => loadedCounts.push(e.data.pageCount));

    book.loadFromHTML(makePages(6));

    // The surviving announcement is the NEWER load. A missing generation check
    // ends with 6 last (or with both).
    expect(loadedCounts.at(-1)).toBe(2);
    expect(loadedCounts).not.toContain(6);
    expect(book.getPageCount()).toBe(2);

    book.destroy();
  });

  test('loadFromHTML([]) announces nothing; the later fill announces once', () => {
    const el = host();
    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      flippingTime: 0,
      usePortrait: true,
    });

    const timeline: string[] = [];
    book.on('ready', (e) => timeline.push(`ready:${e.data.pageCount}`));
    book.on('loaded', (e) => timeline.push(`loaded:${e.data.pageCount}`));

    book.loadFromHTML([]);
    expect(timeline).toEqual([]);

    book.updateFromHtml(makePages(4));
    expect(timeline).toEqual(['ready:4', 'loaded:4']);

    // A second non-empty replacement is not a fresh opening once ready has
    // fired — only loaded may fire again, and only via a full loadFromHTML.
    book.updateFromHtml(makePages(3));
    expect(timeline).toEqual(['ready:4', 'loaded:4']);

    book.destroy();
  });

  test('a genuinely empty book never announces ready or loaded', () => {
    const el = host();
    const book = new PageFlip(el, { width: 200, height: 300, flippingTime: 0 });

    const seen: string[] = [];
    book.on('ready', () => seen.push('ready'));
    book.on('loaded', () => seen.push('loaded'));

    book.loadFromHTML([]);
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('ready fires once per engine across a second loadFromHTML', () => {
    const el = host();
    const book = new PageFlip(el, { width: 200, height: 300, flippingTime: 0 });

    const ready: number[] = [];
    const loaded: number[] = [];
    book.on('ready', (e) => ready.push(e.data.pageCount));
    book.on('loaded', (e) => loaded.push(e.data.pageCount));

    book.loadFromHTML(makePages(2));
    book.loadFromHTML(makePages(4));

    expect(ready).toEqual([2]);
    expect(loaded).toEqual([2, 4]);

    book.destroy();
  });

  test('a ready listener that destroys stops the matching loaded', () => {
    // destroy() clears the listener set, so the second dispatch reaches nobody.
    // A generation check that only compared numbers would still try to fire
    // loaded against a dead engine.
    const el = host();
    const book = new PageFlip(el, { width: 200, height: 300, flippingTime: 0 });

    const timeline: string[] = [];
    book.on('ready', () => {
      timeline.push('ready');
      book.destroy();
    });
    book.on('loaded', () => timeline.push('loaded'));

    book.loadFromHTML(makePages(3));

    expect(timeline).toEqual(['ready']);
    expect(book.isDestroyed()).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 90aa7a9 MAJOR — flipNext/flipPrev report notReady when no controller       */
/* -------------------------------------------------------------------------- */

describe('D15 — relative turns report notReady when the engine is absent', () => {
  test('before load, flipNext/flipPrev emit notReady rather than bare false', () => {
    // Reverted fix: the two relative methods returned false with no event while
    // turnToPage/flip reported notReady — two of four still refusing silently.
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);

    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'notReady',
        direction: 'next',
        targetPage: null,
        code: 'NOT_LOADED',
        landedOn: null,
      }),
      expect.objectContaining({
        reason: 'notReady',
        direction: 'prev',
        targetPage: null,
        code: 'NOT_LOADED',
        landedOn: null,
      }),
    ]);

    book.destroy();
  });

  test('after destroy, flipNext/flipPrev report notReady with DESTROYED', () => {
    // Same path, different code: "not loaded yet" is a retry; "destroyed" never
    // will be. Collapsing both to NOT_LOADED loses that distinction.
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0 });
    destroy();

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);

    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'notReady',
        direction: 'next',
        code: 'DESTROYED',
        landedOn: null,
      }),
      expect.objectContaining({
        reason: 'notReady',
        direction: 'prev',
        code: 'DESTROYED',
        landedOn: null,
      }),
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* pagesChanged + turnRejected landedOn                                       */
/* -------------------------------------------------------------------------- */

describe('pagesChanged and turnRejected.landedOn', () => {
  test('updateFromHtml emits a single pagesChanged with the landed index', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, flippingTime: 0, usePortrait: true });
    book.turnToPage(5);

    const changes: BookSnapshot[] = [];
    book.on('pagesChanged', (e) => changes.push(e.data));

    book.updateFromHtml(makePages(3));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(
      expect.objectContaining({
        page: book.getCurrentPageIndex(),
        pageCount: 3,
      }),
    );
    expect(book.getCurrentPageIndex()).toBeLessThanOrEqual(2);

    destroy();
  });

  test('empty shell → fill emits one pagesChanged alongside the deferred ready/loaded', () => {
    // pagesChanged is the collection event; ready/loaded are the load events.
    // A fill must not double-fire pagesChanged just because it also announces.
    const el = host();
    const book = new PageFlip(el, {
      width: 200,
      height: 300,
      flippingTime: 0,
      usePortrait: true,
      initialPage: 1,
    });

    const timeline: string[] = [];
    book.on('ready', (e) => timeline.push(`ready:${e.data.page}`));
    book.on('loaded', (e) => timeline.push(`loaded:${e.data.page}`));
    book.on('pagesChanged', (e) =>
      timeline.push(`pagesChanged:${e.data.page}:${e.data.pageCount}`),
    );

    book.loadFromHTML([]);
    expect(timeline).toEqual([]);

    book.updateFromHtml(makePages(4));
    expect(timeline).toEqual(['ready:1', 'loaded:1', 'pagesChanged:1:4']);

    book.destroy();
  });

  test('a disabled click carries landedOn as the current index', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      flipOnClick: 'never',
    });
    book.turnToPage(2);

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const c = cornerForward(book);
    clickAt(book, c.x, c.y);

    expect(rejected[0]?.landedOn).toBe(2);
    destroy();
  });

  test('a boundary flipNext carries landedOn as the current index', () => {
    // Restored field: "we clamped you" is not derivable from targetPage alone
    // when targetPage is null on a relative turn.
    const { book, destroy } = makeHtmlBook({
      pageCount: 2,
      flippingTime: 0,
      usePortrait: true,
    });
    book.turnToPage(1);

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'boundary',
        direction: 'next',
        targetPage: null,
        landedOn: 1,
      }),
    ]);

    destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* D3 — pageBackground throws at the boundary                                 */
/* -------------------------------------------------------------------------- */

describe('D3 — pageBackground rejects translucent / junk at the boundary', () => {
  test('a translucent colour throws INVALID_SETTING instead of becoming white', () => {
    // Reverted fix: isOpaque treated unrecognised syntax as opaque, construction
    // succeeded, and foldFill silently substituted white at draw time.
    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        pageBackground: 'rgba(255,255,255,0.4)',
      }),
    ).toThrow(PageFlipError);

    try {
      new Settings().resolve({
        width: 100,
        height: 100,
        pageBackground: 'rgba(255,255,255,0.4)',
      });
    } catch (error) {
      expect((error as PageFlipError).code).toBe('INVALID_SETTING');
      expect((error as PageFlipError).setting).toBe('pageBackground');
    }
  });

  test('an opaque colour is still accepted — negative control', () => {
    const settings = new Settings().resolve({
      width: 100,
      height: 100,
      pageBackground: '#f4ecd8',
    });
    expect(settings.pageBackground).toBe('#f4ecd8');
  });

  test('a non-string pageBackground is refused, not stringified', () => {
    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        pageBackground: 0 as unknown as string,
      }),
    ).toThrow(PageFlipError);
  });
});

/* -------------------------------------------------------------------------- */
/* Settings validation for the renamed contracts                              */
/* -------------------------------------------------------------------------- */

describe('renamed setting contracts are enforced, not only declared', () => {
  test('flipOnClick rejects unknown values', () => {
    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        flipOnClick: 'sometimes' as 'anywhere',
      }),
    ).toThrow(PageFlipError);
  });

  test('pointerInput rejects non-arrays and unknown kinds', () => {
    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        pointerInput: 'touch' as unknown as readonly ['touch'],
      }),
    ).toThrow(PageFlipError);

    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        pointerInput: ['mouse', 'stylus'] as unknown as readonly ['mouse'],
      }),
    ).toThrow(PageFlipError);
  });

  test('readingDirection rejects anything other than ltr/rtl', () => {
    expect(() =>
      new Settings().resolve({
        width: 100,
        height: 100,
        readingDirection: 'ttb' as 'ltr',
      }),
    ).toThrow(PageFlipError);
  });
});
