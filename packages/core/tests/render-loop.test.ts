/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The shared render loop — `Render` is the base of BOTH renderers, so
 * everything here is repo-wide behaviour, not canvas behaviour.
 *
 * Covers three defects from `docs/CANVAS_FIRST_CLASS.md`:
 *
 *  - **C4** the final animation frame was dropped whenever rAF skipped a frame;
 *  - **C5** a zero-size container voted PORTRAIT and emitted `changeOrientation`;
 *  - **C11** `RENDER_NOT_READY` was an unreachable branch in the public surface.
 *
 * The loop is driven through a fake `requestAnimationFrame` so frame timestamps
 * are exact: a real rAF cannot be asked to drop a frame on demand, and a test
 * that stubbed `startAnimation` would be testing nothing (AGENTS.md §2).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Render, Orientation } from '../src/Render/Render';
import type { PageFlip } from '../src/PageFlip';
import { Settings, SizeType, type FlipSetting } from '../src/Settings';

class TestRender extends Render {
  public frameDraws = 0;

  public constructor(app: PageFlip, setting: FlipSetting) {
    super(app, setting);
  }

  protected drawFrame(): void {
    this.frameDraws += 1;
  }

  public reload(): void {
    /* nothing to reload in the harness */
  }
}

type Harness = {
  render: TestRender;
  /** Run one animation frame at the given timestamp. */
  tick: (timer: number) => void;
  /** The measured box the render reads through `getDistElement()`. */
  box: { offsetWidth: number; offsetHeight: number };
  updateOrientation: ReturnType<typeof vi.fn>;
};

let pendingFrame: ((timer: number) => void) | null = null;
let nextRafId = 0;

function makeHarness(
  userSetting: Partial<FlipSetting> = {},
  box = { offsetWidth: 0, offsetHeight: 0 },
): Harness {
  const setting = new Settings().getSettings({ width: 200, height: 300, ...userSetting });
  const updateOrientation = vi.fn();

  const app = {
    getUI: () => ({ getDistElement: () => box }),
    getSettings: () => setting,
    updateOrientation,
  } as unknown as PageFlip;

  const render = new TestRender(app, setting);

  const tick = (timer: number): void => {
    const frame = pendingFrame;
    if (frame === null) throw new Error('no frame scheduled — did start() run?');
    pendingFrame = null;
    frame(timer);
  };

  return { render, tick, box, updateOrientation };
}

