/**
 * Design-tranche coverage for Settings validation, construction-time
 * updateSettings refusals, and EventObject / PageFlip lifecycle edges that
 * design-tranche-critical.test.ts does not pin.
 *
 * New public names only (`sizing`, `hardCovers`, `initialPage`, …).
 * Tests only — no product code edits.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip, PageFlipError, ALL_POINTERS } from '@gullabs/flipbook-core';
import { Settings } from '../src/Settings';
import type { BookSnapshot, FlipSetting, LiveSetting, TurnRejected } from '@gullabs/flipbook-core';
import { testUI } from './engine-access';
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

const base = { width: 200, height: 300 } as const;

function resolve(partial: Record<string, unknown> = {}): FlipSetting {
  return new Settings().resolve({ ...base, ...partial } as Parameters<Settings['resolve']>[0]);
}

function codeOf(partial: Record<string, unknown>): string {
  try {
    resolve(partial);
    return 'NO_THROW';
  } catch (error) {
    return (error as PageFlipError).code;
  }
}

function settingOf(partial: Record<string, unknown>): string | undefined {
  try {
    resolve(partial);
    return undefined;
  } catch (error) {
    return (error as PageFlipError).setting;
  }
}

/** JS callers can still hand construction-time keys; TS fences them out of LiveSetting. */
function livePartial(partial: Record<string, unknown>): Partial<LiveSetting> {
  return partial as Partial<LiveSetting>;
}

/* -------------------------------------------------------------------------- */
/* SETTINGS — sizing, booleans, scalars                                       */
/* -------------------------------------------------------------------------- */

describe('Settings.resolve — sizing fixed vs responsive', () => {
  test("sizing rejects anything other than 'fixed' or 'responsive'", () => {
    expect(codeOf({ sizing: 'stretch' })).toBe('INVALID_SETTING');
    expect(settingOf({ sizing: 'stretch' })).toBe('sizing');
    expect(codeOf({ sizing: 'fluid' })).toBe('INVALID_SETTING');
    expect(codeOf({ sizing: 1 })).toBe('INVALID_SETTING');

    expect(resolve({ sizing: 'fixed' }).sizing).toBe('fixed');
    expect(resolve({ sizing: 'responsive' }).sizing).toBe('responsive');
  });

  test('fixed derives bounds from width/height when none are authored', () => {
    const s = resolve({ sizing: 'fixed', width: 320, height: 480 });
    expect(s.minWidth).toBe(320);
    expect(s.maxWidth).toBe(320);
    expect(s.minHeight).toBe(480);
    expect(s.maxHeight).toBe(480);
  });

  test('fixed still rejects a conflicting authored bound', () => {
    expect(codeOf({ sizing: 'fixed', width: 400, minWidth: 200 })).toBe('INVALID_SETTING');
    expect(settingOf({ sizing: 'fixed', width: 400, minWidth: 200 })).toBe('minWidth');
  });

  test('responsive accepts explicit bounds that fixed would reject as conflict', () => {
    const s = resolve({
      sizing: 'responsive',
      width: 400,
      height: 300,
      minWidth: 200,
      maxWidth: 800,
      minHeight: 150,
      maxHeight: 600,
    });
    expect(s.minWidth).toBe(200);
    expect(s.maxWidth).toBe(800);
    expect(s.minHeight).toBe(150);
    expect(s.maxHeight).toBe(600);
  });
});

describe('Settings.resolve — BOOLEAN_SETTINGS reject string "false"', () => {
  // New names only. Old showCover / mobileScrollSupport / clickEventForward /
  // useMouseEvents / showPageCorners / disableFlipByClick are gone.
  const BOOLEANS = [
    'drawShadow',
    'usePortrait',
    'autoSize',
    'hardCovers',
    'allowTouchScroll',
    'respectInteractiveContent',
    'foldCornerOnHover',
    'respectReducedMotion',
  ] as const;

  test.each(BOOLEANS)('%s rejects the truthy string "false" with INVALID_SETTING', (key) => {
    expect(codeOf({ [key]: 'false' })).toBe('INVALID_SETTING');
    expect(settingOf({ [key]: 'false' })).toBe(key);
  });

  test.each(BOOLEANS)('%s rejects "true", 0, 1, and null the same way', (key) => {
    expect(codeOf({ [key]: 'true' })).toBe('INVALID_SETTING');
    expect(codeOf({ [key]: 0 })).toBe('INVALID_SETTING');
    expect(codeOf({ [key]: 1 })).toBe('INVALID_SETTING');
    expect(codeOf({ [key]: null })).toBe('INVALID_SETTING');
  });

  test.each(BOOLEANS)('%s still accepts real booleans', (key) => {
    expect(codeOf({ [key]: true })).toBe('NO_THROW');
    expect(codeOf({ [key]: false })).toBe('NO_THROW');
  });

  test('message names the key and expected type', () => {
    let message = '';
    try {
      resolve({ hardCovers: 'false' });
    } catch (error) {
      message = (error as PageFlipError).message;
    }
    expect(message).toMatch(/hardCovers/);
    expect(message).toMatch(/true or false/);
  });
});

