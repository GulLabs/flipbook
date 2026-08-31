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

describe('SSR colour-shape path is linear (CodeQL js/polynomial-redos)', () => {
  /**
   * The old COLOUR_SHAPE_RE nested `\s*` / `[^()]*` / `(…)*` and CodeQL
   * flagged polynomial backtracking on long runs of spaces. The replacement
   * is a single left-to-right scan with a hard length cap. This pin is the
   * shape of the attack string, not a wall-clock assertion — if the scan
   * regressed to backtracking, a multi-megabyte space run would hang the
   * suite; finishing at all is the proof.
   *
   * Force the no-`CSS` branch: vitest's node env has no `CSS.supports`, so
   * `rejectPageBackground` already takes the shape path here. Re-check that
   * assumption so a future jsdom shift cannot make this test green while
   * skipping the code under test.
   */
  test('long space runs inside a fake function call are refused without hanging', () => {
    expect(typeof (globalThis as { CSS?: unknown }).CSS).toBe('undefined');

    const spaces = ' '.repeat(100_000);
    const attack = `rgb(${spaces}(${spaces})`;
    const started = Date.now();
    expect(safePageBackground(attack)).toBe(DEFAULT_PAGE_BACKGROUND);
    // Generous ceiling so a loaded CI runner cannot flake; the point is
    // "not seconds of backtracking", not a micro-benchmark.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('over-long values are refused by the length cap, not scanned forever', () => {
    expect(typeof (globalThis as { CSS?: unknown }).CSS).toBe('undefined');
    const huge = `a${'b'.repeat(10_000)}`;
    expect(safePageBackground(huge)).toBe(DEFAULT_PAGE_BACKGROUND);
  });

  test('one-level nested colour functions still pass the shape path', () => {
    expect(typeof (globalThis as { CSS?: unknown }).CSS).toBe('undefined');
    // Same grammar the old regex accepted: outer call + one nested pair.
    expect(safePageBackground('var(--paper, rgb(0 0 0 / 50%))')).toBe(
      'var(--paper, rgb(0 0 0 / 50%))',
    );
    expect(safePageBackground('color-mix(in srgb, red, blue)')).toBe(
      'color-mix(in srgb, red, blue)',
    );
  });
});
