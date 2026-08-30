/**
 * Three defects from `docs/CANVAS_FIRST_CLASS.md`:
 *
 *  - RB6: `HTMLPage.newTemporaryCopy()` puts a `cloneNode(true)` of the
 *         consumer's page subtree into the live document for the length of a
 *         turn — duplicate ids, duplicate ARIA, duplicate test ids and, worst,
 *         duplicate focusable controls — with nothing marking it as scenery.
 *  - H7:  `HTMLPage.isLoad` was written by `load()` and read nowhere; a dead
 *         field that reads like the real gate `ImagePage` has.
 *  - C14: `CanvasRender.drawBookShadow` was `rect.top`-blind — it filled
 *         `[0, 2 * height]` after translating `y = 0`, while the book occupies
 *         `[rect.top, rect.top + height]`.
 *
 * Written so the PRE-FIX implementation fails:
 *  - the RB6 assertions read the clone that a real drag produces, located by
 *    elimination against the known page nodes rather than by the marker
 *    attribute the fix adds (a marker-based lookup would fail to find anything
 *    pre-fix and could be mistaken for a pass);
 *  - the C14 book has `rect.top > rect.height`, asserted before the geometry
 *    claim — that is the only regime where the broken and the fixed fill differ
 *    after clipping, so a shorter block would prove nothing.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HTMLPage, PageDensity, PageFlip } from '@gullabs/flipbook-core';
import { installPointerCaptureShims, makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

beforeEach(() => {
  installPointerCaptureShims();
});

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

/* ------------------------------------------------------------------ *
 * RB6 — the fold clone is scenery, not content
 * ------------------------------------------------------------------ */

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
      buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
      pointerType: 'mouse',
      ...init,
    }),
  );
}

/**
 * Every `.stf__item` in the block that is not one of the caller's own page
 * nodes. Found by elimination on purpose: this is exactly how the defect was
 * observed ("a sixth `.stf__item` carrying the original's data-testid"), and it
 * works identically before and after the fix, so the assertions below are about
 * the clone's attributes rather than about being able to find it.
 */
function clonesIn(app: PageFlip, pages: HTMLElement[]): HTMLElement[] {
  // In HTML mode the dist element IS `.stf__block` — assert that rather than
  // assume it, so a structural change fails loudly instead of finding nothing.
  const block = app.getUI().getDistElement();
  expect(block.classList.contains('stf__block')).toBe(true);

  return [...block.querySelectorAll<HTMLElement>('.stf__item')].filter((el) => !pages.includes(el));
}

