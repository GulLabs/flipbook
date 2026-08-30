import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 2 canvas surface (ADR 0001) — pixel claims for fit modes, insets,
 * blank leaves, and the error-fallback path.
 *
 * Built ahead of the engine implementation. Each visual suite:
 *   1. opens the harness with a known fixture;
 *   2. bails cleanly with `testInfo.skip` when Phase 2 is not yet in the
 *      engine (`data-descriptors=0` / `data-fit=legacy-fill` / ready=unsupported)
 *      so CI stays green on the pre-Phase-2 tree;
 *   3. asserts real `getImageData` (never `toDataURL`), 5×5 median, ±3;
 *   4. carries a negative control so a blank canvas cannot pass a paper test.
 *
 * When Phase 2 lands, remove the skip gates — the assertions are the contract.
 */

/** Identity colours from `scripts/gen-canvas-fixtures.mjs`. */
const PAGE = {
  0: [0xe5, 0x48, 0x4d],
  1: [0x3b, 0x82, 0xf6],
  2: [0x22, 0xc5, 0x5e],
  3: [0xfa, 0xcc, 0x15],
} as const;

/** Default harness paper (`pageBackground`). */
const PAPER = [0xf4, 0xec, 0xd8] as const;

/** Loud paper for blank / letterbox probes that must not look like "no paint". */
const MAGENTA_PAPER = [0xff, 0x00, 0xaa] as const;

type Rgba = [number, number, number, number];

