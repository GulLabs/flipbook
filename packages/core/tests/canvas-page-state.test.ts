// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';

/**
 * `ImagePage` resource state, and the context-stack discipline around it.
 *
 * jsdom has no 2D context, so the calls the renderer makes are recorded on a
 * stub — the same shape the neighbouring canvas suites use. What that stub can
 * honestly prove is WHICH call was made (`arc` = loader, `drawImage` = bitmap,
 * `fillRect` = paper) and in what order, never what any of them painted; the
 * pixel claims live in `e2e/canvas.spec.ts`.
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

type Drawable = {
  draw: () => void;
  simpleDraw: (orient: number) => void;
  setArea: (area: { x: number; y: number }[]) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setAngle: (a: number) => void;
  newTemporaryCopy: () => Drawable;
  load: () => void;
  dispose: () => void;
};

/** The page's own `HTMLImageElement`. Private; the G11/G4 test reaches for it too. */
function imageOf(page: unknown): HTMLImageElement {
  return (page as { image: HTMLImageElement }).image;
}

/** What the browser does when a bitmap arrives: the element fires `load`. */
function arrive(img: HTMLImageElement): void {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 10 });
  img.dispatchEvent(new Event('load'));
}

function placeForDraw(page: Drawable): void {
  page.setArea([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 150 },
    { x: 0, y: 150 },
  ]);
  page.setPosition({ x: 0, y: 0 });
  page.setAngle(0);
}

describe('a temporary copy borrows the origin’s load state, not a snapshot of it', () => {
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

  async function makeBook(): Promise<PageFlip> {
    const book = new PageFlip(host, { width: 100, height: 150, usePortrait: true });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
    ]);
    return book;
  }

  test('a copy made mid-decode paints the bitmap once the origin’s image arrives', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    // The turn starts while the image is still decoding — the copy is made
    // here, which is what `getPortraitFlippingPage` does on every portrait
    // flip, in both directions.
    const copy = page.newTemporaryCopy();
    expect(copy).not.toBe(page); // soft leaf: a real second state, not `this`

    arrive(imageOf(page));

    placeForDraw(copy);
    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    copy.draw();

    // Was: the copy snapshotted `isLoad === false` at construction and
    // `newTemporaryCopy()` caches it, so this leaf's fold spun a loader for the
    // rest of the session while the leaf beneath it showed the picture.
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();

    book.destroy();
  });

  test('a copy of a still-decoding page paints the loader, not an empty bitmap', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    const copy = page.newTemporaryCopy();
    placeForDraw(copy);

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    copy.draw();

    // The other direction of the same mistake: "copies are always loaded"
    // would draw an undecoded bitmap — a blank leaf with no sign it is coming.
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();

    book.destroy();
  });

  test('a copy made after the image arrived still paints it', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    arrive(imageOf(page));

    const copy = page.newTemporaryCopy();
    placeForDraw(copy);

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    copy.draw();

    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();

    book.destroy();
  });

  test('once the origin is disposed its copy is paper — no bitmap, no loader', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    arrive(imageOf(page));
    const copy = page.newTemporaryCopy();
    placeForDraw(copy);

    // `dispose()` drops `src`, which puts the element in the *broken* state.
    // `drawImage` on a broken image is specified to throw `InvalidStateError`,
    // and a loader would promise a bitmap that is never coming.
    page.dispose();

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    ctx.fillRect.mockClear();
    copy.draw();

    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    // Paper is still painted: a released leaf must not become a hole.
    expect(ctx.fillRect).toHaveBeenCalled();

    book.destroy();
  });

  test('`load()` on a copy does not steal the origin’s handler', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    const copy = page.newTemporaryCopy();
    copy.load();

    arrive(imageOf(page));

    placeForDraw(page);
    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    page.draw();

    // Both pages share ONE element, so an `onload` armed by the copy would
    // replace the origin's and leave the real leaf loading forever.
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();

    book.destroy();
  });

  test('the same rule holds for the static path', async () => {
    const book = await makeBook();
    const page = book.getPage(0) as unknown as Drawable;

    const copy = page.newTemporaryCopy();
    arrive(imageOf(page));

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    copy.simpleDraw(1);

    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();

    book.destroy();
  });
});

