// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { makeHtmlBook, makePages, sizeElement } from './html-book-fixture';

/** `flippingPage` is protected with no getter; same cast idiom as the other suites. */
type HardLeaf = { getDrawingDensity: () => string };

/**
 * Shadow GRADIENT DIRECTION, per fold direction.
 *
 * A mutation sweep of every BACK-direction geometry branch found the §4.1 curl,
 * mirror, fold-rect and page-selection paths all properly covered — and then
 * found eight survivors clustered in one place: the shadows. Swapping
 * `'to left'` for `'to right'` in `drawInnerShadow` left the entire suite green.
 *
 * That mutation inverts the gutter shading on **every soft BACK flip** — the
 * mobile back-flip this fork exists for. The reader gets a bright band at the
 * fold and darkness out at the free edge, which is the shading of a page
 * lifting when the page is in fact settling.
 *
 * Two reasons it survived, both worth naming:
 *
 *  - The golden screenshots cannot see it. A ~34px gradient strip is under
 *    Playwright's `maxDiffPixelRatio: 0.05`, so the images pass.
 *  - The one existing shadow test asserts EXISTENCE: "display:block **or**
 *    linear-gradient on **either** node". That is satisfied by any shadow at
 *    all, pointing anywhere.
 *
 * So these assert the literal direction token in the emitted CSS. The CSS
 * string IS the behaviour here — there is nothing else downstream of it — and a
 * spy on `drawInnerShadow` would prove only that a function ran.
 */

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
});

/** A landscape book whose leaves are all SOFT, wide enough for two pages. */
function softBook(): PageFlip {
  const b = makeHtmlBook({
    pageCount: 6,
    hostWidth: 520,
    hostHeight: 300,
    width: 200,
    height: 300,
    flippingTime: 0,
    drawShadow: true,
  });
  books.push(b);
  return b.book;
}

/** A book whose first leaf is HARD, with a cover, so hard folds are reachable. */
function hardBook(): PageFlip {
  const pages = makePages(6, true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, 520, 300);
  for (const p of pages) host.appendChild(p);

  const book = new PageFlip(host, {
    width: 200,
    height: 300,
    size: 'fixed',
    flippingTime: 0,
    drawShadow: true,
    showCover: true,
  });
  book.loadFromHTML(pages);
  sizeElement(book.getUI().getDistElement(), 520, 300);
  book.update();

  books.push({
    destroy() {
      book.destroy();
      host.remove();
    },
  });
  return book;
}

/** The live cssText of a shadow node, after a frame has actually been drawn. */
function shadowCss(book: PageFlip, selector: string): string {
  const el = book.getUI().getDistElement().querySelector<HTMLElement>(selector);
  expect(el, `no ${selector} in the dist element`).not.toBeNull();
  return el!.style.cssText;
}

/**
 * Drive a fold inward from the given edge by `depth` px and paint one frame.
 *
 * `depth` matters: the hard-shadow face turns on whether the cover has passed
 * its halfway point, so a shallow and a deep fold are two different cases.
 */
function foldFrom(book: PageFlip, edge: 'left' | 'right', depth = 60): void {
  const rect = book.getBoundsRect();
  const y = rect.top + rect.height / 2;
  const x = edge === 'right' ? rect.left + rect.width - 6 : rect.left + 6;

  const flip = book.getFlipController()!;
  flip.fold({ x, y });
  // Move inward so the fold has real width and the shadows are painted.
  flip.fold({ x: edge === 'right' ? x - depth : x + depth, y });

  (book.getRender() as unknown as { drawFrame: () => void }).drawFrame();
}

describe('soft fold — inner shadow gradient direction', () => {
  test('FORWARD shades toward the spine on the left', () => {
    const book = softBook();
    foldFrom(book, 'right');

    expect(shadowCss(book, '.stf__innerShadow')).toContain('to left');
  });

  test('BACK shades the other way — the flagship path, and it had no test', () => {
    const book = softBook();
    book.turnToPage(2);
    foldFrom(book, 'left');

    const css = shadowCss(book, '.stf__innerShadow');
    expect(css).toContain('to right');
    // Both halves. Asserting only the expected token passes an implementation
    // that emits both, or that emits a gradient with no direction at all and
    // happens to contain the substring elsewhere.
    expect(css).not.toContain('to left');
  });

  test('the two directions genuinely differ — the control for both above', () => {
    // If a refactor ever made `getDirection()` constant, each test above would
    // still pass for one of the two and fail for the other; this states the
    // relationship directly, so the failure names the cause.
    const forward = softBook();
    foldFrom(forward, 'right');

    const back = softBook();
    back.turnToPage(2);
    foldFrom(back, 'left');

    expect(shadowCss(forward, '.stf__innerShadow')).not.toBe(shadowCss(back, '.stf__innerShadow'));
  });
});

