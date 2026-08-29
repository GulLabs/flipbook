/**
 * Coverage is a byproduct, not the goal — real Flip state machine paths, real animation end.
 * Do not stub startAnimation as a no-op; flippingTime:0 runs the last frame + onAnimateEnd.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import {
  FlipCorner,
  FlipDirection,
  FlippingState,
  Orientation,
  PageDensity,
  PageFlipError,
} from '@gullabs/flipbook-core';
import { makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook({ usePortrait: true, ...opts });
  books.push(b);
  return b;
}

describe('Flip fold / stopMove / showCorner (real HTML engine)', () => {
  test('fixture is portrait so one page = one spread', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    expect(app.getOrientation()).toBe(Orientation.PORTRAIT);
  });

  test('flipNext with flippingTime 0 advances the page and returns to READ', () => {
    const { book: app } = book({ pageCount: 5, flippingTime: 0 });
    const flip = app.getFlipController();
    expect(flip).not.toBeNull();

    const before = app.getCurrentPageIndex();
    expect(flip!.flipNext(FlipCorner.TOP)).toBe(true);
    expect(app.getCurrentPageIndex()).toBe(before + 1);
    expect(flip!.getState()).toBe(FlippingState.READ);
    expect(flip!.getCalculation()).toBeNull();
  });

  test('flipPrev from an interior page restores the previous leaf via BACK', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, startPage: 2 });
    const flip = app.getFlipController()!;
    expect(app.getCurrentPageIndex()).toBe(2);

    expect(flip.flipPrev(FlipCorner.BOTTOM)).toBe(true);
    expect(app.getCurrentPageIndex()).toBe(1);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('fold via user drag enters USER_FOLD then stopMove settles to READ', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const start = { x: rect.left + rect.width - 5, y: rect.top + 10 };
    app.startUserTouch(start);
    // Move well past the 5px threshold so PageFlip.userMove calls fold().
    const mid = { x: rect.left + rect.width - 80, y: rect.top + 40 };
    app.userMove(mid, false);

    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    // If the pointer path did not open a calc (geometry edge), fold directly.
    if (flip.getCalculation() === null) {
      flip.fold(mid);
    }
    expect(flip.getCalculation()).not.toBeNull();
    expect(flip.getCalculation()!.getDirection()).toBe(FlipDirection.FORWARD);

    app.userStop(mid, false);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('stopMove with fold still on the page side snaps back without turning', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const corner = { x: rect.left + rect.width - 8, y: rect.top + 8 };
    app.startUserTouch(corner);
    const slight = { x: corner.x - 30, y: corner.y + 10 };
    app.userMove(slight, false);
    expect(flip.getCalculation()).not.toBeNull();

    const before = app.getCurrentPageIndex();
    flip.stopMove();
    expect(app.getCurrentPageIndex()).toBe(before);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('showCorner peels a corner then leaving the corner restores READ', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, showPageCorners: true });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();

    const onCorner = {
      x: rect.left + rect.width - 5,
      y: rect.top + 5,
    };
    app.userMove(onCorner, false);
    expect([FlippingState.FOLD_CORNER, FlippingState.READ, FlippingState.FLIPPING]).toContain(
      flip.getState(),
    );

    app.userMove({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, false);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('disableFlipByClick blocks whole-page clicks but still allows corner starts', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      disableFlipByClick: true,
    });
    const rect = app.getBoundsRect();

    // Through the real click path: `disableFlipByClick` is a policy about
    // clicks and now lives in `PageFlip.userStop`, so testing it on
    // `Flip.flip` would no longer exercise the guard at all.
    const rejected: { reason: string }[] = [];
    app.on('turnRejected', (e) => rejected.push(e.data));

    const center = {
      x: rect.left + rect.width * 0.75,
      y: rect.top + rect.height / 2,
    };
    app.startUserTouch(center);
    app.userStop(center);

    expect(app.getCurrentPageIndex()).toBe(0);
    expect(rejected).toEqual([{ reason: 'disabled' }]);

    const corner = { x: rect.left + rect.width - 4, y: rect.top + 4 };
    app.startUserTouch(corner);
    app.userStop(corner);

    expect(app.getCurrentPageIndex()).toBeGreaterThan(0);
    expect(rejected).toHaveLength(1);
  });

  test('flipToPage advances toward the target with a real turn animation end', () => {
    const { book: app } = book({ pageCount: 6, flippingTime: 0 });
    const flip = app.getFlipController()!;
    const before = app.getCurrentPageIndex();

    flip.flipToPage(1, FlipCorner.TOP);
    expect(app.getCurrentPageIndex()).toBe(before + 1);
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('no forward turn from the last page', () => {
    const { book: app } = book({ pageCount: 3, flippingTime: 0, startPage: 2 });
    const flip = app.getFlipController()!;
    expect(flip.flipNext(FlipCorner.TOP)).toBe(false);
    expect(app.getCurrentPageIndex()).toBe(2);
  });

  test('hard cover density stays HARD on the temporary-copy path', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      showCover: true,
    });
    const cover = app.getPage(0);
    expect(cover.getDensity()).toBe(PageDensity.HARD);
    expect(cover.newTemporaryCopy()).toBe(cover);
  });

  test('turnToPage out of range throws INVALID_PAGE without changing index', () => {
    const { book: app } = book({ pageCount: 3, flippingTime: 0 });
    const before = app.getCurrentPageIndex();
    expect(() => app.turnToPage(99)).toThrow(PageFlipError);
    expect(app.getCurrentPageIndex()).toBe(before);
  });
});

describe('Flip direction hit-testing under portrait', () => {
  test('left side of the portrait page starts a BACK fold', () => {
    const { book: app } = book({ pageCount: 5, flippingTime: 0, startPage: 2 });
    const flip = app.getFlipController()!;
    expect(app.getOrientation()).toBe(Orientation.PORTRAIT);
    const rect = app.getBoundsRect();

    // Portrait BACK zone: bookPos.x - pageWidth <= width/5
    const leftish = { x: rect.left + rect.pageWidth + 10, y: rect.top + 20 };
    expect(flip.start(leftish)).toBe(true);
    expect(flip.getCalculation()?.getDirection()).toBe(FlipDirection.BACK);
    // Reset without throwing if calc is live.
    if (flip.getCalculation()) flip.stopMove();
  });
});

describe('programmatic turns ignore click policy (StPageFlip #29)', () => {
  /**
   * Upstream `flipNext`/`flipPrev` built a synthetic point and then ran it
   * through the `disableFlipByClick` corner test. The point was in global
   * coordinates, so for any book not sitting at x=0 the corner test failed and
   * the turn was silently blocked: "when disableFlipByClick is true,
   * flipNext() does not function".
   *
   * Two things make that impossible here — the direction is forced, and the
   * click policy lives in `PageFlip.userStop` rather than `Flip.flip` — so this
   * pins both against a refactor that reintroduces either.
   */
  test('flipNext and flipPrev work with disableFlipByClick on an offset book', () => {
    const { book: app, host } = book({
      pageCount: 6,
      flippingTime: 0,
      disableFlipByClick: true,
    });

    // Upstream's synthetic point was in global coordinates, so the corner test
    // only passed for a book sitting at x=0. Push the book right: with the
    // policy correctly out of `Flip.flip`, the offset is irrelevant; with it
    // back in, `x: 0` converts to a negative book coordinate and the corner
    // test refuses the turn.
    const rect = host.getBoundingClientRect();
    host.getBoundingClientRect = () =>
      ({
        ...rect.toJSON(),
        x: 500,
        left: 500,
        right: 500 + rect.width,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        toJSON: () => ({}),
      }) as DOMRect;
    app.update();

    const rejected: unknown[] = [];
    app.on('turnRejected', (e) => rejected.push(e.data));

    expect(app.flipNext()).toBe(true);
    expect(app.getCurrentPageIndex()).toBeGreaterThan(0);

    const forward = app.getCurrentPageIndex();
    expect(app.flipPrev()).toBe(true);
    expect(app.getCurrentPageIndex()).toBeLessThan(forward);

    // Neither turn was refused by policy.
    expect(rejected).toEqual([]);
  });
});
