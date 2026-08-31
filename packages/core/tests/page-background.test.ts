import { describe, expect, test } from 'vitest';
import { foldFill } from '../src/Render/pageBackground';
import { DEFAULT_PAGE_BACKGROUND } from '../src/Render/pageBackground';
import { safePageBackground } from '../src/Render/pageBackground';

/**
 * B3 (docs/API-CONTRACT.md): there is no opacity parser any more. Opacity is
 * structural — `.stf__item::before` composites the consumer's value over an
 * opaque base (see `styling-contract.test.ts`) — so this module checks only
 * injection safety and "is it a colour at all", and everything that passes is
 * drawn VERBATIM, translucent values included.
 */
describe('fold fill draws verbatim; safety is the only gate', () => {
  test('ordinary values pass through untouched', () => {
    expect(foldFill(undefined)).toBe('#fff');
    expect(foldFill('')).toBe('#fff');
    expect(foldFill('#f5f0e6')).toBe('#f5f0e6');
    expect(foldFill('#fff')).toBe('#fff');
  });

  test('translucent values are ACCEPTED — the opaque base is structural now', () => {
    // Two alpha parsers in a row were defeated by syntax they had not met
    // (`rgb(0 0 0 / 50%)`, then `calc(.5)` / `color-mix` / `var()` fallbacks).
    // These painting verbatim is the contract; the ::before base keeps the
    // fold opaque underneath them.
    expect(safePageBackground('rgba(0, 0, 0, 0.4)')).toBe('rgba(0, 0, 0, 0.4)');
    expect(safePageBackground('transparent')).toBe('transparent');
    expect(safePageBackground('#ffffff00')).toBe('#ffffff00');
    expect(safePageBackground('var(--paper, transparent)')).toBe('var(--paper, transparent)');
  });

  test('rejects values that could smuggle CSS into cssText', () => {
    // The safety half is NOT structural and must stay static: this value is
    // interpolated into a style attribute.
    expect(safePageBackground('url(https://example.com/x.png)')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('#fff; position: fixed')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('expression(alert(1))')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('red}{')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(foldFill('#fff; position: fixed')).toBe(DEFAULT_PAGE_BACKGROUND);
  });

  test('a bare var() is a colour now — an unset property resolves to the opaque base', () => {
    // The mandatory-fallback rule existed to keep a typo from painting
    // transparent. Structurally, `--stf-paper: var(--typo)` is
    // guaranteed-invalid when `--typo` is unset, so the ::before falls back
    // to its own `#fff` — the typo costs the author their colour, never the
    // reader their opacity.
    expect(safePageBackground('var(--paper)')).toBe('var(--paper)');
  });
});

describe('the draw-time guard survives a non-string on the live settings object', () => {
  /**
   * `foldFill` runs for every page on every frame against
   * `getSettings().pageBackground`, and `getSettings()` returns the LIVE
   * settings object — which is the whole reason a draw-time guard exists
   * separately from the settings boundary. An untyped consumer assigning to it
   * skips validation entirely.
   *
   * The declared parameter type is therefore not a guarantee here, and
   * `pageBackground.trim()` threw a bare `TypeError` out of the render loop on
   * the NEXT frame — so the book stopped mid-turn, nowhere near the assignment
   * that caused it.
   */
  test.each([
    ['a number', 0],
    ['an object', {}],
    ['an array', ['red']],
    ['a boolean', false],
  ])('%s falls back to the opaque default instead of throwing', (_label, value) => {
    expect(() => foldFill(value as unknown as string)).not.toThrow();
    expect(foldFill(value as unknown as string)).toBe('#fff');
  });

  test('a real string is still honoured, so the guard is not a blanket default', () => {
    expect(foldFill('#0f0')).toBe('#0f0');
    expect(foldFill('  #0f0  ')).toBe('#0f0');
  });
});
