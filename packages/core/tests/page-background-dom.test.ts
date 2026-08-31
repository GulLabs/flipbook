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
   * `getSettings()` hands back the live settings object, so assigning to it
   * skips validation entirely. The draw-time guard still consults the shared
   * predicate on that path — under B3 that means injection/junk falls back to
   * the default, while any real colour (translucent included) flows into
   * `--stf-paper`, where the ::before opaque base keeps the fold opaque.
   */
  test('a settings object mutated behind updateSettings still cannot inject or throw', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    const leaves = [document.createElement('div'), document.createElement('div')];
    book.loadFromHTML(leaves);

    // The vector: the getter hands back the live object, so this reaches the
    // renderer without passing through validation at all.
    book.getSettings().pageBackground = 'red;position:fixed';

    const page = testPage(book, 0);
    page.simpleDraw(1);
    // Injection never reaches the style attribute — the guard substitutes the
    // opaque default. Container roots carry the paper as the custom property.
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('#fff');
    expect(leaves[0]?.style.cssText).not.toMatch(/position:\s*fixed/);

    page.draw();
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('#fff');

    // A translucent value is legitimate now and flows through verbatim; the
    // ::before base (styling-contract.test.ts) is what keeps the fold opaque.
    book.getSettings().pageBackground = 'rgba(0, 0, 0, 0.4)';
    page.simpleDraw(1);
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('rgba(0, 0, 0, 0.4)');

    // The temporary copy is a third, independent path: it stamps the colour on
    // a cloned element rather than on the page's own.
    const copy = page.newTemporaryCopy();
    expect(copy).not.toBe(page);
    expect(
      (copy as unknown as { getElement(): HTMLElement })
        .getElement()
        .style.getPropertyValue('--stf-paper'),
    ).toBe('rgba(0, 0, 0, 0.4)');

    // A legitimate opaque value is still honoured through the same paths.
    book.getSettings().pageBackground = '#f4ecd8';
    page.simpleDraw(1);
    expect(leaves[0]?.style.getPropertyValue('--stf-paper')).toBe('#f4ecd8');

    book.destroy();
    host.remove();
  });
});
