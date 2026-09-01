// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { FlippingState } from '@gullabs/flipbook-core';
import type { Page } from '../src/Page/Page';
import { makeHtmlBook } from './html-book-fixture';
import { testRender, testPage } from './engine-access';
import type { Render } from '../src/Render/Render';

/**
 * `leftPage`/`rightPage` are private with no public getters, and `drawFrame`
 * must be driven explicitly — jsdom runs no rAF loop, so nothing writes the
 * inline styles these assertions read. Same casts the existing
 * `spread-construction` and `lifecycle` suites use.
 */
// `Omit`, not an intersection with `Render`: the pages are `private` now
// (A3 seam closed like A1/A2), and intersecting a class with a same-named
// private member reduces to `never`. `Omit` keeps only the public surface,
// which is all these tests reach through besides the probed fields.
type Internals = Omit<Render, 'drawFrame'> & {
  leftPage: Page | null;
  rightPage: Page | null;
  drawFrame: () => void;
};

const inner = (render: Render): Internals => render as unknown as Internals;

/** The render's in-flight animation slot — private, no getter, like the pages. */
function renderAnimation(book: ReturnType<typeof makeHtmlBook>): unknown {
  return (testRender(book.book) as unknown as { animation: unknown }).animation;
}

/** Force the frame that writes the inline styles, then hand back the internals. */
function drawn(book: ReturnType<typeof makeHtmlBook>): Internals {
  const render = inner(testRender(book.book));
  render.drawFrame();
  return render;
}

/**
 * RTL spread layout is MIRRORED: spine on the right, page 1 on the right.
 *
 * A right-bound book — Arabic, Hebrew, Persian, Urdu — binds on the right and
 * reads right-to-left. Before this, the engine mirrored the TURN direction but
 * not the LAYOUT, so an RTL reader turned right-to-left through pages laid out
 * left-to-right — a half-mirrored state matching no real book.
 *
 * WHY THIS FILE EXISTS AT ALL, and it is the point: when the mirror landed, all
 * 664 existing tests still passed. `rtl-and-spreads.test.ts` and
 * `rtl-drag.test.ts` only ever asserted `Flip`'s direction decisions — nothing'
 * anywhere asserted which page ends up on which SIDE. A behaviour this visible
 * had no test, so the change could not have been proven right or wrong by the
 * suite. That is the fifteenth instance of this repo's recurring failure and it
 * is why the assertions below are on drawn geometry rather than on spies: a
 * spy proves a call was made, not that a page landed anywhere.
 */

/** The `left:` px a leaf was actually drawn at, from the style `simpleDraw` writes. */
function drawnLeft(el: HTMLElement): number {
  const m = /(?:^|;)\s*left:\s*(-?[\d.]+)px/.exec(el.style.cssText);
  expect(m, `no left in: ${el.style.cssText}`).not.toBeNull();
  return Number(m![1]);
}

/** LANDSCAPE: host wide enough for two pages side by side. */
const landscape = { pageCount: 4, hostWidth: 520, hostHeight: 300, width: 200, height: 300 };