describe('an ImagePage leaves the context stack as it found it', () => {
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

  async function loadedPage(): Promise<{ book: PageFlip; page: Drawable }> {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);
    const page = book.getPage(0) as unknown as Drawable;
    arrive(imageOf(page));
    placeForDraw(page);
    return { book, page };
  }

  /**
   * The condition is real, not hypothetical: `drawImage` throws
   * `InvalidStateError` for an image element in the broken state.
   */
  function throwingDrawImage(): void {
    ctx.drawImage.mockImplementation(() => {
      throw new DOMException('broken image', 'InvalidStateError');
    });
  }

  test('draw(): a throwing bitmap still restores', async () => {
    const { book, page } = await loadedPage();
    throwingDrawImage();

    ctx.save.mockClear();
    ctx.restore.mockClear();

    expect(() => {
      page.draw();
    }).toThrow();

    // Unbalanced, the ENCLOSING frame's `restore()` pops this save instead of
    // its own, so the frame's base transform and the portrait clip leak into
    // every later frame — G1, arrived at from the other end.
    expect(ctx.restore.mock.calls.length).toBe(ctx.save.mock.calls.length);

    book.destroy();
  });

  test('simpleDraw(): same rule, and it had no bracket at all', async () => {
    const { book, page } = await loadedPage();
    throwingDrawImage();

    ctx.save.mockClear();
    ctx.restore.mockClear();

    expect(() => {
      page.simpleDraw(1);
    }).toThrow();

    expect(ctx.restore.mock.calls.length).toBe(ctx.save.mock.calls.length);
    expect(ctx.save.mock.calls.length).toBeGreaterThan(0);

    book.destroy();
  });

  test('simpleDraw() brackets the pen it sets, even when nothing throws', async () => {
    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);
    const page = book.getPage(0) as unknown as Drawable;

    ctx.save.mockClear();
    ctx.restore.mockClear();

    // Still decoding, so this goes through `drawLoader`, which sets
    // `strokeStyle` and `lineWidth: 10` on the shared context.
    page.simpleDraw(1);

    expect(ctx.save.mock.calls.length).toBe(1);
    expect(ctx.restore.mock.calls.length).toBe(1);

    book.destroy();
  });
});

describe('canvas construction failures are typed', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  test('a refused 2D context rejects with PageFlipError(RENDER_SETUP)', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const book = new PageFlip(host, { width: 100, height: 150 });

    // A browser refuses a 2D context once too many live contexts exist. A bare
    // `Error` here could not be told from a consumer's own by `err.code`, while
    // its neighbour on this very path already rejects with `CANVAS_LOAD`.
    await expect(book.loadFromImages([{ src: 'a.png', alt: 'Page a' }])).rejects.toThrow(
      PageFlipError,
    );
    await expect(book.loadFromImages([{ src: 'a.png', alt: 'Page a' }])).rejects.toMatchObject({
      code: 'RENDER_SETUP',
    });
  });

  test('a canvas element stripped from the wrapper rejects with PageFlipError(RENDER_SETUP)', async () => {
    stubCanvas2d();

    // What a Trusted Types policy or a DOM sanitizer does to the `innerHTML`
    // that builds this element.
    const real = Element.prototype.querySelector;
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === 'canvas' ? null : real.call(this, selector);
    } as typeof Element.prototype.querySelector);

    const book = new PageFlip(host, { width: 100, height: 150 });

    await expect(book.loadFromImages([{ src: 'a.png', alt: 'Page a' }])).rejects.toThrow(
      PageFlipError,
    );
  });
});

/**
 * BH-1 / BH-2 — a leaf that will never arrive must stop promising it will.
 *
 * Reported by an independent bug hunt. The loader arc is a promise that
 * something is coming; for a 404, a decode failure or a CORS refusal, nothing
 * is.
 */
