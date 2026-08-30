/**
 * RB6: fold clone must be scenery (not in a11y/focus tree).
 * H7: HTMLPage must not keep a dead `isLoad` field that pretends to gate drawing.
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
