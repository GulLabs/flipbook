/**
 * Spread construction and the density inference that rides on it.
 *
 *  - PC1: `createSpread()` hardened the terminal singleton leaf of the LANDSCAPE
 *         spread table unconditionally, via `setDensity` — which writes the
 *         page's permanent density, the one PORTRAIT reads too. On any
 *         odd-length book with `hardCovers: false` that made the last leaf hard,
 *         so `newTemporaryCopy()` returned `this` and the portrait BACK turn
 *         fell back to upstream's previous-leaf slide-in: the §4.1 bug this
 *         fork exists to kill, in HTML mode.
 *  - PC2: a one-page `hardCovers` book placed its cover on the LEFT half —
 *         `leftIdx === pages.length - 1` is also true of index 0 when there is
 *         only one page, and the last-leaf test won the tie.
 *  - PC3: `PageCollection.destroy()` left the spread tables indexing pages it
 *         had just disposed.
 *
 * Written so the PRE-FIX implementation fails, and so an over-broad fix fails
 * too: the `hardCovers` cases below pin the CURRENT behaviour (including the
 * parity gap PC1 deliberately does not close) so that widening the inference
 * shows up as a failure rather than as silence.
 *
 * Fixture note (T1/T2): jsdom hands every element a permanent 0x0 box and
 * `Render.computeBounds` measures the engine's own `.stf__block`, not the host —
 * `makeHtmlBook` sizes both, which is the only reason the orientation
 * assertions below mean anything. Each one is asserted explicitly before the
 * claim it guards.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { FlipDirection, PageDensity, PageFlip } from '@gullabs/flipbook-core';
import type { HTMLPage } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages, sizeElement } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  document.body.innerHTML = '';
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

type Drawable = { drawFrame: () => void };

/* ------------------------------------------------------------------ *
 * PC1 — landscape spread parity must not harden a portrait leaf
 * ------------------------------------------------------------------ */

