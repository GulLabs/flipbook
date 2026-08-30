/**
 * Three defects from the first-class audit, all in the DOM-facing half of the
 * engine: U3/I14 (pointer coordinate space), U4 (dead `handlersBound` state)
 * and X8 (`z-index:;` emitted on every frame).
 *
 * The bar these are written to, because nine non-discriminating tests have
 * already been caught in this repo:
 *
 *  - **U3/I14 fixtures use a scale that is NOT 1.** At scale 1 the broken and
 *    the fixed conversion are byte-for-byte identical, which is precisely why
 *    this survived two rounds of the same fix landing next door in the canvas
 *    path. Every scaled fixture asserts that the visual box and the layout box
 *    actually differ BEFORE it asserts anything about a pointer.
 *  - The origin of the block is deliberately non-zero (`originX`/`originY`), so
 *    a variant that divides before subtracting the origin — the obvious wrong
 *    order — cannot pass.
 *  - Both a scale below 1 and a scale above 1 are covered, so multiplying where
 *    the fix divides fails in both directions rather than looking plausible.
 *  - One fixture is non-uniform (`scale(0.5, 0.8)`), so collapsing the two axes
 *    into one ratio fails.
 *  - X8's assertion reads the string that is WRITTEN, not the string the CSSOM
 *    hands back: the whole point of the defect is that the parser silently
 *    discards the malformed declaration, so reading `cssText` back cannot see
 *    it and a test that did would pass against the bug.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HTMLPage, PageFlip } from '@gullabs/flipbook-core';
import type { Point } from '@gullabs/flipbook-core';
import { installPointerCaptureShims, makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

beforeEach(() => {
  installPointerCaptureShims();
});

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  vi.restoreAllMocks();
});

/** Landscape, spread [2,3], symmetric 200 px halves — real geometry both sides of the spine. */
function landscapeBook(opts: Parameters<typeof makeHtmlBook>[0] = {}): PageFlip {
  const b = makeHtmlBook({
    pageCount: 6,
    flippingTime: 0,
    startPage: 2,
    usePortrait: false,
    hostWidth: 500,
    ...opts,
  });
  books.push(b);
  return b.book;
}

type Transform = { scaleX: number; scaleY: number; originX: number; originY: number };

const IDENTITY: Transform = { scaleX: 1, scaleY: 1, originX: 0, originY: 0 };

/**
 * Put the book inside a `transform: scale()` ancestor.
 *
 * jsdom performs no layout, so the transform is modelled where it is actually
 * observable: `getBoundingClientRect()` is transform-AWARE and reports the
 * VISUAL box, while `offsetWidth`/`offsetHeight` are transform-BLIND and keep
 * reporting the LAYOUT box. That split IS the defect, and the fixture leaves
 * `offsetWidth` exactly as `makeHtmlBook` set it so `Render`'s geometry is
 * untouched — only the pointer's view of the element moves.
 */
function applyAncestorScale(app: PageFlip, t: Transform): void {
  const el = app.getUI().getDistElement();
  const layoutWidth = el.offsetWidth;
  const layoutHeight = el.offsetHeight;

  el.getBoundingClientRect = () =>
    ({
      x: t.originX,
      y: t.originY,
      left: t.originX,
      top: t.originY,
      width: layoutWidth * t.scaleX,
      height: layoutHeight * t.scaleY,
      right: t.originX + layoutWidth * t.scaleX,
      bottom: t.originY + layoutHeight * t.scaleY,
      toJSON() {
        return {};
      },
    }) as DOMRect;
}

/** Client (visual) coordinates of a point expressed in the block's LAYOUT space. */
function toClient(p: Point, t: Transform): Point {
  return { x: t.originX + p.x * t.scaleX, y: t.originY + p.y * t.scaleY };
}

function pointer(
  type: string,
  target: EventTarget,
  init: PointerEventInit & { clientX: number; clientY: number },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerType: 'mouse',
      ...init,
    }),
  );
}

/**
 * Press at the layout-space point `p` and report the point the engine received.
 *
 * The spy calls through, so the engine really starts the touch — this observes
 * the conversion at the boundary it feeds, it does not replace it.
 */
function pressAt(app: PageFlip, p: Point, t: Transform): Point {
  const spy = vi.spyOn(app, 'startUserTouch');
  const c = toClient(p, t);

  pointer('pointerdown', app.getUI().getDistElement(), { clientX: c.x, clientY: c.y });

  expect(spy).toHaveBeenCalledTimes(1);

  const call = spy.mock.calls[0];
  if (call === undefined) throw new Error('startUserTouch was not called');
  return call[0];
}

