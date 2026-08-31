/**
 * C6 (docs/API-CONTRACT.md §4) — observation returns are copies.
 *
 * `getSettings()` and `getBoundsRect()` must not hand back the live engine
 * objects. A consumer who mutates what they just read must not mutate the
 * book; a test that only checks shape passes a regression that re-exports the
 * live reference.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { makeHtmlBook } from './html-book-fixture';

const books: Array<() => void> = [];

afterEach(() => {
  while (books.length) books.pop()?.();
  document.body.innerHTML = '';
});

describe('C6 — observation returns are clones', () => {
  test('mutating getSettings() does not change the engine', () => {
    const { book, destroy } = makeHtmlBook({ flippingTime: 0, pageCount: 4 });
    books.push(destroy);

    const baseline = [...book.getSettings().pointerInput];
    const beforeTime = book.getSettings().flippingTime;
    const observed = book.getSettings();

    observed.flippingTime = beforeTime + 999;
    // Contract: copy (+ ideally a frozen pointerInput slice). The load-bearing
    // half is that a push on the observation never reaches the live list —
    // whether the copy throws (frozen) or accepts the push (mutable copy).
    try {
      (observed.pointerInput as string[]).push('__mutated__');
    } catch {
      // Object.freeze — fine
    }

    expect(book.getSettings().flippingTime).toBe(beforeTime);
    expect([...book.getSettings().pointerInput]).toEqual(baseline);
    expect(book.getSettings().pointerInput).not.toContain('__mutated__');
    // A second read is a different object.
    expect(book.getSettings()).not.toBe(observed);
    expect(book.getSettings().pointerInput).not.toBe(observed.pointerInput);
  });

  test('mutating getBoundsRect() does not change the engine', () => {
    const { book, destroy } = makeHtmlBook({
      flippingTime: 0,
      pageCount: 4,
      usePortrait: true,
    });
    books.push(destroy);

    const observed = book.getBoundsRect();
    const before = { ...observed, left: observed.left, width: observed.width };
    observed.left = before.left + 50;
    observed.width = before.width + 50;

    const again = book.getBoundsRect();
    expect(again.left).toBe(before.left);
    expect(again.width).toBe(before.width);
    expect(again).not.toBe(observed);
  });
});
