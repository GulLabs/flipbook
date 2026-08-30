// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { makePages, sizeElement } from './html-book-fixture';

/**
 * Hard-cover BACK turns — closing a cover, rather than opening one.
 *
 * The mutation sweep that cleared the §4.1 soft path found its remaining
 * survivors clustered in one quadrant: a HARD leaf turning BACKWARD. The cause
 * is structural rather than an oversight — `e2e/golden-flip.spec.ts-snapshots`
 * has `hardcover-forward` at 25/50/75% and portrait/landscape soft folds in
 * both directions, but no `hardcover-back` cell at all. Five survivors lived in
 * exactly the missing one.
 *
 * These assert the drawn DOM, because in every case the defect is that a
 * different draw path ran, or that a transform carries the wrong sign — neither
 * of which a spy or an existence check can see.
 */

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

/** Landscape book with a hard cover and a hard back cover (NF3). */
function hardBook(): PageFlip {
  const pages = makePages(6, true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, 520, 300);
  for (const p of pages) host.appendChild(p);

  const book = new PageFlip(host, {
    width: 200,
    height: 300,
    size: 'fixed',
    flippingTime: 0,
    drawShadow: true,
    showCover: true,
  });
  book.loadFromHTML(pages);
  sizeElement(book.getUI().getDistElement(), 520, 300);
  book.update();

  books.push({
    destroy() {
      book.destroy();
      host.remove();
    },
  });
  return book;
}

type Internals = {
  leftPage: { getElement: () => HTMLElement } | null;
  bottomPage: { getElement: () => HTMLElement } | null;
  flippingPage: { getHardAngle: () => number; getDrawingDensity: () => string } | null;
  drawFrame: () => void;
};

const inner = (book: PageFlip): Internals => book.getRender() as unknown as Internals;

/** Fold inward from an edge and paint one frame. */
function fold(book: PageFlip, edge: 'left' | 'right', depth = 60): void {
  const rect = book.getBoundsRect();
  const y = rect.top + rect.height / 2;
  const x = edge === 'right' ? rect.left + rect.width - 6 : rect.left + 6;

  const flip = book.getFlipController()!;
  flip.fold({ x, y });
  flip.fold({ x: edge === 'right' ? x - depth : x + depth, y });

  inner(book).drawFrame();
}

/** Sit on page 1 and drag the hard cover closed. */
function hardBackFold(depth = 60): PageFlip {
  const book = hardBook();
  book.turnToPage(1);
  fold(book, 'left', depth);

  // Without this the tests silently become soft-fold tests if the mover ever
  // stops being the hard cover.
  expect(inner(book).flippingPage?.getDrawingDensity()).toBe('hard');
  return book;
}

describe('the facing page rotates WITH a closing hard cover', () => {
  test('the left static leaf takes the hard draw path, not simpleDraw', () => {
    // `drawLeftPage` routes to the hard path only when the fold is BACK and the
    // mover is hard. Flipping that comparison to FORWARD sends the facing page
    // to `simpleDraw` instead: it drops to `--simple`, `z-index: 1` and a plain
    // `left:` offset, so mid-turn it visibly snaps flat and jumps a page width
    // while the cover is still swinging.
    const book = hardBackFold();
    const el = inner(book).leftPage!.getElement();

    expect(el.className).not.toContain('--simple');
    expect(el.style.transform).toContain('rotateY(');
    // The hard path also raises it above the resting leaves.
    expect(Number.parseInt(el.style.zIndex || '0', 10)).toBeGreaterThan(1);
  });

  test('its rotation tracks the cover, offset by half a turn', () => {
    // `setHardDrawingAngle(180 + flippingPage.getHardAngle())` is what keeps the
    // facing page glued to the cover. Asserting only "there is a rotateY" would
    // pass a constant angle, which reads as a page frozen mid-air.
    const shallow = hardBackFold(30);
    const deep = hardBackFold(300);

    const angleOf = (book: PageFlip): number => {
      const m = /rotateY\(([-\d.]+)deg\)/.exec(inner(book).leftPage!.getElement().style.transform);
      expect(m, 'no rotateY on the left leaf').not.toBeNull();
      return Number(m![1]);
    };

    expect(angleOf(shallow)).not.toBe(angleOf(deep));
    expect(angleOf(shallow)).toBe(180 + inner(shallow).flippingPage!.getHardAngle());
    expect(angleOf(deep)).toBe(180 + inner(deep).flippingPage!.getHardAngle());
  });
});

describe('hard fold angle sign', () => {
  test('BACK and FORWARD hard angles are exact negatives at the same progress', () => {
    // `Flip.do` negates the hard angle for BACK. Dropping the minus rotates the
    // cover through the wrong hemisphere, and since `drawHard` sets
    // `backface-visibility: hidden`, the cover BLANKS OUT for most of the turn
    // instead of swinging shut — the most visible failure in this file, and it
    // had no test.
    const forward = hardBook();
    fold(forward, 'right', 60);

    const back = hardBackFold(60);

    const f = inner(forward).flippingPage!.getHardAngle();
    const b = inner(back).flippingPage!.getHardAngle();

    // Non-zero, or `0 === -0` makes the relation below vacuous.
    expect(Math.abs(f)).toBeGreaterThan(0);
    expect(b).toBe(-f);
  });
});

describe('the leaf under a BACK fold', () => {
  // `setBottomPage` picks the orientation from the fold direction, and that
  // stamp drives the `--left` / `--right` classes — declared public surface in
  // `ENGINE_LEAF_CLASSES` — and `drawHard`'s transform-origin.
  //
  // Asserted on a SOFT fold, which is where the sweep found it and which is the
  // flagship mobile back-flip. NOT asserted for a hard cover: measured, a hard
  // BACK fold leaves the underside carrying `--right`, because it is also the
  // right static leaf and `drawRightPage` runs before `drawBottomPage` in
  // `drawFrame`. Whether that is correct or a live defect is an open question —
  // it is recorded in the notes rather than pinned here, because writing an
  // assertion for a value nobody has justified is how a bug gets certified as
  // the contract. That has happened twice in this repo already.

  /** A soft landscape book, two leaves per spread. */
  function softBook(): PageFlip {
    const pages = makePages(6);
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 520, 300);
    for (const p of pages) host.appendChild(p);

    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      flippingTime: 0,
      drawShadow: true,
    });
    book.loadFromHTML(pages);
    sizeElement(book.getUI().getDistElement(), 520, 300);
    book.update();

    books.push({
      destroy() {
        book.destroy();
        host.remove();
      },
    });
    return book;
  }

  test('is stamped LEFT under a soft BACK fold', () => {
    const book = softBook();
    book.turnToPage(2);
    fold(book, 'left', 60);

    expect(inner(book).flippingPage?.getDrawingDensity()).toBe('soft');
    const el = inner(book).bottomPage!.getElement();

    expect(el.className).toContain('--left');
    expect(el.className).not.toContain('--right');
  });

  test('and RIGHT under a soft FORWARD fold — the control', () => {
    // Without this, "is stamped LEFT" is satisfied by an engine that stamps
    // `--left` on every underside in every direction.
    const book = softBook();
    fold(book, 'right', 60);

    const el = inner(book).bottomPage!.getElement();

    expect(el.className).toContain('--right');
    expect(el.className).not.toContain('--left');
  });
});
