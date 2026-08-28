import { describe, expect, test } from 'vitest';
import { Flip, FlipCorner, FlipDirection, FlippingState, PageFlipError } from '@gullabs/flipbook-core';
import type { Render } from '@gullabs/flipbook-core';

type CollectionStub = {
  spread: number;
  spreadCount: number;
  getCurrentSpreadIndex: () => number;
  getSpreadCount: () => number;
  getSpreadIndexByPage: (page: number) => number | null;
  setCurrentSpreadIndex: (index: number) => void;
  getFlippingPage: () => { id: string };
  getBottomPage: () => { id: string };
};

function makeFlip(options?: { pageCount?: number; currentPage?: number }) {
  const collection: CollectionStub = {
    spread: 1,
    // Portrait stub: one spread per page.
    spreadCount: options?.pageCount ?? 0,
    getCurrentSpreadIndex() {
      return this.spread;
    },
    getSpreadCount() {
      return this.spreadCount;
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
    startAnimation(_frames: Array<() => void>, _duration: number, onEnd: () => void) {
      const last = _frames[_frames.length - 1];
      if (last) last();
      onEnd();
    },
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

  test('flipToPage with flippingTime 0 does not throw after a successful instant turn', () => {
    const { flip, collection } = makeFlip({ pageCount: 8, currentPage: 1 });
    expect(() => flip.flipToPage(3, FlipCorner.TOP)).not.toThrow();
    expect(collection.spread).not.toBe(1);
  });

  test('flipNext stays FORWARD under direction rtl (no shared-resolver invert)', () => {
    const seen: number[] = [];
    const { flip } = makeFlip({ pageCount: 8, currentPage: 1 });
    const app = (flip as unknown as { app: { getSettings: () => Record<string, unknown> } }).app;
    const orig = app.getSettings;
    app.getSettings = () => ({ ...orig(), direction: 'rtl' });
    const render = (flip as unknown as { render: { setDirection: (d: number) => void } }).render;
    const setDirection = render.setDirection.bind(render);
    render.setDirection = (d: number) => {
      seen.push(d);
      setDirection(d);
    };
    flip.flipNext(FlipCorner.TOP);
    expect(seen[0]).toBe(FlipDirection.FORWARD);
  });
});
