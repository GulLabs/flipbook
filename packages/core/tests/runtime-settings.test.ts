/**
 * `updateSettings` has to actually reach the code that reads a setting.
 *
 * The failure mode this guards is quiet: a value is accepted, echoed back by
 * `getSettings()`, and listed as runtime-updatable by the React binding, while
 * the collaborator that uses it kept a copy from construction. `swipeDistance`
 * shipped that way — set to 90, still gesturing on 30.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { Orientation, PageFlip, SizeType } from '@gullabs/flipbook-core';
import { makePages, sizeElement } from './html-book-fixture';

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

describe('runtime-updatable settings reach their collaborator', () => {
  test('swipeDistance is read live, not cached at construction', () => {
    const { engine } = book({ swipeDistance: 30 });

    engine.updateSettings({ swipeDistance: 90 });

    // Not just the echo: the UI must agree with what `getSettings()` reports.
    expect(engine.getSettings().swipeDistance).toBe(90);
    const ui = engine.getUI() as unknown as Record<string, unknown>;
    expect(ui['swipeDistance']).toBeUndefined();

    engine.destroy();
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
 * W2 — `Render` reads settings from its own reference, not through the app.
 *
 * `calculateRect` used `this.app.getSettings().usePortrait` while every value
 * beside it came from `this.setting`. The two are the same object today, so
 * that was inert; this pins the invariant that makes both correct, because the
 * moment anyone clones settings on the way in, only one of the two readers
 * keeps seeing updates — Y5's exact bug class, and `swipeDistance` already
 * shipped that way once.
 */
describe('W2 — Render and PageFlip share one settings object', () => {
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
