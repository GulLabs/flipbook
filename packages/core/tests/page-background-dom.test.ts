// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { DEFAULT_PAGE_BACKGROUND, safePageBackground } from '@gullabs/flipbook-core';

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