describe('BH-1 / BH-2 — a failed image stops the loader', () => {
  /** An `<img>` that is already `complete` with no bitmap: a cached failure. */
  function settledFailure(): void {
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 0,
    });
  }

  function restoreImage(): void {
    for (const prop of ['complete', 'naturalWidth']) {
      delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[prop];
    }
  }

  test('a cached 404 paints paper, not the loader, forever', async () => {
    const ctx = stubCanvas2d();
    settledFailure();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages([
      { src: 'gone.png', alt: 'Page gone' },
      { src: 'also-gone.png', alt: 'Page also-gone' },
    ]);

    ctx.arc.mockClear();
    ctx.fillRect.mockClear();
    book.getRender().update();
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // Reverted fix: `load()` saw `complete && naturalWidth === 0`, did NOT
    // return, and armed an `onload` that can never fire for an image the
    // browser has already settled — so the leaf spun for the life of the
    // session. The loader is drawn with `arc`; paper is a `fillRect`.
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();

    // And it must not be drawn as an IMAGE either. `drawImage` on an element in
    // the broken state is specified to throw `InvalidStateError`, so treating a
    // failed page as loaded trades a spinner for an exception out of the render
    // loop. A variant that returned 'image' instead of 'paper' passed the two
    // assertions above — the loader still isn't drawn and the paper fill still
    // happens before the bitmap — so this is the line that separates them.
    expect(ctx.drawImage).not.toHaveBeenCalled();

    book.destroy();
    host.remove();
    restoreImage();
  });

  test('a `load` event with a zero-size bitmap is a failure, not a success', async () => {
    stubCanvas2d();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);

    const page = book.getPageCollection().getPage(0) as unknown as {
      image: HTMLImageElement;
      isLoad: boolean;
      failed: boolean;
    };

    Object.defineProperty(page.image, 'naturalWidth', { configurable: true, get: () => 0 });
    page.image.onload?.(new Event('load'));

    // Reverted fix: `isLoad = true` unconditionally, so a decode that fires
    // `load` with no bitmap was drawn as a SUCCESSFUL page — an empty
    // `drawImage` producing a blank leaf beside siblings that look fine, with
    // nothing anywhere reporting it.
    expect(page.isLoad).toBe(false);
    expect(page.failed).toBe(true);

    book.destroy();
    host.remove();
  });

  test('a real bitmap still loads — the guard is not a blanket failure', async () => {
    stubCanvas2d();

    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 100, height: 150 });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);

    const page = book.getPageCollection().getPage(0) as unknown as {
      image: HTMLImageElement;
      isLoad: boolean;
      failed: boolean;
    };

    Object.defineProperty(page.image, 'naturalWidth', { configurable: true, get: () => 800 });
    page.image.onload?.(new Event('load'));

    expect(page.isLoad).toBe(true);
    expect(page.failed).toBe(false);

    book.destroy();
    host.remove();
  });
});

/**
 * Phase 2 — fit modes (A3), blank leaves, per-leaf background (G2) and the
 * broken-image glyph (partial A4).
 *
 * The *geometry* of a fit is proved on numbers in `canvas-image-fit.test.ts`;
 * what is proved here is the WIRING — which fit a leaf resolves, which
 * arguments reach `drawImage`, and which of the four draw states a leaf is in.
 * Neither file can prove a pixel: that the letterbox is actually filled with
 * paper, that `cover` does not bleed across the spine, and that the glyph is
 * legible are `e2e/canvas.spec.ts` claims.
 */
