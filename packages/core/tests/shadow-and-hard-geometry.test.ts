/**
 * H6: `HTMLPage.drawHard` ignored `rect.top`, so a hard cover rendered
 * vertically offset from every soft page whenever the block was taller
 * than the book.
 *
 * Written so the PRE-FIX implementation fails: the book has a NON-ZERO
 * `rect.top` (asserted before the geometry claim) — with `rect.top === 0`
 * the broken and the fixed code agree, and the test would prove nothing.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { PageDensity } from '@gullabs/flipbook-core';
import { PageOrientation } from '../src/Page/Page';
import { makeHtmlBook } from './html-book-fixture';
import { testRender, testPage } from './engine-access';
import { Page } from '../src/Page/Page';

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

    const rect = testRender(app).getRect();

    // FIXTURE CHECK — the whole test is void if this is zero.
    expect(rect.top).toBe(80);
    expect(rect.top).not.toBe(0);
    expect(rect.height).toBe(300);
    expect(rect.left).toBe(60);

    pages[0]!.dataset.density = 'hard';
    pages[1]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const right = testPage(app, 0) as Page;
    right.setDrawingDensity(PageDensity.HARD);
    right.setOrientation(PageOrientation.RIGHT);
    right.setHardDrawingAngle(30);
    right.draw(PageDensity.HARD);

    const left = testPage(app, 1) as Page;
    left.setDrawingDensity(PageDensity.HARD);
    left.setOrientation(PageOrientation.LEFT);
    left.setHardDrawingAngle(-30);
    left.draw(PageDensity.HARD);

    expect(effectiveTop(right.getElement().style.cssText)).toBe(rect.top);
    expect(effectiveTop(left.getElement().style.cssText)).toBe(rect.top);

    // …and that is the same top a static soft leaf gets, which is the whole
    // point: no vertical jump when the cover starts turning.
    const soft = testPage(app, 2) as Page;
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

    expect(testRender(app).getRect().top).toBe(50);

    pages[0]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const page = testPage(app, 0) as Page;
    page.setDrawingDensity(PageDensity.HARD);
    page.setOrientation(PageOrientation.RIGHT);
    page.setHardDrawingAngle(0);
    page.draw(PageDensity.HARD);
    expect(effectiveTop(page.getElement().style.cssText)).toBe(50);

    // Grow the block: rect.top moves, and so must the hard page. A hardcoded
    // constant would pass the first assertion and fail here.
    const dist = app.getBlockElement();
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 700 });
    app.update();

    const grown = testRender(app).getRect();
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

    expect(testRender(app).getRect().top).toBe(0);

    pages[0]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const page = testPage(app, 0) as Page;
    page.setDrawingDensity(PageDensity.HARD);
    page.setOrientation(PageOrientation.LEFT);
    page.setHardDrawingAngle(0);
    page.draw(PageDensity.HARD);

    expect(effectiveTop(page.getElement().style.cssText)).toBe(0);
  });
});
