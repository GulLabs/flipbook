import { expect, test, type Page } from '@playwright/test';

/**
 * The §4.1 / §4.2 guard.
 *
 * Screenshots were the original plan, but committed pixels are a poor bargain
 * here: they are platform-specific, they go stale on any cosmetic change, and
 * they cannot say *why* a frame is wrong. These read the same invariants
 * straight off the live engine instead, which is what the unit tests cannot do
 * — they passed downstream while the browser still showed the slide-in.
 */

const PORTRAIT = { width: 420, height: 800 };
const LANDSCAPE = { width: 1100, height: 700 };

async function openBook(page: Page, size: { width: number; height: number }, query = '') {
  await page.setViewportSize(size);
  await page.goto(`/${query}`);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#book .stf__block')).toBeVisible();
}

function orientation(page: Page) {
  return page.locator('body').getAttribute('data-orientation');
}

/** Geometry of every mounted leaf, in DOM order. */
async function leaves(page: Page) {
  return page.$$eval('#book .stf__item', (nodes) =>
    nodes.map((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // The leaf is positioned by `transform`, and clipped by `clip-path`; the
      // bounding box does not move, so read the translation itself.
      return {
        text: (el.textContent ?? '').trim(),
        display: style.display,
        background: style.backgroundColor,
        clipped: style.clipPath !== 'none',
        // The leaf being animated is the only one carrying a transform.
        moving: style.transform !== 'none',
        x: Math.round(rect.x),
        width: Math.round(rect.width),
        visible: style.display !== 'none' && rect.width > 0,
      };
    }),
  );
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await settle(page);
}

/** Let the render loop paint what the engine just calculated. */
function settle(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Where the fold currently sits, in on-screen coordinates.
 *
 * Read from the engine rather than from a bounding box: the leaf is drawn with
 * a clip-path over a transformed element, and Chromium and WebKit disagree on
 * what rectangle that produces even when the fold is in the same place.
 */
function foldX(page: Page) {
  return page.evaluate(() => {
    const book = (window as unknown as { flipbook: import('@gullabs/flipbook-core').PageFlip })
      .flipbook;
    const calc = book.getFlipController()?.getCalculation();
    if (!calc) return null;
    return book.getRender().convertPointToGlobal(calc.getPosition()).x;
  });
}

test.describe('portrait back-curl (StPageFlip #49)', () => {
  test('the moving leaf is a copy of the current page, and the previous leaf is painted under it', async ({
    page,
  }) => {
    await openBook(page, PORTRAIT);
    expect(await orientation(page)).toBe('portrait');

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    // Forward once so a backward turn is possible.
    await page.mouse.click(box.x + box.width - 20, box.y + 20);
    await expect(page.locator('body[data-page="1"]')).toBeAttached();

    const mid = box.y + box.height / 2;
    await dragTo(page, { x: box.x + 12, y: mid }, { x: box.x + box.width * 0.8, y: mid });

    const mounted = await leaves(page);
    const visible = mounted.filter((leaf) => leaf.visible);

    // Upstream animates `pages[current - 1]` and skips the leaf underneath, so
    // exactly one leaf moves and the page below it never paints. The fix
    // animates a *copy* of the current leaf, so the current page's text is
    // mounted twice while the previous leaf paints underneath.
    const currentCopies = visible.filter((leaf) => leaf.text === 'Two');
    expect(currentCopies.length).toBe(2);
    expect(visible.some((leaf) => leaf.text === 'One')).toBe(true);

    await page.mouse.up();
  });

  test('the turning leaf is opaque', async ({ page }) => {
    await openBook(page, PORTRAIT);

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    const mid = box.y + box.height / 2;
    await dragTo(
      page,
      { x: box.x + box.width - 12, y: mid },
      { x: box.x + box.width * 0.35, y: mid },
    );

    const moving = (await leaves(page)).filter((leaf) => leaf.visible);
    expect(moving.length).toBeGreaterThan(1);

    // A transparent fold is §4.2: the page underneath reads through the leaf.
    for (const leaf of moving) {
      expect(leaf.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(leaf.background).not.toBe('transparent');
    }

    await page.mouse.up();
  });

  test('the curl travels rightward across the drag', async ({ page }) => {
    await openBook(page, PORTRAIT);

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    // Forward once so there is a previous leaf to curl back to.
    await page.mouse.click(box.x + box.width - 20, box.y + 20);
    await expect(page.locator('body[data-page="1"]')).toBeAttached();

    const mid = box.y + box.height / 2;
    await page.mouse.move(box.x + 12, mid);
    await page.mouse.down();

    const positions: number[] = [];
    for (const fraction of [0.3, 0.45, 0.6, 0.75, 0.9]) {
      await page.mouse.move(box.x + box.width * fraction, mid, { steps: 6 });
      const x = await foldX(page);
      if (x !== null) positions.push(x);
    }

    expect(positions.length, 'the fold should engage during the drag').toBeGreaterThan(2);

    // The regression this fork exists to kill is the previous page sliding in
    // from the left. The local curl runs left and `convertToGlobal` mirrors it
    // for BACK, so on screen the current leaf peels to the right.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] ?? 0);
    }

    await page.mouse.up();
  });
});

test.describe('landscape', () => {
  test('renders a two-page spread and turns forward', async ({ page }) => {
    await openBook(page, LANDSCAPE);
    expect(await orientation(page)).toBe('landscape');

    const visible = (await leaves(page)).filter((leaf) => leaf.visible);
    expect(visible.length).toBe(2);
    expect(visible.map((leaf) => leaf.text)).toEqual(['One', 'Two']);

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    await page.mouse.click(box.x + box.width - 20, box.y + 20);
    await expect(page.locator('body[data-page="2"]')).toBeAttached();
  });

  test('a hard cover turns without leaving the book blank', async ({ page }) => {
    await openBook(page, LANDSCAPE, '?cover=1');

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    await page.mouse.click(box.x + box.width - 20, box.y + 20);
    await expect(page.locator('body[data-page="1"]')).toBeAttached();

    const visible = (await leaves(page)).filter((leaf) => leaf.visible);
    expect(visible.length).toBeGreaterThan(0);
  });
});

test.describe('reading direction', () => {
  test('rtl turns forward from the left edge', async ({ page }) => {
    await openBook(page, PORTRAIT, '?rtl=1');

    const box = await page.locator('#book .stf__block').boundingBox();
    if (!box) throw new Error('no book box');

    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.locator('body[data-page="1"]')).toBeAttached();
  });
});