/** Book-global point `inset` px inside the named outer edge (layout space). */
function edgePoint(app: PageFlip, edge: 'left' | 'right', inset: number): Point {
  const rect = app.getBoundsRect();

  return {
    x: edge === 'left' ? rect.left + inset : rect.left + rect.width - inset,
    y: rect.top + 20,
  };
}

/**
 * Drag from the very outer edge to `p`, and report how far the fold opened.
 *
 * `PageFlip.userMove` requires 5 px of travel before it folds, so the gesture
 * starts 1 px inside the edge and ends at `p`. `Flip.fold` is a function of the
 * CURRENT point only, so the progress reported is the progress at `p` — both
 * endpoints are given in layout space and converted through `t`, which is the
 * whole point of the comparison.
 */
function foldProgressAt(
  app: PageFlip,
  edge: 'left' | 'right',
  inset: number,
  t: Transform,
): number {
  const dist = app.getUI().getDistElement();
  const from = toClient(edgePoint(app, edge, 1), t);
  const to = toClient(edgePoint(app, edge, inset), t);

  pointer('pointerdown', dist, { clientX: from.x, clientY: from.y });
  pointer('pointermove', dist, { clientX: to.x, clientY: to.y });

  const calc = app.getFlipController()?.getCalculation();
  if (!calc) throw new Error('drag did not open a fold');
  return calc.getFlippingProgress();
}

// ---------------------------------------------------------------------------
// U3 / I14
// ---------------------------------------------------------------------------

describe('the fixture really is scaled (precondition for everything below)', () => {
  test('visual box and layout box differ under a scaled ancestor, and agree without one', () => {
    const t: Transform = { scaleX: 0.5, scaleY: 0.5, originX: 120, originY: 37 };
    const app = landscapeBook();
    const el = app.getUI().getDistElement();

    // Baseline: the fixture as `makeHtmlBook` leaves it has scale 1, where a
    // broken and a correct conversion are indistinguishable.
    expect(el.getBoundingClientRect().width).toBe(el.offsetWidth);

    applyAncestorScale(app, t);

    expect(el.offsetWidth).toBe(500);
    expect(el.getBoundingClientRect().width).toBe(250);
    expect(el.getBoundingClientRect().width).not.toBe(el.offsetWidth);
    expect(el.getBoundingClientRect().height).not.toBe(el.offsetHeight);
    // And `Render` is still measuring the layout box — the other half of the
    // mismatch. If this ever stops being true the defect is somewhere else.
    expect(app.getRender().getBlockWidth()).toBe(500);
    expect(app.getBoundsRect()).toEqual({
      left: 50,
      top: 0,
      width: 400,
      height: 300,
      pageWidth: 200,
    });
  });
});