describe('RTL spread layout is mirrored', () => {
  test('landscape: the spread HEAD is drawn on the right, its partner on the left', () => {
    const ltr = makeHtmlBook({ ...landscape, readingDirection: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, readingDirection: 'rtl' });

    // Spread [0,1] in both. Index order is reading order in both readings; only
    // the side each lands on differs.
    drawn(ltr);
    drawn(rtl);

    const ltrHead = drawnLeft(ltr.pages[0]!);
    const ltrTail = drawnLeft(ltr.pages[1]!);
    const rtlHead = drawnLeft(rtl.pages[0]!);
    const rtlTail = drawnLeft(rtl.pages[1]!);

    // LTR: head left of tail. RTL: head RIGHT of tail. Asserted as a relation
    // rather than against pixel constants, so it cannot be broken by an
    // unrelated change to the bounds rect.
    expect(ltrHead).toBeLessThan(ltrTail);
    expect(rtlHead).toBeGreaterThan(rtlTail);

    // …and it is a true mirror, not merely "different": the two leaves swap
    // positions exactly. This is what fails for a fix that nudges the layout
    // instead of mirroring it.
    expect(rtlHead).toBe(ltrTail);
    expect(rtlTail).toBe(ltrHead);

    ltr.destroy();
    rtl.destroy();
  });

  test('landscape: the PageOrientation stamped on each leaf mirrors too', () => {
    // `setLeftPage`/`setRightPage` stamp the orientation that drives the
    // `--left`/`--right` classes and `drawHard`'s transform-origin. If only the'
    // pixel moved and the stamp did not, hard pages would rotate about the
    // wrong edge — visible only on a cover, and only mid-turn.
    const rtl = makeHtmlBook({ ...landscape, readingDirection: 'rtl' });
    const render = drawn(rtl);

    // Orientation is private after the Page collapse; the public signal is the
    // `--left`/`--right` class `setOrientation` stamps (and `drawHard` reads
    // via the same field). Assert the class, not the field.
    expect(render.rightPage?.getElement().classList.contains('--right')).toBe(true);
    expect(render.leftPage?.getElement().classList.contains('--left')).toBe(true);
    // The head (index 0) must be the RIGHT page under rtl.
    expect(render.rightPage).toBe(testPage(rtl.book, 0));
    expect(render.leftPage).toBe(testPage(rtl.book, 1));

    rtl.destroy();
  });

  test('landscape hardCovers: the lone cover mirrors to the LEFT', () => {
    // The cover sits against the spine. Mirroring the binding side mirrors the
    // cover with it — a straight inversion of the PC2 tie-break, not a second
    // rule. Under ltr a lone cover draws on the right half; under rtl, left.
    const ltr = makeHtmlBook({
      ...landscape,
      pageCount: 5,
      hardCovers: true,
      readingDirection: 'ltr',
    });
    const rtl = makeHtmlBook({
      ...landscape,
      pageCount: 5,
      hardCovers: true,
      readingDirection: 'rtl',
    });

    expect(drawn(ltr).rightPage).toBe(testPage(ltr.book, 0));
    expect(inner(testRender(ltr.book)).leftPage).toBeNull();

    expect(drawn(rtl).leftPage).toBe(testPage(rtl.book, 0));
    expect(inner(testRender(rtl.book)).rightPage).toBeNull();

    ltr.destroy();
    rtl.destroy();
  });

  test('PORTRAIT does not mirror — the leaf stays on the right half', () => {
    // The trap in "just swap the branches when rtl". Portrait has one centred
    // leaf and no visible spine, and `computeBounds` puts it on the RIGHT half
    // of a double-width rect. Sending it left under rtl moves it onto the
    // phantom half — off-centre and partly off-host.
    const ltr = makeHtmlBook({ pageCount: 4, readingDirection: 'ltr' });
    const rtl = makeHtmlBook({ pageCount: 4, readingDirection: 'rtl' });

    expect(drawn(ltr).rightPage).not.toBeNull();
    expect(inner(testRender(ltr.book)).leftPage).toBeNull();

    expect(drawn(rtl).rightPage).not.toBeNull();
    expect(inner(testRender(rtl.book)).leftPage).toBeNull();

    // Same pixel, both readings. This is the assertion that fails for a naive
    // whole-method swap.
    expect(drawnLeft(rtl.pages[0]!)).toBe(drawnLeft(ltr.pages[0]!));

    ltr.destroy();
    rtl.destroy();
  });

  test('landscape: a spread PAST the first mirrors too', () => {
    // Codex, reviewing the first draft of this file, named the half-fix it
    // could not kill: `rtl && headIdx === 0`. Every side assertion above uses
    // the opening spread `[0,1]`, and the navigation test below only ever
    // checked the INDEX — so a mirror that fired on the cover spread alone
    // passed the whole file while `turnToPage(2)` rendered left-to-right.
    const ltr = makeHtmlBook({ ...landscape, readingDirection: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, readingDirection: 'rtl' });

    ltr.book.turnToPage(2);
    rtl.book.turnToPage(2);

    expect(drawn(ltr).leftPage).toBe(testPage(ltr.book, 2));
    expect(inner(testRender(ltr.book)).rightPage).toBe(testPage(ltr.book, 3));

    expect(drawn(rtl).rightPage).toBe(testPage(rtl.book, 2));
    expect(inner(testRender(rtl.book)).leftPage).toBe(testPage(rtl.book, 3));

    // …and the pixels swapped, not just the slots.
    expect(drawnLeft(rtl.pages[2]!)).toBe(drawnLeft(ltr.pages[3]!));
    expect(drawnLeft(rtl.pages[3]!)).toBe(drawnLeft(ltr.pages[2]!));

    ltr.destroy();
    rtl.destroy();
  });

  test('landscape: the TAIL singleton mirrors to the right, not just the cover', () => {
    // The other half-fix Codex named: `onLeft = isTail || rtl`. That satisfies
    // every LTR test and the RTL *cover* test above — a lone cover under rtl
    // does belong on the left — while sending the RTL tail there as well.
    //
    // Five pages, no cover, landscape: spreads are [0,1], [2,3], [4]. The lone
    // leaf 4 is the tail, so it sits away from the spine — left in a
    // left-bound book, right in a right-bound one.
    const ltr = makeHtmlBook({ ...landscape, pageCount: 5, readingDirection: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, pageCount: 5, readingDirection: 'rtl' });

    ltr.book.turnToPage(4);
    rtl.book.turnToPage(4);

    expect(drawn(ltr).leftPage).toBe(testPage(ltr.book, 4));
    expect(inner(testRender(ltr.book)).rightPage).toBeNull();

    expect(drawn(rtl).rightPage).toBe(testPage(rtl.book, 4));
    expect(inner(testRender(rtl.book)).leftPage).toBeNull();

    ltr.destroy();
    rtl.destroy();
  });

  test('hardCovers: the OFF-PARITY paired spread mirrors too', () => {
    // Codex's third half-fix: mirror only when `headIdx % 2 === 0`. Every
    // paired spread tested so far — [0,1] and [2,3] — has an even head, so
    // that passes. With `hardCovers` the cover stands alone and the pairs shift
    // to [1,2], [3,4]: odd heads, which the parity mutant leaves left-to-right.
    //
    // This is why parity is never a safe proxy for "is this a spread head".
    const ltr = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      hardCovers: true,
      readingDirection: 'ltr',
    });
    const rtl = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      hardCovers: true,
      readingDirection: 'rtl',
    });

    ltr.book.turnToPage(1);
    rtl.book.turnToPage(1);

    // Sanity: this really is the [1,2] spread, not [0] or [2,3].
    expect(ltr.book.getCurrentPageIndex()).toBe(1);
    expect(rtl.book.getCurrentPageIndex()).toBe(1);

    expect(drawn(ltr).leftPage).toBe(testPage(ltr.book, 1));
    expect(inner(testRender(ltr.book)).rightPage).toBe(testPage(ltr.book, 2));

    expect(drawn(rtl).rightPage).toBe(testPage(rtl.book, 1));
    expect(inner(testRender(rtl.book)).leftPage).toBe(testPage(rtl.book, 2));

    ltr.destroy();
    rtl.destroy();
  });

  test('a ONE-page hardCovers book keeps its cover on the binding side', () => {
    // The PC2 tie-break exists because for a one-page `hardCovers` book both
    // descriptions are true of the same leaf: index 0 is also index
    // `length - 1`. Without the `hardCovers && headIdx === 0` exclusion the
    // last-leaf test wins and the cover is placed away from the spine.
    //
    // Under `ltr` that puts it left; under `rtl`, right. The RTL half was
    // untested, so dropping the exclusion passed the whole file.
    const ltr = makeHtmlBook({
      ...landscape,
      pageCount: 1,
      hardCovers: true,
      readingDirection: 'ltr',
    });
    const rtl = makeHtmlBook({
      ...landscape,
      pageCount: 1,
      hardCovers: true,
      readingDirection: 'rtl',
    });

    expect(drawn(ltr).rightPage).toBe(testPage(ltr.book, 0));
    expect(inner(testRender(ltr.book)).leftPage).toBeNull();

    expect(drawn(rtl).leftPage).toBe(testPage(rtl.book, 0));
    expect(inner(testRender(rtl.book)).rightPage).toBeNull();

    ltr.destroy();
    rtl.destroy();
  });

  test('changing direction mid-turn settles the fold instead of splitting the book', () => {
    // `showSpread` re-mirrors the static spread on the next `update()`, which
    // is immediate. The fold cannot: `Render.direction` and `FlipCalculation`
    // are stamped once at turn start, on purpose, so the mirror is applied
    // exactly once. Toggling direction mid-turn therefore used to put two
    // readings on screen at once — resting pages swapped instantly while the
    // curl, underside, shadows and z-order stayed in the old reading until the
    // animation ended and snapped.
    //
    // `updateSettings` now abandons the in-flight fold, the same
    // `cancelAnimation()` + `abandon()` every other state-invalidating path
    // uses. Asserting the STATE rather than a pixel is the point: the split is
    // a disagreement between two subsystems, and only one of them draws.
    const book = makeHtmlBook({ ...landscape, readingDirection: 'ltr', flippingTime: 400 });

    book.book.flipNext();
    // Precondition, or the assertion below passes on a book that never turned.
    expect(book.book.getState()).toBe(FlippingState.FLIPPING);

    book.book.updateSettings({ readingDirection: 'rtl' });

    expect(book.book.getState()).toBe(FlippingState.READ);

    // And the settled book is coherently mirrored — not left mid-fold.
    drawn(book);
    expect(inner(testRender(book.book)).rightPage).toBe(
      testPage(book.book, book.book.getCurrentPageIndex()),
    );

    book.destroy();
  });

  test('the settle drops the ANIMATION, not just the fold state', () => {
    // `abandon()` alone satisfies a state assertion while the renderer keeps a
    // live animation — a turn that still has frames scheduled against a
    // calculation nobody owns. The pair is `cancelAnimation()` + `abandon()`,
    // and only this asserts the first half.
    const book = makeHtmlBook({ ...landscape, readingDirection: 'ltr', flippingTime: 400 });

    book.book.flipNext();
    expect(renderAnimation(book)).not.toBeNull();

    book.book.updateSettings({ readingDirection: 'rtl' });

    expect(renderAnimation(book)).toBeNull();

    book.destroy();
  });

  test('the settle resets a real DRAG, not just a programmatic turn', () => {
    // The settle test above uses `flipNext()`, which leaves no user gesture —
    // so deleting `resetUserGesture()` passes it. During a real drag the
    // engine is holding `isUserTouch` / `touchPoint`, and leaving those set
    // means the NEXT pointermove resumes a fold with no fresh pointerdown:
    // the page follows the cursor with no button held.
    const book = makeHtmlBook({ ...landscape, readingDirection: 'ltr', flippingTime: 400 });
    const dist = book.book.getBlockElement();
    const rect = book.book.getBoundsRect();
    const y = rect.top + rect.height / 2;
    const startX = rect.left + rect.width - 10;

    const pointer = (type: string, x: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    /** A mouse move with no button held — a hover, not a drag. */
    const hover = (hx: number, hy: number): void => {
      dist.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: 0,
          pointerType: 'mouse',
          clientX: hx,
          clientY: hy,
        }),
      );
    };

    // Press and drag, but do NOT release — the gesture is live.
    pointer('pointerdown', startX);
    pointer('pointermove', startX - 40);
    expect(book.book.getState()).not.toBe(FlippingState.READ);

    book.book.updateSettings({ readingDirection: 'rtl' });
    expect(book.book.getState()).toBe(FlippingState.READ);

    // The observable that actually discriminates: corner hover.
    //
    // `userMove` guards `showCorner` behind `!isUserTouch`, so a stuck flag
    // routes a buttonless hover into `fold()` instead — the page follows the
    // cursor with nothing held down, and the corner peel is dead for the life
    // of the book.
    //
    // Recorded because I got this wrong once and Codex caught it: an earlier
    // version of this test asserted the private FLAGS and claimed in a comment
    // that `FOLD_CORNER` was unreachable in jsdom. It is reachable — my probe
    // had simply hovered 10px inside the edge, outside the corner band. The
    // claim was wrong, and a wrong claim in a comment outlives the test.
    hover(rect.left + 4, rect.top + 4);
    expect(book.book.getState()).toBe(FlippingState.FOLD_CORNER);
    book.destroy();
  });

  // The two C1 tests that lived here — a release after the settle, and the
  // capture release — moved to `gesture-teardown.test.ts`. Codex killed both:
  // they settled only through `updateSettings`, so a fix applied at that one
  // branch passed while four other callers stayed broken, and the capture test
  // never installed stateful capture shims, so it could not see a leak at all.
  // The replacements are parameterized over every caller. Left as a pointer
  // rather than deleted silently, because a reader who remembers them here
  // should find out they were inadequate, not merely that they are gone.

  test('a mid-turn RESIZE settles the fold too — direction is not a special case', () => {
    // Codex: the settle originally keyed on `direction` alone, but every
    // geometry setting has the same hazard. `FlipCalculation` is built from the
    // page dimensions at turn start, so a book resized mid-turn re-lays its
    // static leaves at the new width while the curl keeps the old one.
    const book = makeHtmlBook({ ...landscape, flippingTime: 400 });

    book.book.flipNext();
    expect(book.book.getState()).toBe(FlippingState.FLIPPING);

    book.book.updateSettings({ width: 150 });

    expect(book.book.getState()).toBe(FlippingState.READ);
    expect(renderAnimation(book)).toBeNull();

    book.destroy();
  });

  test('an UNCHANGED direction does not abandon a turn in flight', () => {
    // The negative control for the test above, and the reason it is not simply
    // "updateSettings cancels turns". Pushing a settings object that merely
    // echoes the current direction — which every React binding does on any
    // prop change — must not kill the user's page turn.
    const book = makeHtmlBook({ ...landscape, readingDirection: 'ltr', flippingTime: 400 });

    book.book.flipNext();
    expect(book.book.getState()).toBe(FlippingState.FLIPPING);

    book.book.updateSettings({ readingDirection: 'ltr', drawShadow: false });

    expect(book.book.getState()).toBe(FlippingState.FLIPPING);

    book.destroy();
  });

  test('page indices are reading order in BOTH readings — no consumer state moves', () => {
    // "Page 5" must mean the same page whichever way the book binds, or every
    // consumer syncing a URL or React state breaks on a direction change. The
    // spatial side is derived from the index, never the other way round.
    const ltr = makeHtmlBook({ ...landscape, readingDirection: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, readingDirection: 'rtl' });

    expect(rtl.book.getCurrentPageIndex()).toBe(ltr.book.getCurrentPageIndex());

    ltr.book.turnToPage(2);
    rtl.book.turnToPage(2);
    expect(rtl.book.getCurrentPageIndex()).toBe(ltr.book.getCurrentPageIndex());
    expect(rtl.book.getCurrentPageIndex()).toBe(2);

    ltr.destroy();
    rtl.destroy();
  });

  test('direction is live: updateSettings re-mirrors an existing book', () => {
    // `direction` is not a construction-time setting, so the mirror must be
    // read where it is used. Caching it in the collection would repeat the
    // `swipeDistance` mistake — a setting that silently ignores every runtime
    // update.
    const book = makeHtmlBook({ ...landscape, readingDirection: 'ltr' });

    drawn(book);
    const before = drawnLeft(book.pages[0]!);

    book.book.updateSettings({ readingDirection: 'rtl' });
    book.book.update();
    drawn(book);

    expect(drawnLeft(book.pages[0]!)).not.toBe(before);
    expect(inner(testRender(book.book)).rightPage).toBe(testPage(book.book, 0));

    book.destroy();
  });
});

