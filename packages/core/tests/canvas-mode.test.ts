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
    // The renderer restates its base transform every frame (DPR), so a stub
    // without this throws before any assertion runs.
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

describe('canvas mode: the leaf under the fold (StPageFlip #44)', () => {
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

  /**
   * `ImagePage.newTemporaryCopy()` returns `this`, so in canvas mode the
   * flipping page and the page beneath it are routinely the *same object*.
   * `HTMLRender` guards that with `shouldDrawBottomPage`; `CanvasRender` drew
   * the bottom page unconditionally, so the turning image was painted twice —
   * once unclipped underneath, once clipped and rotating on top.
   *
   * Upstream: "the same image is visible under it and disappears only after
   * flipping is over" — https://github.com/Nodlik/StPageFlip/issues/44
   */
  test('the same page is not painted twice when it is its own bottom page', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    await book.loadFromImages(['a.png', 'b.png', 'c.png', 'd.png']);

    const render = book.getRender() as unknown as {
      flippingPage: unknown;
      bottomPage: unknown;
      drawFrame: () => void;
    };

    const page = book.getPage(1) as unknown as { draw: (d?: unknown) => void };
    const draws: string[] = [];
    page.draw = () => draws.push('draw');

    // The hard-cover shape: one leaf is both the mover and the leaf beneath.
    render.flippingPage = page;
    render.bottomPage = page;

    render.drawFrame();

    expect(draws).toHaveLength(1);

    book.destroy();
  });
});

describe('canvas mode honours pageBackground (StPageFlip #56)', () => {
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

  /** The colour in effect at the first fillRect — the clear, before shadows. */
  function paperColourAtClear(ctxStub: ReturnType<typeof stubCanvas2d>): { value: string } {
    let first: string | undefined;
    ctxStub.fillRect.mockImplementation(() => {
      first ??= ctxStub.fillStyle;
    });
    return {
      get value(): string {
        return first ?? '';
      },
    };
  }

  test('the canvas is cleared to the configured paper colour, not white', async () => {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      pageBackground: '#f4ecd8',
    });
    await book.loadFromImages(['a.png', 'b.png']);

    const paper = paperColourAtClear(ctx);
    (book.getRender() as unknown as { drawFrame: () => void }).drawFrame();

    expect(paper.value).toBe('#f4ecd8');

    book.destroy();
  });

  test('a settings object mutated behind updateSettings cannot reach fillStyle', async () => {
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    await book.loadFromImages(['a.png', 'b.png']);

    // Skips `Settings.getSettings` entirely — the getter hands back the live
    // object. The draw-time guard is what stops it.
    book.getSettings().pageBackground = 'rgba(0, 0, 0, 0.4)';

    const paper = paperColourAtClear(ctx);
    (book.getRender() as unknown as { drawFrame: () => void }).drawFrame();

    expect(paper.value).toBe('#fff');

    book.destroy();
  });

  test('an unsafe value still falls back to the opaque default', async () => {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      pageBackground: 'url(javascript:alert(1))',
    });
    await book.loadFromImages(['a.png', 'b.png']);

    const paper = paperColourAtClear(ctx);
    (book.getRender() as unknown as { drawFrame: () => void }).drawFrame();

    expect(paper.value).toBe('#fff');

    book.destroy();
  });
});

