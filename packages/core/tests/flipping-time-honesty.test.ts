/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Puddlebend Issue 4 — `flippingTime` is a duration, not a ceiling.
 *
 * Upstream derived duration from the pixel path length against a magic
 * 1000-point reference: `flippingTime: 800` meant 800 ms on a ≥500 px page and
 * ~560 ms on a 350 px phone leaf. The reference is now the book's own full
 * turn (2 × pageWidth), so the setting means the same thing on every screen.
 * Observed by the product owner as "mobile flips are visibly faster", and the
 * consumer had begun compensating with `flippingTime × 1000 / (2 × pageW)` —
 * engine-internals arithmetic no consumer should need.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { installPointerCaptureShims, makeHtmlBook } from './html-book-fixture';
import { testRender } from './engine-access';

const books: Array<{ destroy: () => void }> = [];

beforeEach(() => {
  installPointerCaptureShims();
});

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

/** Capture the duration handed to `Render.startAnimation` by the next turn. */
function captureDuration(book: ReturnType<typeof makeHtmlBook>['book']): () => number | null {
  const render = testRender(book) as unknown as {
    startAnimation: (frames: unknown[], duration: number, done: () => void) => void;
  };
  const original = render.startAnimation.bind(render);
  let seen: number | null = null;

  render.startAnimation = (frames, duration, done) => {
    seen = duration;
    original(frames, duration, done);
  };

  return () => seen;
}

function bookOf(width: number) {
  const made = makeHtmlBook({
    pageCount: 4,
    width,
    height: Math.round(width * 1.5),
    hostWidth: width * 2,
    hostHeight: Math.round(width * 1.5),
    flippingTime: 800,
    usePortrait: false,
  });
  books.push(made);
  return made;
}

describe('flippingTime is honest per page size', () => {
  test('a full turn takes the configured time on a small page', () => {
    // 200 px page → 400 px full turn. The old formula gave 400/1000 × 800 =
    // 320 ms — the phone-flips-faster defect, pinned here as the revert proof.
    const { book } = bookOf(200);
    const duration = captureDuration(book);

    expect(book.flipNext()).toBe(true);
    expect(duration()).toBe(800);
  });

  test('…and the same configured time on a large page', () => {
    const { book } = bookOf(700);
    const duration = captureDuration(book);

    expect(book.flipNext()).toBe(true);
    expect(duration()).toBe(800);
  });

  test('a huge book is not shortened by the point cap', () => {
    // pointsBetween caps at 4097 points; a duration derived from
    // points.length would silently shorten this book's turns.
    const { book } = bookOf(3000);
    const duration = captureDuration(book);

    expect(book.flipNext()).toBe(true);
    expect(duration()).toBe(800);
  });
});
