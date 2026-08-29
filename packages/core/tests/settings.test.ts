import { describe, expect, test } from 'vitest';
import { Settings, DEFAULT_PAGE_BACKGROUND, PageFlipError } from '@gullabs/flipbook-core';
import { foldFill, isOpaquePageBackground } from '../src/Render/pageBackground';

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
    expect(() => new Settings().getSettings({ width: 300, height: 400, flippingTime: -1 })).toThrow(
      PageFlipError,
    );
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
    // Untrusted/transparent values are sanitized to the default fill.
    expect(foldFill('transparent')).toBe('#fff');
    expect(foldFill('url(javascript:alert(1))')).toBe('#fff');
  });

  test('direction rtl is accepted', () => {
    const settings = new Settings().getSettings({
      width: 100,
      height: 200,
      direction: 'rtl',
    });
    expect(settings.direction).toBe('rtl');
  });

  test('rejects invalid size, dimensions, and direction', () => {
    expect(() =>
      new Settings().getSettings({
        width: 100,
        height: 200,
        size: 'fluid' as 'fixed',
      }),
    ).toThrow(PageFlipError);

    expect(() => new Settings().getSettings({ width: 0, height: 200 })).toThrow(PageFlipError);
    expect(() => new Settings().getSettings({ width: 100, height: -1 })).toThrow(PageFlipError);

    expect(() =>
      new Settings().getSettings({
        width: 100,
        height: 200,
        direction: 'ttb' as 'ltr',
      }),
    ).toThrow(PageFlipError);
  });

  test('stretch size fills missing min/max bounds', () => {
    const settings = new Settings().getSettings({
      width: 300,
      height: 400,
      size: 'stretch',
      minWidth: 0,
      maxWidth: 0,
      minHeight: 0,
      maxHeight: 0,
    });
    expect(settings.minWidth).toBe(100);
    expect(settings.maxWidth).toBe(2000);
    expect(settings.minHeight).toBe(100);
    expect(settings.maxHeight).toBe(2000);
  });

  test('fixed size pins min/max to width/height', () => {
    const settings = new Settings().getSettings({
      width: 320,
      height: 480,
      size: 'fixed',
      minWidth: 1,
      maxWidth: 9999,
    });
    expect(settings.minWidth).toBe(320);
    expect(settings.maxWidth).toBe(320);
    expect(settings.minHeight).toBe(480);
    expect(settings.maxHeight).toBe(480);
  });
});
