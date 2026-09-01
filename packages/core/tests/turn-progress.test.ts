/**
 * Campaign C — `turnProgress` emission semantics (PLAN-3.1 § C3).
 *
 * Progress is a value stream from `Flip.do`, not a frame clock. Instant turns
 * and hover peels must stay silent; direction is semantic page-index order.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FlippingState, type FlipbookEventMap } from '@gullabs/flipbook-core';
import { turnProgressPayload } from '../src/Event/EventObject';
import { makeHtmlBook, installPointerCaptureShims } from './html-book-fixture';
import { testFlip, testRender } from './engine-access';

type Progress = FlipbookEventMap['turnProgress'];

const books: Array<{ destroy: () => void }> = [];

afterEach(() => {
  while (books.length) books.pop()?.destroy();
  vi.restoreAllMocks();
});

beforeEach(() => {
  installPointerCaptureShims();
});

function book(opts?: Parameters<typeof makeHtmlBook>[0]) {
  const b = makeHtmlBook({ pageCount: 6, usePortrait: true, ...opts });
  books.push(b);
  return b;
}

/** Own the rAF queue so animated turns play under controlled timestamps. */
function installRafQueue(): {
  flush: (stepMs?: number, maxTicks?: number) => void;
  restore: () => void;
} {
  const queued: FrameRequestCallback[] = [];
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  }) as typeof globalThis.requestAnimationFrame;

  globalThis.cancelAnimationFrame = (() => {
    queued.length = 0;
  }) as typeof globalThis.cancelAnimationFrame;

  let clock = 0;
  return {
    flush(stepMs = 16, maxTicks = 80) {
      for (let i = 0; i < maxTicks && queued.length > 0; i += 1) {
        const batch = queued.splice(0, queued.length);
        clock += stepMs;
        for (const cb of batch) cb(clock);
      }
    },
    restore() {
      globalThis.requestAnimationFrame = realRaf;
      globalThis.cancelAnimationFrame = realCancel;
    },
  };
}

describe('turnProgress — animated and drag paths', () => {
  test('programmatic animated flip emits a non-decreasing [0,1] next stream', () => {
    const raf = installRafQueue();
    try {
      const { book: app } = book({ flippingTime: 200 });
      // Drain the load-time orientation frame before subscribing.
      raf.flush();

      const payloads: Progress[] = [];
      app.on('turnProgress', (e) => payloads.push(e.data));

      expect(app.flipNext()).toBe(true);
      expect(app.getState()).toBe(FlippingState.FLIPPING);

      raf.flush(20, 120);

      expect(payloads.length).toBeGreaterThanOrEqual(2);
      for (const p of payloads) {
        expect(p.progress).toBeGreaterThanOrEqual(0);
        expect(p.progress).toBeLessThanOrEqual(1);
        expect(p.direction).toBe('next');
      }
      for (let i = 1; i < payloads.length; i += 1) {
        expect(payloads[i]!.progress).toBeGreaterThanOrEqual(payloads[i - 1]!.progress);
      }
      expect(app.getState()).toBe(FlippingState.READ);
    } finally {
      raf.restore();
    }
  });

  test('drag fold emits monotonically tracking progress', () => {
    const { book: app } = book({ flippingTime: 200 });
    const flip = testFlip(app)!;
    const rect = app.getBoundsRect();

    const payloads: Progress[] = [];
    app.on('turnProgress', (e) => payloads.push(e.data));

    const y = rect.top + 20;
    const start = { x: rect.left + rect.width - 5, y };
    app.startUserTouch(start);

    // Monotonic inward drag along the right edge (FORWARD).
    const xs = [start.x - 20, start.x - 40, start.x - 70, start.x - 110];
    for (const x of xs) {
      app.userMove({ x, y: y + 10 }, false);
      (testRender(app) as unknown as { drawFrame: () => void }).drawFrame();
    }

    expect(flip.getState()).toBe(FlippingState.USER_FOLD);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    for (const p of payloads) {
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThanOrEqual(1);
      expect(p.direction).toBe('next');
    }
    for (let i = 1; i < payloads.length; i += 1) {
      expect(payloads[i]!.progress).toBeGreaterThanOrEqual(payloads[i - 1]!.progress);
    }

    // Snap back without committing so the book is clean for afterEach.
    flip.stopMove();
    testRender(app).finishAnimation();
  });
});

