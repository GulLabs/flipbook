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
    await book.loadFromImages(['a.png', 'b.png', 'c.png']);
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
    await book.loadFromImages(['a.png', 'b.png']);
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
    await book.loadFromImages(['a.png', 'b.png']);
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
    await expect(book.loadFromImages(['a.png'])).rejects.toThrow(PageFlipError);
    await expect(book.loadFromImages(['a.png'])).rejects.toMatchObject({
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

    await expect(book.loadFromImages(['a.png'])).rejects.toThrow(PageFlipError);
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
    await book.loadFromImages(['gone.png', 'also-gone.png']);

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
    await book.loadFromImages(['a.png', 'b.png']);

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
    await book.loadFromImages(['a.png', 'b.png']);

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
