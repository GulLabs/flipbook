import { describe, expect, test } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';

function makeBook() {
  // No DOM needed: every call under test fails before touching the element.
  return new PageFlip({} as HTMLElement, { width: 200, height: 300, flippingTime: 0 });
}

describe('engine lifecycle before load', () => {
  test('accessors throw a typed NOT_LOADED error instead of a TypeError', () => {
    const book = makeBook();

    for (const call of [
      () => book.getRender(),
      () => book.getUI(),
      () => book.getPageCollection(),
      () => book.getPageCount(),
      () => book.getCurrentPageIndex(),
      () => book.getOrientation(),
      () => book.getBoundsRect(),
      () => book.getPage(0),
      () => book.turnToPage(0),
      () => book.turnToNextPage(),
      () => book.turnToPrevPage(),
      () => book.clear(),
    ]) {
      expect(call).toThrow(PageFlipError);
      expect(call).toThrow(/NOT_LOADED|not available/);
    }
  });

  test('the error carries a machine-readable code', () => {
    const book = makeBook();
    try {
      book.getPageCount();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PageFlipError);
      expect((err as PageFlipError).code).toBe('NOT_LOADED');
    }
  });

  test('settings and state stay usable before load', () => {
    const book = makeBook();

    expect(book.getSettings().width).toBe(200);
    expect(book.getFlipController()).toBeNull();
    expect(book.isDestroyed()).toBe(false);
    // Both are documented as safe no-ops pre-load; the React binding calls them
    // from effects that run before `loadFromHTML`.
    expect(() => book.update()).not.toThrow();
    expect(() => book.updateSettings({ flippingTime: 10 })).not.toThrow();
    expect(book.getSettings().flippingTime).toBe(10);
  });

  test('destroy before load is a no-op', () => {
    const book = makeBook();
    expect(() => book.destroy()).not.toThrow();
    expect(book.isDestroyed()).toBe(true);
  });
});
