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
import { afterEach, describe, expect, test } from 'vitest';
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
 * B1 budget pins — test.fails until B3.1–B3.4
 * ------------------------------------------------------------------ */

describe('frame discipline (B1)', () => {
  /**
   * Resting redraw writes nothing.
   *
   * Pre-fix this fails loudly: measured **54** writes on a settled 10-leaf
   * landscape redraw (`applyEngineStyle` ~setProperty/removeProperty per drawn
   * leaf, plus unconditional classList add/remove). B3.1 + B3.4 are both
   * required before this can pass.
   */
  test.fails('resting redraw writes nothing', () => {
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
  test.fails('mid-fold frame touches only the working set', () => {
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
    const extras = [...written].filter((el) => !allowed.has(el));
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
   * writes. Post-B3 ceiling is measured + 25% of the fixed count; the
   * aspiration below is the post-fix budget so `test.fails` stays red until
   * B3 lands. After B3, re-measure, set
   * `MEASURED_POST_FIX` to the new number, ceiling = measured * 1.25, and
   * drop `test.fails`.
   */
  test.fails('mid-fold write count is bounded', () => {
    const { book } = landscape10();
    recorder = installStyleWriteRecorder();

    book.startUserTouch({ x: 850, y: 150 });
    book.userMove({ x: 500, y: 150 }, false);
    drawFrame(book);

    recorder.reset();
    book.userMove({ x: 480, y: 150 }, false);
    drawFrame(book);

    // Post-fix aspiration (pre-fix measured 106). Ceiling = measured + 25%.
    const MEASURED_POST_FIX_ASPIRATION = 80;
    const ceiling = Math.ceil(MEASURED_POST_FIX_ASPIRATION * 1.25);

    expect(
      recorder.count(),
      `mid-fold writes ${recorder.count()} exceed budget ${ceiling}: ${summarize(recorder)}`,
    ).toBeLessThanOrEqual(ceiling);
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
