// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { DEFAULT_PAGE_BACKGROUND } from '../src/Render/pageBackground';
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