beforeEach(() => {
  pendingFrame = null;
  nextRafId = 0;

  globalThis.requestAnimationFrame = ((cb: (timer: number) => void): number => {
    pendingFrame = cb;
    nextRafId += 1;
    return nextRafId;
  }) as typeof globalThis.requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((): void => {
    pendingFrame = null;
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Five frames, 100 ms each, logging into a shared trace. */
function fiveFrames(trace: string[]): Array<() => void> {
  return [0, 1, 2, 3, 4].map((i) => () => trace.push(`frame:${String(i)}`));
}

describe('C4 — the final animation frame is never dropped', () => {
  test('a skipped frame still plays the last frame, exactly once, before the callback', () => {
    const { render, tick } = makeHarness();
    const trace: string[] = [];

    render.start();
    render.startAnimation(fiveFrames(trace), 500, () => trace.push('end'));

    // First frame lands on index 0, then the tab is throttled and the clock
    // jumps clean past the end of the list.
    tick(0);
    tick(100_000);

    // Reverted fix: ['frame:0', 'end'] — the leaf commits a turn whose final
    // geometry was never drawn.
    expect(trace).toEqual(['frame:0', 'frame:4', 'end']);
  });

  test('the last frame is not replayed when the loop lands on it normally', () => {
    const { render, tick } = makeHarness();
    const trace: string[] = [];

    render.start();
    render.startAnimation(fiveFrames(trace), 500, () => trace.push('end'));

    for (const t of [0, 100, 200, 300, 400]) tick(t);
    // The tick after the last frame is the one that commits.
    tick(500);

    // A "fix" that unconditionally replays the last frame in the overshoot
    // branch produces ['frame:0'..'frame:4', 'frame:4', 'end'] — the leaf
    // re-runs its final geometry, and any frame with a side effect runs twice.
    expect(trace).toEqual(['frame:0', 'frame:1', 'frame:2', 'frame:3', 'frame:4', 'end']);
  });

  test('the animation ends exactly once even if the loop keeps running', () => {
    const { render, tick } = makeHarness();
    const trace: string[] = [];

    render.start();
    render.startAnimation(fiveFrames(trace), 500, () => trace.push('end'));

    tick(0);
    tick(900);
    tick(1000);
    tick(1100);

    expect(trace.filter((entry) => entry === 'end')).toHaveLength(1);
    expect(trace.filter((entry) => entry === 'frame:4')).toHaveLength(1);
  });

  test('an instant turn (flippingTime: 0) still runs the last frame synchronously', () => {
    // CLAUDE.md invariant: `startAnimation` with a zero duration commits inside
    // the call, before it returns — the C4 guard must not defer that.
    const { render } = makeHarness();
    const trace: string[] = [];

    render.startAnimation(fiveFrames(trace), 0, () => trace.push('end'));

    expect(trace).toEqual(['frame:4', 'end']);
  });

  test('finishAnimation still commits a turn the loop never reached', () => {
    const { render, tick } = makeHarness();
    const trace: string[] = [];

    render.start();
    render.startAnimation(fiveFrames(trace), 500, () => trace.push('end'));

    tick(0);
    render.finishAnimation();

    expect(trace).toEqual(['frame:0', 'frame:4', 'end']);

    // …and it is idempotent: a second call has no animation left to commit.
    render.finishAnimation();
    expect(trace.filter((entry) => entry === 'end')).toHaveLength(1);
  });
});

describe('C5 — a zero-size container is not an observation', () => {
  test('hiding and re-showing a measured book emits nothing', () => {
    // 400 wide is exactly two 200-wide pages: landscape.
    const { render, box, updateOrientation } = makeHarness(
      {},
      {
        offsetWidth: 400,
        offsetHeight: 300,
      },
    );

    render.update();
    expect(updateOrientation).toHaveBeenCalledExactlyOnceWith(Orientation.LANDSCAPE);

    const measured = { ...render.getRect() };

    // display: none — every box collapses to 0.
    box.offsetWidth = 0;
    box.offsetHeight = 0;
    render.update();

    // Reverted fix: `0 < minWidth * 2` votes PORTRAIT and this emits.
    expect(updateOrientation).toHaveBeenCalledTimes(1);
    expect(render.getOrientation()).toBe(Orientation.LANDSCAPE);
    // A fix that suppresses only the event still corrupts the geometry: the
    // retained bounds must be the last *measured* ones, not a rect of zeros.
    expect(render.getRect()).toEqual(measured);

    // Visible again, same size: still nothing to say.
    box.offsetWidth = 400;
    box.offsetHeight = 300;
    render.update();

    expect(updateOrientation).toHaveBeenCalledTimes(1);
    expect(render.getRect()).toEqual(measured);
  });

  test('a real resize across the portrait threshold still emits, once', () => {
    const { render, box, updateOrientation } = makeHarness(
      {},
      {
        offsetWidth: 400,
        offsetHeight: 300,
      },
    );

    render.update();
    updateOrientation.mockClear();

    // Narrower than two pages: portrait, and that is a real measurement.
    box.offsetWidth = 300;
    render.update();

    expect(updateOrientation).toHaveBeenCalledExactlyOnceWith(Orientation.PORTRAIT);
    expect(render.getOrientation()).toBe(Orientation.PORTRAIT);

    // Hidden while portrait: retained, silent. Recovery after that must work.
    box.offsetWidth = 0;
    box.offsetHeight = 0;
    render.update();
    expect(render.getOrientation()).toBe(Orientation.PORTRAIT);

    box.offsetWidth = 400;
    box.offsetHeight = 300;
    render.update();

    expect(updateOrientation).toHaveBeenCalledTimes(2);
    expect(updateOrientation).toHaveBeenLastCalledWith(Orientation.LANDSCAPE);
    expect(render.getRect().pageWidth).toBe(200);
  });

  test('a stretch book behaves the same way', () => {
    const { render, box, updateOrientation } = makeHarness(
      { size: SizeType.STRETCH, minWidth: 150, maxWidth: 2000, minHeight: 100, maxHeight: 2000 },
      { offsetWidth: 600, offsetHeight: 400 },
    );

    render.update();
    expect(updateOrientation).toHaveBeenCalledExactlyOnceWith(Orientation.LANDSCAPE);

    const measured = { ...render.getRect() };

    box.offsetWidth = 0;
    box.offsetHeight = 0;
    render.update();

    expect(updateOrientation).toHaveBeenCalledTimes(1);
    expect(render.getRect()).toEqual(measured);
  });

  test('a zero height alone is also no observation', () => {
    // A collapsed flex child can report a width and no height; the geometry
    // that falls out of it is just as degenerate.
    const { render, box, updateOrientation } = makeHarness(
      {},
      {
        offsetWidth: 400,
        offsetHeight: 300,
      },
    );

    render.update();
    const measured = { ...render.getRect() };
    updateOrientation.mockClear();

    box.offsetHeight = 0;
    render.update();

    expect(updateOrientation).not.toHaveBeenCalled();
    expect(render.getRect()).toEqual(measured);
  });
});

describe('C11 — geometry is always answerable', () => {
  test('a never-measured book returns bounds instead of throwing RENDER_NOT_READY', () => {
    // Mounted inside `display: none`: no box has ever existed. The old code
    // documented a `RENDER_NOT_READY` error here that could not fire; the
    // decision is that it must not start firing either — a hidden book that
    // throws out of the rAF loop is worse than one that reports a flat rect.
    const { render } = makeHarness();

    expect(() => render.getRect()).not.toThrow();

    const rect = render.getRect();
    for (const value of Object.values(rect)) expect(Number.isFinite(value)).toBe(true);
  });

  test('the render loop runs on an unmeasured book without throwing', () => {
    const { render, tick } = makeHarness();

    render.start();
    expect(() => {
      tick(0);
      tick(16);
    }).not.toThrow();

    expect(render.frameDraws).toBe(2);
  });

  test('the first real measurement replaces the unmeasured bounds', () => {
    const { render, box, updateOrientation } = makeHarness();

    render.getRect();
    box.offsetWidth = 400;
    box.offsetHeight = 300;
    render.update();

    expect(render.getRect().pageWidth).toBe(200);
    expect(render.getRect().left).toBe(0);
    expect(updateOrientation).toHaveBeenLastCalledWith(Orientation.LANDSCAPE);
  });
});
