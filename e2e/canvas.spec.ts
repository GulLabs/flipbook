import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 0 of `docs/CANVAS_FIRST_CLASS.md`: browser coverage for canvas mode.
 *
 * Canvas mode has only ever been tested in jsdom against a mocked 2D context,
 * which is exactly how upstream #44 and #56 shipped broken — a mock records
 * that you called `drawImage`, never what appeared. These read real pixels.
 *
 * This suite asserts ONLY what is already true. Transparent-paper correctness,
 * hard-page geometry, exact DPR backing size and load-error handling stay red
 * and belong to their own phases; Phase 0 provides their fixtures, not skipped
 * tests dressed up as coverage.
 */

/** Identity colour per page, from `scripts/gen-canvas-fixtures.mjs`. */
const PAGE = {
  0: [0xe5, 0x48, 0x4d],
  1: [0x3b, 0x82, 0xf6],
  2: [0x22, 0xc5, 0x5e],
  3: [0xfa, 0xcc, 0x15],
  4: [0xa8, 0x55, 0xf7],
  5: [0xf9, 0x73, 0x16],
} as const;

/** The far-edge band is the identity colour at 60% luminance. */
const dim = ([r, g, b]: readonly number[]): number[] => [
  Math.round((r ?? 0) * 0.6),
  Math.round((g ?? 0) * 0.6),
  Math.round((b ?? 0) * 0.6),
];

type Rgba = [number, number, number, number];

async function open(page: Page, query = '', viewport = { width: 1000, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto(`/canvas.html${query}`);
  await expect(page.locator('body[data-ready="1"]')).toBeAttached();
  await settle(page);
}

/** Two browser rAFs. Necessary, never sufficient — always follow with a poll. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Median of a 5x5 backing-pixel patch at a canvas-local CSS coordinate.
 *
 * `getBoundsRect()` is canvas-local, so no viewport origin is subtracted here.
 * Median (not mean) so a stray antialiased pixel cannot drag the sample.
 * `getImageData`, never `toDataURL`: encoded PNG bytes vary between engines
 * while the pixels are identical.
 */
async function sample(page: Page, cssX: number, cssY: number): Promise<Rgba> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');

      const box = canvas.getBoundingClientRect();
      const scaleX = canvas.width / box.width;
      const scaleY = canvas.height / box.height;
      const bx = Math.floor((x as number) * scaleX);
      const by = Math.floor((y as number) * scaleY);

      const half = 2;
      const data = ctx.getImageData(bx - half, by - half, 5, 5).data;
      const channels: number[][] = [[], [], [], []];
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 4; c++) channels[c]?.push(data[i + c] ?? 0);
      }
      return channels.map((values) => {
        values.sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)] ?? 0;
      }) as [number, number, number, number];
    },
    [cssX, cssY],
  );
}

/** Canvas-local sample points, derived from the engine rather than hard-coded. */
async function probes(page: Page) {
  return page.evaluate(() => {
    const rect = window.flipbook.getBoundsRect();
    const y = rect.top + rect.height / 2;
    return {
      left: { x: rect.left + rect.pageWidth * 0.5, y },
      right: { x: rect.left + rect.pageWidth * 1.5, y },
      farEdge: { x: rect.left + rect.pageWidth * 1.85, y },
    };
  });
}

function near(actual: Rgba, expected: readonly number[], tolerance = 3) {
  const [r, g, b, a] = actual;
  expect(a).toBeGreaterThanOrEqual(254);
  expect(Math.abs(r - (expected[0] ?? 0))).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(g - (expected[1] ?? 0))).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(b - (expected[2] ?? 0))).toBeLessThanOrEqual(tolerance);
}

/** Poll until the probe shows the expected colour, then prove it is stable. */
async function expectPixel(page: Page, at: { x: number; y: number }, expected: readonly number[]) {
  await expect
    .poll(async () => (await sample(page, at.x, at.y)).slice(0, 3).join(','), {
      timeout: 5000,
    })
    .toBe(expected.join(','));

  await settle(page);
  near(await sample(page, at.x, at.y), expected);
}

