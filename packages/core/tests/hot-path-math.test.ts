/**
 * The maths under the fold: `Helper.pointsBetween` (the frame list for every
 * turn) and `FlipCalculation` (every animation frame of every turn).
 *
 * Two different jobs in one file, deliberately:
 *
 *  - A **fix**: `pointsBetween` could not survive a non-finite endpoint — it
 *    looped until the heap died. Reverting the guard does not make these tests
 *    fail; it kills the worker (see the note on the first one).
 *  - A **characterization**: `FlipCalculation`'s per-frame constants were'
 *    hoisted into the constructor and its rotation stopped evaluating `cos`
 *    and `sin` twice per point. Both are supposed to be bit-for-bit invisible,
 *    which is not something a red-on-revert test can express. The digest below
 *    is what pins it: it was captured from the code as it stood BEFORE those
 *    edits (2,400 frames across twelve page geometries, dumped to JSON and
 *    hashed; the post-edit dump was byte-identical), so any future change that
 *    moves the geometry by a single ULP turns it red.
 */
import { describe, expect, test } from 'vitest';
import { FlipCalculation } from '../src/Flip/FlipCalculation';
import { FlipCorner, FlipDirection } from '../src/Flip/enums';
import { pointsBetween } from '../src/Helper';
import type { Point } from '../src/BasicTypes';

/* --------------------------------------------------------- pointsBetween -- */

