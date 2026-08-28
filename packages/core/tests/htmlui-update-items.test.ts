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