describe('PC1 — a book with no covers gets no inferred hard leaf', () => {
  test('the last leaf of an odd-length book stays soft', () => {
    // 3 pages ⇒ landscape spreads [0,1] and [2]; page 2 is the singleton the
    // inference used to harden. `hardCovers` is false, so the book has declared
    // that it has no covers.
    const { book: app } = book({ pageCount: 3, hardCovers: false, flippingTime: 0 });

    const last = app.getPage(2);
    expect(last.getDensity()).toBe(PageDensity.SOFT);
    expect(last.getDrawingDensity()).toBe(PageDensity.SOFT);
  });

  test('portrait BACK from that leaf animates a copy of it, not the previous leaf', () => {
    const { book: app } = book({ pageCount: 3, hardCovers: false, flippingTime: 0 });

    // FIXTURE CHECK — the whole test is void in landscape: `getFlippingPage`
    // takes a completely different branch there.
    expect(app.getRender().getOrientation()).toBe('portrait');

    app.turnToPage(2);
    const pages = app.getPageCollection();
    expect(pages.getCurrentPageIndex()).toBe(2);

    const flipping = pages.getFlippingPage(FlipDirection.BACK);
    const bottom = pages.getBottomPage(FlipDirection.BACK);

    // The mover is the temporary copy of the CURRENT leaf. Pre-fix, page 2 was
    // hard, `newTemporaryCopy()` returned `this`, and `getPortraitFlippingPage`
    // handed back `pages[1]` — upstream's slide-in.
    // Compared as booleans, not with `toBe(page)`: a failed identity assertion
    // on a `Page` makes vitest pretty-print the whole engine graph.
    expect(flipping === app.getPage(1), 'mover is the PREVIOUS leaf (upstream slide-in)').toBe(
      false,
    );
    expect(flipping === app.getPage(2), 'mover is the current leaf itself, not a copy').toBe(false);
    expect(app.getPage(2).getTemporaryCopy() === flipping, 'mover is not page 2’s copy').toBe(true);

    // …and the leaf underneath is the previous page, distinct from the mover,
    // so `shouldDrawBottomPage` draws it. Pre-fix both were `pages[1]`, so the
    // curl revealed nothing.
    expect(bottom === app.getPage(1), 'bottom page is not the previous leaf').toBe(true);
    expect(bottom === flipping, 'mover IS the bottom page — the curl reveals nothing').toBe(false);

    app.getPage(2).hideTemporaryCopy();
  });

  test('an even-length book is unchanged (it never had a singleton)', () => {
    const { book: app } = book({ pageCount: 4, hardCovers: false, flippingTime: 0 });

    for (let i = 0; i < 4; i++) {
      expect(app.getPage(i).getDensity(), `page ${i}`).toBe(PageDensity.SOFT);
    }
  });

  test('an author-declared hard page is still hard (the inference is what changed)', () => {
    const { book: app, pages } = book({ pageCount: 3, hardCovers: false, flippingTime: 0 });
    pages[2]!.dataset['density'] = 'hard';
    app.updateFromHtml(pages);

    expect(app.getPage(2).getDensity()).toBe(PageDensity.HARD);

    // And such a page keeps the documented hard-cover contract: it returns
    // itself from `newTemporaryCopy()` and stays on the previous-leaf path.
    app.turnToPage(2);
    expect(
      app.getPageCollection().getFlippingPage(FlipDirection.BACK) === app.getPage(1),
      'a declared hard page left the previous-leaf path',
    ).toBe(true);
  });

  test('hardCovers keeps its inferred back cover (no drift)', () => {
    // 6 pages + cover ⇒ spreads [0] [1,2] [3,4] [5]; page 5 is the singleton.
    const { book: app } = book({ pageCount: 6, hardCovers: true, flippingTime: 0 });

    expect(app.getPage(0).getDensity()).toBe(PageDensity.HARD);
    expect(app.getPage(5).getDensity()).toBe(PageDensity.HARD);
    for (const i of [1, 2, 3, 4]) {
      expect(app.getPage(i).getDensity(), `page ${i}`).toBe(PageDensity.SOFT);
    }
  });

  test('NF3 — hardCovers hardens the back cover regardless of page-count parity', () => {
    // CLOSED 2026-08-30 (owner decision). This test previously pinned the
    // OPPOSITE — 5 pages + cover ⇒ spreads [0] [1,2] [3,4], no singleton, so
    // page 4 stayed soft — and it was written specifically so that closing NF3
    // would require deliberately updating a failing test rather than happening
    // as a silent side effect. It did exactly that.
    //
    // The old behaviour was indefensible once stated plainly: the same setting
    // and the same intent produced opposite results depending on arithmetic the
    // author could not see, so adding one page silently gained or lost a hard
    // back cover. `hardCovers: true` says the book has covers, plural; a book
    // has two.
    const odd = book({ pageCount: 5, hardCovers: true, flippingTime: 0 }).book;

    expect(odd.getPage(0).getDensity()).toBe(PageDensity.HARD);
    expect(odd.getPage(4).getDensity()).toBe(PageDensity.HARD);

    // The parity partner, asserted in the SAME test: the whole defect was that
    // these two disagreed, so proving them equal is the actual invariant. A
    // test that only checked the odd case would pass for a fix that hardened
    // everything.
    const even = book({ pageCount: 6, hardCovers: true, flippingTime: 0 }).book;

    expect(even.getPage(0).getDensity()).toBe(PageDensity.HARD);
    expect(even.getPage(5).getDensity()).toBe(PageDensity.HARD);

    // …and nothing in between hardened. This is the negative control, and it is
    // what fails for "harden every leaf", which satisfies everything above.
    for (const i of [1, 2, 3]) {
      expect(odd.getPage(i).getDensity(), `odd page ${i}`).toBe(PageDensity.SOFT);
    }
    for (const i of [1, 2, 3, 4]) {
      expect(even.getPage(i).getDensity(), `even page ${i}`).toBe(PageDensity.SOFT);
    }
  });

  test('NF3 — a book WITHOUT hardCovers still gets no inferred hard leaf', () => {
    // The PC1 guarantee, re-asserted next to NF3 because they are one line
    // apart in `createSpread` and the new rule must not leak past its gate.
    // PC1 is the §4.1 bug this fork exists to kill: a hard terminal leaf on a
    // cover-less book puts portrait BACK back on upstream's slide-in path.
    for (const pageCount of [4, 5]) {
      const { book: app } = book({ pageCount, hardCovers: false, flippingTime: 0 });
      for (let i = 0; i < pageCount; i += 1) {
        expect(app.getPage(i).getDensity(), `page ${i} of ${pageCount}`).toBe(PageDensity.SOFT);
      }
    }
  });

  test('NF3 — a one-page hardCovers book has one cover, not a doubled one', () => {
    // The `length > 1` guard. Page 0 is already the front cover; it must not be
    // re-hardened as its own back cover. Harmless today, but it would make the
    // two rules read as though they could disagree about the same leaf.
    const { book: app } = book({ pageCount: 1, hardCovers: true, flippingTime: 0 });

    expect(app.getPageCount()).toBe(1);
    expect(app.getPage(0).getDensity()).toBe(PageDensity.HARD);
  });
});

