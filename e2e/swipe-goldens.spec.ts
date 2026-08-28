import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env.GOLDEN_DIR || join(process.cwd(), 'e2e', 'goldens');

test.describe('swipe goldens', () => {
  test('portrait forward frames at 25/50/75', async ({ page, browserName }) => {
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto('/');
    const book = page.locator('#book');
    await expect(book).toBeVisible();
    const box = await book.boundingBox();
    if (!box) throw new Error('no book box');

    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4);
    await page.mouse.down();
    for (const t of [0.25, 0.5, 0.75]) {
      await page.mouse.move(
        box.x + box.width * (0.8 - 0.7 * t),
        box.y + box.height * 0.4,
      );
      await page.screenshot({
        path: join(outDir, `${browserName}-portrait-forward-${Math.round(t * 100)}.png`),
      });
    }
    await page.mouse.up();
  });

  test('portrait back frames at 25/50/75', async ({ page, browserName }) => {
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto('/');
    const book = page.locator('#book');
    await expect(book).toBeVisible();
    const box = await book.boundingBox();
    if (!box) throw new Error('no book box');

    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.4);
    await page.mouse.down();
    for (const t of [0.25, 0.5, 0.75]) {
      await page.mouse.move(
        box.x + box.width * (0.2 + 0.7 * t),
        box.y + box.height * 0.4,
      );
      await page.screenshot({
        path: join(outDir, `${browserName}-portrait-back-${Math.round(t * 100)}.png`),
      });
    }
    await page.mouse.up();
  });
});