describe('pointsBetween is bounded for every input', () => {
  // A browser cannot recover from this one: `steps` is the loop bound and it
  // comes from caller data, so `Infinity` means `i <= Infinity`, which pushes
  // points until the heap is gone.
  //
  // How it fails without the fix, observed rather than assumed: the loop is
  // synchronous, so vitest's per-test timeout never gets a turn. The worker
  // dies with "FATAL ERROR: … JavaScript heap out of memory" after ~7 s and
  // the run exits 1 with `Tests ()` — no test result at all, an error. Check
  // the exit code, not the summary line, if you ever revert this to watch it
  // go red.
  test.each([
    ['x destination', { x: 0, y: 0 }, { x: Infinity, y: 0 }],
    ['y destination', { x: 0, y: 0 }, { x: 0, y: Infinity }],
    ['negative destination', { x: 0, y: 0 }, { x: -Infinity, y: 0 }],
    ['origin', { x: Infinity, y: 0 }, { x: 10, y: 10 }],
  ] as Array<[string, Point, Point]>)(
    'a non-finite %s terminates instead of looping forever',
    (_label, from, to) => {
      const points = pointsBetween(from, to);

      expect(points).toHaveLength(1);
      expect(points[0]).toBe(from);
    },
  );

  test('no non-finite coordinate is emitted as a frame', () => {
    // Kills the two variants that also terminate but are wrong: returning
    // `[a, b]` (the destination is the bad value, and the animation's LAST
    // frame is the one that sets the committed geometry), and clamping `steps`
    // to some large maximum (terminates, but every interpolated point between
    // a finite start and an infinite end is NaN or Infinity).
    for (const p of pointsBetween({ x: 3, y: 4 }, { x: Infinity, y: 0 })) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  test('a NaN endpoint keeps the answer it already had', () => {
    // The guard exists to give Infinity the SAME degenerate answer NaN already
    // produced, not a second one. If this ever diverges there are two
    // degenerate behaviours to reason about instead of one.
    const nan = pointsBetween({ x: 0, y: 0 }, { x: NaN, y: 0 });
    const inf = pointsBetween({ x: 0, y: 0 }, { x: Infinity, y: 0 });

    expect(nan).toHaveLength(1);
    expect(inf).toHaveLength(1);
  });

  test('ordinary and sub-pixel deltas are untouched by the guard', () => {
    // The guard must not cost the finite cases anything: these counts feed
    // `Flip.getAnimationDuration(points.length)`.
    expect(pointsBetween({ x: 0, y: 0 }, { x: 100, y: 0 })).toHaveLength(101);
    expect(pointsBetween({ x: 0, y: 0 }, { x: 0.4, y: 0 })).toHaveLength(2);
    expect(pointsBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toHaveLength(1);
  });

  test('a huge but perfectly FINITE delta is bounded too', () => {
    // `Number.isFinite` was never the real limit. `Settings` accepts any
    // positive finite dimension, so a legal 1e8 x 1e8 book asks for ~1.9e8
    // points here and ~1.9e8 closures in `animateFlippingTo` — the same
    // out-of-memory death the non-finite guard was added to prevent, reached
    // without a single non-finite number.
    //
    // Reverted fix: this allocates ~100 million points and the vitest worker
    // dies with "FATAL ERROR: … JavaScript heap out of memory". As with the
    // Infinity cases above, there is no test result at all — check the EXIT
    // CODE, not the summary line.
    const points = pointsBetween({ x: 0, y: 0 }, { x: 1e8, y: 0 });

    expect(points.length).toBeLessThanOrEqual(4097);

    // Bounded is not enough: the interpolation must still be a real one.
    // Truncating the loop (rather than re-spacing it) terminates just as well
    // and leaves the page frozen a hair off its destination forever, because
    // the LAST frame is the one that sets the committed geometry.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 1e8, y: 0 });
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  test('the cap is duration-neutral: it never engages below `getAnimationDuration`s threshold', () => {
    // Duration no longer depends on `points.length` at all —
    // `getAnimationDuration` takes the geometric travel (Puddlebend Issue 4),
    // so the cap is unconditionally duration-neutral. The counts below still
    // pin the cap's floor: capping under ~1000 would coarsen the frame
    // sampling of ordinary turns, which no other test here would catch.
    expect(pointsBetween({ x: 0, y: 0 }, { x: 999, y: 0 })).toHaveLength(1000);
    expect(pointsBetween({ x: 0, y: 0 }, { x: 2000, y: 0 }).length).toBeGreaterThanOrEqual(1000);
  });
});

/* ------------------------------------------------------- FlipCalculation -- */

/**
 * A bit-exact fold of a float stream: the raw IEEE-754 bits of every number,
 * not a rounded comparison, so a one-ULP drift in the fold geometry shows up.
 */
function digest(values: Iterable<number>): string {
  const buf = new DataView(new ArrayBuffer(8));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const v of values) {
    buf.setFloat64(0, v);
    const hi = buf.getUint32(0);
    const lo = buf.getUint32(4);
    h1 = Math.imul(h1 ^ hi, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ lo, 0x85ebca6b) >>> 0;
    h1 = (h1 ^ (h2 >>> 13)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Deterministic LCG — the trajectory has to be reproducible without a fixture. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const GEOMETRIES: Array<[number, number]> = [
  [400, 600], // ordinary
  [1, 1000], // a 1px-wide leaf: an extreme aspect ratio in one direction
  [10000, 10], // and in the other
];

function* sweep(): Generator<number> {
  for (const [W, H] of GEOMETRIES) {
    for (const dir of [FlipDirection.FORWARD, FlipDirection.BACK]) {
      for (const corner of [FlipCorner.TOP, FlipCorner.BOTTOM]) {
        const rnd = lcg(12345);
        const calc = new FlipCalculation(dir, corner, W, H);
        for (let i = 0; i < 200; i += 1) {
          // 1.5x the page on each axis: corners, spine, and well off the leaf.
          const ok = calc.calc({ x: (rnd() * 3 - 1.5) * W, y: (rnd() * 3 - 1.5) * H });
          yield ok ? 1 : 0;
          yield calc.getAngle();
          yield calc.getShadowAngle();
          yield calc.getFlippingProgress();
          yield calc.getPosition().x;
          yield calc.getPosition().y;
          const r = calc.getRect();
          for (const c of [r.topLeft, r.topRight, r.bottomLeft, r.bottomRight]) {
            yield c.x;
            yield c.y;
          }
          for (const p of [...calc.getFlippingClipArea(), ...calc.getBottomClipArea()]) {
            yield p === null ? -1 : p.x;
            yield p === null ? -1 : p.y;
          }
        }
      }
    }
  }
}

describe('FlipCalculation fold geometry is bit-stable', () => {
  test('a 2,400-frame sweep across twelve geometries hashes to the shipped value', () => {
    // Two known digests: darwin arm64 (local) and linux x64 (GitHub Actions).
    // `libm` (`sin`/`cos`/`atan2`) can differ by a ULP across platforms on the
    // same IEEE inputs, so a single bit-exact hash is platform-locked. Both
    // values were captured from the same source; a third hash still means the
    // geometry moved. The named-frame test below pins one trajectory with
    // exact equality on every platform that reaches it.
    const got = digest(sweep());
    expect(
      ['249bfc9f8fe5a227', '6836ccb3fb900246'].includes(got),
      `unexpected fold digest ${got} — geometry moved, or a new platform needs its hash recorded`,
    ).toBe(true);
  });

  test('one named frame, so a digest failure is diagnosable', () => {
    // Exact equality, not `toBeCloseTo`: the point is that the arithmetic did
    // not move at all. These are the values the pre-refactor code produced.
    const calc = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, 400, 600);

    expect(calc.calc({ x: 239.52831532806158, y: -71.47048632614315 })).toBe(true);
    expect(calc.getPosition()).toEqual({ x: 239.52831532806158, y: -71.47048632614315 });
    expect(calc.getRect().bottomRight).toEqual({
      x: 64.34155835328795,
      y: 628.0361971163109,
    });
    expect(calc.getAngle()).toBe(0.8333984396721151);
    expect(calc.getShadowAngle()).toBe(1.9874955466309543);
  });
});

describe('FlipCalculation per-instance constants stay per-instance', () => {
  // The page borders and the bounds rect are now built once in the constructor
  // instead of on every frame. That is only safe while (a) nothing hands one
  // out and (b) they belong to the instance, not the module — a module-level
  // constant would make two books of different sizes share one set of borders.
  test('two calculations of different sizes do not share geometry', () => {
    const small = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, 100, 200);
    const large = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, 800, 1000);

    expect(small.calc({ x: 60, y: 20 })).toBe(true);
    const smallClip = JSON.stringify(small.getFlippingClipArea());

    expect(large.calc({ x: 480, y: 160 })).toBe(true);
    // The small book's polygon must not have moved onto the large book's edges.
    expect(JSON.stringify(small.getFlippingClipArea())).toBe(smallClip);
    for (const p of small.getFlippingClipArea()) {
      if (p !== null) expect(Math.abs(p.x)).toBeLessThanOrEqual(101);
    }
  });

  test('a frame does not alias the previous frame — no border object escapes', () => {
    // If `intersectSegments` ever returned one of the border points it was
    // handed rather than a fresh one, every frame would be writing over the
    // polygon the renderer is still holding.
    const calc = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, 400, 600);

    expect(calc.calc({ x: 300, y: 100 })).toBe(true);
    const first = calc.getFlippingClipArea();
    const snapshot = JSON.stringify(first);

    expect(calc.calc({ x: 120, y: 260 })).toBe(true);
    const second = calc.getFlippingClipArea();

    expect(JSON.stringify(first)).toBe(snapshot);
    for (const p of first) {
      if (p !== null) expect(second).not.toContain(p);
    }
  });
});