/* ------------------------------------------------------------------ *
 * PC2 — a lone cover belongs to the right of the spine
 * ------------------------------------------------------------------ */

/** The `left:` a leaf was drawn at, from the inline style `simpleDraw` writes. */
function drawnLeft(el: HTMLElement): number {
  const m = /(?:^|;)\s*left:\s*(-?[\d.]+)px/.exec(el.style.cssText);
  expect(m, `no left in: ${el.style.cssText}`).not.toBeNull();
  return Number(m![1]);
}

describe('PC2 — a single-leaf landscape spread is placed by what it IS', () => {
  test('a one-page hardCovers book draws its cover on the right half', () => {
    // hostWidth 520 > 2 * 200 ⇒ landscape with rect.left = 60, pageWidth = 200,
    // so the two halves are distinguishable (60 vs 260). A book filling its
    // block cannot tell the implementations apart on the left value alone.
    const { book: app, pages } = book({
      pageCount: 1,
      hardCovers: true,
      width: 200,
      height: 300,
      hostWidth: 520,
      hostHeight: 300,
      flippingTime: 0,
    });

    const render = app.getRender();
    expect(render.getOrientation()).toBe('landscape');
    const rect = render.getRect();
    expect(rect.left).toBe(60);
    expect(rect.pageWidth).toBe(200);

    (render as unknown as Drawable).drawFrame();

    expect(drawnLeft(pages[0]!)).toBe(rect.left + rect.pageWidth);
  });

  test('the last leaf of a longer book still draws on the left half', () => {
    // 3 pages + cover ⇒ spreads [0] [1,2]; there is no terminal singleton, so
    // use 2 pages: spreads [0] [1], and spread 1 is the last-leaf singleton.
    const { book: app, pages } = book({
      pageCount: 2,
      hardCovers: true,
      width: 200,
      height: 300,
      hostWidth: 520,
      hostHeight: 300,
      flippingTime: 0,
    });

    const render = app.getRender();
    expect(render.getOrientation()).toBe('landscape');
    const rect = render.getRect();

    // Spread 0 is the cover, on the right — unchanged by the fix.
    (render as unknown as Drawable).drawFrame();
    expect(drawnLeft(pages[0]!)).toBe(rect.left + rect.pageWidth);

    app.turnToPage(1);
    (render as unknown as Drawable).drawFrame();
    expect(drawnLeft(pages[1]!)).toBe(rect.left);
  });
});

/* ------------------------------------------------------------------ *
 * PC3 — destroy() leaves no table indexing disposed pages
 * ------------------------------------------------------------------ */

describe('PC3 — a destroyed collection describes an empty book', () => {
  test('the spread tables go with the pages', () => {
    const { book: app } = book({ pageCount: 4, hardCovers: false, flippingTime: 0 });
    const pages = app.getPageCollection();

    expect(pages.getSpreadCount()).toBe(4);
    expect(pages.getSpreadIndexByPage(3)).toBe(3);

    pages.destroy();

    expect(pages.getPageCount()).toBe(0);
    expect(pages.getSpreadCount()).toBe(0);
    expect(pages.getSpreadIndexByPage(3)).toBeNull();
    expect(pages.getSpreadIndexByPage(0)).toBeNull();
  });

  test('a temporary fold copy is still removed from the document', () => {
    // Same method, the part that already worked: `dispose()` hides the clone.
    // Kept adjacent so a change to `destroy()` cannot drop it unnoticed.
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    const pages = app.getPageCollection();
    const page = app.getPage(1) as HTMLPage;

    const copy = page.newTemporaryCopy() as HTMLPage;
    expect(copy.getElement().isConnected).toBe(true);

    pages.destroy();
    expect(copy.getElement().isConnected).toBe(false);
  });
});

