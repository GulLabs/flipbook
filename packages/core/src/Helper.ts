/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point, Rect, Segment } from './BasicTypes';
import { PageFlipError } from './errors';

/** Distance between two points, or Infinity if either is null. */
export function distanceBetween(a: Point | null, b: Point | null): number {
  if (a === null || b === null) return Infinity;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Angle (radians) between two line segments. */
export function angleBetweenSegments(a: Segment, b: Segment): number {
  const A1 = a[0].y - a[1].y;
  const A2 = b[0].y - b[1].y;
  const B1 = a[1].x - a[0].x;
  const B2 = b[1].x - b[0].x;

  const lenA = Math.sqrt(A1 * A1 + B1 * B1);
  const lenB = Math.sqrt(A2 * A2 + B2 * B2);

  // A degenerate segment has no direction, so there is no angle to report.
  // `getSegmentToShadowLine`'s `?? first` can construct exactly that, and
  // dividing by zero here hands `acos` a `NaN` that then poisons the shadow
  // transform for the rest of the frame.
  if (lenA === 0 || lenB === 0) return 0;

  // Rounding can push the cosine a hair outside [-1, 1], where `acos` is NaN.
  const cos = (A1 * A2 + B1 * B2) / (lenA * lenB);

  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** Return `pos` if inside `rect`, else null. */
export function pointInRect(rect: Rect, pos: Point | null): Point | null {
  if (pos === null) return null;
  if (
    pos.x >= rect.left &&
    pos.x <= rect.width + rect.left &&
    pos.y >= rect.top &&
    pos.y <= rect.top + rect.height
  ) {
    return pos;
  }
  return null;
}

/** Rotate `p` around `o` by `a` radians. */
export function rotatePoint(p: Point, o: Point, a: number): Point {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c + p.y * s + o.x, y: p.y * c - p.x * s + o.y };
}

/**
 * Clamp `p` to the circle at `c` with the given radius.
 *
 * X9: the clamp is `c + (p - c) * (radius / d)` — a step of `radius` **along
 * the ray from the centre towards `p`**. The shipped form computed
 * `x = c.x + radius * |p.x - c.x| / d`, which always lands on the RIGHT of the
 * centre, and then flipped the sign of the whole absolute coordinate when
 * `p.x < 0` — a test of absolute position, not of direction from the centre. So
 * `limitToCircle({ x: 100, y: 0 }, 10, { x: 0, y: 0 })` returned `{ x: 110 }`
 * where the clamp is `{ x: 90 }`: on the circle, but 180° from the point being
 * clamped, and the further `c` sits from the y axis the further the fold jumps.
 *
 * It survived because both call sites (`FlipCalculation.checkPositionAtCenterLine`)
 * pass a centre at `x: 0`, where the two forms are algebraically identical: the
 * `|dx|` and the sign flip cancel exactly when `c.x === 0`. Any test written
 * against a centre on the y axis proves nothing about this function.
 *
 * The vertical special case is gone with the same edit rather than kept: it
 * existed only because the old slope form divided by `dx`. This one does not:
 * the only division is by `d`, and `d > radius` on every path that reaches it,
 * so for any non-negative radius `d` cannot be zero. On a vertical input it
 * yields exactly `{ c.x, c.y ± radius }` — what that branch returned.
 */
export function limitToCircle(c: Point, radius: number, p: Point): Point {
  const d = distanceBetween(c, p);
  if (d <= radius) return p;

  return {
    x: c.x + ((p.x - c.x) * radius) / d,
    y: c.y + ((p.y - c.y) * radius) / d,
  };
}

/** Intersection of two segments, or null if outside `border` / parallel. */
export function intersectSegments(border: Rect, one: Segment, two: Segment): Point | null {
  return pointInRect(border, intersectLines(one, two));
}

/** A segment whose endpoints coincide defines no line at all. */
function isDegenerate(s: Segment): boolean {
  return s[0].x === s[1].x && s[0].y === s[1].y;
}

/**
 * Intersection of two infinite lines, or null if parallel.
 *
 * X10, two defects in the failure branch:
 *
 *  - It threw a bare `Error`, so no consumer could identify it by `code` the
 *    way every other engine failure is identified. It is a `PageFlipError` now.
 *    `FlipCalculation.calc` catches this untyped and broadly, on purpose, so the
 *    change is invisible to the flip path: the same inputs still throw, and the
 *    same frames are still skipped.
 *  - It called degenerate input collinear. With
 *    `A·x + B·y + C = 0` per line, coincident lines are `den === 0` **and both
 *    Cramer numerators zero**; the shipped test, `|det1 - det2| < 0.1`, compared
 *    the y numerator against the x numerator, which is not a relationship
 *    between two lines at all. It reported two parallel lines 0.001 apart as
 *    collinear, and it reported a zero-length segment — which has
 *    `A = B = C = 0`, hence both numerators zero — as collinear as well. The
 *    numerator test is now the real one, and the degenerate case is separated
 *    out ahead of it so it reports what actually went wrong.
 */
export function intersectLines(one: Segment, two: Segment): Point | null {
  const A1 = one[0].y - one[1].y;
  const A2 = two[0].y - two[1].y;
  const B1 = one[1].x - one[0].x;
  const B2 = two[1].x - two[0].x;
  const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
  const C2 = two[0].x * two[1].y - two[1].x * two[0].y;
  const numX = C1 * B2 - C2 * B1;
  const numY = A1 * C2 - A2 * C1;
  const den = A1 * B2 - A2 * B1;
  const x = -(numX / den);
  const y = -(numY / den);

  if (isFinite(x) && isFinite(y)) return { x, y };

  if (isDegenerate(one) || isDegenerate(two)) {
    throw new PageFlipError(
      'Segment has zero length: it defines no line to intersect',
      'DEGENERATE_SEGMENT',
    );
  }

  if (numX === 0 && numY === 0) {
    throw new PageFlipError(
      'Segments are collinear: no single intersection point',
      'COLLINEAR_SEGMENTS',
    );
  }

  return null;
}

/** 1px-step point list from `a` to `b` (inclusive). */
export function pointsBetween(a: Point, b: Point): Point[] {
  const sx = Math.abs(a.x - b.x);
  const sy = Math.abs(a.y - b.y);
  // `Math.ceil`, not the raw length: upstream iterated integer `i <= len`, so a
  // fractional delta stopped one step short and the destination was never
  // emitted — every animation ended up to 1px shy of its target on each axis.
  // For an integral delta this is the same count as before, so the animation
  // duration derived from `points.length` is unchanged there.
  const steps = Math.ceil(Math.max(sx, sy));
  const out: Point[] = [a];

  for (let i = 1; i <= steps; i += 1) {
    // Clamped so the last point is exactly `b` rather than a rounding of it.
    const t = Math.min(i / steps, 1);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
