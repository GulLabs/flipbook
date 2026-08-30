/**
 * Coverage is a byproduct, not the goal — assert real cssText / z-order / fold opacity.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import {
  FlippingState,
  HTMLPage,
  PageDensity,
  PageFlip,
  PageOrientation,
} from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages, sizeElement } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

function makePagesHard(): HTMLElement[] {
  return makePages(4, true);
}

function bookWithPages(
  pages: HTMLElement[],
  opts: Parameters<typeof makeHtmlBook>[0] = {},
): { book: PageFlip; destroy: () => void } {
  const width = opts.width ?? 200;
  const height = opts.height ?? 300;
  const hostW = opts.hostWidth ?? width * 2 - 20;
  const hostH = opts.hostHeight ?? height;
  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, hostW, hostH);
  for (const p of pages) host.appendChild(p);
  const book = new PageFlip(host, {
    width,
    height,
    sizing: 'fixed',
    flippingTime: 0,
    usePortrait: true,
    drawShadow: true,
    ...opts,
  });
  book.loadFromHTML(pages);
  sizeElement(book.getUI().getDistElement(), hostW, hostH);
  book.update();
  return {
    book,
    destroy() {
      book.destroy();
      host.remove();
    },
  };
}

describe('HTMLRender + HTMLPage fold paint', () => {
  test('static simpleDraw pages carry opaque pageBackground in cssText', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      pageBackground: '#f5f0e6',
    });

    app.update();
    const page = app.getPage(0) as HTMLPage;
    page.simpleDraw(PageOrientation.RIGHT);

    const css = page.getElement().style.cssText;
    expect(css.toLowerCase()).toMatch(/background-color:\s*(#f5f0e6|rgb\(245,\s*240,\s*230\))/i);
    expect(page.getElement().classList.contains('--simple')).toBe(true);
    expect(css).toMatch(/display:\s*block/i);
  });

  test('temporary soft copy gets opaque fold fill on portrait BACK', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      initialPage: 2,
      pageBackground: '#fff',
    });
    const current = app.getPage(2) as HTMLPage;
    expect(current.getDensity()).toBe(PageDensity.SOFT);

    const copy = current.newTemporaryCopy() as HTMLPage;
    expect(copy).not.toBe(current);
    expect(copy.getElement().style.backgroundColor).toMatch(/rgb\(255,\s*255,\s*255\)|#fff/i);

    current.hideTemporaryCopy();
    expect(current.getTemporaryCopy()).toBeNull();
  });

  test('soft fold draw paints clip-path; clearShadow hides overlay nodes', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, drawShadow: true });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();
    const dist = app.getUI().getDistElement();

    // Drive fold through the real controller (not a stubbed animation).
    flip.fold({ x: rect.left + rect.width - 5, y: rect.top + 20 });
    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    expect(flip.getCalculation()).not.toBeNull();

    // drawFrame only runs on rAF; paint the current leaf directly and assert cssText.
    const page = app.getPage(0) as HTMLPage;
    page.setArea([
      { x: 0, y: 0 },
      { x: 180, y: 10 },
      { x: 160, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 20, y: 0 });
    page.setAngle(-0.15);
    page.draw(PageDensity.SOFT);

    const css = page.getElement().style.cssText;
    expect(css).toMatch(/clip-path:\s*polygon/i);
    expect(css.toLowerCase()).toMatch(/background-color/);

    const outer = dist.querySelector<HTMLElement>('.stf__outerShadow');
    expect(outer).toBeTruthy();
    app.getRender().clearShadow();
    expect(outer!.style.cssText).toMatch(/display:\s*none/i);

    flip.stopMove();
    expect(flip.getState()).toBe(FlippingState.READ);
  });

  test('hard page draw uses rotateY and backface-visibility without clip-path', () => {
    const { book: app, pages } = book({ pageCount: 3, flippingTime: 0 });
    pages[0]!.dataset.density = 'hard';
    // Rebuild so density is HARD.
    app.updateFromHtml(pages);
    const hard = app.getPage(0) as HTMLPage;
    hard.setDrawingDensity(PageDensity.HARD);
    hard.setOrientation(PageOrientation.RIGHT);
    hard.setHardDrawingAngle(45);
    hard.draw(PageDensity.HARD);

    const css = hard.getElement().style.cssText;
    expect(css).toMatch(/rotateY\(/i);
    expect(css).toMatch(/backface-visibility:\s*hidden/i);
    expect(css).toMatch(/background-color/i);
    expect(css).not.toMatch(/clip-path:\s*polygon/i);
  });

  test('drawBottomPage skips only when flippingPage === bottomPage (hard cover)', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, hardCovers: true });
    const render = app.getRender();
    const page = app.getPage(0) as HTMLPage;

    // Same reference → shouldDrawBottomPage false → no draw crash.
    render.setFlippingPage(page);
    render.setBottomPage(page);
    expect(() =>
      (render as unknown as { drawBottomPage: () => void }).drawBottomPage(),
    ).not.toThrow();
  });

  test('updateFromHtml keeps shadow nodes (no wholesale innerHTML wipe)', () => {
    const { book: app, pages } = book({ pageCount: 3, flippingTime: 0 });
    const dist = app.getUI().getDistElement();
    expect(dist.querySelector('.stf__outerShadow')).toBeTruthy();

    const next = [...pages, document.createElement('div')];
    next[3]!.textContent = 'page-3';
    app.updateFromHtml(next);

    expect(dist.querySelector('.stf__outerShadow')).toBeTruthy();
    expect(dist.querySelector('.stf__innerShadow')).toBeTruthy();
    expect(app.getPageCount()).toBe(4);
  });

  test('setDrawingDensity toggles --soft / --hard classes', () => {
    const { book: app } = book({ pageCount: 2, flippingTime: 0 });
    const page = app.getPage(0) as HTMLPage;
    page.setDrawingDensity(PageDensity.HARD);
    expect(page.getElement().classList.contains('--hard')).toBe(true);
    page.setDrawingDensity(PageDensity.SOFT);
    expect(page.getElement().classList.contains('--soft')).toBe(true);
  });

  test('soft draw includes foldFillCss and transform for a prepared area', () => {
    const { book: app } = book({ pageCount: 3, flippingTime: 0, pageBackground: '#eaeaea' });
    const page = app.getPage(0) as HTMLPage;
    page.setArea([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 10, y: 0 });
    page.setAngle(-0.2);
    page.draw(PageDensity.SOFT);

    const css = page.getElement().style.cssText;
    expect(css.toLowerCase()).toMatch(/background-color:\s*(#eaeaea|rgb\(234,\s*234,\s*234\))/i);
    expect(css).toMatch(/clip-path:\s*polygon/i);
    expect(css).toMatch(/transform:/i);
  });
});

describe('HTMLRender drawFrame via rAF (soft + hard shadows)', () => {
  test('soft fold paints outer/inner shadow cssText on animation frames', async () => {
    const { book: app } = book({ pageCount: 5, flippingTime: 200, drawShadow: true });
    const flip = app.getFlipController()!;
    const rect = app.getBoundsRect();
    const dist = app.getUI().getDistElement();

    flip.fold({ x: rect.left + rect.width - 8, y: rect.top + 25 });
    expect(flip.getCalculation()).not.toBeNull();

    // Let the render loop paint while the fold is live.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const outer = dist.querySelector<HTMLElement>('.stf__outerShadow');
    const inner = dist.querySelector<HTMLElement>('.stf__innerShadow');
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();

    // At least one soft shadow should be visible (display:block + gradient).
    const outerCss = outer!.style.cssText;
    const innerCss = inner!.style.cssText;
    const painted =
      /display:\s*block/i.test(outerCss) ||
      /display:\s*block/i.test(innerCss) ||
      /linear-gradient/i.test(outerCss) ||
      /linear-gradient/i.test(innerCss);
    expect(painted).toBe(true);

    // Mover leaf should carry a raised z-index from drawFrame.
    const items = Array.from(dist.querySelectorAll<HTMLElement>('.stf__item'));
    const raised = items.some((el) => {
      const z = Number.parseInt(el.style.zIndex || '0', 10);
      return z >= 5;
    });
    expect(raised).toBe(true);

    flip.stopMove();
  });

  test('hard density fold uses hard shadow nodes', async () => {
    const pages = makePagesHard();
    const { book: app, destroy } = bookWithPages(pages, {
      pageCount: pages.length,
      flippingTime: 200,
      drawShadow: true,
      hardCovers: true,
    });
    books.push({ destroy });

    const flip = app.getFlipController()!;
    // Start on page 0 hard cover; FORWARD fold.
    const rect = app.getBoundsRect();
    flip.fold({ x: rect.left + rect.width - 6, y: rect.top + 30 });

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const hard = app.getUI().getDistElement().querySelector<HTMLElement>('.stf__hardShadow');
    const hardInner = app
      .getUI()
      .getDistElement()
      .querySelector<HTMLElement>('.stf__hardInnerShadow');
    expect(hard).toBeTruthy();
    expect(hardInner).toBeTruthy();

    flip.stopMove();
  });

  test('reload recreates missing shadow nodes', () => {
    const { book: app } = book({ pageCount: 3, flippingTime: 0 });
    const dist = app.getUI().getDistElement();
    dist.querySelector('.stf__outerShadow')?.remove();
    app.getRender().reload();
    expect(dist.querySelector('.stf__outerShadow')).toBeTruthy();
  });
});
