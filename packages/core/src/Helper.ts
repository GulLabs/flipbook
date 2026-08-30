/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point, Rect, Segment } from './BasicTypes';

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

/** Clamp `p` to the circle at `c` with the given radius. */
export function limitToCircle(c: Point, radius: number, p: Point): Point {
  if (distanceBetween(c, p) <= radius) return p;

  const a = c.x;
  const b = c.y;
  const n = p.x;
  const m = p.y;
  const dx = a - n;
  const dy = b - m;
  const d2 = dx * dx + dy * dy;

  // Vertical case: `p` is directly above or below `c`, so the slope form below
  // divides by zero. The upstream guard tested `dx + b === 0` — the wrong
  // quantity — and substituted `radius` as an absolute y, which is neither the
  // clamped point nor on the circle. The clamp is unambiguous here.
  if (dx === 0) {
    return { x: c.x, y: p.y > c.y ? c.y + radius : c.y - radius };
  }

  let x = Math.sqrt((radius * radius * dx * dx) / d2) + a;
  if (p.x < 0) x *= -1;

  const y = ((x - a) * dy) / dx + b;

  return { x, y };
}

/** Intersection of two segments, or null if outside `border` / parallel. */
export function intersectSegments(border: Rect, one: Segment, two: Segment): Point | null {
  return pointInRect(border, intersectLines(one, two));
}

/** Intersection of two infinite lines, or null if parallel. */
export function intersectLines(one: Segment, two: Segment): Point | null {
  const A1 = one[0].y - one[1].y;
  const A2 = two[0].y - two[1].y;
  const B1 = one[1].x - one[0].x;
  const B2 = two[1].x - two[0].x;
  const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
  const C2 = two[0].x * two[1].y - two[1].x * two[0].y;
  const det1 = A1 * C2 - A2 * C1;
  const det2 = B1 * C2 - B2 * C1;
  const den = A1 * B2 - A2 * B1;
  const x = -((C1 * B2 - C2 * B1) / den);
  const y = -((A1 * C2 - A2 * C1) / den);

  if (isFinite(x) && isFinite(y)) return { x, y };
  if (Math.abs(det1 - det2) < 0.1)
    throw new Error('Segments are collinear: no single intersection point');
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
