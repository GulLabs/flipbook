// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PageOrientation } from '@gullabs/flipbook-core';
import type { Page, Render } from '@gullabs/flipbook-core';
import { makeHtmlBook } from './html-book-fixture';

/**
 * `leftPage`/`rightPage` are protected with no public getters, and `drawFrame`
 * must be driven explicitly — jsdom runs no rAF loop, so nothing writes the
 * inline styles these assertions read. Same casts the existing
 * `spread-construction` and `lifecycle` suites use.
 */
type Sided = Page & { orientation: PageOrientation };
type Internals = Render & {
  leftPage: Sided | null;
  rightPage: Sided | null;
  drawFrame: () => void;
};

const inner = (render: Render): Internals => render as unknown as Internals;

/** Force the frame that writes the inline styles, then hand back the internals. */
function drawn(book: ReturnType<typeof makeHtmlBook>): Internals {
  const render = inner(book.book.getRender());
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
 * `rtl-drag.test.ts` only ever asserted `Flip`'s direction decisions — nothing
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
    const ltr = makeHtmlBook({ ...landscape, direction: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, direction: 'rtl' });

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
    // `--left`/`--right` classes and `drawHard`'s transform-origin. If only the
    // pixel moved and the stamp did not, hard pages would rotate about the
    // wrong edge — visible only on a cover, and only mid-turn.
    const rtl = makeHtmlBook({ ...landscape, direction: 'rtl' });
    const render = drawn(rtl);

    // `orientation` is protected with no getter, like `leftPage`/`rightPage`.
    expect(render.rightPage?.orientation).toBe(PageOrientation.RIGHT);
    expect(render.leftPage?.orientation).toBe(PageOrientation.LEFT);
    // The head (index 0) must be the RIGHT page under rtl.
    expect(render.rightPage).toBe(rtl.book.getPage(0));
    expect(render.leftPage).toBe(rtl.book.getPage(1));

    rtl.destroy();
  });

  test('landscape showCover: the lone cover mirrors to the LEFT', () => {
    // The cover sits against the spine. Mirroring the binding side mirrors the
    // cover with it — a straight inversion of the PC2 tie-break, not a second
    // rule. Under ltr a lone cover draws on the right half; under rtl, left.
    const ltr = makeHtmlBook({ ...landscape, pageCount: 5, showCover: true, direction: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, pageCount: 5, showCover: true, direction: 'rtl' });

    expect(drawn(ltr).rightPage).toBe(ltr.book.getPage(0));
    expect(inner(ltr.book.getRender()).leftPage).toBeNull();

    expect(drawn(rtl).leftPage).toBe(rtl.book.getPage(0));
    expect(inner(rtl.book.getRender()).rightPage).toBeNull();

    ltr.destroy();
    rtl.destroy();
  });

  test('PORTRAIT does not mirror — the leaf stays on the right half', () => {
    // The trap in "just swap the branches when rtl". Portrait has one centred
    // leaf and no visible spine, and `computeBounds` puts it on the RIGHT half
    // of a double-width rect. Sending it left under rtl moves it onto the
    // phantom half — off-centre and partly off-host.
    const ltr = makeHtmlBook({ pageCount: 4, direction: 'ltr' });
    const rtl = makeHtmlBook({ pageCount: 4, direction: 'rtl' });

    expect(drawn(ltr).rightPage).not.toBeNull();
    expect(inner(ltr.book.getRender()).leftPage).toBeNull();

    expect(drawn(rtl).rightPage).not.toBeNull();
    expect(inner(rtl.book.getRender()).leftPage).toBeNull();

    // Same pixel, both readings. This is the assertion that fails for a naive
    // whole-method swap.
    expect(drawnLeft(rtl.pages[0]!)).toBe(drawnLeft(ltr.pages[0]!));

    ltr.destroy();
    rtl.destroy();
  });

  test('page indices are reading order in BOTH readings — no consumer state moves', () => {
    // "Page 5" must mean the same page whichever way the book binds, or every
    // consumer syncing a URL or React state breaks on a direction change. The
    // spatial side is derived from the index, never the other way round.
    const ltr = makeHtmlBook({ ...landscape, direction: 'ltr' });
    const rtl = makeHtmlBook({ ...landscape, direction: 'rtl' });

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
    const book = makeHtmlBook({ ...landscape, direction: 'ltr' });

    drawn(book);
    const before = drawnLeft(book.pages[0]!);

    book.book.updateSettings({ direction: 'rtl' });
    book.book.update();
    drawn(book);

    expect(drawnLeft(book.pages[0]!)).not.toBe(before);
    expect(inner(book.book.getRender()).rightPage).toBe(book.book.getPage(0));

    book.destroy();
  });
});
