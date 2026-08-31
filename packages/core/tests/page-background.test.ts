import { describe, expect, test } from 'vitest';
import { foldFill } from '../src/Render/pageBackground';
import { DEFAULT_PAGE_BACKGROUND } from '../src/Render/pageBackground';
import { isOpaquePageBackground } from '../src/Render/pageBackground';
import { safePageBackground } from '../src/Render/pageBackground';

describe('opaque fold fill (shipped)', () => {
  test('temporary copy / fold use opaque pageBackground', () => {
    expect(foldFill(undefined)).toBe('#fff');
    expect(foldFill('')).toBe('#fff');
    expect(foldFill('#f5f0e6')).toBe('#f5f0e6');
    expect(foldFill('#fff')).toBe('#fff');
    expect(isOpaquePageBackground(foldFill())).toBe(true);
  });

  test('recognises see-through values', () => {
    expect(isOpaquePageBackground('transparent')).toBe(false);
    expect(isOpaquePageBackground('inherit')).toBe(false);
    expect(isOpaquePageBackground('currentColor')).toBe(false);
    expect(isOpaquePageBackground('rgba(0, 0, 0, 0)')).toBe(false);
    expect(isOpaquePageBackground('rgba(0, 0, 0, 0.5)')).toBe(false);
    expect(isOpaquePageBackground('hsla(0, 0%, 0%, 0.2)')).toBe(false);
    expect(isOpaquePageBackground('#ffffff00')).toBe(false);
    expect(isOpaquePageBackground('#fff8')).toBe(false);
  });

  test('recognises opaque values', () => {
    expect(isOpaquePageBackground('#fff')).toBe(true);
    expect(isOpaquePageBackground('cream')).toBe(true);
    expect(isOpaquePageBackground('rgb(255, 255, 255)')).toBe(true);
    expect(isOpaquePageBackground('rgba(255, 255, 255, 1)')).toBe(true);
    expect(isOpaquePageBackground('#ffffffff')).toBe(true);
    expect(isOpaquePageBackground(undefined)).toBe(true);
  });

  test('a translucent background never reaches the fold', () => {
    // §4.2 exists precisely so content cannot bleed through the turning leaf.
    expect(safePageBackground('rgba(0, 0, 0, 0.4)')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('transparent')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('#ffffff00')).toBe(DEFAULT_PAGE_BACKGROUND);
  });

  test('rejects values that could smuggle CSS into cssText', () => {
    expect(safePageBackground('url(https://example.com/x.png)')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('#fff; position: fixed')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('var(--paper)')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(safePageBackground('expression(alert(1))')).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(foldFill('#fff; position: fixed')).toBe(DEFAULT_PAGE_BACKGROUND);
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
