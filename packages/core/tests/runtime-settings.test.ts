/**
 * `updateSettings` has to actually reach the code that reads a setting.
 *
 * The failure mode this guards is quiet: a value is accepted, echoed back by
 * `getSettings()`, and listed as runtime-updatable by the React binding, while
 * the collaborator that uses it kept a copy from construction. `swipeDistance`
 * shipped that way — set to 90, still gesturing on 30.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Orientation, PageFlip, SizeType } from '@gullabs/flipbook-core';
import {
  installPointerCaptureShims,
  makeHtmlBook,
  makePages,
  sizeElement,
} from './html-book-fixture';

function book(overrides: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, 800, 600);

  const engine = new PageFlip(host, {
    width: 300,
    height: 400,
    flippingTime: 0,
    ...overrides,
  });
  engine.loadFromHTML(makePages(4));
  return { engine, host };
}

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * Drive one horizontal drag of `dx` pixels through the real pointer path.
 *
 * A pointermove is part of it on purpose: without one, `isUserMove` stays false
 * and `PageFlip.userStop` falls through to the CLICK-turn path, which turns the
 * page whatever the swipe threshold says — a "did not swipe" assertion would
 * then be measuring the wrong mechanism.
 */
function drag(app: PageFlip, dx: number): void {
  const dist = app.getUI().getDistElement();
  const rect = app.getBoundsRect();
  // Mid-height: clear of both corner bands, so nothing here is a corner fold.
  const y = rect.top + rect.height / 2;
  const startX = rect.left + rect.width - 10;

  for (const [type, x] of [
    ['pointerdown', startX],
    ['pointermove', startX + dx],
    ['pointerup', startX + dx],
  ] as const) {
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
  }
}

beforeEach(() => {
  installPointerCaptureShims();
});

