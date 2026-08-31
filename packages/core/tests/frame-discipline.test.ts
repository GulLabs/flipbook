/**
 * PLAN-3.1 Campaign B1 — pin the per-frame style/class write budget BEFORE any
 * B3 optimization. These tests document the pre-fix cost model (Puddlebend
 * Issue 3): every frame re-stamps engine styles on every drawn leaf and walks
 * the whole collection in `clear()`.
 *
 * Until B3.1–B3.4 land, the three budget assertions are `test.fails` so CI
 * stays green while the failing shape is locked in. Flip them to plain `test`
 * after the optimizations pass.
 *
 * Pre-fix measurements (this harness, soft landscape, 10 leaves, 2026-08-31):
 *   - resting redraw after settle: **54** writes
 *   - mid-fold update frame: **106** writes
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PageDensity } from '@gullabs/flipbook-core';
import type { PageFlip } from '@gullabs/flipbook-core';
import type { Page } from '../src/Page/Page';
import { makeHtmlBook } from './html-book-fixture';
import { testCollection, testRender } from './engine-access';
import { installStyleWriteRecorder, type StyleWriteRecorder } from './style-write-recorder';

const books: Array<{ destroy: () => void }> = [];
let recorder: StyleWriteRecorder | null = null;

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  recorder?.restore();
  recorder = null;
  document.body.innerHTML = '';
});

type DrawableRender = {
  drawFrame: () => void;
  flippingPage: Page | null;
  bottomPage: Page | null;
  leftPage: Page | null;
  rightPage: Page | null;
};

function drawFrame(book: PageFlip): void {
  (testRender(book) as unknown as DrawableRender).drawFrame();
}

function renderOf(book: PageFlip): DrawableRender {
  return testRender(book) as unknown as DrawableRender;
}

/** 10-leaf landscape book — spread has two static leaves + room for a fold. */
function landscape10(): { book: PageFlip; pages: HTMLElement[]; destroy: () => void } {
  const made = makeHtmlBook({
    pageCount: 10,
    flippingTime: 0,
    usePortrait: false,
    hostWidth: 900,
    hostHeight: 300,
    drawShadow: true,
  });
  books.push(made);
  return made;
}

/**
 * Allowed write targets for a mid-fold frame after B3 (PLAN-3.1 B1):
 * mover, temporary copy, bottom page, hard-turn static leaf, four shadows.
 * Soft left/right simpleDraw leaves are intentionally excluded — B3 must stop
 * restamping them on a steady fold frame.
 */
function midFoldAllowedElements(book: PageFlip): Set<Element> {
  const render = renderOf(book);
  const allowed = new Set<Element>();

  const addPage = (page: Page | null | undefined): void => {
    if (page) allowed.add(page.getElement());
  };

  addPage(render.flippingPage);
  addPage(render.bottomPage);

  // Temporary copy (portrait soft) and its owner page element if distinct.
  for (const page of testCollection(book).getPages()) {
    const copy = page.getTemporaryCopy();
    if (copy !== null) {
      allowed.add(copy.getElement());
      allowed.add(page.getElement());
    }
  }

  // Hard-turn static leaf (drawLeftPage / drawRightPage hard branch).
  if (render.flippingPage?.getDrawingDensity() === PageDensity.HARD) {
    addPage(render.leftPage);
    addPage(render.rightPage);
  }

  const block = book.getBlockElement();
  for (const cls of [
    'stf__outerShadow',
    'stf__innerShadow',
    'stf__hardShadow',
    'stf__hardInnerShadow',
  ]) {
    const el = block.querySelector(`.${cls}`);
    if (el) allowed.add(el);
  }

  return allowed;
}

/* ------------------------------------------------------------------ *
 * Recorder self-test (negative control for the zIndex path)
 * ------------------------------------------------------------------ */

