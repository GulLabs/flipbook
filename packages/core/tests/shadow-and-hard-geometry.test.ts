/**
 * Two geometry defects from `docs/CANVAS_FIRST_CLASS.md`:
 *
 *  - C13: `CanvasRender.drawBookShadow` painted the spine gradient in PORTRAIT,
 *         where there is no spine. The gradient is centred on the middle of the
 *         *spread*, which in portrait is the LEFT EDGE of the single visible
 *         leaf, so its darkest stops landed as a dark band down that edge.
 *  - H6:  `HTMLPage.drawHard` ignored `rect.top`, so a hard cover rendered
 *         vertically offset from every soft page whenever the block was taller
 *         than the book.
 *
 * Both suites are written so the PRE-FIX implementation fails them:
 *  - the C13 book is really in portrait (asserted before the gradient claim);
 *  - the H6 book has a NON-ZERO `rect.top` (asserted before the geometry
 *    claim) — with `rect.top === 0` the broken and the fixed code agree, and
 *    the test would prove nothing.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HTMLPage, PageDensity, PageFlip, PageOrientation } from '@gullabs/flipbook-core';
import { makeHtmlBook } from './html-book-fixture';

/* ------------------------------------------------------------------ *
 * C13 — canvas spine gradient
 * ------------------------------------------------------------------ */

/** jsdom has no 2D context; stub only what the renderer touches. */
function stubCanvas2d() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );

  return ctx;
}

type DrawableRender = { drawFrame: () => void };

function sizeHost(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
}

describe('C13 — the spine gradient is a landscape decoration only', () => {
  let host: HTMLElement;
  let ctx: ReturnType<typeof stubCanvas2d>;

  beforeEach(() => {
    ctx = stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  async function makeBook(hostWidth: number): Promise<PageFlip> {
    sizeHost(host, hostWidth, 300);
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      usePortrait: true,
      drawShadow: true,
    });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
      { src: 'd.png', alt: 'Page d' },
    ]);
    sizeHost(book.getUI().getDistElement(), hostWidth, 300);
    book.update();
    return book;
  }

  test('portrait paints no spine gradient', async () => {
    // hostWidth (300) < 2 * width (400) ⇒ portrait.
    const book = await makeBook(300);
    const render = book.getRender();

    // Verify the FIXTURE first: a landscape book here would make the assertion
    // below true for the wrong reason.
    expect(render.getOrientation()).toBe('portrait');

    const rect = render.getRect();
    // And confirm the defect's premise: the gradient's centre coincides with
    // the left edge of the portrait clip.
    expect(rect.left + rect.width / 2).toBe(rect.left + rect.pageWidth);

    ctx.createLinearGradient.mockClear();
    (render as unknown as DrawableRender).drawFrame();

    // A static portrait frame has no fold shadow, so the ONLY gradient the
    // renderer could produce is the spine one. Zero calls means it is gone —
    // which also rejects a "narrowed" gradient that still paints something.
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();

    book.destroy();
  });

  test('landscape still paints it — the guard is orientation, not a deletion', async () => {
    const book = await makeBook(500);
    const render = book.getRender();

    expect(render.getOrientation()).toBe('landscape');

    ctx.createLinearGradient.mockClear();
    (render as unknown as DrawableRender).drawFrame();

    expect(ctx.createLinearGradient).toHaveBeenCalled();

    book.destroy();
  });

  test('the `drawShadow` gate survives the orientation guard', async () => {
    const book = await makeBook(500);
    const render = book.getRender();

    book.updateSettings({ drawShadow: false });
    ctx.createLinearGradient.mockClear();
    (render as unknown as DrawableRender).drawFrame();
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();

    book.updateSettings({ drawShadow: true });
    ctx.createLinearGradient.mockClear();
    (render as unknown as DrawableRender).drawFrame();
    expect(ctx.createLinearGradient).toHaveBeenCalled();

    book.destroy();
  });
});

/* ------------------------------------------------------------------ *
 * H6 — hard pages honour rect.top
 * ------------------------------------------------------------------ */

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

/**
 * y component of `translate3d(<x>,<y>,0)`. The unit is optional so that a
 * unitless `0` — which is what the pre-fix code emitted, and what browsers and
 * jsdom both normalise to — reads as 0 rather than as "no match". Otherwise the
 * `rect.top === 0` no-drift case would fail for a parsing reason instead of a
 * behavioural one, and would prove nothing.
 */