test.describe('canvas mode renders real pixels', () => {
  test('landscape paints the first spread', async ({ page }) => {
    await open(page);
    const p = await probes(page);

    await expectPixel(page, p.left, PAGE[0]);
    await expectPixel(page, p.right, PAGE[1]);
  });

  test('the far edge of a leaf is painted, not clipped short', async ({ page }) => {
    await open(page);
    const p = await probes(page);

    // Tightened in Phase 1 to prove DPR backing resolution; here it only has
    // to prove the leaf reaches its own right-hand edge.
    await expectPixel(page, p.farEdge, dim(PAGE[1]));
  });

  test('a turn advances both the engine index and the pixels', async ({ page }) => {
    await open(page, '?reducedMotion=1');
    const p = await probes(page);

    await page.evaluate(() => {
      window.flipbook.flipNext();
    });
    await expect(page.locator('body[data-page="2"]')).toBeAttached();

    await expectPixel(page, p.left, PAGE[2]);
    await expectPixel(page, p.right, PAGE[3]);
  });

  test('a back turn returns to the previous spread', async ({ page }) => {
    await open(page, '?reducedMotion=1');
    const p = await probes(page);

    await page.evaluate(() => {
      window.flipbook.flipNext();
    });
    await expect(page.locator('body[data-page="2"]')).toBeAttached();
    await page.evaluate(() => {
      window.flipbook.flipPrev();
    });
    await expect(page.locator('body[data-page="0"]')).toBeAttached();

    await expectPixel(page, p.left, PAGE[0]);
    await expectPixel(page, p.right, PAGE[1]);
  });

  test('portrait shows one leaf and turns it', async ({ page }) => {
    await open(page, '?portrait=1&reducedMotion=1', { width: 500, height: 900 });
    const p = await probes(page);

    await expectPixel(page, p.right, PAGE[0]);

    await page.evaluate(() => {
      window.flipbook.flipNext();
    });
    await expect(page.locator('body[data-page="1"]')).toBeAttached();
    await expectPixel(page, p.right, PAGE[1]);
  });

  test('reduced motion makes the index change synchronous', async ({ page }) => {
    // `respectReducedMotion` only bites when the BROWSER reports the
    // preference. Passing a query flag proved nothing — the engine was
    // respecting a preference nobody had expressed.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '?reducedMotion=1');

    const result = await page.evaluate(() => {
      const before = window.flipbook.getCurrentPageIndex();
      window.flipbook.flipNext();
      // Same JavaScript task: an instant turn has already committed here.
      return {
        before,
        after: window.flipbook.getCurrentPageIndex(),
        state: window.flipbook.getState(),
      };
    });

    expect(result.after).toBeGreaterThan(result.before);
    expect(result.state).toBe('read');
  });

  test('motion enabled leaves a turn in flight', async ({ page }) => {
    // Same preference expressed, but the engine is told not to respect it.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '?reducedMotion=0&flippingTime=2000');

    const state = await page.evaluate(() => {
      window.flipbook.flipNext();
      return window.flipbook.getState();
    });

    expect(state).not.toBe('read');
  });

  test('destroy removes the canvas and raises nothing afterwards', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await open(page);
    await page.evaluate(() => {
      window.flipbook.destroy();
    });
    await settle(page);

    expect(await page.locator('#book canvas').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a growing update paints the new collection', async ({ page }) => {
    await open(page, '?pages=2');

    await page.evaluate(async () => {
      await window.flipbook.updateFromImages([
        { src: '/fixtures/canvas/page-4.png', alt: 'Page 4' },
        { src: '/fixtures/canvas/page-5.png', alt: 'Page 5' },
      ]);
    });

    const p = await probes(page);
    await expectPixel(page, p.left, PAGE[4]);
    await expectPixel(page, p.right, PAGE[5]);
  });

  test('portrait to landscape resize changes orientation and pixels', async ({ page }) => {
    await open(page, '?portrait=1&reducedMotion=1', { width: 500, height: 900 });
    await expectPixel(page, (await probes(page)).right, PAGE[0]);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => {
      window.flipbook.updateSettings({ usePortrait: false });
      window.flipbook.update();
    });
    await settle(page);

    const p = await probes(page);
    await expectPixel(page, p.left, PAGE[0]);
    await expectPixel(page, p.right, PAGE[1]);
  });
});

test.describe('device pixel ratio (B1) and sizing (B2)', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the backing store is sized for the display, not for CSS pixels', async ({ page }) => {
    await open(page);

    const m = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
      const box = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      const t = ctx?.getTransform();
      return {
        backingW: canvas.width,
        backingH: canvas.height,
        cssW: box.width,
        cssH: box.height,
        a: t?.a ?? 0,
        d: t?.d ?? 0,
      };
    });

    // One backing pixel per CSS pixel is linearly HALF resolution on a 2x
    // display — the most visible defect in the canvas renderer.
    expect(m.backingW).toBe(Math.ceil(m.cssW * 2));
    expect(m.backingH).toBe(Math.ceil(m.cssH * 2));

    // The CTM is deliberately NOT asserted here. The frame is bracketed by
    // save()/restore(), so the base transform is transient by design and reads
    // back as identity between frames. Restating it per frame is the point:
    // it cannot drift out of sync with a resize, a context reset, or a throw.
    //
    // The transform is proven by the test below instead: at 2x with no
    // setTransform, every leaf would paint into the top-left quarter of the
    // canvas and the CSS-coordinate probes would miss entirely.
    expect(m.a).toBeGreaterThan(0);
  });

  test('pages still land in the right place at 2x', async ({ page }) => {
    await open(page);
    const p = await probes(page);

    // Geometry stays in CSS pixels: `getBoundsRect` is public API and pointer
    // input arrives in CSS px, so the ONLY conversion point is the context CTM.
    await expectPixel(page, p.left, PAGE[0]);
    await expectPixel(page, p.right, PAGE[1]);
    await expectPixel(page, p.farEdge, dim(PAGE[1]));
  });

  test('the far edge is painted at 2x — no stale strip from an under-fill', async ({ page }) => {
    await open(page, '?fractional=1');
    const p = await probes(page);

    // `clear()` used to fill `canvas.width/height` (DEVICE px) through a scaled
    // CTM. Right by accident at 1x; below 1x it under-fills and leaves stale
    // pixels along the right and bottom edges.
    await expectPixel(page, p.farEdge, dim(PAGE[1]));
  });
});
