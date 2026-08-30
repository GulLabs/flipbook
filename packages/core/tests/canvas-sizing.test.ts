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
 * The spy is installed ONCE over a mutable box: re-spying would capture the
 * previous stub as `real` and recurse until the stack blew.
 */
const layout = { width: 0, height: 0 };
let layoutSpyInstalled = false;

function stubLayout(cssWidth: number, cssHeight: number) {
  layout.width = cssWidth;
  layout.height = cssHeight;
  if (layoutSpyInstalled) return;

  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo ?? undefined);
    if (!(el instanceof HTMLCanvasElement)) return style;

    return new Proxy(style, {
      get(target, prop) {
        if (prop === 'getPropertyValue') {
          return (name: string): string => {
            if (name === 'width') return `${String(layout.width)}px`;
            if (name === 'height') return `${String(layout.height)}px`;
            return target.getPropertyValue(name);
          };
        }
        return Reflect.get(target, prop) as unknown;
      },
    });
  });
  layoutSpyInstalled = true;
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
    layoutSpyInstalled = false;
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
