import { describe, expect, test } from 'vitest';
import {
  Settings,
  DEFAULT_PAGE_BACKGROUND,
  isOpaquePageBackground,
  PageFlipError,
} from '@gullabs/flipbook-core';
import { foldFill } from '../src/Render/pageBackground';

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

  test('a non-string pageBackground falls back to the default, it does not crash', () => {
    // Every other bad value in getSettings raises a PageFlipError; this one
    // raised `TypeError: pageBackground.trim is not a function` from inside
    // safePageBackground, straight out of the PageFlip constructor.
    for (const bad of [0, 1, {}, [], true, Symbol('x')]) {
      expect(() =>
        new Settings().getSettings({
          width: 100,
          height: 200,
          pageBackground: bad as unknown as string,
        }),
      ).not.toThrow();

      expect(
        new Settings().getSettings({
          width: 100,
          height: 200,
          pageBackground: bad as unknown as string,
        }).pageBackground,
      ).toBe(DEFAULT_PAGE_BACKGROUND);
    }
  });

  test('a non-string pageBackground is refused, not stringified', () => {
    // Discriminates the fix from `String(pageBackground)`: every other
    // non-string stringifies into something invalid and lands on the default
    // anyway, so only a value that coerces to a *valid* colour can tell the
    // two apart. An array is not a documented pageBackground; honouring it
    // would be the type contract drifting open by accident.
    const settings = new Settings().getSettings({
      width: 100,
      height: 200,
      pageBackground: ['red'] as unknown as string,
    });

    expect(settings.pageBackground).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(settings.pageBackground).not.toBe('red');
  });

  test('a string pageBackground still goes through both sanitising and the opacity check', () => {
    // The type guard must not become a short-circuit: a real string still has
    // to reach safePageBackground, which is where CSS safety and opacity are
    // decided (two separate jobs, per the invariant).
    const kept = new Settings().getSettings({
      width: 100,
      height: 200,
      pageBackground: '#0f0',
    });
    expect(kept.pageBackground).toBe('#0f0');

    for (const seeThrough of [
      'transparent',
      'rgba(255,255,255,0)',
      'hsla(0,0%,100%,.5)',
      '#fff0',
      '#ffffff00',
      'color-mix(in srgb, red, blue)',
      'var(--x)',
      'red;position:fixed',
      'red}body{display:none',
      'red/*x*/',
      '   ',
    ]) {
      expect(
        new Settings().getSettings({ width: 100, height: 200, pageBackground: seeThrough })
          .pageBackground,
      ).toBe(DEFAULT_PAGE_BACKGROUND);
    }
  });

  test('stretch bounds are never left inverted by the max fallback', () => {
    // The fallback filled an absent maxWidth with a flat 2000, which lands
    // BELOW a minWidth the caller declared above it. Render then goes portrait
    // under `minWidth * 2` and clamps pageWidth to maxWidth, so the book can
    // never reach its own declared minimum and nothing is reported.
    const wide = new Settings().getSettings({
      width: 300,
      height: 400,
      size: 'stretch',
      minWidth: 3000,
    });
    expect(wide.minWidth).toBe(3000);
    expect(wide.maxWidth).toBe(3000);
    expect(wide.maxWidth).toBeGreaterThanOrEqual(wide.minWidth);

    const tall = new Settings().getSettings({
      width: 300,
      height: 400,
      size: 'stretch',
      minHeight: 3000,
    });
    expect(tall.minHeight).toBe(3000);
    expect(tall.maxHeight).toBe(3000);
    expect(tall.maxHeight).toBeGreaterThanOrEqual(tall.minHeight);

    // …and the ordinary "no bounds given" case still gets the 2000 default,
    // so the fix cannot degenerate into `maxWidth = minWidth`.
    const plain = new Settings().getSettings({ width: 300, height: 400, size: 'stretch' });
    expect(plain.maxWidth).toBe(2000);
    expect(plain.maxHeight).toBe(2000);
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
