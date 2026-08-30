// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { getPortraitFlippingPage } from '../src/Collection/flippingPage';
import { shouldDrawBottomPage } from '../src/Render/bottomPage';
import { FlipDirection } from '../src/Flip/enums';
import { PageDensity } from '../src/Page/Page';

/**
 * A1 — the fork's flagship fix, which was absent in canvas mode.
 *
 * On a phone a back swipe must curl the CURRENT leaf away and reveal the
 * previous one underneath. Upstream slides the previous page in from the left.
 * `ImagePage.newTemporaryCopy()` returned `this`, so `getPortraitFlippingPage`
 * saw `copy === current` and fell through to `pages[i - 1]` — i.e. straight
 * back onto upstream's slide-in, in the renderer nobody was checking.
 */

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

describe('A1 — portrait BACK curls the current leaf on canvas', () => {
  let host: HTMLElement;

  beforeEach(() => {
    stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  test('a soft image page yields a real copy, not itself', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
    ]);

    const page = book.getPageCollection().getPage(1);
    expect(page.getDrawingDensity()).toBe(PageDensity.SOFT);
    const copy = page.newTemporaryCopy();

    // The whole defect in one assertion.
    expect(copy).not.toBe(page);
    expect(page.getTemporaryCopy()).toBe(copy);

    book.destroy();
  });

  test('the copy is reused, not rebuilt every frame', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);

    const page = book.getPageCollection().getPage(0);
    expect(page.newTemporaryCopy()).toBe(page.newTemporaryCopy());

    book.destroy();
  });

  test('the copy shares the decoded bitmap — no second request', async () => {
    const created: string[] = [];
    const RealImage = globalThis.Image;
    vi.stubGlobal(
      'Image',
      class extends RealImage {
        override set src(value: string) {
          created.push(value);
          super.src = value;
        }
        override get src(): string {
          return super.src;
        }
      },
    );

    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);

    const before = created.length;
    book.getPageCollection().getPage(0).newTemporaryCopy();

    // A copy that fetched its own bitmap would double every book's network
    // cost and show a spinner over a page that is already on screen.
    expect(created.length).toBe(before);

    book.destroy();
    vi.unstubAllGlobals();
  });

  test('a HARD page still returns itself, matching HTMLPage', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
    ]);

    const page = book.getPageCollection().getPage(0);
    page.setDrawingDensity(PageDensity.HARD);

    // A rigid cover swings, it does not curl, so it must stay on the vendor
    // previous-leaf path where the mover is not also the leaf beneath it.
    expect(page.newTemporaryCopy()).toBe(page);

    book.destroy();
  });

  test('portrait BACK selects a copy of the CURRENT leaf, not the previous page', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    // FOUR pages, deliberately. `createSpread` hardens the terminal leaf of an
    // odd collection, and a hard page correctly returns itself — so a 3-page
    // fixture tests the hard path while claiming to test the soft one.
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
      { src: 'd.png', alt: 'Page d' },
    ]);

    const collection = book.getPageCollection();
    const pages = [0, 1, 2, 3].map((i) => collection.getPage(i));
    expect(pages[2]?.getDrawingDensity()).toBe(PageDensity.SOFT);

    const mover = getPortraitFlippingPage(pages, 2, FlipDirection.BACK);

    // Upstream returns pages[1] here — the slide-in. The fix returns a copy of
    // pages[2], the leaf the reader is actually looking at.
    expect(mover).not.toBe(pages[1]);
    expect(mover).toBe(pages[2]?.getTemporaryCopy());

    book.destroy();
  });

  test('the leaf underneath is drawn, because the mover is no longer it', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
      { src: 'd.png', alt: 'Page d' },
    ]);

    const collection = book.getPageCollection();
    const current = collection.getPage(2);
    const mover = getPortraitFlippingPage(
      [0, 1, 2, 3].map((i) => collection.getPage(i)),
      2,
      FlipDirection.BACK,
    );

    // While `newTemporaryCopy()` returned `this`, the mover WAS the bottom
    // page, so `shouldDrawBottomPage` suppressed it and the leaf under the fold
    // vanished for the length of the turn.
    expect(shouldDrawBottomPage(mover, current)).toBe(true);

    book.destroy();
  });

  test('hiding the copy does not blank the page it was copied from', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);

    const page = book.getPageCollection().getPage(0);
    const copy = page.newTemporaryCopy() as unknown as { image: HTMLImageElement };
    const original = page as unknown as { image: HTMLImageElement };

    expect(copy.image).toBe(original.image);

    page.hideTemporaryCopy();

    // The copy BORROWS the bitmap. Disposing it on hide would strip the src
    // from the page still on screen.
    expect(original.image.getAttribute('src')).not.toBeNull();
    expect(page.getTemporaryCopy()).toBeNull();

    book.destroy();
  });
});