describe('Phase 2 — how a leaf is drawn', () => {
  let host: HTMLElement;
  let ctx: ReturnType<typeof stubCanvas2d>;

  /** Give the host a measurable box, as the neighbouring canvas suites do. */
  function sizeHost(el: HTMLElement, width: number, height: number): void {
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
  }

  beforeEach(() => {
    ctx = stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeHost(host, 400, 300);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  /** A landscape book whose leaf rect is exactly 200 × 300, asserted below. */
  async function makeBook(
    leaves: readonly unknown[],
    settings: Record<string, unknown> = {},
  ): Promise<PageFlip> {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      usePortrait: false,
      flippingTime: 0,
      ...settings,
    } as ConstructorParameters<typeof PageFlip>[1]);

    await book.loadFromImages(leaves as Parameters<PageFlip['loadFromImages']>[0]);
    sizeHost(book.getUI().getDistElement(), 400, 300);
    book.update();

    return book;
  }

  /** A bitmap that has decoded at a known intrinsic size. */
  function arriveWith(page: unknown, naturalWidth: number, naturalHeight: number): void {
    const img = (page as { image: HTMLImageElement }).image;
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: naturalWidth });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: naturalHeight });
    img.dispatchEvent(new Event('load'));
  }

  function place(page: ReturnType<PageFlip['getPage']>): void {
    page.setArea([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 0, y: 0 });
    page.setAngle(0);
  }

  /**
   * `draw()` translates by the page position and then draws at `(0, 0)`, so the
   * arguments `drawImage` receives ARE the destination rect. That is what makes
   * an exact assertion possible without a real canvas.
   */
  function lastDrawImage(): unknown[] {
    const calls = ctx.drawImage.mock.calls as unknown as unknown[][];
    return calls[calls.length - 1] ?? [];
  }

  function destArgs(): number[] {
    const call = lastDrawImage();
    return call.slice(call.length === 9 ? 5 : 1) as number[];
  }

  /** Every `fillStyle` in force at the moment a `fillRect` was issued. */
  function recordPaper(): string[] {
    const seen: string[] = [];
    ctx.fillRect.mockImplementation(() => {
      seen.push(ctx.fillStyle);
    });
    return seen;
  }

  test('the fixture really is a 200 × 300 leaf — everything below depends on it', async () => {
    const book = await makeBook([
      { src: 'a.png', alt: 'a' },
      { src: 'b.png', alt: 'b' },
    ]);

    expect(book.getRender().getRect().pageWidth).toBe(200);
    expect(book.getRender().getRect().height).toBe(300);

    book.destroy();
  });

  describe('fit modes', () => {
    test('the default is `contain` — a 4:1 bitmap is letterboxed, not stretched', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();

      // Was: `drawImage(img, 0, 0, pageWidth, pageHeight)` unconditionally —
      // i.e. an implicit `fill`, which distorts every bitmap whose ratio is not
      // the leaf's, silently. scale = min(200/400, 300/100) = 0.5.
      expect(destArgs()).toEqual([0, 125, 200, 50]);

      book.destroy();
    });

    test('`fit: "fill"` restores the legacy stretch, per leaf', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a', fit: 'fill' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();

      expect(destArgs()).toEqual([0, 0, 200, 300]);

      book.destroy();
    });

    test('`fit: "cover"` crops the source, so `drawImage` takes nine arguments', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a', fit: 'cover' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();

      const call = lastDrawImage();
      // Five arguments would mean the destination was made oversized instead,
      // and the fold clip — which is the folded PAGE shape, not the leaf rect —
      // would let it bleed across the spine mid-turn.
      expect(call).toHaveLength(9);
      // Source: the widest 2:3 sub-rect of a 400 × 100 bitmap is 66.66 × 100.
      expect(call[3] as number).toBeCloseTo(200 / 3, 9);
      expect(call[4]).toBe(100);
      expect(call.slice(5)).toEqual([0, 0, 200, 300]);

      book.destroy();
    });

    test('the BOOK-level `imageFit` is read at draw time, so it can change live', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();
      expect(destArgs()).toEqual([0, 125, 200, 50]);

      // `getSettings()` hands back the LIVE settings object, which is exactly
      // how `updateSettings` reaches the renderer. Caching the fit on the page
      // at construction is the `swipeDistance` bug — a setting that silently
      // ignores every runtime update (CLAUDE.md).
      (book.getSettings() as unknown as { imageFit: string }).imageFit = 'fill';

      ctx.drawImage.mockClear();
      page.draw();
      expect(destArgs()).toEqual([0, 0, 200, 300]);

      book.destroy();
    });

    test('a per-leaf `fit` beats the book setting', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a', fit: 'contain' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      (book.getSettings() as unknown as { imageFit: string }).imageFit = 'fill';

      ctx.drawImage.mockClear();
      page.draw();

      expect(destArgs()).toEqual([0, 125, 200, 50]);

      book.destroy();
    });

    test('`inset` is a fraction of page WIDTH, on all four edges', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a', fit: 'fill', inset: 0.1 },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();

      // 0.1 × 200 = 20 on every edge. A pixel inset, or one that resolved the
      // vertical pad against height, would put y at 30 here.
      expect(destArgs()).toEqual([20, 20, 160, 260]);

      book.destroy();
    });

    test('the same leaf keeps its proportional inset when the book is resized', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a', fit: 'fill', inset: 0.1 },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      arriveWith(page, 400, 100);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();
      expect(destArgs()).toEqual([20, 20, 160, 260]);

      // Half the book. A pixel inset would still be 20px here — a 20% margin on
      // a 100px leaf where the consumer asked for 10%.
      book.updateSettings({ width: 100, height: 150 });
      sizeHost(book.getUI().getDistElement(), 200, 150);
      book.update();
      expect(book.getRender().getRect().pageWidth).toBe(100);

      ctx.drawImage.mockClear();
      page.draw();
      expect(destArgs()).toEqual([10, 10, 80, 130]);

      book.destroy();
    });

    test('a bitmap of unknown intrinsic size falls back to the leaf, not to NaN', async () => {
      const book = await makeBook([
        { src: 'a.png', alt: 'a' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      // `naturalHeight` stays 0 — what jsdom reports, and what a decoded-but-
      // unmeasured bitmap looks like.
      arriveWith(page, 400, 0);
      place(page);

      ctx.drawImage.mockClear();
      page.draw();

      expect(destArgs()).toEqual([0, 0, 200, 300]);
      for (const value of destArgs()) expect(Number.isNaN(value)).toBe(false);

      book.destroy();
    });
  });

  describe('blank leaves', () => {
    test('a blank leaf paints paper only — no loader, ever', async () => {
      const book = await makeBook([
        { blank: true, alt: '' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      place(page);

      ctx.arc.mockClear();
      ctx.drawImage.mockClear();
      ctx.fillRect.mockClear();
      page.draw();

      // A blank leaf modelled as "an image that has not loaded" spins the
      // loader arc forever — BH-1 reached from the other end. It is a leaf, not
      // a pending resource.
      expect(ctx.arc).not.toHaveBeenCalled();
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled();

      book.destroy();
    });

    test('its neighbour still loads — blankness is per leaf, not a mode', async () => {
      const book = await makeBook([
        { blank: true, alt: '' },
        { src: 'b.png', alt: 'b' },
      ]);
      const image = book.getPage(1);
      place(image);

      ctx.arc.mockClear();
      image.draw();

      expect(ctx.arc).toHaveBeenCalled();

      book.destroy();
    });

    test('a blank leaf issues no request and can never enter the failed state', async () => {
      const book = await makeBook([
        { blank: true, alt: '' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0) as unknown as {
        image: HTMLImageElement | null;
        failed: boolean;
        load: () => void;
      };

      expect(page.image).toBeNull();

      page.load();
      page.load();

      expect(page.failed).toBe(false);

      book.destroy();
    });

    test('the temporary copy of a blank leaf is blank too', async () => {
      const book = await makeBook(
        [
          { blank: true, alt: '' },
          { blank: true, alt: '' },
        ],
        {
          usePortrait: true,
        },
      );
      const page = book.getPage(0);
      const copy = page.newTemporaryCopy() as ReturnType<PageFlip['getPage']>;
      place(copy);

      ctx.arc.mockClear();
      ctx.drawImage.mockClear();
      copy.draw();

      expect(ctx.arc).not.toHaveBeenCalled();
      expect(ctx.drawImage).not.toHaveBeenCalled();

      book.destroy();
    });

    test('disposing a blank leaf is a no-op, not a crash', async () => {
      const book = await makeBook([
        { blank: true, alt: '' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      place(page);

      expect(() => {
        page.dispose();
      }).not.toThrow();

      ctx.fillRect.mockClear();
      page.draw();
      expect(ctx.fillRect).toHaveBeenCalled();

      book.destroy();
    });
  });

  describe('per-leaf background', () => {
    test('a leaf paints its own paper colour, not the book’s', async () => {
      const book = await makeBook(
        [
          { src: 'a.png', alt: 'a', background: '#123456' },
          { src: 'b.png', alt: 'b' },
        ],
        { pageBackground: '#f4ecd8' },
      );
      const page = book.getPage(0);
      place(page);

      const paper = recordPaper();
      page.draw();

      expect(paper).toContain('#123456');
      expect(paper).not.toContain('#f4ecd8');

      book.destroy();
    });

    test('a leaf without one inherits the book’s', async () => {
      const book = await makeBook(
        [
          { src: 'a.png', alt: 'a' },
          { src: 'b.png', alt: 'b' },
        ],
        { pageBackground: '#f4ecd8' },
      );
      const page = book.getPage(0);
      place(page);

      const paper = recordPaper();
      page.draw();

      expect(paper).toContain('#f4ecd8');

      book.destroy();
    });

    test('the static path uses the same colour as the fold', async () => {
      const book = await makeBook(
        [
          { src: 'a.png', alt: 'a', background: '#123456' },
          { src: 'b.png', alt: 'b' },
        ],
        { pageBackground: '#f4ecd8' },
      );
      const page = book.getPage(0);

      const paper = recordPaper();
      page.simpleDraw(1);

      // A fold that letterboxed in a different colour from the leaf underneath
      // it would be visible on every single turn.
      expect(paper).toContain('#123456');
      expect(paper).not.toContain('#f4ecd8');

      book.destroy();
    });

    /**
     * Build one leaf directly, past the descriptor validator.
     *
     * Deliberate: `validateCanvasLeaves` rejects these at the public boundary,
     * so the only way to exercise `ImagePage`'s own second line of defence is
     * to go around it — and it needs one, because the page is constructible
     * from anywhere inside the engine.
     */
    function leafPage(
      book: PageFlip,
      leaf: unknown,
    ): { draw: () => void; setArea: ReturnType<PageFlip['getPage']>['setArea'] } {
      const Ctor = (book.getPage(0) as object).constructor as new (
        render: unknown,
        leaf: unknown,
        density: string,
      ) => ReturnType<PageFlip['getPage']>;

      const page = new Ctor(book.getRender(), leaf, 'soft');
      place(page);
      return page;
    }

    test.each([
      // Opaque? No. This is the `isOpaquePageBackground` job — a see-through
      // leaf reveals the page beneath, the §4.2 bug `pageBackground` exists to
      // prevent.
      ['rgba(1, 2, 3, 0.5)'],
      ['#11223344'],
      ['transparent'],
      // Opaque, but not a colour the sanitiser will emit. This is the
      // `safePageBackground` job, and it is a DIFFERENT question — collapsing
      // the two is how a translucent fold shipped once already (CLAUDE.md).
      ['red; background: url(evil)'],
      ['color-mix(in srgb, red, blue)'],
    ])('a refused override (%s) falls back to the BOOK’s paper, not to #fff', async (value) => {
      const book = await makeBook(
        [
          { src: 'a.png', alt: 'a' },
          { src: 'b.png', alt: 'b' },
        ],
        { pageBackground: '#f4ecd8' },
      );

      const page = leafPage(book, { src: 'a.png', alt: 'a', background: value });

      const paper = recordPaper();
      page.draw();

      // "Override absent" and "override rejected" have to land in the same
      // place, and that place is the book's own paper colour. Landing on the
      // engine default instead would repaint a cream book white on exactly the
      // pages whose descriptor was wrong.
      expect(paper).toContain('#f4ecd8');
      expect(paper).not.toContain('#fff');
      expect(paper).not.toContain(value);

      book.destroy();
    });

    test('an accepted override really does reach the fold — the guard is not a blanket refusal', async () => {
      const book = await makeBook(
        [
          { src: 'a.png', alt: 'a' },
          { src: 'b.png', alt: 'b' },
        ],
        { pageBackground: '#f4ecd8' },
      );

      const page = leafPage(book, { src: 'a.png', alt: 'a', background: 'rgb(1, 2, 3)' });

      const paper = recordPaper();
      page.draw();

      expect(paper).toContain('rgb(1, 2, 3)');

      book.destroy();
    });
  });

  describe('the broken-image glyph', () => {
    /** Settle an image as a failure the way a 404 does. */
    function fail(page: unknown): void {
      const img = (page as { image: HTMLImageElement }).image;
      Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 0 });
      img.onerror?.(new Event('error'));
    }

    async function failedPage(): Promise<{
      book: PageFlip;
      page: ReturnType<PageFlip['getPage']>;
    }> {
      const book = await makeBook([
        { src: 'gone.png', alt: 'gone' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      place(page);
      fail(page);
      return { book, page };
    }

    test('a failed leaf draws a mark — it is not silently blank', async () => {
      const { book, page } = await failedPage();

      ctx.stroke.mockClear();
      ctx.lineTo.mockClear();
      ctx.drawImage.mockClear();
      page.draw();

      // Paper alone made "this image failed" pixel-identical to "this leaf is
      // deliberately blank" — which is now a real, supported thing.
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
      expect(ctx.drawImage).not.toHaveBeenCalled();

      book.destroy();
    });

    test('the glyph uses no `arc`, so the loader stays distinguishable', async () => {
      const { book, page } = await failedPage();

      ctx.arc.mockClear();
      page.draw();

      // Every canvas suite in this repo tells "still loading" from anything
      // else by `arc`. A glyph drawn with arcs would make that discriminator
      // ambiguous and the existing tests would go quietly blind — including
      // BH-1's, which is the reason the spinner stops at all.
      expect(ctx.arc).not.toHaveBeenCalled();

      book.destroy();
    });

    test('a blank leaf draws NO glyph — the two must not look alike', async () => {
      const book = await makeBook([
        { blank: true, alt: '' },
        { src: 'b.png', alt: 'b' },
      ]);
      const page = book.getPage(0);
      place(page);

      ctx.stroke.mockClear();
      page.draw();

      expect(ctx.stroke).not.toHaveBeenCalled();

      book.destroy();
    });

    test('the glyph is deterministic — no clock, no drift between two draws', async () => {
      const { book, page } = await failedPage();

      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);

      ctx.lineTo.mockClear();
      page.draw();
      const first = ctx.lineTo.mock.calls.map((c) => c.join(','));

      clock.mockReturnValue(9_999);
      ctx.lineTo.mockClear();
      page.draw();
      const second = ctx.lineTo.mock.calls.map((c) => c.join(','));

      // Same C10 rule as the loader: a page is routinely drawn twice in one
      // frame, and drawing must not mutate state.
      expect(second).toEqual(first);
      expect(first.length).toBeGreaterThan(0);

      clock.mockRestore();
      book.destroy();
    });

    test('a disposed failed leaf drops back to paper — no glyph on a released page', async () => {
      const { book, page } = await failedPage();

      page.dispose();

      ctx.stroke.mockClear();
      ctx.fillRect.mockClear();
      page.draw();

      expect(ctx.stroke).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled();

      book.destroy();
    });

    test('the temporary copy of a failed leaf shows the glyph too', async () => {
      const book = await makeBook(
        [
          { src: 'gone.png', alt: 'gone' },
          { src: 'b.png', alt: 'b' },
        ],
        { usePortrait: true },
      );
      const page = book.getPage(0);
      fail(page);

      const copy = page.newTemporaryCopy() as ReturnType<PageFlip['getPage']>;
      place(copy);

      ctx.stroke.mockClear();
      ctx.arc.mockClear();
      copy.draw();

      // The fold and the leaf beneath it must agree about what happened.
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.arc).not.toHaveBeenCalled();

      book.destroy();
    });
  });
});