describe('style-write-recorder', () => {
  test('bare el.style.zIndex assignment is counted against that element', () => {
    recorder = installStyleWriteRecorder();
    const el = document.createElement('div');
    document.body.appendChild(el);

    el.style.zIndex = '5';

    expect(recorder.count()).toBeGreaterThan(0);
    expect(recorder.records.some((r) => r.kind === 'zIndex' && r.element === el)).toBe(true);
  });

  test('setProperty and classList writes resolve to the owning element', () => {
    recorder = installStyleWriteRecorder();
    const el = document.createElement('div');
    document.body.appendChild(el);

    el.style.setProperty('color', 'red');
    el.classList.add('x');
    el.classList.remove('x');

    expect(recorder.records.some((r) => r.kind === 'setProperty' && r.element === el)).toBe(true);
    expect(recorder.records.some((r) => r.kind === 'classList.add' && r.element === el)).toBe(true);
    expect(recorder.records.some((r) => r.kind === 'classList.remove' && r.element === el)).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ *
 * B1 budget pins — green after B3.1–B3.4
 * ------------------------------------------------------------------ */

describe('frame discipline (B1)', () => {
  /**
   * Resting redraw writes nothing.
   *
   * Pre-fix measured **54** writes on a settled 10-leaf landscape redraw.
   * Passes after B3.1 (style memo) + B3.4 (class elision); B3.2/B3.3 also
   * reduce mid-fold noise.
   */
  test('resting redraw writes nothing', () => {
    const { book } = landscape10();
    recorder = installStyleWriteRecorder();

    // Settle one frame so the visible spread is fully painted.
    drawFrame(book);
    recorder.reset();

    drawFrame(book);

    expect(recorder.count(), `unexpected writes: ${summarize(recorder)}`).toBe(0);
  });

  /**
   * A mid-fold frame touches only the working set.
   *
   * Drag setup mirrors styling-contract.test.ts B3.2. Identity, not counts —
   * counts go stale; element membership does not. Pre-fix extras include the
   * soft left/right simpleDraw leaves and every non-working page that
   * `clear()` classList.removes.
   */
  test('mid-fold frame touches only the working set', () => {
    const { book } = landscape10();
    recorder = installStyleWriteRecorder();

    // Establish a mid-fold (soft landscape forward), paint once, then measure
    // the NEXT fold update frame only.
    book.startUserTouch({ x: 850, y: 150 });
    book.userMove({ x: 500, y: 150 }, false);
    drawFrame(book);

    const allowed = midFoldAllowedElements(book);
    expect(allowed.size, 'working set should be non-empty mid-fold').toBeGreaterThan(0);

    recorder.reset();
    book.userMove({ x: 480, y: 150 }, false);
    drawFrame(book);

    const written = recorder.elements();
    // foldFill() probes CSS.supports via a throwaway disconnected <div>; those
    // writes are not engine paint. Only count elements attached to the book.
    const block = book.getBlockElement();
    const extras = [...written].filter(
      (el) => !allowed.has(el) && (block.contains(el) || el === block),
    );
    expect(
      extras,
      extras.length
        ? `writes outside working set: ${extras.map(describeEl).join(', ')} (${summarize(recorder)})`
        : '',
    ).toEqual([]);
  });

  /**
   * Write count is bounded.
   *
   * Pre-fix measured mid-fold frame (soft landscape, 10 leaves): **106**
   * writes. Post-B3.1–B3.4 measured: **48** (included foldFill probe noise on
   * a throwaway div); **44** after the R2 foldFill memo removed the per-frame
   * `CSS.supports` re-validation. Ceiling = measured + 25%.
   */
  test('mid-fold write count is bounded', () => {
    const { book } = landscape10();
    recorder = installStyleWriteRecorder();

    book.startUserTouch({ x: 850, y: 150 });
    book.userMove({ x: 500, y: 150 }, false);
    drawFrame(book);

    recorder.reset();
    book.userMove({ x: 480, y: 150 }, false);
    drawFrame(book);

    // Post-B3.1–B3.4 measured 2026-08-31: 48; 44 after the R2 foldFill memo.
    // Ceiling = measured + 25%.
    const MEASURED_POST_FIX = 44;
    const ceiling = Math.ceil(MEASURED_POST_FIX * 1.25);

    expect(
      recorder.count(),
      `mid-fold writes ${recorder.count()} exceed budget ${ceiling}: ${summarize(recorder)}`,
    ).toBeLessThanOrEqual(ceiling);
  });
});

/* ------------------------------------------------------------------ *
 * B3.1 — applyEngineStyle memoization + invalidation sites
 * ------------------------------------------------------------------ */

describe('applyEngineStyle memoization (B3.1)', () => {
  /**
   * Resting second frame must not re-stamp setProperty/removeProperty on the
   * drawn leaves. Class writes still fire (B3.4); style writes must not.
   * Pre-B3.1 resting style writes were ~36–40 (two simpleDraw leaves × ~18).
   */
  test('resting redraw skips unchanged applyEngineStyle writes', () => {
    const { book } = landscape10();
    recorder = installStyleWriteRecorder();

    drawFrame(book);
    recorder.reset();
    drawFrame(book);

    expect(
      styleWriteCount(recorder),
      `resting style writes should be 0 after B3.1 memoization: ${summarize(recorder)}`,
    ).toBe(0);
  });

  test('updateSettings({ pageBackground }) restamps --stf-paper on visible leaves', () => {
    const { book } = landscape10();
    drawFrame(book);

    book.updateSettings({ pageBackground: '#f5f0e6' });
    drawFrame(book);

    const leaf = visibleLeaf(book);
    const paper = leaf.style.getPropertyValue('--stf-paper').trim().toLowerCase();
    expect(paper === '#f5f0e6' || paper === 'rgb(245, 240, 230)').toBe(true);
  });

  test('update() after size change restamps width on visible leaves', () => {
    const { book } = landscape10();
    drawFrame(book);

    const leaf = visibleLeaf(book);
    const beforeWidth = leaf.style.width;

    // LiveSetting width/height — updateSettings → Render.update busts the memo
    // and recomputes page geometry under fixed sizing.
    book.updateSettings({ width: 320, height: 400 });
    drawFrame(book);

    expect(leaf.style.width).not.toBe(beforeWidth);
    expect(leaf.style.width).not.toBe('');
  });

  test('setDensity restamps on the next draw', () => {
    const { book } = landscape10();
    drawFrame(book);

    const page = testCollection(book).getPage(1);
    const el = page.getElement();
    // Corrupt the memo path: clear a property the next soft simpleDraw must
    // rewrite. Without invalidateDrawCache the memo would skip and leave it gone.
    el.style.removeProperty('width');
    page.setDensity(PageDensity.SOFT);
    drawFrame(book);

    expect(el.style.width).not.toBe('');
  });

  test('setDrawingDensity restamps on the next draw', () => {
    const { book } = landscape10();
    drawFrame(book);

    const page = testCollection(book).getPage(1);
    const el = page.getElement();
    el.style.removeProperty('width');
    page.setDrawingDensity(PageDensity.SOFT);
    drawFrame(book);

    expect(el.style.width).not.toBe('');
  });

  test('newTemporaryCopy draws fully on its first frame (fresh cache)', () => {
    // Portrait soft turn is what builds a temporary copy.
    const made = makeHtmlBook({
      pageCount: 6,
      flippingTime: 0,
      usePortrait: true,
      hostWidth: 200,
      hostHeight: 300,
      width: 200,
      height: 300,
      drawShadow: true,
    });
    books.push(made);

    made.book.startUserTouch({ x: 180, y: 150 });
    made.book.userMove({ x: 100, y: 150 }, false);

    const owner = testCollection(made.book).getPage(made.book.getCurrentPageIndex());
    const copy = owner.getTemporaryCopy() ?? owner.newTemporaryCopy();
    expect(copy).not.toBe(owner);

    // First draw on a fresh copy must write engine styles (cache starts null).
    recorder = installStyleWriteRecorder();
    copy.draw();
    expect(
      styleWriteCount(recorder),
      `temporary copy first draw wrote nothing: ${summarize(recorder)}`,
    ).toBeGreaterThan(0);
    expect(copy.getElement().style.width).not.toBe('');
  });

  test('updateFromHtml with the same nodes repaints after rebuild', () => {
    const { book, pages } = landscape10();
    drawFrame(book);

    book.updateFromHtml(pages);
    drawFrame(book);

    const leaf = visibleLeaf(book);
    expect(leaf.style.width).not.toBe('');
    expect(leaf.style.getPropertyValue('--stf-paper').trim()).not.toBe('');
  });

  test('updateFromHtml with replaced nodes repaints the new leaves', () => {
    const { book } = landscape10();
    drawFrame(book);

    const replacements = Array.from({ length: 10 }, (_, i) => {
      const el = document.createElement('div');
      el.dataset.page = `new-${i}`;
      el.textContent = `new-${i}`;
      return el;
    });
    book.updateFromHtml(replacements);
    drawFrame(book);

    const leaf = visibleLeaf(book);
    expect(leaf.dataset.page?.startsWith('new-')).toBe(true);
    expect(leaf.style.width).not.toBe('');
    expect(leaf.style.getPropertyValue('--stf-paper').trim()).not.toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * B3.2 — delta clear() / lastShown / temporary-copy ownership
 * ------------------------------------------------------------------ */

describe('delta clear (B3.2)', () => {
  /** Portrait soft book — temporary copies only exist on this path. */
  function portraitSoft(): { book: PageFlip; pages: HTMLElement[]; destroy: () => void } {
    const made = makeHtmlBook({
      pageCount: 6,
      flippingTime: 0,
      usePortrait: true,
      hostWidth: 200,
      hostHeight: 300,
      width: 200,
      height: 300,
      drawShadow: true,
    });
    books.push(made);
    return made;
  }

  function restingLeafElements(book: PageFlip): Set<Element> {
    const render = renderOf(book);
    const resting = new Set<Element>();
    if (render.leftPage) resting.add(render.leftPage.getElement());
    if (render.rightPage) resting.add(render.rightPage.getElement());
    return resting;
  }

  function shownLeaves(book: PageFlip): HTMLElement[] {
    return [...book.getBlockElement().querySelectorAll<HTMLElement>('.stf__item.--shown')];
  }

  /**
   * Frame cleanup must never query the live collection. Spy getPages and assert
   * zero calls from a steady-state drawFrame (after one settle frame).
   */
  test('steady-state drawFrame does not call collection.getPages', () => {
    const { book } = landscape10();
    const collection = testCollection(book);
    drawFrame(book);

    const spy = vi.spyOn(collection, 'getPages');
    drawFrame(book);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('soft-turn cancellation mid-fold removes the clone and resting-only --shown', () => {
    const { book } = portraitSoft();

    book.startUserTouch({ x: 180, y: 150 });
    book.userMove({ x: 100, y: 150 }, false);
    drawFrame(book);

    const block = book.getBlockElement();
    expect(
      block.querySelector('[data-stf-clone]'),
      'mid-fold should have mounted a temporary copy',
    ).not.toBeNull();
    expect(renderOf(book).flippingPage).not.toBeNull();

    // Assert IMMEDIATELY after cancelAnimation — before any drawFrame. A delta
    // clear alone only cleans on the next frame; the B3.2 sweep must run here
    // so a cancelled fold does not leave an orphaned clone until rAF.
    testRender(book).cancelAnimation();

    expect(
      block.querySelector('[data-stf-clone]'),
      'clone must leave the DOM on cancel',
    ).toBeNull();
    expect(renderOf(book).flippingPage).toBeNull();

    // Repaint the resting spread, then no leaf outside it may still be --shown
    // (including a leftover mover class on a detached clone's former sibling).
    drawFrame(book);
    const resting = restingLeafElements(book);
    const extras = shownLeaves(book).filter((el) => !resting.has(el));
    expect(
      extras,
      extras.length
        ? `stale --shown outside resting spread: ${extras.map(describeEl).join(', ')}`
        : '',
    ).toEqual([]);
  });

  test('PageFlip.clear() leaves no --shown leaves and no orphaned clones', () => {
    const { book } = portraitSoft();

    book.startUserTouch({ x: 180, y: 150 });
    book.userMove({ x: 100, y: 150 }, false);
    drawFrame(book);
    expect(book.getBlockElement().querySelector('[data-stf-clone]')).not.toBeNull();

    // Collection is destroyed BEFORE releasePages → cancelAnimation; the sweep
    // must use retained lastShown, not getPages() on the emptied collection.
    book.clear();

    expect(document.querySelector('[data-stf-clone]')).toBeNull();
    expect(document.querySelectorAll('.stf__item.--shown').length).toBe(0);
  });

  test('updateFromHtml same nodes: no stale --shown, no orphaned clone', () => {
    const { book, pages } = portraitSoft();

    book.startUserTouch({ x: 180, y: 150 });
    book.userMove({ x: 100, y: 150 }, false);
    drawFrame(book);
    expect(book.getBlockElement().querySelector('[data-stf-clone]')).not.toBeNull();

    book.updateFromHtml(pages);
    // No drawFrame yet: reload/cancel sweep must have dropped the mid-fold
    // clone; a deferred delta-clear would still leave it until the next frame.
    expect(book.getBlockElement().querySelector('[data-stf-clone]')).toBeNull();

    drawFrame(book);

    const resting = restingLeafElements(book);
    expect(resting.size).toBeGreaterThan(0);
    const extras = shownLeaves(book).filter((el) => !resting.has(el));
    expect(
      extras,
      extras.length
        ? `stale --shown after updateFromHtml: ${extras.map(describeEl).join(', ')}`
        : '',
    ).toEqual([]);
  });

  /**
   * Owner back-ref trap (PLAN-3.1 B3.2): drop the mover via setFlippingPage(null)
   * and the NEXT drawFrame's delta clear must hideTemporaryCopy on the OWNER.
   * Calling hideTemporaryCopy on the clone itself is a no-op (the clone has no
   * temporaryCopy state), so a missing copyOwner leaves an orphaned [data-stf-clone].
   */
  test('temporary copy is hidden via the owner, not the clone', () => {
    const { book } = portraitSoft();

    book.startUserTouch({ x: 180, y: 150 });
    book.userMove({ x: 100, y: 150 }, false);
    drawFrame(book);

    const owner = testCollection(book).getPage(book.getCurrentPageIndex());
    const copy = owner.getTemporaryCopy();
    expect(copy).not.toBeNull();
    expect(copy!.getCopyOwner()).toBe(owner);
    expect(copy!.getElement().isConnected).toBe(true);

    // Delta-clear path only — not cancelAnimation's full sweep.
    const render = testRender(book);
    render.setFlippingPage(null);
    render.setBottomPage(null);
    drawFrame(book);

    expect(owner.getTemporaryCopy()).toBeNull();
    expect(book.getBlockElement().querySelector('[data-stf-clone]')).toBeNull();
  });
});

function describeEl(el: Element): string {
  const cls = typeof el.className === 'string' ? el.className : '';
  const page = el instanceof HTMLElement ? el.dataset.page : undefined;
  return `<${el.tagName.toLowerCase()}${page !== undefined ? ` data-page=${page}` : ''}${cls ? ` class="${cls}"` : ''}>`;
}

function summarize(rec: StyleWriteRecorder): string {
  const byKind = new Map<string, number>();
  for (const r of rec.records) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  }
  const kinds = [...byKind.entries()].map(([k, n]) => `${k}=${n}`).join(', ');
  return `${rec.count()} writes (${kinds}); elements=[${[...rec.elements()].map(describeEl).join(', ')}]`;
}

function styleWriteCount(rec: StyleWriteRecorder): number {
  let n = 0;
  for (const r of rec.records) {
    if (
      r.kind === 'setProperty' ||
      r.kind === 'removeProperty' ||
      r.kind === 'cssText' ||
      r.kind === 'zIndex'
    ) {
      n += 1;
    }
  }
  return n;
}

function visibleLeaf(book: PageFlip): HTMLElement {
  const render = renderOf(book);
  const page = render.leftPage ?? render.rightPage;
  if (!page) throw new Error('no visible leaf');
  return page.getElement();
}
