// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';

/**
 * B1/B2 — canvas backing-store sizing.
 *
 * Two defects Codex found in the first version of this code, both of which the
 * original e2e assertions could not see:
 *
 *  - the area cap was written as `Math.max(1, min(raw, 3, areaCap))`, so the
 *    floor overrode the cap in exactly the case the cap exists for;
 *  - the measurement moved to `getBoundingClientRect()`, which is
 *    transform-AWARE, while `Render` measures with `offsetWidth`, which is not.
 *
 * The DPR-2 e2e probe cannot discriminate either: over-filling is harmless, and
 * a scale above 1 never exercises the under-fill path. These do.
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

/**
 * jsdom has no layout, so the computed box is what the engine will read.
 *
 * `ORIGINAL_GET_COMPUTED_STYLE` is captured at MODULE LOAD, before any spy can
 * exist. An earlier version captured it inside `stubLayout` and guarded
 * double-install with a module flag, which recursed to a stack overflow when
 * another test file had already spied on the shared jsdom window — the flag
 * said "installed" while `real` pointed at someone else's spy. The shared
 * mutable box also leaked between tests. Both were reproduced.
 */
const ORIGINAL_GET_COMPUTED_STYLE = window.getComputedStyle.bind(window);

function stubLayout(cssWidth: number, cssHeight: number) {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = ORIGINAL_GET_COMPUTED_STYLE(el, pseudo ?? undefined);
    if (!(el instanceof HTMLCanvasElement)) return style;

    return new Proxy(style, {
      get(target, prop) {
        if (prop === 'getPropertyValue') {
          return (name: string): string => {
            if (name === 'width') return `${String(cssWidth)}px`;
            if (name === 'height') return `${String(cssHeight)}px`;
            return target.getPropertyValue(name);
          };
        }
        return Reflect.get(target, prop) as unknown;
      },
    });
  });
}

function backing(host: HTMLElement) {
  const canvas = host.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
  return { w: canvas.width, h: canvas.height };
}

const MAX_BACKING_PIXELS = 8_388_608;

describe('canvas backing store is capped by AREA, not by a DPR floor', () => {
  let host: HTMLElement;

  beforeEach(() => {
    stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    host.remove();
  });

  test('a book larger than the cap renders BELOW 1:1 rather than over it', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    stubLayout(6000, 4000);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    const { w, h } = backing(host);

    // `Math.max(1, ...)` used to floor the scale here, allowing 24M backing
    // pixels against a stated 8.4M ceiling. On iOS, exceeding the limit does
    // not degrade — the canvas comes back blank.
    expect(w * h).toBeLessThanOrEqual(MAX_BACKING_PIXELS * 1.01);
    expect(w).toBeLessThan(6000);
    expect(w).toBeGreaterThan(0);

    book.destroy();
  });

  test('a phone still gets its full 3x — the cap is not a blanket ceiling', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    stubLayout(390, 700);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    const { w, h } = backing(host);

    // A 390x700 phone at 3x is 2.5M pixels — cheaper than a desktop at 2x. A
    // flat DPR cap would refuse quality exactly where it is cheapest.
    expect(w).toBe(Math.ceil(390 * 3));
    expect(h).toBe(Math.ceil(700 * 3));

    book.destroy();
  });

  test('an ordinary 2x desktop book is sized for the display', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    stubLayout(800, 600);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    expect(backing(host)).toEqual({ w: 1600, h: 1200 });

    book.destroy();
  });

  test('a fractional layout box is not truncated', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    stubLayout(800.5, 600.25);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    // `parseInt` threw the fraction away, leaving an unpainted sub-pixel strip.
    expect(backing(host)).toEqual({ w: 801, h: 601 });

    book.destroy();
  });

  test('a hidden book allocates nothing and recovers', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    stubLayout(0, 0);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    expect(backing(host)).toEqual({ w: 0, h: 0 });

    // `PageFlip.update()` only refreshes the render; the UI owns the backing
    // store, and it is `UI.update()` that the ResizeObserver drives.
    stubLayout(800, 600);
    book.getUI().update();

    expect(backing(host)).toEqual({ w: 1600, h: 1200 });

    book.destroy();
  });

  test('the cap holds even where the scale falls below 0.1', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    stubLayout(30000, 30000);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    const { w, h } = backing(host);

    // A 0.1 floor was the SECOND version of this bug: areaCap here is 0.0965,
    // the floor picked 0.1, and the result was 9.0M against an 8.39M ceiling.
    // A floor and an absolute cap are contradictory claims; the cap wins.
    expect(w * h).toBeLessThanOrEqual(MAX_BACKING_PIXELS * 1.01);
    expect(w).toBeGreaterThan(0);

    book.destroy();
  });

  test('the DRAWING scale follows the layout box, not the visual box', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    stubLayout(800, 600);

    // A `transform: scale(.5)` ancestor halves the visual box.
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 300,
      top: 0,
      left: 0,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const ctx = stubCanvas2d();
    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    // Assert what the RENDERER applies, not what the UI reports — an earlier
    // version of this test read the UI's own method and therefore could not see
    // the renderer deriving its scale somewhere else entirely.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const calls = ctx.setTransform.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // Deriving the scale from the visual box gives 800/400 = 2, while the
    // render geometry stays in layout pixels — content drawn at twice the
    // intended scale and clipped. Fixing the ALLOCATION alone left this live.
    const [a, , , d] = calls[calls.length - 1] as number[];
    expect(a).toBeCloseTo(1, 5);
    expect(d).toBeCloseTo(1, 5);

    book.destroy();
  });

  test('measurement uses the LAYOUT box, so a scaled ancestor cannot skew it', async () => {
    vi.stubGlobal('devicePixelRatio', 1);
    stubLayout(800, 600);

    // A transform-aware measurement would report the visual box here and size
    // the backing store for it, while `Render` kept measuring the book with
    // `offsetWidth` — transform-blind — and the two would disagree.
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 300,
      top: 0,
      left: 0,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const book = new PageFlip(host, { width: 400, height: 300 });
    await book.loadFromImages(['a.png', 'b.png']);

    // The visual box says 400x300; the layout box says 800x600. The backing
    // store must follow the LAYOUT box, because that is what `Render` measures.
    expect(backing(host)).toEqual({ w: 800, h: 600 });

    book.destroy();
  });
});