describe('turnProgress — silence gates', () => {
  test('instant turn (flippingTime: 0) emits zero turnProgress while flip still fires', () => {
    const { book: app } = book({ flippingTime: 0 });
    const progress = vi.fn();
    const flipped = vi.fn();
    app.on('turnProgress', progress);
    app.on('flip', flipped);

    expect(app.flipNext()).toBe(true);
    expect(progress).not.toHaveBeenCalled();
    expect(flipped).toHaveBeenCalled();
  });

  test('RTL flipNext still reports direction: next (semantic, not geometric)', () => {
    const raf = installRafQueue();
    try {
      const { book: app } = book({ flippingTime: 200, readingDirection: 'rtl' });
      raf.flush();

      const directions: Array<Progress['direction']> = [];
      app.on('turnProgress', (e) => directions.push(e.data.direction));

      expect(app.flipNext()).toBe(true);
      raf.flush(20, 120);

      expect(directions.length).toBeGreaterThanOrEqual(1);
      expect(directions.every((d) => d === 'next')).toBe(true);
    } finally {
      raf.restore();
    }
  });

  test('no listener: turnProgressPayload.build is never called; with listener it is', () => {
    const raf = installRafQueue();
    try {
      const spy = vi.spyOn(turnProgressPayload, 'build');

      const silent = book({ flippingTime: 200 });
      raf.flush();
      spy.mockClear();
      expect(silent.book.flipNext()).toBe(true);
      raf.flush(20, 120);
      expect(spy).not.toHaveBeenCalled();
      silent.destroy();
      books.pop();

      const live = book({ flippingTime: 200 });
      raf.flush();
      live.book.on('turnProgress', () => undefined);
      spy.mockClear();
      expect(live.book.flipNext()).toBe(true);
      raf.flush(20, 120);
      expect(spy).toHaveBeenCalled();
    } finally {
      raf.restore();
    }
  });

  test('hover corner peel emits zero turnProgress', () => {
    const raf = installRafQueue();
    try {
      // Real duration so peel-in installs frames rather than running instantly.
      const { book: app } = book({ flippingTime: 200, foldCornerOnHover: true });
      raf.flush();

      const progress = vi.fn();
      app.on('turnProgress', progress);

      const flip = testFlip(app)!;
      const rect = app.getBoundsRect();
      const onCorner = { x: rect.left + rect.width - 5, y: rect.top + 5 };

      flip.showCorner(onCorner);
      expect(flip.getState()).toBe(FlippingState.FOLD_CORNER);
      raf.flush(16, 40);
      expect(progress).not.toHaveBeenCalled();

      // Peel-out.
      flip.showCorner({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      raf.flush(16, 40);
      testRender(app).finishAnimation();
      expect(progress).not.toHaveBeenCalled();
    } finally {
      raf.restore();
    }
  });

  test('reduced motion forces instant turns with zero turnProgress', () => {
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

    try {
      const { book: app } = book({
        flippingTime: 400,
        respectReducedMotion: true,
      });
      const progress = vi.fn();
      const flipped = vi.fn();
      app.on('turnProgress', progress);
      app.on('flip', flipped);

      expect(app.flipNext()).toBe(true);
      expect(progress).not.toHaveBeenCalled();
      expect(flipped).toHaveBeenCalled();
      expect(app.getState()).toBe(FlippingState.READ);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('turnProgress — terminal ordering and teardown', () => {
  test('snap-back: no turnProgress after changeState(read), and no flip', () => {
    const raf = installRafQueue();
    try {
      const { book: app } = book({ flippingTime: 200 });
      raf.flush();

      const timeline: string[] = [];
      app.on('turnProgress', () => timeline.push('progress'));
      app.on('changeState', (e) => timeline.push(`state:${e.data.state}`));
      app.on('flip', () => timeline.push('flip'));

      const flip = testFlip(app)!;
      const rect = app.getBoundsRect();
      const y = rect.top + 10;
      const start = { x: rect.left + rect.width - 8, y };
      app.startUserTouch(start);
      // Stay on the page side of the spine so stopMove snaps back.
      app.userMove({ x: start.x - 30, y: y + 8 }, false);
      expect(flip.getState()).toBe(FlippingState.USER_FOLD);
      expect(flip.getCalculation()).not.toBeNull();

      const before = app.getCurrentPageIndex();
      flip.stopMove();
      raf.flush(16, 80);

      expect(app.getCurrentPageIndex()).toBe(before);
      expect(timeline.includes('flip')).toBe(false);

      const readAt = timeline.lastIndexOf('state:read');
      expect(readAt).toBeGreaterThanOrEqual(0);
      const progressAfterRead = timeline.slice(readAt + 1).filter((t) => t === 'progress');
      expect(progressAfterRead).toEqual([]);
    } finally {
      raf.restore();
    }
  });

  test('committed turn: last turnProgress precedes flip; nothing after flip for that turn', () => {
    const raf = installRafQueue();
    try {
      const { book: app } = book({ flippingTime: 200 });
      raf.flush();

      const timeline: string[] = [];
      app.on('turnProgress', () => timeline.push('progress'));
      app.on('flip', () => timeline.push('flip'));
      app.on('changeState', (e) => timeline.push(`state:${e.data.state}`));

      expect(app.flipNext()).toBe(true);
      raf.flush(20, 120);

      const flipAt = timeline.indexOf('flip');
      expect(flipAt).toBeGreaterThanOrEqual(0);
      const progressBefore = timeline.slice(0, flipAt).filter((t) => t === 'progress');
      expect(progressBefore.length).toBeGreaterThanOrEqual(1);
      const progressAfter = timeline.slice(flipAt + 1).filter((t) => t === 'progress');
      expect(progressAfter).toEqual([]);
    } finally {
      raf.restore();
    }
  });

  test('destroy from turnProgress mid-turn: teardown completes; second listener still gets in-flight event', () => {
    const raf = installRafQueue();
    try {
      const { book: app } = book({ flippingTime: 200 });
      raf.flush();

      const second = vi.fn();
      let destroyed = false;
      const postDestroy: string[] = [];

      app.on('turnProgress', () => {
        if (destroyed) {
          postDestroy.push('progress');
          return;
        }
        destroyed = true;
        app.destroy();
      });
      app.on('turnProgress', second);

      // One permitted abandon emission may land before listeners clear.
      app.on('changeState', () => {
        if (app.isDestroyed()) postDestroy.push('changeState');
      });
      app.on('flip', () => {
        if (app.isDestroyed()) postDestroy.push('flip');
      });

      expect(app.flipNext()).toBe(true);
      // Drive until the first progress fires destroy.
      raf.flush(20, 120);

      expect(destroyed).toBe(true);
      expect(app.isDestroyed()).toBe(true);
      // E1 snapshot: second listener still received the in-flight event.
      expect(second).toHaveBeenCalled();
      // After that dispatch, no further turnProgress / fabricated post-teardown stream.
      expect(postDestroy.filter((t) => t === 'progress')).toEqual([]);
      expect(postDestroy.filter((t) => t === 'flip')).toEqual([]);
      // Permitted exception (a), ASSERTED rather than merely tolerated:
      // destroy() → abandon() emits exactly ONE changeState (to 'read')
      // before listeners clear. Zero would mean the teardown ordering moved;
      // more than one would be a fabricated post-teardown stream.
      expect(postDestroy.filter((t) => t === 'changeState')).toEqual(['changeState']);
    } finally {
      raf.restore();
    }
  });

  test('destroy from turnProgress during a REAL pointer fold: still exactly one changeState', () => {
    // Release-audit pin (Codex final-review claim, refuted empirically): a
    // destroy() from a progress listener while a POINTER fold is live runs
    // abandon() TWICE — once via `UI.destroy → removeHandlers →
    // cancelGesture` (the pointer is still active), once unconditionally from
    // `PageFlip.destroy`. The second is silent because `Flip.setState` only
    // dispatches on an actual state change — the book is already `read`. This
    // test pins that dedupe for the pointer path the programmatic test above
    // cannot reach; if it ever reports two `changeState`s, someone removed
    // the equality guard in `setState`.
    const { book: app } = book({ pageCount: 6, hostWidth: 900, hostHeight: 300 });
    const dist = app.getBlockElement();
    const postDestroy: string[] = [];
    let destroyed = false;

    app.on('changeState', (e) => {
      if (destroyed) postDestroy.push(String(e.data.state));
    });
    app.on('turnProgress', () => {
      if (!destroyed) {
        destroyed = true;
        app.destroy();
      }
    });

    const dispatch = (type: string, clientX: number, clientY: number): void => {
      dist.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          button: 0,
          buttons: 1,
          pointerType: 'mouse',
          clientX,
          clientY,
        }),
      );
    };

    const rect = dist.getBoundingClientRect();
    dispatch('pointerdown', rect.left + 880, rect.top + 150);
    dispatch('pointermove', rect.left + 500, rect.top + 150);

    expect(destroyed).toBe(true);
    expect(app.isDestroyed()).toBe(true);
    expect(postDestroy).toEqual(['read']);
  });
});