describe('pointer coordinates are converted into the space Render measures (U3/I14)', () => {
  test('a press at a known layout point arrives as that layout point, at scale 0.5', () => {
    const t: Transform = { scaleX: 0.5, scaleY: 0.5, originX: 120, originY: 37 };
    const app = landscapeBook();
    applyAncestorScale(app, t);

    const target = { x: 420, y: 60 };
    const got = pressAt(app, target, t);

    expect(got.x).toBeCloseTo(420, 6);
    expect(got.y).toBeCloseTo(60, 6);
  });

  test('and at scale 1.6 — a magnifying ancestor, not just a shrinking one', () => {
    const t: Transform = { scaleX: 1.6, scaleY: 1.6, originX: -40, originY: 12 };
    const app = landscapeBook();
    applyAncestorScale(app, t);

    const got = pressAt(app, { x: 420, y: 60 }, t);

    expect(got.x).toBeCloseTo(420, 6);
    expect(got.y).toBeCloseTo(60, 6);
  });

  test('the two axes are derived independently: scale(0.5, 0.8)', () => {
    const t: Transform = { scaleX: 0.5, scaleY: 0.8, originX: 90, originY: 25 };
    const app = landscapeBook();
    applyAncestorScale(app, t);

    const got = pressAt(app, { x: 420, y: 240 }, t);

    expect(got.x).toBeCloseTo(420, 6);
    expect(got.y).toBeCloseTo(240, 6);
  });

  test('scale 1 is untouched — the unscaled path must not move', () => {
    const app = landscapeBook();
    const got = pressAt(app, { x: 420, y: 60 }, IDENTITY);

    expect(got).toEqual({ x: 420, y: 60 });
  });

  test('a hidden book (0×0) falls back to 1:1 instead of dividing by zero', () => {
    const app = landscapeBook();
    const el = app.getUI().getDistElement();

    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 0 });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => 0 });
    el.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const got = pressAt(app, { x: 42, y: 17 }, IDENTITY);

    expect(Number.isFinite(got.x)).toBe(true);
    expect(Number.isFinite(got.y)).toBe(true);
    expect(got).toEqual({ x: 42, y: 17 });
  });

  test('the fold opens the same amount under a scaled ancestor as without one', () => {
    // The behavioural half: identical PHYSICAL point on the book, compared
    // against the unscaled book. Insets are all well short of the half-way
    // mark so "equal" cannot mean "both pinned at 100".
    const t: Transform = { scaleX: 0.5, scaleY: 0.5, originX: 120, originY: 37 };

    for (const inset of [30, 80, 150]) {
      for (const edge of ['left', 'right'] as const) {
        const plain = landscapeBook();
        const scaled = landscapeBook();
        applyAncestorScale(scaled, t);

        const a = foldProgressAt(plain, edge, inset, IDENTITY);
        const b = foldProgressAt(scaled, edge, inset, t);

        expect(b, `${edge} @${inset}`).toBeCloseTo(a, 6);
        expect(a, `${edge} @${inset}`).toBeLessThan(50);
        expect(a, `${edge} @${inset}`).toBeGreaterThan(0);
      }
    }
  });

  test('a drag keeps tracking the finger under scale: pointermove converts too', () => {
    const t: Transform = { scaleX: 0.5, scaleY: 0.5, originX: 120, originY: 37 };
    const plain = landscapeBook();
    const scaled = landscapeBook();
    applyAncestorScale(scaled, t);

    const progressAfterDrag = (app: PageFlip, tr: Transform): number => {
      const dist = app.getUI().getDistElement();
      const start = edgePoint(app, 'right', 10);
      const mid = { x: start.x - 90, y: start.y + 15 };
      const c0 = toClient(start, tr);
      const c1 = toClient(mid, tr);

      pointer('pointerdown', dist, { clientX: c0.x, clientY: c0.y });
      pointer('pointermove', dist, { clientX: c1.x, clientY: c1.y });

      const calc = app.getFlipController()?.getCalculation();
      if (!calc) throw new Error('drag did not open a fold');
      return calc.getFlippingProgress();
    };

    const a = progressAfterDrag(plain, IDENTITY);
    const b = progressAfterDrag(scaled, t);

    expect(a).toBeGreaterThan(20);
    expect(a).toBeLessThan(80);
    expect(b).toBeCloseTo(a, 6);
  });

  test('swipe distance is measured in layout px, so the threshold means the same thing', () => {
    // `swipeDistance` is compared against a delta produced by `getMousePos`.
    // In visual pixels a 120 px drag under `scale(0.5)` measures 60 and misses
    // an 80 px threshold — the same gesture that works unscaled does nothing
    // inside a zoom-to-fit shell.
    const t: Transform = { scaleX: 0.5, scaleY: 0.5, originX: 120, originY: 37 };
    const app = landscapeBook({ swipeDistance: 80 });
    applyAncestorScale(app, t);

    const dist = app.getUI().getDistElement();
    const spy = vi.spyOn(app, 'flipNext');
    const start = { x: 300, y: 150 };
    const end = { x: 180, y: 152 };
    const c0 = toClient(start, t);
    const c1 = toClient(end, t);

    pointer('pointerdown', dist, { clientX: c0.x, clientY: c0.y });
    pointer('pointerup', dist, { clientX: c1.x, clientY: c1.y });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// U4
// ---------------------------------------------------------------------------

describe('the dead handler-bound flag is gone (U4)', () => {
  test('neither the field nor the accessor exists on a live UI', () => {
    // A deletion has no behaviour to observe, so the assertion is structural —
    // and made at RUNTIME rather than by grepping the source, so it is about
    // the shipped object rather than about a spelling. TypeScript's `private`
    // is erased: `private handlersBound = false` is a plain own property on
    // every instance, and `protected get handlersAreBound()` is a plain
    // accessor on the prototype. Both are visible from here, so both can be
    // asserted absent — including the half-deletion that drops only the getter.
    const ui = landscapeBook().getUI();

    expect(Object.getOwnPropertyNames(ui)).not.toContain('handlersBound');

    const protoNames: string[] = [];
    for (
      let o: object | null = Object.getPrototypeOf(ui) as object | null;
      o !== null && o !== Object.prototype;
      o = Object.getPrototypeOf(o) as object | null
    ) {
      protoNames.push(...Object.getOwnPropertyNames(o));
    }

    // Sanity: the walk really did reach the UI class, or "absent" means nothing.
    expect(protoNames).toContain('refreshHandlers');
    expect(protoNames).not.toContain('handlersAreBound');
    expect(protoNames).not.toContain('handlersBound');
  });

  test('why it was misleading: dragstart is bound even with useMouseEvents:false', () => {
    // The flag was only ever set inside the `useMouseEvents` branch, so it read
    // `false` in exactly the configuration where a handler IS bound (X7). A
    // reader added later would have been told the opposite of the truth.
    const app = landscapeBook({ useMouseEvents: false });
    const dist = app.getUI().getDistElement();

    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    dist.dispatchEvent(drag);

    expect(drag.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// X8
// ---------------------------------------------------------------------------

/**
 * Record every string ASSIGNED to `element.style.cssText`.
 *
 * Reading `cssText` back is useless here: the CSSOM parses on assignment and
 * silently drops the malformed `z-index:;` declaration, so the getter reports
 * a clean string whether or not the bug is present. Only the written string
 * witnesses it.
 */
function captureCssTextWrites(el: HTMLElement): string[] {
  const writes: string[] = [];

  // The accessor can sit anywhere on the chain (jsdom puts it on
  // `CSSStyleDeclaration.prototype`, two hops up from the instance).
  let desc: PropertyDescriptor | undefined;
  for (let o: object | null = el.style; o !== null; o = Object.getPrototypeOf(o) as object | null) {
    desc = Object.getOwnPropertyDescriptor(o, 'cssText');
    if (desc) break;
  }
  if (!desc?.get || !desc.set) throw new Error('cssText is not an accessor here');

  Object.defineProperty(el.style, 'cssText', {
    configurable: true,
    get: () => desc.get?.call(el.style) as string,
    set: (value: string) => {
      writes.push(value);
      desc.set?.call(el.style, value);
    },
  });

  return writes;
}

describe('no invalid `z-index:;` declaration is emitted (X8)', () => {
  test('a leaf with no inline z-index gets no z-index declaration at all', () => {
    const app = landscapeBook();
    const page = app.getPage(2) as HTMLPage;
    const el = page.getElement();

    el.style.removeProperty('z-index');
    expect(el.style.zIndex).toBe('');

    const writes = captureCssTextWrites(el);
    page.draw();

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain('z-index:;');
    expect(writes[0]).not.toContain('z-index');
    // The rest of the declaration block is untouched — this is not "drop the
    // whole style", it is "drop one empty declaration".
    expect(writes[0]).toContain('display:block;');
    expect(writes[0]).toContain('width:200px;');
  });

  test('a leaf that DOES have an inline z-index still round-trips it', () => {
    // The interpolation exists because `draw()` replaces `cssText` wholesale
    // and would otherwise erase what `HTMLRender` just stamped. Removing the
    // declaration unconditionally would be the obvious wrong fix.
    const app = landscapeBook();
    const page = app.getPage(2) as HTMLPage;
    const el = page.getElement();

    el.style.zIndex = '17';
    const writes = captureCssTextWrites(el);
    page.draw();

    expect(writes[0]).toContain('z-index:17;');
    expect(el.style.zIndex).toBe('17');
  });

  test('the temporary fold copy — an engine-built leaf — is clean too', () => {
    // The clone is the leaf that is drawn on every frame of a turn, and it
    // inherits the original's inline style, so a page that never carried a
    // z-index produces a clone that never carries one either.
    const app = landscapeBook();
    const page = app.getPage(2) as HTMLPage;

    page.getElement().style.removeProperty('z-index');

    const copy = page.newTemporaryCopy() as HTMLPage;
    expect(copy).not.toBe(page);
    expect(copy.getElement().style.zIndex).toBe('');

    const writes = captureCssTextWrites(copy.getElement());
    copy.draw();

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain('z-index');
    // The clone's own re-emitted declaration is still there — this fix must not
    // take the `pointer-events:none` with it.
    expect(writes[0]).toContain('pointer-events:none;');

    page.hideTemporaryCopy();
  });
});
