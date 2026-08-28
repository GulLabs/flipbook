import { describe, expect, test } from 'vitest';
import {
  PageFlip,
  Settings,
  effectiveFlippingTime,
} from '@gullabs/flipbook-core';

describe('SSR / Node import of shipped core', () => {
  test('does not require window at import time', () => {
    expect(typeof window).toBe('undefined');
    const settings = new Settings().getSettings({
      width: 320,
      height: 480,
      flippingTime: 0,
      respectReducedMotion: true,
    });
    expect(settings.flippingTime).toBe(0);
    expect(settings.respectReducedMotion).toBe(true);
    expect(effectiveFlippingTime(800, false)).toBe(800);
    expect(effectiveFlippingTime(0, true)).toBe(0);
    expect(typeof PageFlip).toBe('function');
  });

  test('constructor with flippingTime 0 returns a usable settings object', () => {
    const fakeRoot = {} as HTMLElement;
    const book = new PageFlip(fakeRoot, {
      width: 200,
      height: 300,
      flippingTime: 0,
    });
    const got = book.getSettings();
    expect(got.flippingTime).toBe(0);
    expect(got.width).toBe(200);
    expect(got.pageBackground.length).toBeGreaterThan(0);
  });
});