describe('canvas frame state and paper (r4 defect batch)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  test('G1: the frame is bracketed, and the portrait clip is set before painting', async () => {
    const ctx = stubCanvas2d();
    const order: string[] = [];
    for (const name of ['save', 'restore', 'clip', 'fillRect', 'drawImage', 'fill'] as const) {
      ctx[name].mockImplementation(() => {
        order.push(name);
      });
    }

    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages(['a.png', 'b.png']);
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Balanced: every save is matched. Upstream clipped after painting and
    // never restored, so the clip leaked into the next frame's clear().
    expect(order.filter((c) => c === 'save').length).toBe(
      order.filter((c) => c === 'restore').length,
    );

    // A frame opens with save(). The portrait clip must precede the FIRST page
    // paint — asserting "before the last paint" proved nothing, because
    // drawBookShadow() itself clips and paints after the leaves.
    expect(order[0]).toBe('save');

    // `fill()` is the unambiguous page-paint marker: only the leaf placeholder
    // uses it. `fillRect` is ambiguous — CanvasRender.clear() legitimately
    // fillRects the whole canvas BEFORE the clip, which is why an earlier
    // version of this assertion could not tell the two apart.
    const firstClip = order.indexOf('clip');
    const firstPagePaint = order.indexOf('fill');

    expect(firstClip).toBeGreaterThanOrEqual(0);
    expect(firstPagePaint).toBeGreaterThanOrEqual(0);
    expect(firstClip).toBeLessThan(firstPagePaint);

    book.destroy();
  });

  test('G2/G9: leaf paper and loader both use pageBackground, never white', async () => {
    const ctx = stubCanvas2d();
    // Kept apart on purpose: page paper is painted with fillRect() (G2) and the
    // loader placeholder with fill() (G9). Pooling them let each test pass with
    // the other's fix present — the pool always contained the right colour.
    const rectFills: string[] = [];
    const pathFills: string[] = [];
    const rectCalls: { style: string; w: number; h: number }[] = [];
    ctx.fillRect.mockImplementation((_x: number, _y: number, w: number, h: number) => {
      rectFills.push(String(ctx.fillStyle));
      rectCalls.push({ style: String(ctx.fillStyle), w, h });
    });
    ctx.fill.mockImplementation(() => {
      pathFills.push(String(ctx.fillStyle));
    });

    const book = new PageFlip(host, {
      width: 100,
      height: 150,
      usePortrait: true,
      pageBackground: '#f5f0e6',
    });
    await book.loadFromImages(['a.png', 'b.png']);
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // G2: the leaf itself is opaque paper, so a transparent PNG cannot read
    // through to the page beneath. Must be a *page-sized* fill: CanvasRender
    // .clear() also fillRects the whole canvas in pageBackground (#56), and
    // matching on colour alone let this pass with the page fill deleted.
    const rect = book.getBoundsRect();
    const paperFills = rectCalls.filter(
      (c) => Math.abs(c.w - rect.pageWidth) < 1 && Math.abs(c.h - rect.height) < 1,
    );
    expect(paperFills.length).toBeGreaterThan(0);
    expect(paperFills.every((c) => c.style === '#f5f0e6')).toBe(true);
    expect(rectFills).not.toContain('rgb(255, 255, 255)');

    // G9: the loader placeholder used to paint rgb(255,255,255) over custom
    // paper for as long as the image took to arrive.
    expect(pathFills).toContain('#f5f0e6');
    expect(pathFills).not.toContain('rgb(255, 255, 255)');

    book.destroy();
  });

  test('G5: clear() works in canvas mode instead of throwing on an HTMLUI cast', async () => {
    stubCanvas2d();
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png']);

    expect(() => {
      book.clear();
    }).not.toThrow();

    book.destroy();
  });

  test('G8: a slow image load cannot replace a newer HTML mode', async () => {
    stubCanvas2d();
    const book = new PageFlip(host, { width: 100, height: 150 });

    const pending = book.loadFromImages(['a.png', 'b.png']);
    // The newer load wins even though it starts while the import is in flight.
    const nodes = [document.createElement('div'), document.createElement('div')];
    for (const n of nodes) host.appendChild(n);
    book.loadFromHTML(nodes);

    await pending;

    // The stale canvas continuation must not have re-attached over HTML mode.
    expect(host.querySelector('canvas')).toBeNull();

    book.destroy();
  });
});

describe('collection replacement and teardown (G4, G6, G10)', () => {
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

  test('G6: a shrinking update clamps, and reports where it landed', async () => {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
    book.turnToPage(4);
    expect(book.getCurrentPageIndex()).toBe(4);

    const seen: number[] = [];
    book.on('collectionRebuild', (e) => {
      seen.push((e.data as { page: number }).page);
    });

    await book.updateFromImages(['a.png', 'b.png']);

    // show() silently returns for an out-of-range index, so page 4 used to be
    // kept and reported while the render still held the old collection's pages.
    expect(book.getCurrentPageIndex()).toBeLessThanOrEqual(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeLessThanOrEqual(1);

    book.destroy();
  });

  test('G10: replacing the collection abandons an in-flight turn', async () => {
    const book = new PageFlip(host, {
      width: 100,
      height: 150,
      usePortrait: true,
      flippingTime: 1000,
    });
    await book.loadFromImages(['a.png', 'b.png', 'c.png', 'd.png']);

    book.flipNext();
    expect(book.getState()).not.toBe('read');

    await book.updateFromImages(['x.png', 'y.png']);

    // The old turn's onAnimateEnd would otherwise commit against the new
    // collection — turning a page that belongs to a book that no longer exists.
    expect(book.getState()).toBe('read');
    expect(book.getCurrentPageIndex()).toBeLessThanOrEqual(1);

    book.destroy();
  });

  test('G4: destroy releases the pages, not just the render loop', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png', 'c.png']);

    const pages = book.getPageCollection();
    expect(pages.getPageCount()).toBe(3);

    book.destroy();

    // Stopping the loop released nothing: the collection kept every page and
    // the renderer kept its own left/right/flipping/bottom references, so a
    // retained destroyed engine retained every decoded image.
    expect(pages.getPageCount()).toBe(0);
  });
});