describe('Settings.resolve — initialPage, maxShadowOpacity, startZIndex', () => {
  test('initialPage must be a non-negative integer', () => {
    expect(codeOf({ initialPage: -1 })).toBe('INVALID_SETTING');
    expect(settingOf({ initialPage: -1 })).toBe('initialPage');
    expect(codeOf({ initialPage: 0.5 })).toBe('INVALID_SETTING');
    expect(codeOf({ initialPage: NaN })).toBe('INVALID_SETTING');
    expect(codeOf({ initialPage: Infinity })).toBe('INVALID_SETTING');
    expect(codeOf({ initialPage: '0' })).toBe('INVALID_SETTING');

    expect(resolve({ initialPage: 0 }).initialPage).toBe(0);
    expect(resolve({ initialPage: 3 }).initialPage).toBe(3);
  });

  test('maxShadowOpacity must be a finite number in 0..1', () => {
    expect(codeOf({ maxShadowOpacity: -0.01 })).toBe('INVALID_SETTING');
    expect(settingOf({ maxShadowOpacity: -0.01 })).toBe('maxShadowOpacity');
    expect(codeOf({ maxShadowOpacity: 1.01 })).toBe('INVALID_SETTING');
    expect(codeOf({ maxShadowOpacity: 2 })).toBe('INVALID_SETTING');
    expect(codeOf({ maxShadowOpacity: NaN })).toBe('INVALID_SETTING');
    expect(codeOf({ maxShadowOpacity: Infinity })).toBe('INVALID_SETTING');

    expect(resolve({ maxShadowOpacity: 0 }).maxShadowOpacity).toBe(0);
    expect(resolve({ maxShadowOpacity: 0.5 }).maxShadowOpacity).toBe(0.5);
    expect(resolve({ maxShadowOpacity: 1 }).maxShadowOpacity).toBe(1);
  });

  test('startZIndex must be an integer (fractions and non-finite rejected)', () => {
    expect(codeOf({ startZIndex: 1.5 })).toBe('INVALID_SETTING');
    expect(settingOf({ startZIndex: 1.5 })).toBe('startZIndex');
    expect(codeOf({ startZIndex: NaN })).toBe('INVALID_SETTING');
    expect(codeOf({ startZIndex: Infinity })).toBe('INVALID_SETTING');
    expect(codeOf({ startZIndex: '0' })).toBe('INVALID_SETTING');

    // Negative integers are legal z-index values.
    expect(resolve({ startZIndex: -3 }).startZIndex).toBe(-3);
    expect(resolve({ startZIndex: 0 }).startZIndex).toBe(0);
    expect(resolve({ startZIndex: 12 }).startZIndex).toBe(12);
  });
});

describe('Settings.resolve — responsive bounds default when 0', () => {
  test('zero / unset responsive bounds fill to 100 / max(2000, min)', () => {
    const s = resolve({
      sizing: 'responsive',
      minWidth: 0,
      maxWidth: 0,
      minHeight: 0,
      maxHeight: 0,
    });
    expect(s.minWidth).toBe(100);
    expect(s.maxWidth).toBe(2000);
    expect(s.minHeight).toBe(100);
    expect(s.maxHeight).toBe(2000);
  });

  test('maxWidth floors at the authored minWidth when min is above 2000', () => {
    // A flat 2000 would put the upper bound BELOW a declared minWidth of 3000.
    const s = resolve({
      sizing: 'responsive',
      minWidth: 3000,
      maxWidth: 0,
      minHeight: 0,
      maxHeight: 0,
    });
    expect(s.minWidth).toBe(3000);
    expect(s.maxWidth).toBe(3000);
  });

  test('an explicit max below min is raised the same way', () => {
    const s = resolve({
      sizing: 'responsive',
      minWidth: 500,
      maxWidth: 100,
      minHeight: 400,
      maxHeight: 50,
    });
    expect(s.maxWidth).toBe(Math.max(2000, 500));
    expect(s.maxHeight).toBe(Math.max(2000, 400));
  });
});

/* -------------------------------------------------------------------------- */
/* updateSettings — construction-time refusal + pointerInput set equality     */
/* -------------------------------------------------------------------------- */