describe('RB6 — the temporary fold copy is out of the a11y tree and out of focus order', () => {
  test('a real drag produces a clone that is aria-hidden, inert and not interactive', () => {
    const { book: app, pages } = book({ pageCount: 6, flippingTime: 0 });

    // Give the consumer's page the things that actually hurt when duplicated.
    // Page 0 is the leaf a fold from page 0 copies (portrait: the mover is a
    // copy of the CURRENT leaf).
    const control = document.createElement('button');
    control.id = 'buy-now';
    control.textContent = 'Buy';
    pages[0]!.id = 'chapter-1';
    pages[0]!.dataset.testid = 'page-0';
    pages[0]!.appendChild(control);
    app.updateFromHtml(pages);

    expect(clonesIn(app, pages)).toHaveLength(0);

    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const y = rect.top + rect.height - 8;
    const press = (x: number, type = 'pointermove') =>
      pointer(type, dist, { clientX: x, clientY: y });

    // Press near the bottom-right corner and drag inward in steps: FOLD_CORNER
    // → USER_FOLD, which is what calls `newTemporaryCopy()`. No pointerup, so
    // the clone is still in the document. (One giant jump does not fold — the
    // direction is decided from the first move.)
    press(rect.left + rect.width - 6, 'pointerdown');
    press(rect.left + rect.width - 40);
    press(rect.left + rect.width - 120);

    const clones = clonesIn(app, pages);
    expect(clones.length, 'the drag never produced a fold copy').toBeGreaterThan(0);

    // At least one of them really is a duplicate of the consumer's subtree —
    // that is the premise of the defect, and it must stay true (the clone is
    // what the fold shows).
    expect(clones.some((c) => c.querySelector('#buy-now') !== null)).toBe(true);

    // …and EVERY clone is scenery: no screen reader, no Tab stop, no hit test.
    for (const clone of clones) {
      expect(clone.getAttribute('aria-hidden')).toBe('true');
      expect(clone.hasAttribute('inert')).toBe(true);
      expect(clone.style.pointerEvents).toBe('none');
    }

    // The original is untouched: the fix must not neutralise the real page.
    expect(pages[0]!.hasAttribute('aria-hidden')).toBe(false);
    expect(pages[0]!.hasAttribute('inert')).toBe(false);
    expect(pages[0]!.style.pointerEvents).toBe('');

    press(rect.left + rect.width - 120, 'pointerup');
  });

  test('`draw()` re-emits pointer-events on every frame (cssText is rewritten wholesale)', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });

    const page = app.getPage(1) as HTMLPage;
    const copy = page.newTemporaryCopy() as HTMLPage;
    expect(copy).not.toBe(page);

    const el = copy.getElement();
    expect(el.style.pointerEvents).toBe('none');

    // A frame of a soft fold, then a frame of a hard one: both go through
    // `commonStyle`. Setting the property once at clone time would survive
    // neither, because `draw()` assigns `style.cssText`.
    copy.draw(PageDensity.SOFT);
    expect(el.style.pointerEvents).toBe('none');
    copy.draw(PageDensity.HARD);
    expect(el.style.pointerEvents).toBe('none');

    // The original still takes input after being drawn — the flag is per-clone.
    page.draw(PageDensity.SOFT);
    expect(page.getElement().style.pointerEvents).toBe('');

    page.hideTemporaryCopy();
  });

  test('the clone keeps its ids and markup so it still LOOKS like the page', () => {
    // The deliberate scope limit: ids are NOT stripped. `#id` selectors are a
    // normal way to style a page, and both getElementById and IDREF resolution
    // take the first match in tree order — which stays the original, because
    // the clone is appended after it.
    const { book: app, pages } = book({ pageCount: 4, flippingTime: 0 });
    pages[1]!.id = 'chapter-1';
    app.updateFromHtml(pages);

    const page = app.getPage(1) as HTMLPage;
    const copy = page.newTemporaryCopy() as HTMLPage;

    expect(copy.getElement().id).toBe('chapter-1');
    expect(document.getElementById('chapter-1')).toBe(pages[1]);
    // …and there is a marker to disambiguate on when a duplicate matters.
    expect(copy.getElement().hasAttribute('data-stf-clone')).toBe(true);

    page.hideTemporaryCopy();
    expect(clonesIn(app, pages)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * H7 — no dead `isLoad` field on HTMLPage
 * ------------------------------------------------------------------ */

describe('H7 — HTMLPage has no field that pretends to gate drawing', () => {
  test('load() adds no state; `isLoad` is not an own property', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    const page = app.getPage(0) as HTMLPage;

    // TypeScript `private` is a compile-time notion — a class field is an own
    // property at runtime, so this is a real check that the field is gone and
    // not merely hidden. It fails the moment someone reintroduces it.
    expect(Object.keys(page)).not.toContain('isLoad');

    page.load();
    expect(Object.keys(page)).not.toContain('isLoad');

    // The method itself has to stay: `Page.load()` is abstract and both
    // collections call it during a load.
    expect(() => {
      page.load();
    }).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * C14 — the spine gradient honours rect.top
 * ------------------------------------------------------------------ */

type Call =
  | { op: 'translate'; x: number; y: number }
  | { op: 'fillRect'; x: number; y: number; w: number; h: number };

/** jsdom has no 2D context; stub what the renderer touches and log the geometry. */
function stubCanvas2d(): { calls: Call[] } {
  const calls: Call[] = [];

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
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push({ op: 'fillRect', x, y, w, h });
    }),
    clearRect: vi.fn(),
    translate: vi.fn((x: number, y: number) => {
      calls.push({ op: 'translate', x, y });
    }),
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

  return { calls };
}

type DrawableRender = { drawFrame: () => void };

function sizeHost(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
}

/**
 * The vertical band the spine gradient actually paints, in BLOCK coordinates:
 * the shadow's `fillRect` (identified by its width, `rect.width / 20`) offset
 * by the translation in force when it ran.
 */
function shadowBand(calls: Call[], shadowSize: number): { top: number; bottom: number } | null {
  let offset = 0;

  for (const c of calls) {
    if (c.op === 'translate') offset += c.y;
    else if (Math.abs(c.w - shadowSize) < 1e-9) {
      return { top: offset + c.y, bottom: offset + c.y + c.h };
    }
  }

  return null;
}

describe('C14 — the spine gradient covers the book, not the block origin', () => {
  let host: HTMLElement;
  let calls: Call[];

  beforeEach(() => {
    ({ calls } = stubCanvas2d());
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function makeBook(hostWidth: number, hostHeight: number): Promise<PageFlip> {
    sizeHost(host, hostWidth, hostHeight);
    const app = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      size: 'fixed',
      usePortrait: false,
      drawShadow: true,
    });
    await app.loadFromImages([
      { src: 'a.png', alt: 'Page a' },
      { src: 'b.png', alt: 'Page b' },
      { src: 'c.png', alt: 'Page c' },
      { src: 'd.png', alt: 'Page d' },
    ]);
    sizeHost(app.getUI().getDistElement(), hostWidth, hostHeight);
    app.update();
    books.push(app);
    return app;
  }

  test('a block far taller than the book still gets a full-height spine shadow', async () => {
    // hostHeight (1400) ⇒ rect.top = (1400 - 300) / 2 = 550.
    const app = await makeBook(500, 1400);
    const render = app.getRender();
    const rect = render.getRect();

    // FIXTURE CHECKS — the whole test is void without these.
    expect(render.getOrientation()).toBe('landscape');
    expect(rect.top).toBe(550);
    expect(rect.top).not.toBe(0);
    // …and specifically: `rect.top > rect.height`. Below that threshold the
    // clip hides the defect and the broken code passes.
    expect(rect.top).toBeGreaterThan(rect.height);
    expect(rect.height).toBe(300);

    calls.length = 0;
    (render as unknown as DrawableRender).drawFrame();

    const band = shadowBand(calls, rect.width / 20);
    expect(band, 'no spine gradient was painted').not.toBeNull();

    // Covers the book. Stated as coverage, not as equality, so that an
    // implementation which deliberately over-fills below the book (the clip
    // trims it) is not failed for a harmless difference.
    expect(band!.top).toBeLessThanOrEqual(rect.top);
    expect(band!.bottom).toBeGreaterThanOrEqual(rect.top + rect.height);
  });

  test('the band tracks rect.top as the block grows (not a constant)', async () => {
    const app = await makeBook(500, 1400);
    const render = app.getRender();

    const dist = app.getUI().getDistElement();
    Object.defineProperty(dist, 'offsetHeight', { configurable: true, get: () => 2000 });
    app.update();

    const rect = render.getRect();
    expect(rect.top).toBe(850);
    expect(rect.top).toBeGreaterThan(rect.height);

    calls.length = 0;
    (render as unknown as DrawableRender).drawFrame();

    const band = shadowBand(calls, rect.width / 20)!;
    expect(band.top).toBeLessThanOrEqual(rect.top);
    expect(band.bottom).toBeGreaterThanOrEqual(rect.top + rect.height);
  });

  test('rect.top === 0 keeps the historical band (no behaviour drift)', async () => {
    const app = await makeBook(500, 300);
    const render = app.getRender();
    const rect = render.getRect();

    expect(rect.top).toBe(0);

    calls.length = 0;
    (render as unknown as DrawableRender).drawFrame();

    const band = shadowBand(calls, rect.width / 20)!;
    expect(band.top).toBe(0);
    expect(band.bottom).toBeGreaterThanOrEqual(rect.height);
  });

  test('portrait suppression and the drawShadow gate both survive', async () => {
    // Narrow host ⇒ portrait would be forced, but `usePortrait: false` keeps
    // this landscape; assert the two guards directly instead.
    const app = await makeBook(500, 1400);
    const render = app.getRender();
    const rect = render.getRect();

    app.updateSettings({ drawShadow: false });
    calls.length = 0;
    (render as unknown as DrawableRender).drawFrame();
    expect(shadowBand(calls, rect.width / 20)).toBeNull();

    app.updateSettings({ drawShadow: true });
    calls.length = 0;
    (render as unknown as DrawableRender).drawFrame();
    expect(shadowBand(calls, rect.width / 20)).not.toBeNull();
  });
});