describe('hard fold — shadow face selection', () => {
  // `drawHardInnerShadow` / `drawHardOuterShadow` choose which FACE of the
  // cover the shadow sits on with
  //
  //   (FORWARD && progress > 100) || (BACK && progress <= 100)
  //
  // i.e. it turns on the direction AND on whether the cover has passed its
  // halfway point. Inverting either half shows the wrong face — the dark end
  // lands on the outside of the cover instead of down into the spine.
  //
  // The axis that discriminates is therefore PROGRESS at a fixed direction,
  // which is what the first draft of this file got wrong: it varied only
  // direction, and the two conditions are symmetric in direction, so a shallow
  // FORWARD fold and a shallow BACK fold legitimately differ while telling you
  // nothing about the comparison itself.
  //
  // The inner and outer shadows emit OPPOSITE tokens for the same condition,
  // so each also acts as the other's control.

  const FACE = 'rotateY(180deg)';

  /** A hard fold BACKWARD: sit on page 1 and drag the cover closed. */
  function hardBackFold(depth: number): PageFlip {
    const book = hardBook();
    book.turnToPage(1);
    foldFrom(book, 'left', depth);

    // The whole point is the HARD path — if the mover ever stopped being the
    // hard cover these would silently become soft-fold tests.
    const mover = (book.getRender() as unknown as { flippingPage: HardLeaf | null }).flippingPage;
    expect(mover?.getDrawingDensity()).toBe('hard');
    return book;
  }

  test('the faces are pinned ABSOLUTELY, not just relative to each other', () => {
    // Every other assertion in this describe is a RELATION — this differs from
    // that, this is the negation of that. Swapping BOTH ternary outputs puts
    // every hard shadow on the wrong face while preserving every relation, so
    // all of them still pass. Codex found exactly that hole.
    //
    // These are golden values: they pin the observed behaviour of code believed
    // correct, and unlike the relations above they encode no reasoning. If one
    // ever fails, the question to ask is which of the two is wrong — not to
    // update the constant.
    //
    // They follow from the source condition
    // `(FORWARD && progress > 100) || (BACK && progress <= 100)`: a shallow
    // FORWARD fold has progress <= 100, so the condition is false, so the INNER
    // shadow takes the flipped face and the OUTER — whose ternary outputs are
    // inverted — takes the plain one. Deep FORWARD reverses both. Written down
    // this way rather than guessed: the first draft of this test asserted the
    // opposite and was wrong.
    const shallow = hardBook();
    foldFrom(shallow, 'right', 40);

    expect(shadowCss(shallow, '.stf__hardInnerShadow')).toContain(FACE);
    expect(shadowCss(shallow, '.stf__hardShadow')).not.toContain(FACE);

    const deep = hardBook();
    foldFrom(deep, 'right', 360);

    expect(shadowCss(deep, '.stf__hardInnerShadow')).not.toContain(FACE);
    expect(shadowCss(deep, '.stf__hardShadow')).toContain(FACE);
  });

  test('the inner shadow swaps face as a hard fold passes halfway', () => {
    const shallow = hardBook();
    foldFrom(shallow, 'right', 40);
    const shallowCss = shadowCss(shallow, '.stf__hardInnerShadow');

    const deep = hardBook();
    foldFrom(deep, 'right', 360);
    const deepCss = shadowCss(deep, '.stf__hardInnerShadow');

    expect(shallowCss).toMatch(/linear-gradient/);
    expect(deepCss).toMatch(/linear-gradient/);
    // Exactly one of the two carries the flipped face.
    expect(shallowCss.includes(FACE)).not.toBe(deepCss.includes(FACE));
  });

  test('the BACK clause is exercised too — the half the FORWARD tests cannot see', () => {
    // The condition is a disjunction over direction, so folding only FORWARD
    // leaves `BACK && progress <= 100` completely untested: inverting it passes
    // every FORWARD test. Measured — the first draft of this file did exactly
    // that and both hard mutants survived.
    const shallow = hardBackFold(40);
    const deep = hardBackFold(360);

    const shallowInner = shadowCss(shallow, '.stf__hardInnerShadow').includes(FACE);
    const deepInner = shadowCss(deep, '.stf__hardInnerShadow').includes(FACE);
    expect(shallowInner).not.toBe(deepInner);

    const shallowOuter = shadowCss(shallow, '.stf__hardShadow').includes(FACE);
    const deepOuter = shadowCss(deep, '.stf__hardShadow').includes(FACE);
    expect(shallowOuter).not.toBe(deepOuter);
    expect(shallowOuter).toBe(!shallowInner);
  });

  test('a BACK fold shows the opposite face to a FORWARD fold at the same depth', () => {
    // States the symmetry directly: at equal progress the two directions put
    // the shadow on opposite faces. This is what an inversion of EITHER clause
    // breaks, whichever one a mutation happens to hit.
    const forward = hardBook();
    foldFrom(forward, 'right', 40);
    const back = hardBackFold(40);

    expect(shadowCss(forward, '.stf__hardInnerShadow').includes(FACE)).not.toBe(
      shadowCss(back, '.stf__hardInnerShadow').includes(FACE),
    );
  });

  test('the outer shadow swaps with it, and to the OPPOSITE face', () => {
    // Same condition, inverted output. A single test on the inner shadow
    // leaves the outer free to disagree, which on screen is a drop shadow cast
    // from the wrong side of the cover.
    const shallow = hardBook();
    foldFrom(shallow, 'right', 40);

    const deep = hardBook();
    foldFrom(deep, 'right', 360);

    const shallowInner = shadowCss(shallow, '.stf__hardInnerShadow').includes(FACE);
    const shallowOuter = shadowCss(shallow, '.stf__hardShadow').includes(FACE);
    const deepInner = shadowCss(deep, '.stf__hardInnerShadow').includes(FACE);
    const deepOuter = shadowCss(deep, '.stf__hardShadow').includes(FACE);

    expect(shallowOuter).toBe(!shallowInner);
    expect(deepOuter).toBe(!deepInner);
    expect(shallowOuter).not.toBe(deepOuter);
  });
});
