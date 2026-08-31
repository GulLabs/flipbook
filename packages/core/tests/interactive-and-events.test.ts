// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import {
  isInteractivePointerTarget,
  FLIPBOOK_INTERACTIVE_SELECTOR,
  PageFlip,
  PageFlipError,
} from '@gullabs/flipbook-core';
import { prefersReducedMotion } from '../src/reducedMotion';
import { effectiveFlippingTime } from '../src/reducedMotion';

describe('isInteractivePointerTarget (shipped)', () => {
  test('detects nested control and ARIA widget', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div><button type="button"><span id="inner">Go</span></button></div>`;
    document.body.appendChild(root);
    expect(isInteractivePointerTarget(root.querySelector('#inner'))).toBe(true);
    expect(isInteractivePointerTarget(root)).toBe(false);
    expect(FLIPBOOK_INTERACTIVE_SELECTOR.includes('label')).toBe(true);
    root.remove();
  });
});

describe('reduced motion (shipped)', () => {
  test('matchMedia reduce forces instant when respected', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: String(query).includes('prefers-reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    expect(effectiveFlippingTime(800, true)).toBe(0);
    expect(effectiveFlippingTime(800, false)).toBe(800);
    window.matchMedia = original;
  });
});

describe('PageFlip.flipNext boolean + turnRejected (shipped)', () => {
  test('returns false and emits turnRejected at end of book', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pages = [0, 1].map((i) => {
      const el = document.createElement('div');
      el.textContent = `p${i}`;
      return el;
    });
    const book = new PageFlip(host, {
      width: 200,
      height: 300,
      flippingTime: 0,
      usePortrait: true,
      hardCovers: false,
    });
    book.loadFromHTML(pages);
    book.turnToPage(1);
    const rejected = vi.fn();
    book.on('turnRejected', rejected);
    expect(book.flipNext()).toBe(false);
    expect(rejected).toHaveBeenCalled();
    book.destroy();
    host.remove();
  });
});

describe('PageFlip.turnToPage PageFlipError (shipped)', () => {
  test('invalid turnToPage throws PageFlipError with code', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const book = new PageFlip(host, { width: 100, height: 100, flippingTime: 0 });
    book.loadFromHTML([document.createElement('div'), document.createElement('div')]);
    expect(() => book.turnToPage(99)).toThrow(PageFlipError);
    book.destroy();
    host.remove();
  });
});