function translateY(css: string): number {
  const m = /translate3d\(\s*-?[\d.]+(?:px)?\s*,\s*(-?[\d.]+)(?:px)?/.exec(css);
  expect(m, `no translate3d in: ${css}`).not.toBeNull();
  return Number(m![1]);
}

/** The `top:` declaration (NOT `transform-origin`); jsdom may drop the unit on 0. */
function cssTop(css: string): number {
  const m = /(?:^|;)\s*top:\s*(-?[\d.]+)(?:px)?/.exec(css);
  expect(m, `no top declaration in: ${css}`).not.toBeNull();
  return Number(m![1]);
}

/**
 * Where the element's box actually starts vertically: the static `top` plus
 * whatever the transform translates it by. Written this way on purpose — an
 * implementation that sets `top:${rect.top}` instead of translating is equally
 * correct and must not be failed for it.
 */
function effectiveTop(css: string): number {
  return cssTop(css) + translateY(css);
}

describe('H6 — hard pages sit at rect.top, like every soft page', () => {
  test('LEFT and RIGHT hard covers align with the soft leaves (rect.top non-zero)', () => {
    // hostHeight (460) > height (300) ⇒ rect.top = (460 - 300) / 2 = 80.
    // hostWidth (520) > 2 * width (400) ⇒ landscape, rect.left = 60.
    // A book whose host is exactly as tall as the book has rect.top === 0,
    // where the broken code and the fixed code produce identical output.
    const { book: app, pages } = book({
      pageCount: 4,
      width: 200,
      height: 300,
      hostWidth: 520,
      hostHeight: 460,
      flippingTime: 0,
    });

    const rect = app.getRender().getRect();

    // FIXTURE CHECK — the whole test is void if this is zero.
    expect(rect.top).toBe(80);
    expect(rect.top).not.toBe(0);
    expect(rect.height).toBe(300);
    expect(rect.left).toBe(60);

    pages[0]!.dataset.density = 'hard';
    pages[1]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const right = app.getPage(0) as HTMLPage;
    right.setDrawingDensity(PageDensity.HARD);
    right.setOrientation(PageOrientation.RIGHT);
    right.setHardDrawingAngle(30);
    right.draw(PageDensity.HARD);

    const left = app.getPage(1) as HTMLPage;
    left.setDrawingDensity(PageDensity.HARD);
    left.setOrientation(PageOrientation.LEFT);
    left.setHardDrawingAngle(-30);
    left.draw(PageDensity.HARD);

    expect(effectiveTop(right.getElement().style.cssText)).toBe(rect.top);
    expect(effectiveTop(left.getElement().style.cssText)).toBe(rect.top);

    // …and that is the same top a static soft leaf gets, which is the whole
    // point: no vertical jump when the cover starts turning.
    const soft = app.getPage(2) as HTMLPage;
    soft.simpleDraw(PageOrientation.RIGHT);
    expect(cssTop(soft.getElement().style.cssText)).toBe(rect.top);
  });

  test('a hard page tracks rect.top as the block resizes', () => {
    const {
      book: app,
      pages,
      host,
    } = makeHtmlBook({
      pageCount: 4,
      width: 200,
      height: 300,
      hostWidth: 520,
      hostHeight: 400,
      flippingTime: 0,
    });
    books.push({
      destroy: () => {
        app.destroy();
        host.remove();
      },
    });

    expect(app.getRender().getRect().top).toBe(50);

    pages[0]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const page = app.getPage(0) as HTMLPage;
    page.setDrawingDensity(PageDensity.HARD);
    page.setOrientation(PageOrientation.RIGHT);
    page.setHardDrawingAngle(0);
    page.draw(PageDensity.HARD);
    expect(effectiveTop(page.getElement().style.cssText)).toBe(50);

    // Grow the block: rect.top moves, and so must the hard page. A hardcoded
    // constant would pass the first assertion and fail here.
    const dist = app.getUI().getDistElement();
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 700 });
    app.update();

    const grown = app.getRender().getRect();
    expect(grown.top).toBe(200);

    page.draw(PageDensity.HARD);
    expect(effectiveTop(page.getElement().style.cssText)).toBe(200);
  });

  test('rect.top === 0 keeps the historical placement (no behaviour drift)', () => {
    const { book: app, pages } = book({
      pageCount: 4,
      width: 200,
      height: 300,
      hostWidth: 400,
      hostHeight: 300,
      flippingTime: 0,
    });

    expect(app.getRender().getRect().top).toBe(0);

    pages[0]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const page = app.getPage(0) as HTMLPage;
    page.setDrawingDensity(PageDensity.HARD);
    page.setOrientation(PageOrientation.LEFT);
    page.setHardDrawingAngle(0);
    page.draw(PageDensity.HARD);

    expect(effectiveTop(page.getElement().style.cssText)).toBe(0);
  });
});
