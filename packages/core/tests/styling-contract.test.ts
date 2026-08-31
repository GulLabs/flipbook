/**
 * B3 — the Job 1 styling contract (docs/API-CONTRACT.md), pinned structurally.
 *
 * The invariant is "the engine paints opaque paper BEHIND consumer content and
 * touches nothing else on the paint axis". Three verifiable halves:
 *
 *  1. The `::before` paper layer composites the consumer's `--stf-paper` over
 *     an opaque base, so a translucent `pageBackground` — `var()` fallbacks,
 *     `color-mix`, `calc()` alphas, whatever CSS grows next — cannot produce a
 *     see-through fold. Opacity is structural; there is no alpha parser to
 *     bypass.
 *  2. The engine writes no inline `background-color` on a CONTAINER leaf root
 *     (inline paint beats every consumer stylesheet), and no
 *     `display`-forcing rule beats a consumer's `.page { display: flex }`.
 *  3. A REPLACED-element leaf root (`img`, `video`, `canvas`, `iframe`,
 *     `embed`) keeps the inline `background-color`: pseudo-elements do not
 *     render on replaced elements, so it is the only opaque backing such a
 *     root can have.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { FLIPBOOK_CSS, PageFlip } from '@gullabs/flipbook-core';
import { makeHtmlBook, sizeElement } from './html-book-fixture';
import { testRender } from './engine-access';

/** Paint one frame synchronously — jsdom runs no rAF loop of its own. */
function drawFrame(book: PageFlip): void {
  (testRender(book) as unknown as { drawFrame: () => void }).drawFrame();
}

const books: Array<() => void> = [];

afterEach(() => {
  while (books.length) books.pop()?.();
  document.body.innerHTML = '';
});

describe('B3.1 — opacity is structural, not parsed', () => {
  test('the paper pseudo-element composites --stf-paper over an opaque base', () => {
    const before = /\.stf__item::before\{([^}]*)\}/.exec(FLIPBOOK_CSS)?.[1] ?? '';

    // An opaque ground the consumer value paints OVER. Both halves matter:
    // the color layer is the base, the image layer is the consumer's paint.
    expect(before).toMatch(/background-color:#fff/);
    expect(before).toMatch(/background-image:linear-gradient\(var\(--stf-paper[,)]/);
  });

  test('a translucent pageBackground is accepted at the boundary and painted verbatim', () => {
    // The old boundary threw 'translucent' for these; the structural base
    // makes them safe, so rejecting them made the library the thing that was
    // out of date. Injection safety is still enforced separately.
    const { book } = tracked(makeHtmlBook({ pageBackground: 'rgba(255,255,255,0.4)' }));
    expect(book.getSettings().pageBackground).toBe('rgba(255,255,255,0.4)');
  });
});

describe('B3.2 — the engine claims no paint or display on a container leaf root', () => {
  test('a container leaf carries --stf-paper and NO inline background-color', () => {
    const { book, pages } = tracked(makeHtmlBook({ pageBackground: '#f5f0e6' }));
    expect(book.getPageCount()).toBeGreaterThan(0);
    drawFrame(book);

    // Only the visible spread is drawn — hidden leaves are not styled at all,
    // which is itself part of the claim-nothing contract.
    const visible = book.getVisiblePages();
    expect(visible.length).toBeGreaterThan(0);

    for (const index of visible) {
      const el = pages[index]!;
      expect(el.style.getPropertyValue('--stf-paper')).toBe('#f5f0e6');
      expect(el.style.getPropertyValue('background-color')).toBe('');
    }
  });

  test('no stylesheet rule forces display on a shown leaf', () => {
    // `.stf__item.--shown { display: block }` was (0,2,0) and beat a design
    // system's `.page { display: flex }`. Show/hide lives on the visibility
    // axis alone; an absolutely positioned leaf is block-level without help.
    expect(FLIPBOOK_CSS).not.toMatch(/--shown\{display:/);
    expect(FLIPBOOK_CSS).toMatch(/\.stf__item\.--shown\{visibility:visible\}/);
  });
});

describe('B3.3 — a replaced-element leaf root keeps its opaque backing', () => {
  test('a bare-<img> book gets inline background-color on each leaf', () => {
    const host = document.createElement('div');
    sizeElement(host, 380, 300);
    document.body.appendChild(host);

    const imgs = Array.from({ length: 2 }, (_, i) => {
      const img = document.createElement('img');
      img.alt = `page-${i}`;
      return img;
    });

    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      pageBackground: '#f5f0e6',
    });
    books.push(() => book.destroy());
    book.loadFromHTML(imgs);
    drawFrame(book);

    // jsdom normalizes hex to rgb(); either spelling is the same paint.
    const paper = /^(#f5f0e6|rgb\(245,\s*240,\s*230\))$/;
    for (const index of book.getVisiblePages()) {
      const img = imgs[index]!;
      expect(img.style.getPropertyValue('background-color')).toMatch(paper);
      expect(img.style.getPropertyValue('--stf-paper')).toMatch(paper);
    }
  });
});

function tracked(made: ReturnType<typeof makeHtmlBook>): ReturnType<typeof makeHtmlBook> {
  books.push(made.destroy);
  return made;
}
