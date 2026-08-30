/**
 * THE FLAGSHIP INVARIANT, asserted where the engine actually decides it.
 *
 * `CLAUDE.md`: "The local curl is identical for both directions, ending at
 * `to.x = -pageWidth` (`portraitCurlLocal`). BACK reads as a rightward
 * on-screen curl only because `convertPageToGlobal` mirrors x. A 'smarter'
 * back curl with `to.x > pageWidth` re-creates the slide-in regression."
 *
 * That was previously "tested" by `geometry.test.ts` and
 * Pure helper equality tests cannot catch a regression in `Flip.runFlip`.
 * The real decision is one line in `Flip.runFlip`:
 *
 *   const curl = portraitCurlLocal(rect.pageWidth, rect.height, corner);
 *   calc.calc(curl.from);
 *   this.animateFlippingTo(curl.from, curl.to, true);
 *
 * A mutation that made BACK take `to: { x: rect.pageWidth * 2, y: ... }` —
 * verbatim the regression the docs warn about — left the whole suite green.
 *
 * So this file reads the destination the ENGINE animates towards, for a real
 * FORWARD turn and a real BACK turn on a real book, by capturing the frame
 * list handed to `Render.startAnimation` and replaying its last frame. Nothing
 * is stubbed out: the spy calls through, so the engine behaves exactly as it
 * would without it.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PageFlip } from '@gullabs/flipbook-core';
import type { Point } from '../src/BasicTypes';
import { makeHtmlBook } from './html-book-fixture';

/** `Render.FrameAction` is module-local; this is the same shape. */
type Frame = () => void;

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  vi.restoreAllMocks();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

/**
 * Run `turn()` and report the LOCAL position the engine's own last animation
 * frame lands on.
 *
 * `flippingTime` must be real: an instant turn runs `onAnimateEnd`
 * synchronously inside `startAnimation` and tears the calculation down before
 * anything can read it (AGENTS.md §4).
 */
function finalLocalPoint(app: PageFlip, turn: () => void): Point {
  const render = app.getRender();
  const captured: Frame[][] = [];
  const original = render.startAnimation.bind(render);

  vi.spyOn(render, 'startAnimation').mockImplementation(
    (frames: Frame[], duration: number, onAnimateEnd: () => void) => {
      captured.push(frames);
      // Call through — the animation still runs. This observes, it does not
      // replace the mechanism under test.
      original(frames, duration, onAnimateEnd);
    },
  );

  turn();

  expect(captured.length, 'the turn must have installed an animation').toBeGreaterThan(0);
  const frames = captured[captured.length - 1]!;
  expect(frames.length).toBeGreaterThan(1);

  // The turn is still in flight (real `flippingTime`, no rAF has fired yet), so
  // the calculation is live. Replaying the final frame drives it to the
  // destination `animateFlippingTo` was given.
  frames[frames.length - 1]!();

  const calc = app.getFlipController()!.getCalculation();
  expect(calc, 'the calculation must still be live mid-turn').not.toBeNull();

  return calc!.getPosition();
}

describe('the engine animates the SAME local curl for FORWARD and BACK', () => {
  test('both directions end at local x = -pageWidth', () => {
    const forwardBook = book({ pageCount: 6, startPage: 0, flippingTime: 400 });
    const rect = forwardBook.book.getBoundsRect();

    // FIXTURE CHECK: portrait, and a page width worth asserting against.
    expect(forwardBook.book.getOrientation()).toBe('portrait');
    expect(rect.pageWidth).toBe(200);

    const fwd = finalLocalPoint(forwardBook.book, () => {
      forwardBook.book.flipNext();
    });

    const backBook = book({ pageCount: 6, startPage: 3, flippingTime: 400 });
    expect(backBook.book.getCurrentPageIndex()).toBe(3);

    const back = finalLocalPoint(backBook.book, () => {
      backBook.book.flipPrev();
    });

    // THE INVARIANT. Not "two aliases agree" — the engine's own animation
    // destination, in FlipCalculation's local space, for each direction.
    expect(fwd.x).toBe(-rect.pageWidth);
    expect(back.x).toBe(-rect.pageWidth);
    expect(back.x).toBe(fwd.x);

    // And explicitly NOT the slide-in regression: a back curl aimed past the
    // right edge is what `CLAUDE.md` names, and BACK's x mirror turns it into a
    // leftward slide on screen.
    expect(back.x).toBeLessThan(0);
    expect(back.x).not.toBeGreaterThan(rect.pageWidth);
  });

  test('the BOTTOM corner changes only y, never the x destination', () => {
    // The corner argument is the only thing `runFlip` derives from state before
    // calling `portraitCurlLocal`. If a "smarter" curl ever keyed off direction
    // through the corner, this is where it would show.
    const b = book({ pageCount: 6, startPage: 3, flippingTime: 400 });
    const rect = b.book.getBoundsRect();

    const back = finalLocalPoint(b.book, () => {
      b.book.flipPrev('bottom');
    });

    expect(back.x).toBe(-rect.pageWidth);
    expect(back.y).toBe(rect.height);
  });
});
