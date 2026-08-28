import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PAGE_BACKGROUND,
  foldFill,
  foldFillCss,
  isOpaquePageBackground,
  safePageBackground,
} from '@gullabs/flipbook-core';

describe('opaque fold fill (shipped)', () => {
  test('temporary copy / fold use opaque pageBackground', () => {
    expect(foldFill(undefined)).toBe('#fff');
    expect(foldFill('')).toBe('#fff');
    expect(foldFill('#f5f0e6')).toBe('#f5f0e6');
    expect(foldFillCss('#fff')).toContain('background-color: #fff');
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
    expect(foldFillCss('#fff; position: fixed')).toBe('background-color: #fff;');
  });
});
