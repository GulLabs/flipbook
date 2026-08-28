/**
 * Destroy-path invariants.
 *
 * `UI.distElement` is declared with definite assignment (`!`) rather than
 * `| null`, which is only sound because `PageFlip.ui` stays null until a load
 * completes — so `ui.destroy()` can never observe an unassigned dist element.
 * These tests pin that invariant: if someone constructs a `UI` outside the
 * load path, or makes `destroy()` reachable earlier, this file fails instead
 * of a consumer hitting `Cannot read properties of undefined`.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';
import { makePages } from './html-book-fixture';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PageFlip lifecycle', () => {
  test('destroy() on a never-loaded engine does not throw', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    expect(() => {
      book.destroy();
    }).not.toThrow();
    expect(book.isDestroyed()).toBe(true);
  });

  test('destroy() is idempotent after a load', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    book.loadFromHTML([]);
    book.destroy();
    expect(() => {
      book.destroy();
    }).not.toThrow();
  });

  test('accessors throw a typed error before load rather than returning undefined', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });

    // The published .d.ts promises non-null here; the guard is what makes that
    // promise honest instead of handing callers `undefined`.
    expect(() => book.getPageCollection()).toThrow(PageFlipError);
    expect(() => book.getRender()).toThrow(PageFlipError);
    expect(() => book.getUI()).toThrow(PageFlipError);
    expect(book.getFlipController()).toBeNull();

    book.destroy();
  });

  test('a turn requested before load is rejected, not crashed', () => {
    const book = new PageFlip(host(), { width: 200, height: 300 });
    const rejected: string[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data.reason));

    expect(book.flipNext()).toBe(false);
    expect(book.flipPrev()).toBe(false);
    expect(rejected).toEqual(['setup', 'setup']);

    book.destroy();
  });
});

describe('relative turns never throw', () => {
  /**
   * `flipNext` / `flipPrev` are what a swipe and an arrow key call, where
   * nothing is there to catch. They are documented to return a boolean and
   * emit `turnRejected`; an engine-internal `PageFlipError` used to escape
   * them and reach the consumer as an unhandled exception from a gesture.
   *
   * Explicit navigation keeps throwing — that is the §4.6 contract.
   */
  test('an engine-internal failure is reported as a rejection, not thrown', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: { reason: string; code?: string }[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    // Force the engine's own index guard to fire inside the turn.
    const collection = book.getPageCollection() as unknown as Record<string, unknown>;
    collection['getFlippingPage'] = () => {
      throw new PageFlipError('corrupt spread', 'INVALID_SPREAD');
    };

    expect(book.flipNext()).toBe(false);
    expect(rejected).toEqual([{ reason: 'setup', code: 'INVALID_SPREAD' }]);

    book.destroy();
  });

  test('a non-engine error is NOT swallowed into a rejection', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    const rejected: unknown[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    const collection = book.getPageCollection() as unknown as Record<string, unknown>;
    collection['getFlippingPage'] = () => {
      throw new TypeError('renderer blew up');
    };

    // A real defect must reach the consumer. Converting it to `false` would
    // hide a broken renderer behind "the book just would not turn".
    expect(() => book.flipNext()).toThrow(TypeError);
    expect(rejected).toEqual([]);

    book.destroy();
  });

  test('turnToPage still throws for an unreachable page', () => {
    const book = new PageFlip(host(), { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML(makePages(4));

    expect(() => book.turnToPage(99)).toThrow(PageFlipError);

    book.destroy();
  });
});
