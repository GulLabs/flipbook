/**
 * Geometry / shipped-CSS regressions:
 *  - C6:  `.stf__parent canvas` was an unscoped descendant selector, so a
 *         consumer canvas on an HTML page got absolutely positioned + stretched.
 *  - C12: `HTMLPage.drawHard` anchored the LEFT branch at block-local
 *         `pageWidth` instead of the spine — correct only when rect.left === 0.
 *
 * Both tests are written to FAIL against the pre-fix implementation; the C12
 * book deliberately has a NON-ZERO rect.left, which is the only configuration
 * that can tell the two implementations apart.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { ensureFlipbookStyles, PageDensity } from '@gullabs/flipbook-core';
import { PageOrientation } from '../src/Page/Page';
import { makeHtmlBook } from './html-book-fixture';
import { testRender, testPage } from './engine-access';
import { Page } from '../src/Page/Page';

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  document.querySelectorAll('style[data-gullabs-flipbook]').forEach((s) => {
    s.remove();
  });
  document.body.innerHTML = '';
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

/** Pull the x component out of `translate3d(<x>px,0,0)`. */
function translateX(css: string): number {
  const m = /translate3d\(\s*(-?[\d.]+)px/.exec(css);
  expect(m, `no translate3d in: ${css}`).not.toBeNull();
  return Number(m![1]);
}

/** Pull the x component out of `transform-origin:<x>px 0` (jsdom drops `px` on 0). */
function originX(css: string): number {
  const m = /transform-origin:\s*(-?[\d.]+)(?:px)?/.exec(css);
  expect(m, `no transform-origin in: ${css}`).not.toBeNull();
  return Number(m![1]);
}

describe('C12 — hard pages rotate about the spine, not block-local pageWidth', () => {
  test('LEFT and RIGHT share one rotation axis when rect.left is non-zero', () => {
    // hostWidth > 2 * width ⇒ landscape with the book centred in a wider
    // block ⇒ rect.left = hostWidth / 2 - pageWidth = 60. A left of 0 cannot
    // distinguish the fixed code from the broken code.
    const { book: app, pages } = book({
      pageCount: 4,
      width: 200,
      height: 300,
      hostWidth: 520,
      hostHeight: 300,
      flippingTime: 0,
    });

    const rect = testRender(app).getRect();
    expect(rect.left).toBe(60);
    expect(rect.pageWidth).toBe(200);
    const spine = rect.left + rect.width / 2;
    expect(spine).toBe(260);

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

    const rightCss = right.getElement().style.cssText;
    const leftCss = left.getElement().style.cssText;

    // The rotation axis is translateX + transform-origin x, because the origin
    // is expressed in the element's own box and moves with the translation.
    expect(translateX(rightCss) + originX(rightCss)).toBe(spine);
    expect(translateX(leftCss) + originX(leftCss)).toBe(spine);

    // And the left page's box lands to the left of the spine, not at x=0.
    expect(translateX(leftCss)).toBe(spine - rect.pageWidth);
    expect(translateX(leftCss)).toBe(rect.left);
  });

  test('rect.left === 0 keeps the historical placement (no behaviour drift)', () => {
    const { book: app, pages } = book({
      pageCount: 4,
      width: 200,
      height: 300,
      hostWidth: 400,
      hostHeight: 300,
      flippingTime: 0,
    });

    const rect = testRender(app).getRect();
    expect(rect.left).toBe(0);

    pages[0]!.dataset.density = 'hard';
    app.updateFromHtml(pages);

    const page = testPage(app, 0) as Page;
    page.setDrawingDensity(PageDensity.HARD);
    page.setOrientation(PageOrientation.LEFT);
    page.setHardDrawingAngle(0);
    page.draw(PageDensity.HARD);

    const css = page.getElement().style.cssText;
    expect(translateX(css)).toBe(0);
    expect(originX(css)).toBe(200);
  });
});

describe('C6 — shipped CSS has no canvas layout rules', () => {
  test('even a leftover .stf__canvas is not absolutely stretched', () => {
    // Canvas mode CSS was removed (ADR 0002). The old rule was
    // `.stf__parent>.stf__wrapper>.stf__canvas{position:absolute;width:100%;…}`.
    // Putting that class on a node and asserting it is NOT absolute is what
    // fails if the rule is restored; a bare chart without the class would not.
    ensureFlipbookStyles();

    const parent = document.createElement('div');
    parent.className = 'stf__parent';
    const wrapper = document.createElement('div');
    wrapper.className = 'stf__wrapper';
    parent.appendChild(wrapper);

    const leftover = document.createElement('canvas');
    leftover.className = 'stf__canvas';
    wrapper.appendChild(leftover);

    const block = document.createElement('div');
    block.className = 'stf__block';
    const page = document.createElement('div');
    page.className = 'stf__item';
    const chart = document.createElement('canvas');
    page.appendChild(chart);
    block.appendChild(page);
    parent.appendChild(block);

    document.body.appendChild(parent);

    const leftoverStyle = getComputedStyle(leftover);
    expect(leftoverStyle.position).not.toBe('absolute');
    expect(leftoverStyle.width).not.toBe('100%');

    const chartStyle = getComputedStyle(chart);
    expect(chartStyle.position).not.toBe('absolute');
    expect(chartStyle.width).not.toBe('100%');
  });
});