async function open(page: Page, query = '', viewport = { width: 1000, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto(`/canvas.html${query}`);
  // ready=1 (ok), ready=unsupported (blank-only fixture on pre-Phase-2), or error.
  await expect(page.locator('body[data-ready]')).toBeAttached({ timeout: 15_000 });
  await settle(page);
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

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

async function probes(page: Page) {
  return page.evaluate(() => {
    const rect = window.flipbook.getBoundsRect();
    const y = rect.top + rect.height / 2;
    const topY = rect.top + rect.height * 0.08;
    const botY = rect.top + rect.height * 0.92;
    return {
      rect,
      left: { x: rect.left + rect.pageWidth * 0.5, y },
      right: { x: rect.left + rect.pageWidth * 1.5, y },
      // Near the left edge of the RIGHT leaf — letterbox zone for a tall contain.
      rightEdgeIn: { x: rect.left + rect.pageWidth * 1.08, y },
      rightEdgeOut: { x: rect.left + rect.pageWidth * 1.92, y },
      rightTop: { x: rect.left + rect.pageWidth * 1.5, y: topY },
      rightBot: { x: rect.left + rect.pageWidth * 1.5, y: botY },
      // Negative-control point well outside the book bounds — must NOT match paper.
      outside: { x: 4, y: 4 },
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

async function expectPixel(page: Page, at: { x: number; y: number }, expected: readonly number[]) {
  await expect
    .poll(async () => (await sample(page, at.x, at.y)).slice(0, 3).join(','), {
      timeout: 5000,
    })
    .toBe(expected.join(','));
  await settle(page);
  near(await sample(page, at.x, at.y), expected);
}

/** Fail the suite if the canvas never painted (blank book green-pass guard). */
async function assertNotBlankCanvas(page: Page) {
  const p = await probes(page);
  const mid = await sample(page, p.right.x, p.right.y);
  // A never-drawn canvas is transparent black. Anything with alpha and a
  // non-zero channel means *something* reached the backing store.
  expect(mid[3]).toBeGreaterThanOrEqual(254);
  const sum = mid[0] + mid[1] + mid[2];
  expect(sum).toBeGreaterThan(0);
}

async function phase2Ready(page: Page): Promise<'ok' | 'pending' | 'unsupported' | 'error'> {
  return page.evaluate(() => {
    const ready = document.body.dataset['ready'];
    if (ready === 'unsupported') return 'unsupported';
    if (ready === 'error') return 'error';
    if (document.body.dataset['phase2'] === 'pending') return 'pending';
    if (document.body.dataset['fit'] === 'legacy-fill') return 'pending';
    if (document.body.dataset['descriptors'] === '1') return 'ok';
    // fit setting present without descriptors still counts as partial Phase 2.
    const fit = document.body.dataset['fit'];
    if (fit === 'contain' || fit === 'cover' || fit === 'fill') return 'ok';
    return 'pending';
  });
}

test.describe('Phase 2 — fill (legacy stretch) is still observable', () => {
  test('tall fixture stretched to the leaf still covers the right edge', async ({ page }) => {
    // Pre-Phase 2 AND fill mode: drawImage(img, 0, 0, pageW, pageH) stretches.
    // A tall 1:2 image into a 4:3 leaf: the vertical mid-line of the image
    // lands on the leaf centre → red|blue split, so the centre probe is one of
    // the two (resampling may blend). The RIGHT edge of the leaf is still art,
    // never paper — that is the fill contract.
    await open(page, '?fixture=tall&pages=2&fit=fill');
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    // Negative control: a blank/unpainted backing store is transparent black.
    // assertNotBlankCanvas already rejects that; also require the leaf centre
    // and the far edge to disagree with pure paper so a paper-only clear()
    // cannot green this test.
    const mid = await sample(page, p.right.x, p.right.y);
    const midIsPaper =
      Math.abs(mid[0] - PAPER[0]) <= 5 &&
      Math.abs(mid[1] - PAPER[1]) <= 5 &&
      Math.abs(mid[2] - PAPER[2]) <= 5;
    expect(midIsPaper).toBe(false);

    // Far edge of the leaf must be painted (stretched), not letterboxed paper.
    const edge = await sample(page, p.rightEdgeOut.x, p.rightEdgeOut.y);
    expect(edge[3]).toBeGreaterThanOrEqual(254);
    const isPaper =
      Math.abs(edge[0] - PAPER[0]) <= 5 &&
      Math.abs(edge[1] - PAPER[1]) <= 5 &&
      Math.abs(edge[2] - PAPER[2]) <= 5;
    expect(isPaper).toBe(false);
  });
});

test.describe('Phase 2 — contain letterboxes with pageBackground', () => {
  test('tall + contain shows paper in the side bands', async ({ page }, testInfo) => {
    await open(page, `?fixture=tall&fit=contain&pageBackground=${encodeURIComponent('#ff00aa')}`);
    const gate = await phase2Ready(page);
    if (gate !== 'ok') {
      testInfo.skip(true, `Phase 2 imageFit not in engine yet (gate=${gate})`);
      return;
    }
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    // Side letterbox bands are magenta paper.
    await expectPixel(page, p.rightEdgeIn, MAGENTA_PAPER);
    await expectPixel(page, p.rightEdgeOut, MAGENTA_PAPER);

    // Centre of the leaf is image content (red or blue quadrant), not paper.
    const mid = await sample(page, p.right.x, p.right.y);
    const isPaper =
      Math.abs(mid[0] - MAGENTA_PAPER[0]) <= 5 &&
      Math.abs(mid[1] - MAGENTA_PAPER[1]) <= 5 &&
      Math.abs(mid[2] - MAGENTA_PAPER[2]) <= 5;
    expect(isPaper).toBe(false);
  });

  test('wide + contain shows paper in the top/bottom bands', async ({ page }, testInfo) => {
    await open(page, `?fixture=wide&fit=contain&pageBackground=${encodeURIComponent('#ff00aa')}`);
    const gate = await phase2Ready(page);
    if (gate !== 'ok') {
      testInfo.skip(true, `Phase 2 imageFit not in engine yet (gate=${gate})`);
      return;
    }
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    await expectPixel(page, p.rightTop, MAGENTA_PAPER);
    await expectPixel(page, p.rightBot, MAGENTA_PAPER);

    const mid = await sample(page, p.right.x, p.right.y);
    const isPaper =
      Math.abs(mid[0] - MAGENTA_PAPER[0]) <= 5 &&
      Math.abs(mid[1] - MAGENTA_PAPER[1]) <= 5 &&
      Math.abs(mid[2] - MAGENTA_PAPER[2]) <= 5;
    expect(isPaper).toBe(false);
  });
});

test.describe('Phase 2 — cover crops, no paper letterbox', () => {
  test('tall + cover paints the leaf edge with image, not paper', async ({ page }, testInfo) => {
    await open(page, `?fixture=tall&fit=cover&pageBackground=${encodeURIComponent('#ff00aa')}`);
    const gate = await phase2Ready(page);
    if (gate !== 'ok') {
      testInfo.skip(true, `Phase 2 imageFit not in engine yet (gate=${gate})`);
      return;
    }
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    const edge = await sample(page, p.rightEdgeOut.x, p.rightEdgeOut.y);
    const isPaper =
      Math.abs(edge[0] - MAGENTA_PAPER[0]) <= 5 &&
      Math.abs(edge[1] - MAGENTA_PAPER[1]) <= 5 &&
      Math.abs(edge[2] - MAGENTA_PAPER[2]) <= 5;
    expect(isPaper).toBe(false);
  });
});

test.describe('Phase 2 — fractional inset', () => {
  test('inset 0.08 leaves a paper frame around a matching-aspect page', async ({
    page,
  }, testInfo) => {
    // page-0 is 400×300 into a 400×300 leaf: contain with inset → uniform paper frame.
    await open(
      page,
      `?pages=2&fit=contain&inset=0.08&pageBackground=${encodeURIComponent('#ff00aa')}`,
    );
    const gate = await phase2Ready(page);
    if (gate !== 'ok') {
      testInfo.skip(true, `Phase 2 imageInset not in engine yet (gate=${gate})`);
      return;
    }
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    // Just inside the leaf edge: paper frame.
    await expectPixel(page, p.rightEdgeIn, MAGENTA_PAPER);
    // Centre: identity red of page 0 (right leaf is page 1 blue in landscape —
    // left is page 0). Probe left for page 0.
    await expectPixel(page, p.left, PAGE[0]);
  });
});

test.describe('Phase 2 — blank leaf', () => {
  test('a blank leaf is opaque paper, not a spinner and not transparent', async ({
    page,
  }, testInfo) => {
    await open(
      page,
      `?fixture=blank&pageBackground=${encodeURIComponent('#ff00aa')}&reducedMotion=1`,
    );
    const ready = await page.evaluate(() => document.body.dataset['ready']);
    if (ready === 'unsupported' || ready === 'error') {
      testInfo.skip(true, 'Blank leaves require Phase 2 descriptors');
      return;
    }
    const gate = await phase2Ready(page);
    if (gate !== 'ok') {
      testInfo.skip(true, `Phase 2 blank leaves not in engine yet (gate=${gate})`);
      return;
    }
    await assertNotBlankCanvas(page);
    const p = await probes(page);
    // Landscape: blank is left leaf, page-1 is right.
    await expectPixel(page, p.left, MAGENTA_PAPER);
    await expectPixel(page, p.right, PAGE[1]);
  });
});

test.describe('Phase 2 — image error path', () => {
  test('a 404 settles the load and paints paper (no infinite spinner)', async ({
    page,
  }, testInfo) => {
    await open(
      page,
      `?fixture=broken&pageBackground=${encodeURIComponent('#ff00aa')}&reducedMotion=1`,
    );
    const ready = await page.evaluate(() => document.body.dataset['ready']);
    expect(ready === '1' || ready === 'unsupported').toBeTruthy();
    if (ready !== '1') {
      testInfo.skip(true, 'broken fixture needs engine to settle failed images');
      return;
    }

    // Wait long enough that a spinner would have painted several frames.
    await page.waitForTimeout(400);
    await settle(page);
    await assertNotBlankCanvas(page);
    const p = await probes(page);

    // Failed left leaf must be stable paper (or paper + glyph), never the
    // loader arc's grey stroke as the only content forever.
    const left = await sample(page, p.left.x, p.left.y);
    expect(left[3]).toBeGreaterThanOrEqual(254);

    // Right leaf still paints.
    await expectPixel(page, p.right, PAGE[1]);

    // imageError event — Phase 2 only.
    const errors = await page.evaluate(() => window.flipbookImageErrors ?? []);
    if (errors.length === 0) {
      testInfo.skip(true, 'imageError event not emitted yet (Phase 2 pending)');
      return;
    }
    expect(errors[0]?.page).toBe(0);
    expect(errors[0]?.attempt).toBe(1);
  });

  test('a corrupt PNG is the same failure class as a 404', async ({ page }, testInfo) => {
    await open(
      page,
      `?fixture=corrupt&pageBackground=${encodeURIComponent('#ff00aa')}&reducedMotion=1`,
    );
    const ready = await page.evaluate(() => document.body.dataset['ready']);
    if (ready !== '1') {
      testInfo.skip(true, 'corrupt fixture needs engine error path');
      return;
    }
    await page.waitForTimeout(400);
    await assertNotBlankCanvas(page);
    const p = await probes(page);
    await expectPixel(page, p.right, PAGE[1]);
  });
});

test.describe('Phase 2 — DPR still holds for new fixtures', () => {
  test.use({ deviceScaleFactor: 2 });

  test('tall fill at 2x still reaches the far edge', async ({ page }) => {
    await open(page, '?fixture=tall&fit=fill');
    await assertNotBlankCanvas(page);
    const p = await probes(page);
    const edge = await sample(page, p.rightEdgeOut.x, p.rightEdgeOut.y);
    expect(edge[3]).toBeGreaterThanOrEqual(254);
    const isPaper =
      Math.abs(edge[0] - PAPER[0]) <= 5 &&
      Math.abs(edge[1] - PAPER[1]) <= 5 &&
      Math.abs(edge[2] - PAPER[2]) <= 5;
    expect(isPaper).toBe(false);
  });
});
