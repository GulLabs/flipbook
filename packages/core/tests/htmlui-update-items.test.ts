// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { PageFlip } from '@gullabs/flipbook-core';
import { makePages, sizeElement } from './html-book-fixture';

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

  test('updateFromHtml does not delete a page the caller parents itself', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const book = new PageFlip(host, { width: 200, height: 300, flippingTime: 0 });
    book.loadFromHTML([]);

    const block = book.getUI().getDistElement();
    const portalled = document.createElement('div');
    block.appendChild(portalled);

    book.updateFromHtml([portalled]);
    // The framework drops the page from the next render; it will remove the
    // node itself. Deleting it here would pull it out from under React.
    book.updateFromHtml([]);

    expect(portalled.parentElement).toBe(block);

    book.destroy();
    host.remove();
  });
});

/**
 * NF2 — the ONE path the React binding uses for every page it adds.
 *
 * `HTMLUI.adopt` snapshots which engine classes a leaf already carried, so
 * `destroy()` can hand back a node the consumer authored without stripping a
 * `--hard` they wrote themselves. That snapshot is only honest if it is taken
 * before the engine stamps its own classes on.
 */
describe('NF2 — updateFromHtml adopts a leaf before the engine stamps it', () => {
  function book(): { engine: PageFlip; host: HTMLElement; initial: HTMLElement[] } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    sizeElement(host, 400, 300);

    const initial = makePages(2);
    const engine = new PageFlip(host, { width: 200, height: 300 });
    engine.loadFromHTML(initial);
    return { engine, host, initial };
  }

  test('a page added later is handed back undressed', () => {
    const { engine, host, initial } = book();

    const added = document.createElement('div');
    added.className = 'my-page';
    document.body.appendChild(added);

    engine.updateFromHtml([...initial, added]);
    expect(added.classList.contains('stf__item')).toBe(true);

    engine.destroy();

    // Reverted fix (`pages.load()` before `ui.updateItems()`): the element still
    // reads `my-page stf__item --soft`. `adopt` recorded the engine's OWN
    // classes as pre-existing — they were, by one line — and release honoured
    // that. Under React this leaks engine classes onto a consumer node for the
    // life of the document, on every page the book grows.
    expect(added.className).toBe('my-page');

    host.remove();
    added.remove();
  });

  test('a class the CONSUMER wrote is still preserved', () => {
    const { engine, host, initial } = book();

    const added = document.createElement('div');
    added.className = 'my-page';
    // The consumer declares a hard leaf themselves, in the class the engine
    // also uses. This is the case the snapshot exists for, and the reorder must
    // not break it — a fix that simply cleaned every engine class on release
    // would pass the test above and fail this one.
    added.classList.add('--hard');
    document.body.appendChild(added);

    engine.updateFromHtml([...initial, added]);
    engine.destroy();

    expect(added.classList.contains('--hard')).toBe(true);
    expect(added.classList.contains('stf__item')).toBe(false);

    host.remove();
    added.remove();
  });

  test('the leaves present at the initial load are unaffected', () => {
    const { engine, host, initial } = book();

    // The control: initial-load leaves already cleaned correctly, so a change
    // that only moved the bug around would show up here.
    engine.destroy();
    expect(initial[0]!.className).toBe('');

    host.remove();
  });
});