describe('runtime-updatable settings reach their collaborator', () => {
  /**
   * BEHAVIOURAL, because the previous version was not.
   *
   * It asserted `ui['swipeDistance'] === undefined` — a claim about a PRIVATE
   * FIELD NAME, evaluated before any swipe happened. Two separate mutations
   * that re-cached the setting survived it, including one caching under that
   * exact name (the cache is filled on first USE, and the old test never
   * swiped). It also pinned an implementation detail, so an honest rename would
   * have reddened it.
   *
   * The only thing worth asserting is the gesture: the SAME drag must turn the
   * page under a threshold below it and must not under one above it, with the
   * only difference being a runtime `updateSettings` call.
   */
  test('swipeDistance is read live, not cached at construction', () => {
    const { book: app } = makeHtmlBook({
      pageCount: 6,
      flippingTime: 0,
      swipeDistance: 30,
    });

    // 50 px > 30: a swipe. (`distY` is 0, well inside `swipeDistance * 2`.)
    drag(app, -50);
    expect(app.getCurrentPageIndex()).toBe(1);

    app.updateSettings({ swipeDistance: 90 });
    expect(app.getSettings().swipeDistance).toBe(90);

    // The IDENTICAL drag, now under the threshold. A `UI` that cached 30 at
    // construction — or on first use — still turns the page here.
    drag(app, -50);
    expect(app.getCurrentPageIndex()).toBe(1);

    // …and the setting is live in both directions, not a one-way latch.
    app.updateSettings({ swipeDistance: 30 });
    drag(app, -50);
    expect(app.getCurrentPageIndex()).toBe(2);

    app.destroy();
  });

  test('width / height restyle the host instead of needing a rebuild', () => {
    const { engine, host } = book({
      size: SizeType.FIXED,
      width: 300,
      height: 400,
      usePortrait: false,
    });

    // FIXED + two-page spread ⇒ the host reserves width × 2.
    expect(host.style.minWidth).toBe('600px');
    expect(host.style.minHeight).toBe('400px');

    engine.updateSettings({ width: 320, height: 420 });

    expect(engine.getSettings().width).toBe(320);
    expect(host.style.minWidth).toBe('640px');
    expect(host.style.minHeight).toBe('420px');

    engine.destroy();
  });

  test('pageBackground reaches the rendered leaf', async () => {
    const { engine } = book();

    engine.updateSettings({ pageBackground: '#f5f0e6' });

    // cssText is written by drawFrame, which only runs inside the rAF loop.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const leaf = document.querySelector('.stf__item');
    expect(leaf).toBeInstanceOf(HTMLElement);
    expect((leaf as HTMLElement).style.cssText.toLowerCase()).toMatch(
      /background-color:\s*(#f5f0e6|rgb\(245,\s*240,\s*230\))/,
    );

    engine.destroy();
  });

  test('direction flips the turn resolved for a user point', () => {
    const { engine } = book();

    engine.turnToPage(1);
    engine.updateSettings({ direction: 'rtl' });
    expect(engine.getSettings().direction).toBe('rtl');

    // The engine keeps working after the switch; the mapping itself is
    // asserted end-to-end in e2e/flip-invariants.spec.ts, which can measure a
    // real fold.
    expect(engine.flipPrev()).toBe(true);

    engine.destroy();
  });
});

/**
 * `Render` and `PageFlip` share ONE settings object.
 *
 * Renamed from "W2" and re-scoped, because as a W2 test it was worthless and
 * Codex was right to say so: `this.setting` and `app.getSettings()` are the
 * same mutated object, so reverting the reader W2 changed leaves this passing.
 * It never could have discriminated — there is no observable difference between
 * two names for one object, which is exactly WHY W2 was recorded as a
 * consistency fix and not a defect.
 *
 * What it does prove is the invariant that makes both readers correct: settings
 * reach `Render` live. Revert THAT — clone the object in `Render`'s constructor
 * — and this fails. That is the failure W2 was insurance against, and it is the
 * one worth a test.
 */
describe('settings reach Render live, not by value', () => {
  test('updateSettings({ usePortrait }) reaches the render geometry', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 900, 400);

    const book = new PageFlip(host, { width: 200, height: 300, usePortrait: true });
    book.loadFromHTML(makePages(6));

    // T1, paid off for this test. `computeBounds` measures
    // `getUI().getDistElement()` — the engine's own `.stf__block` — and NOT the
    // host the consumer passed in. jsdom leaves that block 0x0 forever, at
    // which point `update()` returns early as "not observed" and the
    // orientation never moves at all. Stubbing the host looks right, changes
    // nothing, and lets every assertion below pass without reaching the branch
    // it names; the first two drafts of this test did exactly that.
    const measured = book.getUI().getDistElement();
    sizeElement(measured, 250, 400);
    book.update();
    expect(book.getOrientation()).toBe(Orientation.PORTRAIT);

    // Now forbid portrait at RUNTIME, on a box narrow enough that the portrait
    // branch is the one being taken. `updateSettings` mutates the settings
    // object in place, so a `Render` reading through that shared reference sees
    // it for free; one holding its own copy would keep reporting portrait.
    book.updateSettings({ usePortrait: false });
    expect(book.getOrientation()).toBe(Orientation.LANDSCAPE);

    // …and back, so the test pins a live setting rather than a one-way latch.
    book.updateSettings({ usePortrait: true });
    expect(book.getOrientation()).toBe(Orientation.PORTRAIT);

    book.destroy();
    host.remove();
  });
});

describe('the host sizing invariant U10 now depends on', () => {
  test('a fixed-size book stamps the host from width/height, via minWidth/minHeight', () => {
    // `applyHostSize` used to re-stamp `width * k` / `height` inside a
    // `size === FIXED` branch, immediately after stamping `minWidth * k` /
    // `minHeight`. That branch was provably inert: `Settings` assigns
    // `minWidth = width` and `minHeight = height` for EVERY non-stretch size,
    // so it rewrote the two lines above it with identical values.
    //
    // Deleting it makes host sizing depend on that `Settings` assignment. That
    // coupling was already covered — `settings.test.ts` and
    // `pointer-transform.test.ts:603-623` pin it, the latter for both k=1 and
    // k=2 — so this is a landscape-only restatement, kept because it is the
    // case the deleted branch was ostensibly there for and it names the reason.
    // Corrected from an earlier version claiming nothing tested the coupling;
    // that was false, and a false claim in a comment outlives the test.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = makePages(4);
    for (const p of pages) host.appendChild(p);

    const b = new PageFlip(host, {
      width: 200,
      height: 300,
      size: 'fixed',
      usePortrait: false,
    });
    b.loadFromHTML(pages);

    // Landscape: k = 2, so the host reserves room for two leaves.
    expect(host.style.minWidth).toBe('400px');
    expect(host.style.minHeight).toBe('300px');

    b.destroy();
    host.remove();
  });
});