describe('a COMPLETED swipe lands on the right page in both readings', () => {
  // C4. Everything else about rtl asserts a decision: which `FlipDirection`
  // `Flip` resolved, or which side a leaf was drawn on. Nothing anywhere ran a
  // swipe all the way through `onPointerUp` and checked where the book ENDED
  // UP. So an engine that mirrored the direction decision and then committed
  // the unmirrored turn passed the entire rtl suite.
  //
  // This is also the closest unit-level proxy for the gesture the fork exists
  // to fix, and it is asserted as a RELATION between the two readings: the same
  // physical finger movement must move the index in opposite directions. Pinned
  // constants would break on an unrelated change to spread layout.
  function swipe(book: ReturnType<typeof makeHtmlBook>, dx: number): void {
    const dist = book.book.getBlockElement();
    const rect = book.book.getBoundsRect();
    const y = rect.top + rect.height / 2;
    const startX = rect.left + rect.width / 2 + (dx < 0 ? 60 : -60);

    const send = (type: string, x: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      );
    };

    send('pointerdown', startX);
    send('pointermove', startX + dx / 2);
    send('pointerup', startX + dx);
  }

  test('the same finger movement moves the index OPPOSITE ways under ltr and rtl', () => {
    const ltr = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      readingDirection: 'ltr',
      flippingTime: 0,
    });
    const rtl = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      readingDirection: 'rtl',
      flippingTime: 0,
    });

    ltr.book.turnToPage(2);
    rtl.book.turnToPage(2);

    // A right-to-left drag: "onward" for a left-bound book, "back" for a
    // right-bound one.
    swipe(ltr, -200);
    swipe(rtl, -200);

    expect(ltr.book.getCurrentPageIndex()).toBeGreaterThan(2);
    expect(rtl.book.getCurrentPageIndex()).toBeLessThan(2);

    ltr.destroy();
    rtl.destroy();
  });

  test('and the mirror image of that drag reverses both', () => {
    // Without this, an engine that simply refuses every rtl forward turn
    // satisfies the test above.
    const ltr = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      readingDirection: 'ltr',
      flippingTime: 0,
    });
    const rtl = makeHtmlBook({
      ...landscape,
      pageCount: 6,
      readingDirection: 'rtl',
      flippingTime: 0,
    });

    ltr.book.turnToPage(2);
    rtl.book.turnToPage(2);

    swipe(ltr, 200);
    swipe(rtl, 200);

    expect(ltr.book.getCurrentPageIndex()).toBeLessThan(2);
    expect(rtl.book.getCurrentPageIndex()).toBeGreaterThan(2);

    ltr.destroy();
    rtl.destroy();
  });
});