describe('updateSettings — construction-time hardCovers / initialPage', () => {
  test('refuses a changed hardCovers/initialPage with console.warn and keeps getSettings honest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      hardCovers: false,
      initialPage: 0,
    });

    const returned = book.updateSettings(
      livePartial({ hardCovers: true, initialPage: 3, flippingTime: 7 }),
    );

    expect(returned.hardCovers).toBe(false);
    expect(returned.initialPage).toBe(0);
    expect(book.getSettings().hardCovers).toBe(false);
    expect(book.getSettings().initialPage).toBe(0);
    // Live setting in the same call still applies.
    expect(book.getSettings().flippingTime).toBe(7);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('hardCovers');
    expect(message).toContain('initialPage');
    expect(message).toMatch(/construction-time/i);

    destroy();
  });

  test('echoing the current hardCovers/initialPage back is silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      hardCovers: false,
      initialPage: 0,
    });

    book.updateSettings(livePartial({ ...book.getSettings(), flippingTime: 9 }));
    expect(warn).not.toHaveBeenCalled();
    expect(book.getSettings().flippingTime).toBe(9);
    expect(book.getSettings().hardCovers).toBe(false);
    expect(book.getSettings().initialPage).toBe(0);

    destroy();
  });

  test('refusing only the key that actually differs — same-value hardCovers is not listed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      hardCovers: false,
      initialPage: 0,
    });

    book.updateSettings(livePartial({ hardCovers: false, initialPage: 2 }));
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('initialPage');
    expect(message).not.toContain('hardCovers');

    destroy();
  });
});

describe('updateSettings — pointerInput reorder is set equality, not array equality', () => {
  test('reordering the same kinds does not call refreshHandlers', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['mouse', 'touch', 'pen'],
    });

    const ui = testUI(book);
    const spy = vi.spyOn(ui, 'refreshHandlers');

    book.updateSettings({ pointerInput: ['pen', 'mouse', 'touch'] });

    expect(spy).not.toHaveBeenCalled();
    expect(book.getSettings().pointerInput).toEqual(['pen', 'mouse', 'touch']);

    destroy();
  });

  test('a real membership change still rebinds handlers', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 4,
      flippingTime: 0,
      pointerInput: ['mouse', 'touch', 'pen'],
    });

    const ui = testUI(book);
    const spy = vi.spyOn(ui, 'refreshHandlers');

    book.updateSettings({ pointerInput: ['touch'] });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(book.getSettings().pointerInput).toEqual(['touch']);

    destroy();
  });

  test('default ALL_POINTERS round-trip reorder stays a no-op for handlers', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 2, flippingTime: 0 });
    expect(book.getSettings().pointerInput).toEqual([...ALL_POINTERS]);

    const spy = vi.spyOn(testUI(book), 'refreshHandlers');
    book.updateSettings({ pointerInput: [...ALL_POINTERS].reverse() });
    expect(spy).not.toHaveBeenCalled();

    destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* EVENTS / LIFECYCLE                                                         */
/* -------------------------------------------------------------------------- */

describe('pagesChanged payload is a BookSnapshot', () => {
  test('clear() emits { page, pageCount, orientation }', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0 });
    book.turnToPage(2);

    const changes: BookSnapshot[] = [];
    book.on('pagesChanged', (e) => changes.push(e.data));

    book.clear();

    expect(changes).toHaveLength(1);
    const snap = changes[0]!;
    expect(Object.keys(snap).sort()).toEqual(['orientation', 'page', 'pageCount']);
    expect(snap).toEqual({
      page: 0,
      pageCount: 0,
      orientation: book.getOrientation(),
    });
    // Shape only — no extra keys leaking from older pair payloads.
    expect('reason' in snap).toBe(false);
    expect('mode' in snap).toBe(false);

    destroy();
  });

  test('updateFromHtml snapshot matches the public getters after the swap', () => {
    const { book, destroy } = makeHtmlBook({ pageCount: 6, flippingTime: 0, usePortrait: true });
    book.turnToPage(4);

    let snap: BookSnapshot | undefined;
    book.on('pagesChanged', (e) => {
      snap = e.data;
    });

    book.updateFromHtml(makePages(4));

    expect(snap).toEqual({
      page: book.getCurrentPageIndex(),
      pageCount: book.getPageCount(),
      orientation: book.getOrientation(),
    });
    expect(snap!.pageCount).toBe(4);

    destroy();
  });
});

describe('turnRejected includes direction for flipNext/flipPrev boundary', () => {
  test('flipNext at the end reports direction: next and reason: boundary', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 2,
      flippingTime: 0,
      usePortrait: true,
    });
    book.turnToPage(1);

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipNext()).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual(
      expect.objectContaining({
        reason: 'boundary',
        direction: 'next',
        targetPage: null,
        landedOn: 1,
      }),
    );

    destroy();
  });

  test('flipPrev at the start reports direction: prev', () => {
    const { book, destroy } = makeHtmlBook({
      pageCount: 2,
      flippingTime: 0,
      usePortrait: true,
    });

    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.flipPrev()).toBe(false);
    expect(rejected[0]).toEqual(
      expect.objectContaining({
        reason: 'boundary',
        direction: 'prev',
        targetPage: null,
        landedOn: 0,
      }),
    );

    destroy();
  });
});

