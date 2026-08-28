import { describe, expect, test } from 'vitest';
import {
  Settings,
  foldFill,
  isOpaquePageBackground,
  DEFAULT_PAGE_BACKGROUND,
  PageFlipError,
} from '@gullabs/flipbook-core';

describe('Settings.getSettings (shipped)', () => {
  test('flippingTime: 0 is instant and does not throw', () => {
    const settings = new Settings().getSettings({
      width: 300,
      height: 400,
      flippingTime: 0,
      respectReducedMotion: true,
    });
    expect(settings.flippingTime).toBe(0);
    expect(settings.respectReducedMotion).toBe(true);
  });

  test('negative flippingTime still throws', () => {
    expect(() =>
      new Settings().getSettings({ width: 300, height: 400, flippingTime: -1 }),
    ).toThrow(PageFlipError);
  });

  test('does not mutate defaults across instances', () => {
    new Settings().getSettings({ width: 100, height: 200, flippingTime: 0 });
    const next = new Settings().getSettings({ width: 100, height: 200 });
    expect(next.flippingTime).toBe(1000);
  });

  test('pageBackground defaults to opaque #fff', () => {
    const settings = new Settings().getSettings({ width: 100, height: 200 });
    expect(settings.pageBackground).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(foldFill(settings.pageBackground)).toBe('#fff');
    expect(isOpaquePageBackground(settings.pageBackground)).toBe(true);
    expect(isOpaquePageBackground('transparent')).toBe(false);
  });

  test('direction rtl is accepted', () => {
    const settings = new Settings().getSettings({
      width: 100,
      height: 200,
      direction: 'rtl',
    });
    expect(settings.direction).toBe('rtl');
  });
});
