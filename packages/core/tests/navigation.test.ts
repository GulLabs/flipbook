import { describe, expect, test } from 'vitest';
import { Flip, FlipCorner, FlippingState, PageFlipError } from '@gullabs/flipbook-core';
import type { Render } from '@gullabs/flipbook-core';

type CollectionStub = {
  spread: number;
  getCurrentSpreadIndex: () => number;
  getSpreadIndexByPage: (page: number) => number | null;
  setCurrentSpreadIndex: (index: number) => void;
  getFlippingPage: () => { id: string };
  getBottomPage: () => { id: string };
};

function makeFlip(options?: { pageCount?: number; currentPage?: number }) {
  const collection: CollectionStub = {
    spread: 1,
    getCurrentSpreadIndex() {
      return this.spread;
    },
    getSpreadIndexByPage(page: number) {
      if (page < 0) return null;
      return page;
    },
    setCurrentSpreadIndex(index: number) {
      if (index < 0 || index > 10) {
        throw new Error('Invalid page');
      }
      this.spread = index;
    },
    getFlippingPage() {
      return { id: 'flip' };
    },
    getBottomPage() {
      return { id: 'bottom' };
    },
  };

  const render = {
    finishAnimation() {},
    convertToPage(pos: { x: number; y: number }) {
      return pos;
    },
    convertToBook(pos: { x: number; y: number }) {
      return pos;
    },
    getRect() {
      return { left: 0, top: 0, width: 800, height: 600, pageWidth: 400 };
    },
    getOrientation() {
      return 'portrait';
    },
    setDirection() {},
    setPageRect() {},
    setBottomPage() {},
    setFlippingPage() {},
    setShadowData() {},
    startAnimation() {},
    clearShadow() {},
  };

  const app = {
    getPageCollection: () => collection,
    getSettings: () => ({
      disableFlipByClick: false,
      flippingTime: 0,
      respectReducedMotion: true,
      direction: 'ltr' as const,
      showPageCorners: true,
    }),
    getCurrentPageIndex: () => options?.currentPage ?? 0,
    getPageCount: () => options?.pageCount ?? 0,
    turnToPrevPage() {},
    turnToNextPage() {},
    updateState() {},
  };

  const flip = new Flip(render as unknown as Render, app as never);
  return { flip, collection };
}

describe('flipToPage / turnToPage failure surface (shipped Flip)', () => {
  test('flipToPage throws on unknown page instead of swallowing', () => {
    const { flip, collection } = makeFlip({ pageCount: 4, currentPage: 1 });
    const before = collection.spread;
    expect(() => flip.flipToPage(-3, FlipCorner.TOP)).toThrow(PageFlipError);
    expect(collection.spread).toBe(before);
  });

  test('flipToPage restores spread and throws when setup cannot start', () => {
    const { flip, collection } = makeFlip({ pageCount: 0, currentPage: 0 });
    const before = collection.spread;
    expect(() => flip.flipToPage(3, FlipCorner.TOP)).toThrow(/Flip setup failed/);
    expect(collection.spread).toBe(before);
    expect(flip.getState()).not.toBe(FlippingState.FLIPPING);
  });
});
