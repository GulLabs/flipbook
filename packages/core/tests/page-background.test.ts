import { describe, expect, test } from 'vitest';
import { foldFill, foldFillCss, isOpaquePageBackground } from '@gullabs/flipbook-core';

describe('opaque fold fill (shipped)', () => {
  test('temporary copy / fold use opaque pageBackground', () => {
    expect(foldFill(undefined)).toBe('#fff');
    expect(foldFill('')).toBe('#fff');
    expect(foldFill('#f5f0e6')).toBe('#f5f0e6');
    expect(foldFillCss('#fff')).toContain('background-color: #fff');
    expect(isOpaquePageBackground(foldFill())).toBe(true);
  });
});
