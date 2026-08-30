import { describe, expect, test } from 'vitest';
import {
  Settings,
  DEFAULT_PAGE_BACKGROUND,
  isOpaquePageBackground,
  PageFlipError,
} from '@gullabs/flipbook-core';
import type { FlipOptions } from '@gullabs/flipbook-core';
import { foldFill } from '../src/Render/pageBackground';

const resolve = (partial: FlipOptions) => new Settings().resolve(partial);

const codeOf = (partial: Record<string, unknown>): string => {
  try {
    resolve(partial as FlipOptions);
  } catch (error) {
    return (error as PageFlipError).code;
  }
  return 'NO_THROW';
};

const settingOf = (partial: Record<string, unknown>): string | undefined => {
  try {
    resolve(partial as FlipOptions);
  } catch (error) {
    return (error as PageFlipError).setting;
  }
  return undefined;
};

describe('Settings.resolve (shipped)', () => {
  test('flippingTime: 0 is instant and does not throw', () => {
    const settings = resolve({
      width: 300,
      height: 400,
      flippingTime: 0,
      respectReducedMotion: true,
    });
    expect(settings.flippingTime).toBe(0);
    expect(settings.respectReducedMotion).toBe(true);
  });

  test('negative flippingTime still throws', () => {
    expect(() => resolve({ width: 300, height: 400, flippingTime: -1 })).toThrow(PageFlipError);
    expect(codeOf({ width: 300, height: 400, flippingTime: -1 })).toBe('INVALID_SETTING');
    expect(settingOf({ width: 300, height: 400, flippingTime: -1 })).toBe('flippingTime');
  });

  test('does not mutate defaults across instances', () => {
    resolve({ width: 100, height: 200, flippingTime: 0 });
    const next = resolve({ width: 100, height: 200 });
    expect(next.flippingTime).toBe(1000);
  });

  test('pageBackground defaults to opaque #fff', () => {
    const settings = resolve({ width: 100, height: 200 });
    expect(settings.pageBackground).toBe(DEFAULT_PAGE_BACKGROUND);
    expect(foldFill(settings.pageBackground)).toBe('#fff');
    expect(isOpaquePageBackground(settings.pageBackground)).toBe(true);
    expect(isOpaquePageBackground('transparent')).toBe(false);
    // Draw-time sanitiser still substitutes; settings.resolve throws instead.
    expect(foldFill('transparent')).toBe('#fff');
    expect(foldFill('url(javascript:alert(1))')).toBe('#fff');
  });

  test('readingDirection rtl is accepted', () => {
    const settings = resolve({
      width: 100,
      height: 200,
      readingDirection: 'rtl',
    });
    expect(settings.readingDirection).toBe('rtl');
  });

  test('rejects invalid sizing, dimensions, and readingDirection', () => {
    expect(() =>
      resolve({
        width: 100,
        height: 200,
        sizing: 'fluid' as 'fixed',
      }),
    ).toThrow(PageFlipError);
    expect(codeOf({ width: 100, height: 200, sizing: 'fluid' })).toBe('INVALID_SETTING');
    expect(settingOf({ width: 100, height: 200, sizing: 'fluid' })).toBe('sizing');

    expect(() => resolve({ width: 0, height: 200 })).toThrow(PageFlipError);
    expect(settingOf({ width: 0, height: 200 })).toBe('width');
    expect(() => resolve({ width: 100, height: -1 })).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: -1 })).toBe('height');

    expect(() =>
      resolve({
        width: 100,
        height: 200,
        readingDirection: 'ttb' as 'ltr',
      }),
    ).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 200, readingDirection: 'ttb' })).toBe(
      'readingDirection',
    );
  });

  test('responsive sizing fills missing min/max bounds', () => {
    const settings = resolve({
      width: 300,
      height: 400,
      sizing: 'responsive',
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

  test('a non-string pageBackground throws INVALID_SETTING', () => {
    // D3: settings boundary throws rather than silently substituting white.
    for (const bad of [0, 1, {}, [], true, Symbol('x')]) {
      expect(() =>
        resolve({
          width: 100,
          height: 200,
          pageBackground: bad as unknown as string,
        }),
      ).toThrow(PageFlipError);

      expect(
        codeOf({
          width: 100,
          height: 200,
          pageBackground: bad,
        }),
      ).toBe('INVALID_SETTING');
      expect(
        settingOf({
          width: 100,
          height: 200,
          pageBackground: bad,
        }),
      ).toBe('pageBackground');
    }
  });

  test('a non-string pageBackground is refused, not stringified', () => {
    // An array would coerce to a valid colour under String(); resolve must not.
    expect(() =>
      resolve({
        width: 100,
        height: 200,
        pageBackground: ['red'] as unknown as string,
      }),
    ).toThrow(PageFlipError);
    expect(settingOf({ width: 100, height: 200, pageBackground: ['red'] })).toBe('pageBackground');
  });

  test('a string pageBackground still goes through the opacity check', () => {
    const kept = resolve({
      width: 100,
      height: 200,
      pageBackground: '#0f0',
    });
    expect(kept.pageBackground).toBe('#0f0');

    // Whitespace-only is treated as unset and falls back to the default.
    expect(resolve({ width: 100, height: 200, pageBackground: '   ' }).pageBackground).toBe(
      DEFAULT_PAGE_BACKGROUND,
    );

    // D3: translucent values throw at the boundary (no silent white fold).
    // CSS-safety (var/url/injection) is still the draw-time `safePageBackground`
    // job — `isOpaquePageBackground` only sees alpha / see-through keywords.
    for (const seeThrough of [
      'transparent',
      'rgba(255,255,255,0)',
      'hsla(0,0%,100%,.5)',
      '#fff0',
      '#ffffff00',
    ]) {
      expect(() => resolve({ width: 100, height: 200, pageBackground: seeThrough })).toThrow(
        PageFlipError,
      );
      expect(settingOf({ width: 100, height: 200, pageBackground: seeThrough })).toBe(
        'pageBackground',
      );
    }
  });

  test('responsive bounds are never left inverted by the max fallback', () => {
    // The fallback filled an absent maxWidth with a flat 2000, which lands
    // BELOW a minWidth the caller declared above it. Render then goes portrait
    // under `minWidth * 2` and clamps pageWidth to maxWidth, so the book can
    // never reach its own declared minimum and nothing is reported.
    const wide = resolve({
      width: 300,
      height: 400,
      sizing: 'responsive',
      minWidth: 3000,
    });
    expect(wide.minWidth).toBe(3000);
    expect(wide.maxWidth).toBe(3000);
    expect(wide.maxWidth).toBeGreaterThanOrEqual(wide.minWidth);

    const tall = resolve({
      width: 300,
      height: 400,
      sizing: 'responsive',
      minHeight: 3000,
    });
    expect(tall.minHeight).toBe(3000);
    expect(tall.maxHeight).toBe(3000);
    expect(tall.maxHeight).toBeGreaterThanOrEqual(tall.minHeight);

    // …and the ordinary "no bounds given" case still gets the 2000 default,
    // so the fix cannot degenerate into `maxWidth = minWidth`.
    const plain = resolve({ width: 300, height: 400, sizing: 'responsive' });
    expect(plain.maxWidth).toBe(2000);
    expect(plain.maxHeight).toBe(2000);
  });

  test('fixed sizing pins min/max to width/height', () => {
    const settings = resolve({
      width: 320,
      height: 480,
      sizing: 'fixed',
    });
    expect(settings.minWidth).toBe(320);
    expect(settings.maxWidth).toBe(320);
    expect(settings.minHeight).toBe(480);
    expect(settings.maxHeight).toBe(480);
  });

  test('fixed sizing rejects a conflicting authored bound', () => {
    // Under fixed, bounds derive from width/height; a different authored
    // min/max does nothing and used to be overwritten silently.
    expect(
      codeOf({
        width: 320,
        height: 480,
        sizing: 'fixed',
        minWidth: 1,
        maxWidth: 9999,
      }),
    ).toBe('INVALID_SETTING');
    expect(
      settingOf({
        width: 320,
        height: 480,
        sizing: 'fixed',
        minWidth: 1,
      }),
    ).toBe('minWidth');
  });
});
