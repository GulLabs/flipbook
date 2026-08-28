/**
 * Coverage is a byproduct, not the goal — real pointer capture / leave / swipe paths.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FlippingState, PageFlip } from '@gullabs/flipbook-core';
import { installPointerCaptureShims, makeHtmlBook } from './html-book-fixture';

const books: Array<{ destroy: () => void }> = [];

beforeEach(() => {
  installPointerCaptureShims();
});

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  vi.useRealTimers();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook(opts);
  books.push(b);
  return b;
}

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

describe('UI pointer paths', () => {
  test('pointerdown + move + up performs a corner click turn', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, swipeDistance: 80 });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const x = rect.left + rect.width - 6;
    const y = rect.top + 6;

    pointer('pointerdown', dist, { clientX: x, clientY: y });
    pointer('pointerup', dist, { clientX: x, clientY: y });

    expect(app.getCurrentPageIndex()).toBe(1);
    expect(app.getState()).toBe(FlippingState.READ);
  });

  test('horizontal swipe past swipeDistance calls flipNext', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, swipeDistance: 40 });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const y = rect.top + 40;
    const startX = rect.left + rect.width - 20;

    pointer('pointerdown', dist, { clientX: startX, clientY: y });
    // Fast left swipe (dx negative → next in LTR).
    pointer('pointerup', dist, { clientX: startX - 120, clientY: y + 5 });

    expect(app.getCurrentPageIndex()).toBe(1);
  });

  test('rtl swipe mapping: positive dx advances next', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      swipeDistance: 40,
      direction: 'rtl',
    });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const y = rect.top + 30;
    const startX = rect.left + 40;

    pointer('pointerdown', dist, { clientX: startX, clientY: y });
    pointer('pointerup', dist, { clientX: startX + 120, clientY: y });

    expect(app.getCurrentPageIndex()).toBe(1);
  });

  test('pointerleave while idle after a corner fold restores READ', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0, showPageCorners: true });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();

    // Hover corner (no pointerdown) → showCorner.
    pointer('pointermove', dist, {
      clientX: rect.left + rect.width - 4,
      clientY: rect.top + 4,
      buttons: 0,
    });

    // Leave with no active pointer → onPointerLeave stopMove path.
    dist.dispatchEvent(
      new PointerEvent('pointerleave', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );

    expect(app.getState()).toBe(FlippingState.READ);
  });

  test('pointerleave during an active drag is ignored (no double stopMove)', () => {
    const { book: app } = book({ pageCount: 4, flippingTime: 0 });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const x = rect.left + rect.width - 8;
    const y = rect.top + 12;

    pointer('pointerdown', dist, { clientX: x, clientY: y });
    pointer('pointermove', dist, { clientX: x - 40, clientY: y + 10 });

    const stateDuringDrag = app.getState();
    dist.dispatchEvent(
      new PointerEvent('pointerleave', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
    // Active pointer id is set → leave must not force READ mid-drag.
    expect(app.getState()).toBe(stateDuringDrag);

    pointer('pointerup', dist, { clientX: x - 40, clientY: y + 10 });
    expect(app.getState()).toBe(FlippingState.READ);
  });

  test('clickEventForward skips interactive children (button / anchor)', () => {
    const { book: app, pages } = book({
      pageCount: 3,
      flippingTime: 0,
      clickEventForward: true,
    });
    const btn = document.createElement('button');
    btn.textContent = 'go';
    pages[0]!.appendChild(btn);

    const rect = app.getBoundsRect();
    pointer('pointerdown', btn, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });
    pointer('pointerup', btn, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });

    // Handlers bail on button targets → no turn.
    expect(app.getCurrentPageIndex()).toBe(0);
  });

  test('useMouseEvents false leaves the book unresponsive to pointers', () => {
    const { book: app } = book({
      pageCount: 3,
      flippingTime: 0,
      useMouseEvents: false,
    });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();

    pointer('pointerdown', dist, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });
    pointer('pointerup', dist, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });

    expect(app.getCurrentPageIndex()).toBe(0);
  });

  test('refreshHandlers after enabling mouse events binds again', () => {
    const { book: app } = book({
      pageCount: 3,
      flippingTime: 0,
      useMouseEvents: false,
    });

    app.updateSettings({ useMouseEvents: true });

    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    pointer('pointerdown', dist, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });
    pointer('pointerup', dist, {
      clientX: rect.left + rect.width - 5,
      clientY: rect.top + 5,
    });

    expect(app.getCurrentPageIndex()).toBe(1);
  });

  test('destroy restores host styles and removes wrapper', () => {
    const host = document.createElement('div');
    host.style.width = '50%';
    host.style.display = 'inline-block';
    document.body.appendChild(host);

    const pages = [0, 1, 2].map((i) => {
      const el = document.createElement('div');
      el.textContent = String(i);
      return el;
    });
    for (const p of pages) host.appendChild(p);

    const app = new PageFlip(host, { width: 200, height: 300, flippingTime: 0, size: 'fixed' });
    app.loadFromHTML(pages);
    expect(host.classList.contains('stf__parent')).toBe(true);

    app.destroy();
    expect(host.classList.contains('stf__parent')).toBe(false);
    expect(host.querySelector('.stf__wrapper')).toBeNull();
    expect(host.style.display).toBe('inline-block');
    expect(host.style.width).toBe('50%');
    host.remove();
  });

  test('touch pointer with mobileScrollSupport gates preventDefault on move', () => {
    const { book: app } = book({
      pageCount: 4,
      flippingTime: 0,
      mobileScrollSupport: true,
    });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();
    const start = { x: rect.left + rect.width - 10, y: rect.top + 20 };

    dist.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        clientX: start.x,
        clientY: start.y,
        button: 0,
      }),
    );
    dist.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        clientX: start.x - 50,
        clientY: start.y + 5,
        buttons: 1,
      }),
    );
    dist.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        clientX: start.x - 50,
        clientY: start.y + 5,
      }),
    );

    expect(app.getState()).toBe(FlippingState.READ);
  });

  test('non-primary mouse button is ignored', () => {
    const { book: app } = book({ pageCount: 3, flippingTime: 0 });
    const dist = app.getUI().getDistElement();
    const rect = app.getBoundsRect();

    dist.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        clientX: rect.left + rect.width - 5,
        clientY: rect.top + 5,
      }),
    );
    expect(app.getCurrentPageIndex()).toBe(0);
  });
});