/**
 * NF1 — the `--soft` / `--hard` class must agree with the density.
 *
 * `setDrawingDensity` synced it and `setDensity` did not, so every
 * engine-INFERRED hard page (a `hardCovers` cover, a terminal singleton) carried
 * a class asserting the opposite of its own density.
 */
describe('NF1 — the density class follows the density', () => {
  /**
   * Built WITHOUT `makeHtmlBook`, and that is the entire point.
   *
   * `makeHtmlBook` calls `makePages(pageCount, Boolean(opts.hardCovers))`, so
   * asking it for `hardCovers: true` also stamps `data-density="hard"` on page 0
   * — the cover is DECLARED hard, its class is `--hard` from the constructor,
   * and `createSpread`'s inference never changes anything. Every assertion here
   * then passes against the unfixed engine. The first draft did exactly that,
   * and all three of its subtly-wrong variants passed too.
   *
   * The defect lives on the INFERENCE path: `hardCovers` with pages that declare
   * nothing.
   */
  function inferredCoverBook(): { engine: PageFlip; pages: HTMLElement[]; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 400, 300);

    const pages = makePages(6); // no `data-density` anywhere
    expect(pages.every((p) => p.dataset.density === undefined)).toBe(true);

    const engine = new PageFlip(host, { width: 200, height: 300, hardCovers: true });
    engine.loadFromHTML(pages);
    return { engine, pages, host };
  }

  test('an inferred cover is `--hard`, not `--soft`', () => {
    const { engine, pages, host } = inferredCoverBook();

    expect(engine.getPageCollection().getPage(0).getDensity()).toBe(PageDensity.HARD);

    // Reverted fix, measured: `class="stf__item --soft --right"` on a page the
    // engine draws through `drawHard`. Consumer CSS on `.stf__item.--hard` never
    // matches a cover, and `--soft` matches a leaf that is anything but.
    expect(pages[0]!.classList.contains('--hard')).toBe(true);
    expect(pages[0]!.classList.contains('--soft')).toBe(false);

    engine.destroy();
    host.remove();
  });

  test('a soft page is still `--soft`, and the classes stay exclusive', () => {
    const { engine, pages, host } = inferredCoverBook();

    expect(engine.getPageCollection().getPage(2).getDensity()).toBe(PageDensity.SOFT);

    // The control: a variant that ADDS `--hard` without removing `--soft`
    // satisfies the assertion above and fails here.
    expect(pages[2]!.classList.contains('--soft')).toBe(true);
    expect(pages[2]!.classList.contains('--hard')).toBe(false);
    expect(pages[0]!.classList.contains('--soft')).toBe(false);

    engine.destroy();
    host.remove();
  });

  test('a consumer’s `data-density` declaration still wins and matches', () => {
    // Built explicitly, because `hardFirst` is a `makePages` parameter and NOT
    // a `makeHtmlBook` option — passing it as one is silently ignored, which is
    // how the first draft of this test asserted `hard` on a page that had never
    // declared anything.
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    sizeElement(hostEl, 400, 300);

    const declared = makePages(4, true);
    expect(declared[0]!.dataset.density).toBe('hard');

    const engine = new PageFlip(hostEl, { width: 200, height: 300, hardCovers: false });
    engine.loadFromHTML(declared);

    // `data-density="hard"` is the DECLARED input; the class is engine output.
    // Both must agree.
    expect(engine.getPageCollection().getPage(0).getDensity()).toBe(PageDensity.HARD);
    expect(declared[0]!.classList.contains('--hard')).toBe(true);
    expect(declared[0]!.classList.contains('--soft')).toBe(false);

    engine.destroy();
    hostEl.remove();
  });
});
