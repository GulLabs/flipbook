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
import { PageFlip, SizeType } from '@gullabs/flipbook-core';
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