describe('destroy from ready does not throw on the subsequent loaded attempt', () => {
  test('a ready listener that destroys leaves loaded unemitted and does not throw', () => {
    const el = host();
    const book = new PageFlip(el, { ...base, flippingTime: 0, usePortrait: true });

    const timeline: string[] = [];
    book.on('ready', () => {
      timeline.push('ready');
      book.destroy();
    });
    book.on('loaded', () => {
      timeline.push('loaded');
    });

    expect(() => book.loadFromHTML(makePages(4))).not.toThrow();
    expect(timeline).toEqual(['ready']);
    expect(book.isDestroyed()).toBe(true);
  });

  test('hostile: a non-destroying ready still gets loaded after it', () => {
    // Discriminates "skip loaded always after ready" from the supersede guard.
    const el = host();
    const book = new PageFlip(el, { ...base, flippingTime: 0 });

    const timeline: string[] = [];
    book.on('ready', () => timeline.push('ready'));
    book.on('loaded', (e) => timeline.push(`loaded:${e.data.pageCount}`));

    book.loadFromHTML(makePages(3));
    expect(timeline).toEqual(['ready', 'loaded:3']);

    book.destroy();
  });
});

describe('nested pagesChanged — pin current re-entrancy behaviour', () => {
  test('a pagesChanged listener that calls updateFromHtml runs nested dispatch to completion', () => {
    // Document whatever the engine does today: trigger() snapshots listeners
    // per dispatch, so a nested updateFromHtml fully emits its own
    // pagesChanged before the outer dispatch continues. Not coalesced.
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0, usePortrait: true });

    const log: Array<{ pageCount: number; nested: boolean }> = [];
    let nested = false;

    book.on('pagesChanged', (e) => {
      log.push({ pageCount: e.data.pageCount, nested });
      if (!nested && e.data.pageCount === 6) {
        nested = true;
        book.updateFromHtml(makePages(2));
        nested = false;
      }
    });

    book.updateFromHtml(makePages(6));

    // Outer starts (6), nested runs fully (2), outer's remaining work is done
    // — with a single listener the outer call has already finished its body
    // after the nested return, so the log is [6, 2].
    expect(log).toEqual([
      { pageCount: 6, nested: false },
      { pageCount: 2, nested: true },
    ]);
    expect(book.getPageCount()).toBe(2);

    destroy();
  });

  test('a second pagesChanged listener still sees the OUTER snapshot after a nested reload', () => {
    // E1 snapshot: listener B was registered for the outer emit, so it still
    // runs with the outer payload even though the collection is already the
    // nested one by the time B executes.
    const { book, destroy } = makeHtmlBook({ pageCount: 4, flippingTime: 0, usePortrait: true });

    const seenByB: number[] = [];
    let reentered = false;

    book.on('pagesChanged', (e) => {
      if (!reentered && e.data.pageCount === 6) {
        reentered = true;
        book.updateFromHtml(makePages(2));
      }
    });
    book.on('pagesChanged', (e) => {
      seenByB.push(e.data.pageCount);
    });

    book.updateFromHtml(makePages(6));

    // Nested emit also has both listeners in its snapshot. Order:
    //   outer A (re-enters) → nested A → nested B (2) → outer B (6)
    expect(seenByB).toEqual([2, 6]);
    expect(book.getPageCount()).toBe(2);

    destroy();
  });
});

describe('EventObject.once is public on PageFlip', () => {
  test('once("loaded") fires for the first load only', () => {
    const el = host();
    const book = new PageFlip(el, { ...base, flippingTime: 0 });

    const counts: number[] = [];
    book.once('loaded', (e) => counts.push(e.data.pageCount));

    book.loadFromHTML(makePages(2));
    book.loadFromHTML(makePages(4));

    expect(counts).toEqual([2]);
    book.destroy();
  });

  test('off(event, originalCallback) cancels a once registration', () => {
    const el = host();
    const book = new PageFlip(el, { ...base, flippingTime: 0 });

    const seen: number[] = [];
    const fn = (e: { data: BookSnapshot }): void => {
      seen.push(e.data.pageCount);
    };
    book.once('loaded', fn);
    book.off('loaded', fn);

    book.loadFromHTML(makePages(3));
    expect(seen).toEqual([]);

    book.destroy();
  });

  test('once chains and returns this', () => {
    const el = host();
    const book = new PageFlip(el, { ...base, flippingTime: 0 });
    expect(book.once('ready', vi.fn())).toBe(book);
    book.destroy();
  });
});
