// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';
import type { CanvasLeaf } from '@gullabs/flipbook-core';
// Type-only, and therefore erased: importing the CLASS here would be fine in a
// test but is exactly what `index.ts` must not do, so the test reaches it the
// same way a consumer will once the type is re-exported.
import type { CanvasAltSource } from '../src/Collection/ImagePageCollection';

/**
 * Phase 2, Decision 1 (`docs/adr/0001-image-page-api.md`): `loadFromImages`
 * takes leaf DESCRIPTORS, blank leaves are a first-class variant, and a
 * DECLARED `density` beats the structural inference in `createSpread`.
 *
 * Everything here is written against the public surface plus the collection,
 * deliberately: the traps recorded in `docs/CANVAS_FIRST_CLASS.md` are all
 * "the fixture skipped the path", and the shortest way to skip this path is to
 * assert on a spy instead of on the state the engine actually ended up in.
 * `getDensity()` and `getAltText()` are that state.
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

/** jsdom lays everything out at 0x0; the render measures the dist element. */
function sizeElement(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
}

/** The `alt` accessor the semantic mirror is built from. Duck-typed on purpose:
 *  `ImagePageCollection` lives in the lazy canvas chunk and is not exported
 *  from the package index, so `instanceof` would drag the chunk into the eager
 *  graph. */
function alts(book: PageFlip): CanvasAltSource {
  return book.getPageCollection() as unknown as CanvasAltSource;
}

const img = (src: string, extra: Partial<CanvasLeaf> = {}): CanvasLeaf =>
  ({ src, alt: `Page ${src}`, ...extra }) as CanvasLeaf;

