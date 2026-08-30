// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';

/**
 * Canvas defects C8 / C9 / C10 from `docs/CANVAS_FIRST_CLASS.md`.
 *
 * jsdom has no 2D context, so the parts the renderer touches are stubbed — the
 * same shape `canvas-mode.test.ts` uses, kept local so the two files can drift
 * independently.
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

type DrawableRender = { drawFrame: () => void };

/** Give the host (and the engine's own dist element) a measurable box. */
function sizeHost(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
}

describe('C8 — canvas spine shadow honours `drawShadow`', () => {
  let host: HTMLElement;
  let ctx: ReturnType<typeof stubCanvas2d>;

  beforeEach(() => {
    ctx = stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeHost(host, 500, 300);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  async function makeBook(drawShadow: boolean): Promise<PageFlip> {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      usePortrait: false,
      drawShadow,
    });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
      { src: 'd.png', alt: 'Page d' },
    ]);
    sizeHost(book.getUI().getDistElement(), 500, 300);
    book.update();
    return book;
  }

  test('`drawShadow: false` paints no spine gradient at all', async () => {
    const book = await makeBook(false);

    ctx.createLinearGradient.mockClear();
    (book.getRender() as unknown as DrawableRender).drawFrame();

    // The only gradient a static landscape frame can produce is the spine one:
    // the fold shadows need `setShadowData`, which is already gated.
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();

    book.destroy();
  });

  test('`drawShadow: true` still paints it — the guard is a gate, not a deletion', async () => {
    const book = await makeBook(true);

    ctx.createLinearGradient.mockClear();
    (book.getRender() as unknown as DrawableRender).drawFrame();

    expect(ctx.createLinearGradient).toHaveBeenCalled();

    book.destroy();
  });

  test('the setting is read per frame, so `updateSettings` takes effect live', async () => {
    const book = await makeBook(true);

    book.updateSettings({ drawShadow: false });
    ctx.createLinearGradient.mockClear();
    (book.getRender() as unknown as DrawableRender).drawFrame();
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();

    book.updateSettings({ drawShadow: true });
    ctx.createLinearGradient.mockClear();
    (book.getRender() as unknown as DrawableRender).drawFrame();
    expect(ctx.createLinearGradient).toHaveBeenCalled();

    book.destroy();
  });
});

describe('C9 — a disposed ImagePage draws paper, never a loader', () => {
  let host: HTMLElement;
  let ctx: ReturnType<typeof stubCanvas2d>;

  beforeEach(() => {
    ctx = stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeHost(host, 500, 300);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  async function makeBook(): Promise<PageFlip> {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      pageBackground: '#f4ecd8',
    });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);
    sizeHost(book.getUI().getDistElement(), 500, 300);
    book.update();
    return book;
  }

  function placeForDraw(page: ReturnType<PageFlip['getPage']>): void {
    page.setArea([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 0, y: 0 });
    page.setAngle(0);
  }

  test('draw() on a disposed page: paper fill, no arc, no bitmap', async () => {
    const book = await makeBook();
    const page = book.getPage(0);
    placeForDraw(page);

    // Sanity: before disposal this page IS in the loader state (jsdom never
    // loads the image), so the assertion below is about disposal, not about
    // the page having been quiet all along.
    ctx.arc.mockClear();
    page.draw();
    expect(ctx.arc).toHaveBeenCalled();

    page.dispose();

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    ctx.fillRect.mockClear();
    page.draw();

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    // Paper is still painted — a disposed leaf must not become a hole.
    expect(ctx.fillRect).toHaveBeenCalled();

    book.destroy();
  });

  test('simpleDraw() on a disposed page: same rule', async () => {
    const book = await makeBook();
    const page = book.getPage(0);

    ctx.arc.mockClear();
    page.simpleDraw(1);
    expect(ctx.arc).toHaveBeenCalled();

    page.dispose();

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    ctx.fillRect.mockClear();
    page.simpleDraw(1);

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();

    book.destroy();
  });

  test('load() after dispose does not re-arm the page', async () => {
    const book = await makeBook();
    const page = book.getPage(0);
    placeForDraw(page);

    page.dispose();
    page.load();

    ctx.arc.mockClear();
    ctx.drawImage.mockClear();
    page.draw();

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();

    book.destroy();
  });
});

describe('C10 — the loader spinner is a function of time, not of draw count', () => {
  let host: HTMLElement;
  let ctx: ReturnType<typeof stubCanvas2d>;

  beforeEach(() => {
    ctx = stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeHost(host, 500, 300);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  /** Start angle of every `arc()` recorded so far. */
  function arcAngles(): number[] {
    return ctx.arc.mock.calls.map((call) => call[3] as number);
  }

  async function makeLoadingPage(): Promise<{ book: PageFlip; draw: () => void }> {
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
    });
    await book.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
    ]);
    sizeHost(book.getUI().getDistElement(), 500, 300);
    book.update();

    const page = book.getPage(0);
    page.setArea([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ]);
    page.setPosition({ x: 0, y: 0 });
    page.setAngle(0);

    return { book, draw: () => page.draw() };
  }

  test('two draws at the same instant produce the same angle', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1234);
    const { book, draw } = await makeLoadingPage();

    ctx.arc.mockClear();
    // The `newTemporaryCopy() === this` shape: one page drawn twice in one
    // frame. Per-call advancement made the spinner run at double speed.
    draw();
    draw();

    const angles = arcAngles();
    expect(angles).toHaveLength(2);
    expect(angles[1]).toBe(angles[0]);

    clock.mockRestore();
    book.destroy();
  });

  test('the angle advances with the clock, and at the documented rate', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { book, draw } = await makeLoadingPage();

    ctx.arc.mockClear();
    draw();
    clock.mockReturnValue(100); // 0.1s
    draw();
    clock.mockReturnValue(200); // 0.2s
    draw();

    const [a0, a1, a2] = arcAngles() as [number, number, number];

    // Not frozen: a fix that simply hardcoded 0 would fail here.
    expect(a1).toBeGreaterThan(a0);
    expect(a2).toBeGreaterThan(a1);
    // Equal time steps give equal angular steps — a per-call counter cannot,
    // because it does not know how much time passed.
    expect(a2 - a1).toBeCloseTo(a1 - a0, 6);
    // ~4.2 rad/s, i.e. the old 0.07 rad/frame at 60fps.
    expect(a1 - a0).toBeCloseTo(0.42, 6);

    clock.mockRestore();
    book.destroy();
  });

  test('the angle stays inside [0, 2π) as the clock runs on', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { book, draw } = await makeLoadingPage();

    ctx.arc.mockClear();
    for (const t of [0, 900, 1_500, 60_000, 3_600_000]) {
      clock.mockReturnValue(t);
      draw();
    }

    for (const angle of arcAngles()) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }

    clock.mockRestore();
    book.destroy();
  });

  test('drawing does not mutate page state: replaying a frame repeats it', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(500);
    const { book, draw } = await makeLoadingPage();

    ctx.arc.mockClear();
    draw();
    const first = arcAngles()[0];

    // Twenty intervening draws at other times must leave no residue.
    for (let i = 1; i <= 20; i++) {
      clock.mockReturnValue(500 + i * 37);
      draw();
    }

    clock.mockReturnValue(500);
    ctx.arc.mockClear();
    draw();

    expect(arcAngles()[0]).toBe(first);

    clock.mockRestore();
    book.destroy();
  });
});
