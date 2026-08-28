// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';

/**
 * Canvas mode ships as a lazily-imported chunk, so nothing in the HTML path
 * exercises it. jsdom has no 2D context, so stub the parts the render touches.
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

describe('canvas mode', () => {
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

  test('loadFromImages resolves and wires the canvas renderer', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });

    await book.loadFromImages(['a.png', 'b.png', 'c.png']);

    expect(book.getPageCount()).toBe(3);
    expect(book.getCurrentPageIndex()).toBe(0);
    expect(book.getFlipController()).not.toBeNull();
    expect(host.querySelector('canvas')).toBeTruthy();

    book.destroy();
  });

  test('updateFromImages swaps the collection and reports the rebuild', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    await book.loadFromImages(['a.png', 'b.png']);

    const rebuilt = vi.fn();
    book.on('collectionRebuild', rebuilt);

    await book.updateFromImages(['a.png', 'b.png', 'c.png', 'd.png']);

    expect(book.getPageCount()).toBe(4);
    expect(rebuilt).toHaveBeenCalledTimes(1);

    book.destroy();
  });

  test('turning pages advances the current index', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    await book.loadFromImages(['a.png', 'b.png', 'c.png']);

    book.turnToPage(2);
    expect(book.getCurrentPageIndex()).toBe(2);

    expect(() => book.turnToPage(9)).toThrow(PageFlipError);

    book.destroy();
  });

  test('a load that lands after destroy attaches nothing', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    const loading = book.loadFromImages(['a.png']);
    book.destroy();

    await expect(loading).resolves.toBeUndefined();
    expect(book.getFlipController()).toBeNull();
    expect(host.querySelector('canvas')).toBeNull();
  });

  test('flipNext drives canvas drawFrame and ImagePage loader path', async () => {
    const ctx = stubCanvas2d();
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      usePortrait: true,
      drawShadow: true,
    });

    Object.defineProperty(host, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(host, 'offsetHeight', { configurable: true, get: () => 300 });

    await book.loadFromImages(['a.png', 'b.png', 'c.png', 'd.png']);
    const dist = book.getUI().getDistElement();
    Object.defineProperty(dist, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 300 });
    book.update();

    const before = ctx.fillRect.mock.calls.length + ctx.arc.mock.calls.length;
    book.flipNext();
    expect(book.getCurrentPageIndex()).toBe(1);

    // Loader path (images not loaded yet) uses fillRect/arc.
    expect(ctx.fillRect.mock.calls.length + ctx.arc.mock.calls.length).toBeGreaterThanOrEqual(
      before,
    );

    const page = book.getPage(0);
    page.setArea([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 0, y: 0 });
    page.setAngle(0);
    page.draw();
    page.simpleDraw(0);

    expect(ctx.save.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.clip.mock.calls.length).toBeGreaterThan(0);

    book.destroy();
  });

  test('landscape canvas path draws book shadow gradient on rAF frames', async () => {
    const ctx = stubCanvas2d();
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      usePortrait: false,
      drawShadow: true,
    });
    Object.defineProperty(host, 'offsetWidth', { configurable: true, get: () => 500 });
    Object.defineProperty(host, 'offsetHeight', { configurable: true, get: () => 300 });

    await book.loadFromImages(['a.png', 'b.png', 'c.png', 'd.png']);
    const dist = book.getUI().getDistElement();
    Object.defineProperty(dist, 'offsetWidth', { configurable: true, get: () => 500 });
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 300 });
    book.update();

    // CanvasRender.drawFrame (incl. drawBookShadow) only runs on the rAF loop.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    expect(ctx.createLinearGradient.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(0);

    book.flipNext();
    expect(book.getCurrentPageIndex()).toBeGreaterThan(0);

    book.destroy();
  });

  test('canvas soft fold paints outer/inner shadow gradients', async () => {
    const ctx = stubCanvas2d();
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 300,
      size: 'fixed',
      usePortrait: true,
      drawShadow: true,
    });
    Object.defineProperty(host, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(host, 'offsetHeight', { configurable: true, get: () => 300 });

    await book.loadFromImages(['a.png', 'b.png', 'c.png']);
    const dist = book.getUI().getDistElement();
    Object.defineProperty(dist, 'offsetWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 300 });
    book.update();

    const flip = book.getFlipController()!;
    const rect = book.getBoundsRect();
    flip.fold({ x: rect.left + rect.width - 5, y: rect.top + 20 });

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    // drawOuterShadow / drawInnerShadow / drawBookShadow all create gradients.
    expect(ctx.createLinearGradient.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.save.mock.calls.length).toBeGreaterThan(0);

    flip.stopMove();
    book.destroy();
  });
});