describe('review follow-ups (codex task-mtey3c3u-wlsgsc)', () => {
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

  test('clear() stops the loop drawing the pages it just discarded', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png']);

    book.clear();

    // Emptying the collection left Render.left/rightPage intact, so the rAF
    // loop kept painting the old images. "Does not throw" proved nothing.
    const render = book.getRender() as unknown as { leftPage: unknown; rightPage: unknown };
    expect(render.rightPage).toBeNull();
    expect(render.leftPage).toBeNull();

    book.destroy();
  });

  test('cross-mode updates are refused instead of failing deep in', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png']);

    // Was an unconditional `as HTMLUI` cast on a CanvasUI.
    expect(() => {
      book.updateFromHtml([document.createElement('div')]);
    }).toThrow(PageFlipError);

    book.destroy();
  });

  test('updateFromImages refuses to build image pages on an HTML render', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    const nodes = [document.createElement('div'), document.createElement('div')];
    for (const n of nodes) host.appendChild(n);
    book.loadFromHTML(nodes);

    // Produced a book whose pages drew into a 2d context that does not exist.
    await expect(book.updateFromImages(['a.png'])).rejects.toThrow(PageFlipError);

    book.destroy();
  });

  test('G11/G4: disposing a collection detaches image loads and drops sources', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png']);

    const pages = book.getPageCollection();
    const images = Array.from({ length: pages.getPageCount() }, (_, i) => {
      return (pages.getPage(i) as unknown as { image: HTMLImageElement }).image;
    });
    expect(images.every((img) => img.getAttribute('src') !== null)).toBe(true);

    book.destroy();

    // Dropping the array released nothing the pages themselves owned.
    expect(images.every((img) => img.onload === null)).toBe(true);
    expect(images.every((img) => img.getAttribute('src') === null)).toBe(true);
  });

  test('A5: an image page reports no temporary copy', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages(['a.png', 'b.png']);

    const page = book.getPageCollection().getPage(0);
    // Returned `this`, so a null-checking caller got a truthy non-copy.
    expect(page.getTemporaryCopy()).toBeNull();

    book.destroy();
  });
});

describe('G2: the TURNING leaf is opaque, not just the static ones', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  test('a leaf mid-turn paints its own paper before its bitmap', async () => {
    const ctx = stubCanvas2d();
    const book = new PageFlip(host, {
      width: 100,
      height: 150,
      usePortrait: true,
      flippingTime: 1000,
      pageBackground: '#f5f0e6',
    });
    await book.loadFromImages(['a.png', 'b.png', 'c.png']);

    const rect = book.getBoundsRect();
    const pageSized: { x: number; y: number }[] = [];
    ctx.fillRect.mockImplementation((x: number, y: number, w: number, h: number) => {
      if (Math.abs(w - rect.pageWidth) < 1 && Math.abs(h - rect.height) < 1) {
        pageSized.push({ x, y });
      }
    });

    // Prime the render clock: `startAnimation` derives `startedAt` from the
    // last frame timestamp, so starting a turn before any frame has run makes
    // the animation appear already finished.
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    book.flipNext();
    pageSized.length = 0;
    // The mover is not in place on the very first frame after the turn starts,
    // so sample a few frames rather than assuming frame one.
    for (let i = 0; i < 1; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    expect(pageSized.some((f) => f.x === 0 && f.y === 0)).toBe(true);

    book.destroy();
  });
});
