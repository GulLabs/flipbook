import { describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';

describe('SSR / Node import of shipped core', () => {
  test('does not require window at import time', async () => {
    expect(typeof window).toBe('undefined');
    // Dynamic import is the consumer path under SSR: the package entry must
    // load without touching window/document.
    const core = await import('@gullabs/flipbook-core');
    expect(typeof core.PageFlip).toBe('function');
    expect(core.SizeMode.FIXED).toBe('fixed');
    expect(core.ALL_POINTERS.length).toBe(3);
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
    expect(book.isReady()).toBe(false);
  });

  test('destroy is a no-op the second time; the engine stays dead', () => {
    const fakeRoot = {} as HTMLElement;
    const book = new PageFlip(fakeRoot, {
      width: 200,
      height: 300,
      flippingTime: 0,
    });
    book.destroy();
    book.destroy();
    expect(book.isDestroyed()).toBe(true);
    expect(book.isReady()).toBe(false);
    expect(book.isAnimating()).toBe(false);
  });
});
