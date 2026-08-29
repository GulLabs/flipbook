// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';

describe('HTMLUI.updateItems (shipped)', () => {
  test('does not wipe sibling shadow nodes under .stf__block', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const a = document.createElement('div');
    a.textContent = 'A';
    const b = document.createElement('div');
    b.textContent = 'B';
    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML([a, b]);
    const block = book.getUI().getDistElement();
    const shadow = document.createElement('div');
    shadow.setAttribute('data-test-shadow', '1');
    block.appendChild(shadow);
    const c = document.createElement('div');
    c.textContent = 'C';
    book.updateFromHtml([a, c]);
    expect(block.querySelector('[data-test-shadow="1"]')).toBeTruthy();
    expect(a.parentElement).toBe(block);
    expect(c.parentElement).toBe(block);
    book.destroy();
    host.remove();
  });
});

describe('clear() and the framework that owns the leaves', () => {
  /**
   * The React binding portals its pages into `.stf__block`, so React's recorded
   * parent for those nodes *is* that block. `clear()` moved them back to the
   * host element, which silently invalidates that: React's next removal or
   * reorder throws `NotFoundError` — the exact failure the portal was
   * introduced to fix.
   *
   * Leaves the engine adopted itself (the vanilla path, where the caller
   * handed us detached nodes) still go back where they came from.
   */
  test('a page the caller still parents is left where the caller put it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML([]);

    const block = book.getUI().getDistElement();

    // A framework-owned leaf: created inside the block, never adopted from
    // elsewhere — exactly what createPortal produces.
    const portalled = document.createElement('div');
    portalled.dataset['owner'] = 'framework';
    block.appendChild(portalled);

    book.updateFromHtml([portalled]);
    book.clear();

    expect(portalled.parentElement).toBe(block);

    book.destroy();
    host.remove();
  });
});