describe('canvas leaves — descriptors, blanks, density and alt', () => {
  let host: HTMLElement;

  beforeEach(() => {
    stubCanvas2d();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 520, 300);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  function newBook(extra: Record<string, unknown> = {}): PageFlip {
    return new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      flippingTime: 0,
      ...extra,
    });
  }

  // ---------------------------------------------------------------- descriptors

  test('the descriptor `src` is what the page actually requests', async () => {
    const book = newBook();
    await book.loadFromImages([img('first.png'), img('second.png')]);

    // Not a spy on `Image`: what matters is the element the page ends up
    // holding. A collection that built pages from the right COUNT of leaves but
    // dropped the descriptor would pass every count assertion in this file.
    const page = book.getPage(0) as unknown as { image: HTMLImageElement };

    expect(page.image.src).toMatch(/first\.png$/);

    book.destroy();
  });

  test('a blank leaf is still a leaf: it occupies a page and a spread', async () => {
    const book = newBook({ usePortrait: false });

    await book.loadFromImages([
      { blank: true, alt: '' },
      img('a.png'),
      img('b.png'),
      { blank: true, alt: '' },
    ]);

    expect(book.getPageCount()).toBe(4);
    // Landscape, no cover: two spreads of two. A blank leaf that was skipped
    // rather than built would leave one spread and shift every page index.
    expect(book.getPageCollection().getSpreadCount()).toBe(2);

    book.destroy();
  });

  test('a blank leaf paints paper and no bitmap, beside an image leaf that does', async () => {
    // The jsdom trap this dodges: no image ever loads here, so `drawImage` is
    // never called for ANY leaf and "blank draws no bitmap" would pass against
    // a collection that built a normal image page for the blank descriptor.
    // Forcing the decode state is what makes the assertion discriminate — the
    // control below is the half that proves it.
    const proto = HTMLImageElement.prototype;
    const saved = (['complete', 'naturalWidth'] as const).map(
      (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
    );
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 40 });
    // Prototype patches are not mocks and `restoreAllMocks` will not undo them;
    // leaving them set would silently change every later test in this file.
    onTestFinished(() => {
      for (const [k, d] of saved) if (d) Object.defineProperty(proto, k, d);
    });

    const ctx = stubCanvas2d();
    const book = newBook({ usePortrait: false });

    await book.loadFromImages([{ blank: true, alt: '' }, img('a.png')]);
    sizeElement(book.getUI().getDistElement(), 520, 300);
    book.update();

    ctx.drawImage.mockClear();
    ctx.fillRect.mockClear();
    (book.getRender() as unknown as { drawFrame: () => void }).drawFrame();

    // Control: the image leaf DID draw, so the stub works and the frame ran.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    // …and both leaves painted paper.
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThanOrEqual(2);

    book.destroy();
  });

  // ------------------------------------------------------------------- density

  test('a declared `soft` survives the showCover cover inference', async () => {
    const book = newBook({ showCover: true, usePortrait: false });

    await book.loadFromImages([
      // An inside cover that is deliberately paper. `createSpread` hardens leaf
      // 0 unconditionally under `showCover`; the descriptor says otherwise and
      // the descriptor wins, or it is lying.
      { blank: true, alt: '', density: 'soft' },
      img('a.png'),
      img('b.png'),
    ]);

    expect(book.getPage(0).getDensity()).toBe('soft');
    expect(book.getPage(0).getDrawingDensity()).toBe('soft');

    book.destroy();
  });

  test('a declared `soft` survives the terminal-singleton inference too', async () => {
    // 4 leaves with `showCover`: spreads are [0], [1,2], [3] — so leaf 3 is a
    // terminal singleton and `createSpread` hardens it. This is the SECOND
    // inference site; a fix applied to the cover alone passes the test above
    // and fails this one.
    const book = newBook({ showCover: true, usePortrait: false });

    await book.loadFromImages([
      img('cover.png'),
      img('a.png'),
      img('b.png'),
      img('back.png', { density: 'soft' }),
    ]);

    expect(book.getPage(3).getDensity()).toBe('soft');

    book.destroy();
  });

  test('a declared `hard` is applied where no inference would have put one', async () => {
    const book = newBook({ usePortrait: false });

    await book.loadFromImages([
      img('a.png'),
      img('b.png', { density: 'hard' }),
      img('c.png'),
      img('d.png'),
    ]);

    // No `showCover`, not terminal: nothing structural hardens leaf 1, so this
    // can only come from the descriptor.
    expect(book.getPage(1).getDensity()).toBe('hard');
    // …and the leaves that declared nothing are left to the inference.
    expect(book.getPage(0).getDensity()).toBe('soft');
    expect(book.getPage(3).getDensity()).toBe('soft');

    book.destroy();
  });

  test('the inference is untouched for leaves that declare nothing', async () => {
    // The negative control for the two tests above: if "declared wins" were
    // implemented by dropping the inference entirely, both would still pass and
    // this one would not.
    const book = newBook({ showCover: true, usePortrait: false });

    await book.loadFromImages([img('cover.png'), img('a.png'), img('b.png'), img('back.png')]);

    expect(book.getPage(0).getDensity()).toBe('hard');
    expect(book.getPage(3).getDensity()).toBe('hard');

    book.destroy();
  });

  test('density declared on the descriptor holds from the first frame, before createSpread', async () => {
    const book = newBook({ usePortrait: false });

    await book.loadFromImages([img('a.png', { density: 'hard' }), img('b.png')]);

    // `getDrawingDensity` is what the renderer reads per frame. Applying the
    // declaration only after `createSpread` and never at construction would
    // still pass `getDensity` (setDensity writes both) — this asserts the pair
    // agree, which is the thing a half-applied fix breaks.
    expect(book.getPage(0).getDensity()).toBe('hard');
    expect(book.getPage(0).getDrawingDensity()).toBe('hard');

    book.destroy();
  });

  test('updateFromImages carries declared density into the replacement collection', async () => {
    const book = newBook({ showCover: true, usePortrait: false });
    await book.loadFromImages([img('a.png'), img('b.png'), img('c.png')]);

    await book.updateFromImages([
      { blank: true, alt: '', density: 'soft' },
      img('x.png'),
      img('y.png'),
    ]);

    expect(book.getPage(0).getDensity()).toBe('soft');

    book.destroy();
  });

  // ----------------------------------------------------------------------- alt

  test('every leaf’s alt is retrievable, and `""` is preserved as an answer', async () => {
    const book = newBook();

    await book.loadFromImages([
      { src: 'a.png', alt: 'The fox at the gate' },
      { blank: true, alt: '' },
      { src: 'b.png', alt: '' },
    ]);

    expect(alts(book).getAltTexts()).toEqual(['The fox at the gate', '', '']);
    expect(alts(book).getAltText(0)).toBe('The fox at the gate');
    // `''` is a deliberate decorative assertion, not a missing value.
    expect(alts(book).getAltText(1)).toBe('');

    book.destroy();
  });

  test('`undefined` and `""` are different answers and both survive', async () => {
    // THE alt test. `alt` no longer throws when it is missing (it warns), so
    // the distinction between "the author said decorative" and "the author said
    // nothing" now has to be carried all the way out to the caller — ADR 0001:
    // absence is UNKNOWN, never decorative. A `?? ''` anywhere on this path
    // collapses the two and silently mutes a page carrying the story.
    const book = newBook();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await book.loadFromImages([
      { src: 'a.png', alt: '' },
      { src: 'b.png' } as unknown as CanvasLeaf,
      { src: 'c.png', alt: 'The fox crosses the river' },
    ]);

    const list = alts(book).getAltTexts();

    expect(list[0]).toBe('');
    expect(list[1]).toBeUndefined();
    expect(list[2]).toBe('The fox crosses the river');
    // `toEqual` treats a hole and an `undefined` alike, so pin the shape too.
    expect(Object.prototype.hasOwnProperty.call(list, 1)).toBe(true);

    expect(alts(book).getAltText(0)).toBe('');
    expect(alts(book).getAltText(1)).toBeUndefined();

    warn.mockRestore();
    book.destroy();
  });

  test('a blank leaf answers `""`, not `undefined`, even with no alt written', async () => {
    // `blank: true` IS the decorative assertion — `canvasLeaf.ts` says so, and
    // says it carries strictly more than `alt: ''`. If a blank pad answered
    // `undefined`, the caller could not tell it from an unlabelled image leaf
    // and would read a positional "Page 7" over every parity pad, which is the
    // noise `BlankPageSource.alt?: ''` exists to prevent.
    const book = newBook();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await book.loadFromImages([{ blank: true }, { blank: true, alt: '' }, img('a.png')]);

    expect(alts(book).getAltText(0)).toBe('');
    expect(alts(book).getAltText(1)).toBe('');
    // …and a blank leaf is not an authoring mistake, so it must not warn.
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
    book.destroy();
  });

  test('an out-of-range alt index throws INVALID_PAGE, matching getPage', async () => {
    const book = newBook();
    await book.loadFromImages([img('a.png'), img('b.png')]);

    expect(() => alts(book).getAltText(2)).toThrow(PageFlipError);
    expect(() => alts(book).getAltText(2)).toThrowError(/Invalid page index 2/);
    expect(() => alts(book).getAltText(-1)).toThrow(PageFlipError);

    book.destroy();
  });

  test('the alt text is reachable from the public surface, with no cast', async () => {
    // The whole point of `getPageAltText`. Before it, the only route to the
    // descriptors was `getPageCollection() as unknown as CanvasAltSource` —
    // a cast through an unexported class in the lazy chunk — so canvas mode
    // shipped an accessibility story no consumer could actually implement.
    //
    // Written WITHOUT the `alts()` helper on purpose: the helper performs the
    // very cast this API exists to remove, so using it here would test the old
    // route and pass no matter what the new one does.
    const book = newBook();
    await book.loadFromImages([
      { src: 'a.png', alt: 'The fox at the gate' },
      { src: 'b.png' } as unknown as CanvasLeaf,
      { blank: true },
    ]);

    expect(book.getPageAltText(0)).toBe('The fox at the gate');
    // Three-valued, and the three stay distinct through the public accessor:
    // `undefined` is "nobody said", `''` is "decorative". A `?? ''` anywhere on
    // this path silently declares the unlabelled leaf decorative.
    expect(book.getPageAltText(1)).toBeUndefined();
    expect(book.getPageAltText(2)).toBe('');
    expect(book.getPageAltTexts()).toEqual(['The fox at the gate', undefined, '']);

    book.destroy();
  });

  test('the alt accessors reject HTML mode rather than answering for it', () => {
    // An HTML page is a real element the consumer labelled themselves, so there
    // is no engine-held answer to give. Answering `undefined` would look
    // identical to "this canvas leaf has no label" and send a binding down the
    // positional-fallback path for a book that never needed one.
    const htmlHost = document.createElement('div');
    document.body.appendChild(htmlHost);
    sizeElement(htmlHost, 520, 300);

    const book = new PageFlip(htmlHost, { width: 200, height: 300, flippingTime: 0 });
    const pages = [0, 1].map(() => document.createElement('div'));
    for (const p of pages) htmlHost.appendChild(p);
    book.loadFromHTML(pages);

    expect(() => book.getPageAltText(0)).toThrow(PageFlipError);
    expect(() => book.getPageAltTexts()).toThrow(PageFlipError);

    let code = 'NO_THROW';
    try {
      book.getPageAltText(0);
    } catch (error) {
      code = (error as PageFlipError).code;
    }
    expect(code).toBe('WRONG_MODE');

    book.destroy();
    htmlHost.remove();
  });

  test('getAltTexts hands back a copy, not the descriptor list', async () => {
    const book = newBook();
    await book.loadFromImages([img('a.png')]);

    const first = alts(book).getAltTexts() as (string | undefined)[];
    first[0] = 'clobbered';

    expect(alts(book).getAltText(0)).toBe('Page a.png');

    book.destroy();
  });

  test('updateFromImages replaces the alt list with the new one', async () => {
    const book = newBook();
    await book.loadFromImages([img('a.png'), img('b.png')]);

    await book.updateFromImages([{ src: 'x.png', alt: 'New art' }]);

    expect(alts(book).getAltTexts()).toEqual(['New art']);

    book.destroy();
  });

  // ---------------------------------------------------------------- validation

  test('a bare string list rejects, and builds nothing', async () => {
    const book = newBook();

    await expect(
      // The 2.x call, exactly as a migrating consumer would write it.
      book.loadFromImages(['a.png', 'b.png'] as unknown as CanvasLeaf[]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    // Nothing was attached: no canvas in the host, and the getters still say
    // NOT_LOADED. A validation that ran after `attachMode` would leave a book.
    expect(host.querySelector('canvas')).toBeNull();
    expect(() => book.getRender()).toThrow(PageFlipError);

    book.destroy();
  });

  test('a leaf missing `alt` still loads the book — it warns, it does not reject', async () => {
    // The trade this replaced: an eager throw turned "page 12 has a poor
    // accessible name" into "nobody gets a book". A missing label is a real
    // defect and it is reported, but it is not worth the product.
    const book = newBook();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      book.loadFromImages([{ src: 'a.png' } as unknown as CanvasLeaf, img('b.png')]),
    ).resolves.toBeUndefined();

    expect(book.getPageCount()).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    book.destroy();
  });

  test('the missing-alt warning is once per BOOK, not once per leaf', async () => {
    // Five identical console lines is how a real warning gets scrolled past and
    // then filtered out, so the count is the assertion, not the text. The
    // message still has to name the offending indices, or it is unactionable.
    const book = newBook();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await book.loadFromImages(
      ['a', 'b', 'c', 'd', 'e'].map((n) => ({ src: `${n}.png` }) as unknown as CanvasLeaf),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/0, 1, 2, 3, 4/);
    expect(alts(book).getAltTexts()).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    warn.mockRestore();
    book.destroy();
  });

  test('a bare string is still a THROW, and says so by name', async () => {
    // The bare-string branch used to sit below the object check, which made it
    // unreachable — every string fell into "expected a descriptor object". The
    // one message written for the most likely 2.x migration mistake has to be
    // the one a migrating consumer actually sees.
    const book = newBook();

    await expect(book.loadFromImages(['a.png'] as unknown as CanvasLeaf[])).rejects.toThrowError(
      /bare URL strings are no longer accepted/,
    );

    book.destroy();
  });

  test('an invalid list does NOT supersede the book already on screen', async () => {
    const book = newBook();
    await book.loadFromImages([img('a.png'), img('b.png'), img('c.png')]);

    const render = book.getRender();

    await expect(
      book.loadFromImages(['nope.png'] as unknown as CanvasLeaf[]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    // Weak on its own — see the next test, which is the one that discriminates.
    expect(book.getPageCount()).toBe(3);
    expect(book.getRender()).toBe(render);
    expect(alts(book).getAltTexts()).toHaveLength(3);

    book.destroy();
  });

  test('an invalid list does not cancel a load already in flight', async () => {
    // THE test for validation ordering, and the reason the one above is not it.
    //
    // `nextGeneration()` does not touch the book on screen — it invalidates
    // loads that have not landed yet. So "the live book survives" passes
    // whether validation runs before or after the bump (measured: it does), and
    // only a load caught mid-import can tell the two apart. The canvas chunk is
    // a dynamic import, so `pending` is exactly that until it is awaited.
    const book = newBook();
    const pending = book.loadFromImages([img('a.png'), img('b.png'), img('c.png')]);

    await expect(
      book.loadFromImages(['nope.png'] as unknown as CanvasLeaf[]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    await pending;

    // Validating after `nextGeneration()` leaves this at NOT_LOADED forever:
    // the good load was superseded by a list that never built anything, so the
    // consumer gets a rejected promise AND no book.
    expect(book.getPageCount()).toBe(3);
    expect(alts(book).getAltTexts()).toHaveLength(3);

    book.destroy();
  });

  test('the same holds for updateFromImages', async () => {
    const book = newBook();
    await book.loadFromImages([img('a.png'), img('b.png')]);

    await expect(
      // `density` — still a throwing check. `alt` deliberately is not any more.
      book.updateFromImages([{ blank: true, density: 'papery' } as unknown as CanvasLeaf]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    expect(book.getPageCount()).toBe(2);
    expect(alts(book).getAltTexts()).toEqual(['Page a.png', 'Page b.png']);

    book.destroy();
  });

  test('an invalid updateFromImages does not cancel a load in flight either', async () => {
    const book = newBook();
    const pending = book.loadFromImages([img('a.png'), img('b.png'), img('c.png')]);

    await expect(
      book.updateFromImages(['nope.png'] as unknown as CanvasLeaf[]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    await pending;

    expect(book.getPageCount()).toBe(3);

    book.destroy();
  });

  test('a translucent per-leaf background rejects — a see-through fold is the G2 bug', async () => {
    const book = newBook();

    await expect(
      book.loadFromImages([img('a.png', { background: 'rgba(255,255,255,0.5)' })]),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE_SOURCE' });

    book.destroy();
  });

  test('a destroyed engine still no-ops rather than validating', async () => {
    const book = newBook();
    book.destroy();

    // The destroy contract is that mutating lifecycle calls are no-ops. A
    // no-op that inspects its argument and can still reject is not one.
    await expect(
      book.loadFromImages(['a.png'] as unknown as CanvasLeaf[]),
    ).resolves.toBeUndefined();
  });
});

/**
 * Ordering, proven the only way it can be: with a canvas chunk that cannot
 * load. If validation ran after the import, the error a consumer would see for
 * a bad descriptor list is `CANVAS_LOAD` — a network story for a typo — and the
 * `CanvasUI` constructor would already have mutated the host.
 */
describe('canvas leaves — validation happens before the chunk is fetched', () => {
  let host: HTMLElement;

  beforeEach(() => {
    stubCanvas2d();
    vi.doMock('../src/canvas-loader', () => {
      throw new Error('chunk 404');
    });
    vi.resetModules();
    host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 520, 300);
  });

  afterEach(() => {
    vi.doUnmock('../src/canvas-loader');
    vi.resetModules();
    vi.restoreAllMocks();
    host.remove();
  });

  test('control: a VALID list on a broken chunk reports CANVAS_LOAD', async () => {
    const book = new PageFlip(host, { width: 200, height: 300 });

    await expect(book.loadFromImages([img('a.png')])).rejects.toMatchObject({
      code: 'CANVAS_LOAD',
    });

    book.destroy();
  });

  test('an INVALID list on the same broken chunk reports INVALID_IMAGE_SOURCE', async () => {
    const book = new PageFlip(host, { width: 200, height: 300 });

    await expect(book.loadFromImages(['a.png'] as unknown as CanvasLeaf[])).rejects.toMatchObject({
      code: 'INVALID_IMAGE_SOURCE',
    });

    book.destroy();
  });
});
