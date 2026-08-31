/**
 * B5 + C8 (docs/API-CONTRACT.md §4) — the instant navigation triad.
 *
 * B5: an instant jump SETTLES the turn in flight before it moves. story-book's
 * spread dots called `getRender().finishAnimation()` before `turnToPage`
 * because a curl landing after the jump committed a relative turn on top of
 * it; that getter is internal now, so the engine owns the settle. The jump's
 * synchronous window is a BARRIER: every turn request from inside its
 * dispatch is refused without an event, and at most one
 * `turnRejected { reason: 'superseded' }` is emitted per jump. Lifecycle is
 * revalidated after the settle — a listener that destroys or reloads the book
 * makes the jump stop without effect and without error.
 *
 * C8: `turnToNextPage`/`turnToPrevPage` return `boolean` and report a
 * boundary through `turnRejected`, exactly like `flipNext`/`flipPrev` — the
 * two triads differ only in animation.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import type { TurnRejected } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages } from './html-book-fixture';

const books: Array<() => void> = [];

afterEach(() => {
  while (books.length) books.pop()?.();
  document.body.innerHTML = '';
});

function animatedBook(pageCount = 6) {
  const made = makeHtmlBook({ pageCount, flippingTime: 400 });
  books.push(made.destroy);
  return made;
}

const twoFrames = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

describe('B5 — turnToPage settles the turn in flight', () => {
  test('a jump during an animated turn lands on the asked-for page and stays there', async () => {
    const { book } = animatedBook();
    const flips: number[] = [];
    book.on('flip', (e) => flips.push(e.data.page));

    expect(book.flipNext()).toBe(true);
    expect(book.isAnimating()).toBe(true);

    // The story-book case: a spread dot pressed mid-curl. The outgoing turn
    // commits first (finish-then-jump, same policy as the animated path),
    // then the jump lands.
    book.turnToPage(3);
    expect(book.getCurrentPageIndex()).toBe(3);
    expect(flips).toEqual([1, 3]);
    expect(book.isAnimating()).toBe(false);

    // And STAYS there: no late commit from the superseded animation.
    await twoFrames();
    expect(book.getCurrentPageIndex()).toBe(3);
    expect(flips).toEqual([1, 3]);
  });

  test('a turn requested from inside the jump dispatch is refused; one superseded event', () => {
    const { book } = animatedBook();
    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    let nested: boolean | null = null;
    book.once('flip', () => {
      // Fires during the settle commit, inside the barrier. An instant nested
      // turn used to commit synchronously before any cleanup could catch it.
      nested = book.flipNext();
    });

    book.flipNext();
    book.turnToPage(3);

    expect(nested).toBe(false);
    expect(book.getCurrentPageIndex()).toBe(3);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'superseded' });
  });

  test('a turnRejected listener that turns does not recurse; the book stays on n', () => {
    const { book } = animatedBook();
    const rejected: TurnRejected[] = [];

    book.on('turnRejected', (e) => {
      rejected.push(e.data);
      // The recursion bait: refusal → event → request → refusal → …
      book.flipNext();
    });
    book.once('flip', () => {
      book.flipNext();
    });

    book.flipNext();
    book.turnToPage(3);

    expect(book.getCurrentPageIndex()).toBe(3);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'superseded' });
  });

  test('a listener that destroys the book mid-settle stops the jump silently', () => {
    const { book } = animatedBook();

    book.once('flip', () => {
      book.destroy();
    });

    book.flipNext();
    expect(() => book.turnToPage(3)).not.toThrow();
    expect(book.isDestroyed()).toBe(true);
  });

  test('a listener that replaces the collection mid-settle stops the jump silently', () => {
    const { book } = animatedBook();

    book.once('flip', () => {
      book.updateFromHtml(makePages(6));
    });

    book.flipNext();
    expect(() => book.turnToPage(3)).not.toThrow();
    // The replacement's own index rules own the book now; the stale jump must
    // not have moved it to 3 on top of them.
    expect(book.getCurrentPageIndex()).toBe(1);
  });
});

describe('C8 — the instant relative turns get an honest boundary', () => {
  test('turnToNextPage/turnToPrevPage return boolean and emit boundary rejections', () => {
    const { book } = animatedBook(4);
    const rejected: TurnRejected[] = [];
    book.on('turnRejected', (e) => rejected.push(e.data));

    expect(book.turnToPrevPage()).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'boundary', direction: 'prev' });

    expect(book.turnToNextPage()).toBe(true);
    expect(book.getCurrentPageIndex()).toBeGreaterThan(0);

    book.turnToPage(book.getPageCount() - 1);
    expect(book.turnToNextPage()).toBe(false);
    expect(rejected).toHaveLength(2);
    expect(rejected[1]).toMatchObject({ reason: 'boundary', direction: 'next' });
  });

  test('an instant relative turn also settles a turn in flight', async () => {
    const { book } = animatedBook();
    book.flipNext();
    expect(book.isAnimating()).toBe(true);

    expect(book.turnToNextPage()).toBe(true);
    const landed = book.getCurrentPageIndex();
    expect(book.isAnimating()).toBe(false);

    await twoFrames();
    expect(book.getCurrentPageIndex()).toBe(landed);
  });
});
