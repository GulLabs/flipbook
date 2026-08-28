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
});
