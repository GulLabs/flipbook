// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { DEFAULT_PAGE_BACKGROUND, foldFill } from '../src/Render/pageBackground';
import { safePageBackground } from '../src/Render/pageBackground';
import { testPage } from './engine-access';

/**
 * The safe-colour pattern accepts any short word as a named colour, but only
 * ~148 names are real. An invented one fails silently everywhere it matters:
 * CSS drops the declaration, leaving a transparent fold — the §4.2 bug the
 * setting exists to prevent — and canvas keeps whatever `fillStyle` was there
 * before. `CSS.supports` is the platform's own answer, so ask it where it
 * exists. In Node it does not, and the pattern stands alone as before.
 */
describe('invented colour names (needs CSS.supports)', () => {
  test('jsdom really does implement CSS.supports', () => {
    expect(typeof CSS?.supports).toBe('function');
    expect(CSS.supports('color', 'ivory')).toBe(true);
    expect(CSS.supports('color', 'papyrus')).toBe(false);
  });

  test('a word that is not a real colour falls back to the opaque default', () => {
    expect(safePageBackground('papyrus')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('cream')).toBe(DEFAULT_PAGE_BACKGROUND);
  });

  test('real named colours still pass', () => {
    expect(safePageBackground('ivory')).toBe('ivory');
    expect(safePageBackground('linen')).toBe('linen');
  });

  test('hex and rgb are unaffected', () => {
    expect(safePageBackground('#f4ecd8')).toBe('#f4ecd8');
    expect(safePageBackground('rgb(244, 236, 216)')).toBe('rgb(244, 236, 216)');
  });
});

describe('R2 — an unchanged background validates once, not once per frame', () => {
  /**
   * `foldFill` runs on every `applyEngineStyle` cache miss, and the flipping
   * leaf misses every frame — so before the size-1 memo, an unchanged
   * `pageBackground` re-ran `CSS.supports` once per rAF for the length of
   * every turn. The memo remembers the last (input → result) pair; a NEW
   * value — the only thing that can change the verdict — still validates.
   */
  test('repeat calls skip CSS.supports; a new value re-validates', () => {
    // Prime the memo with the value under test, then watch the platform call.
    foldFill('#abcdef');
    const spy = vi.spyOn(CSS, 'supports');

    try {
      expect(foldFill('#abcdef')).toBe('#abcdef');
      expect(foldFill('#abcdef')).toBe('#abcdef');
      expect(spy).not.toHaveBeenCalled();

      // A different string is a memo miss and must hit the platform again —
      // this is what keeps the untyped/defence-in-depth path honest.
      expect(foldFill('#123456')).toBe('#123456');
      expect(spy).toHaveBeenCalledTimes(1);

      // The memo is size-1: the previous value now re-validates too.
      expect(foldFill('#abcdef')).toBe('#abcdef');
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  test('a rejected value is memoized as its fallback, not as itself', () => {
    expect(foldFill('papyrus')).toBe(DEFAULT_PAGE_BACKGROUND);
    // Second call serves the same verdict from the memo.
    expect(foldFill('papyrus')).toBe(DEFAULT_PAGE_BACKGROUND);
  });
});

describe('the guards hold where the platform is odd or the caller misbehaves', () => {
  /**
   * `typeof CSS !== 'undefined'` is not enough on its own: an older or partial
   * platform can expose `CSS` without `supports`, and calling it throws.
   */
  test('a CSS object without supports() does not throw', () => {
    const real = globalThis.CSS;
    // @ts-expect-error — deliberately modelling a partial platform.
    globalThis.CSS = {};

    try {
      expect(safePageBackground('#f4ecd8')).toBe('#f4ecd8');
      // B3: translucent is legitimate input now; only injection/junk falls back.
      expect(safePageBackground('rgba(0, 0, 0, 0.4)')).toBe('rgba(0, 0, 0, 0.4)');
      expect(safePageBackground('red;position:fixed')).toBe(DEFAULT_PAGE_BACKGROUND);
    } finally {
      globalThis.CSS = real;
    }
  });

  /**
   * C6 closed the old vector entirely: `getSettings()` returns a COPY, so
   * assigning to the result mutates an observation, never the engine. The
   * draw-time guard stays for defence in depth, but the untyped-mutation path
   * it guarded no longer exists.
   */
  test('mutating the object getSettings() returns does not reach the engine (C6)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      pageBackground: '#f4ecd8',
    });
    const leaves = [document.createElement('div'), document.createElement('div')];
    book.loadFromHTML(leaves);

    // The old vector, now inert: this writes to a copy.
    book.getSettings().pageBackground = 'red;position:fixed';
    expect(book.getSettings().pageBackground).toBe('#f4ecd8');

    const page = testPage(book, 0);
    page.simpleDraw(1);
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('#f4ecd8');
    expect(leaves[0]?.style.cssText).not.toMatch(/position:\s*fixed/);

    // The nested array is a copy too — pushing into it changes nothing.
    const observed = book.getSettings();
    (observed.pointerInput as unknown as string[]).push('gamepad');
    expect(book.getSettings().pointerInput).toEqual(['mouse', 'touch', 'pen']);

    // And the rect is an observation, not live renderer geometry.
    const rect = book.getBoundsRect();
    rect.pageWidth = -1;
    expect(book.getBoundsRect().pageWidth).not.toBe(-1);

    // The supported route still works.
    book.updateSettings({ pageBackground: '#0f0' });
    page.simpleDraw(1);
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('#0f0');

    book.destroy();
    host.remove();
  });
});
