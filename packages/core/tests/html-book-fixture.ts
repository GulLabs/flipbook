/**
 * Shared FIXED-size HTML book harness for jsdom integration tests.
 * Coverage is a byproduct — helpers only size the host so geometry is real.
 */
import { PageFlip } from '@gullabs/flipbook-core';
import type { FlipSetting } from '@gullabs/flipbook-core';

export type BookOpts = Partial<FlipSetting> & {
  pageCount?: number;
  hostWidth?: number;
  hostHeight?: number;
};

/** jsdom reports 0×0 boxes; FIXED size still needs a non-zero dist box for stretch paths. */
export function sizeElement(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      width,
      height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
}

export function makePages(count: number, hardFirst = false): HTMLElement[] {
  return Array.from({ length: count }, (_, i) => {
    const el = document.createElement('div');
    el.dataset.page = String(i);
    el.textContent = `page-${i}`;
    if (hardFirst && i === 0) el.dataset.density = 'hard';
    return el;
  });
}

export function makeHtmlBook(opts: BookOpts = {}): {
  host: HTMLElement;
  book: PageFlip;
  pages: HTMLElement[];
  destroy: () => void;
} {
  const width = opts.width ?? 200;
  const height = opts.height ?? 300;
  // FIXED + host narrower than 2×pageWidth forces portrait when usePortrait is on.
  const hostW = opts.hostWidth ?? Math.max(1, width * 2 - 20);
  const hostH = opts.hostHeight ?? height;
  const pageCount = opts.pageCount ?? 4;

  const host = document.createElement('div');
  document.body.appendChild(host);
  sizeElement(host, hostW, hostH);

  const pages = makePages(pageCount, Boolean(opts.showCover));
  for (const p of pages) host.appendChild(p);

  const book = new PageFlip(host, {
    width,
    height,
    size: 'fixed',
    flippingTime: 0,
    usePortrait: true,
    drawShadow: true,
    showPageCorners: true,
    pageBackground: '#fff',
    ...opts,
  });

  book.loadFromHTML(pages);

  const dist = book.getUI().getDistElement();
  sizeElement(dist, hostW, hostH);
  // Bounds depend on dist offset*; force a layout pass.
  book.update();

  return {
    host,
    book,
    pages,
    destroy() {
      book.destroy();
      host.remove();
    },
  };
}

/** Pointer capture is incomplete in jsdom — keep the real path callable. */
export function installPointerCaptureShims(): void {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
}
