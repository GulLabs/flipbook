import type { Point, Rect, Segment } from './BasicTypes';

/** Distance between two points, or Infinity if either is null. */
export function dist(a: Point | null, b: Point | null): number {
  if (a === null || b === null) return Infinity;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Angle (radians) between two line segments. */
export function ang(a: Segment, b: Segment): number {
  const A1 = a[0].y - a[1].y;
  const A2 = b[0].y - b[1].y;
  const B1 = a[1].x - a[0].x;
  const B2 = b[1].x - b[0].x;
  return Math.acos(
    (A1 * A2 + B1 * B2) / (Math.sqrt(A1 * A1 + B1 * B1) * Math.sqrt(A2 * A2 + B2 * B2)),
  );
}

/** Return `pos` if inside `rect`, else null. */
export function inRect(rect: Rect, pos: Point | null): Point | null {
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
export function rot(p: Point, o: Point, a: number): Point {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c + p.y * s + o.x, y: p.y * c - p.x * s + o.y };
}

/** Clamp `p` to the circle at `c` with the given radius. */
export function lim(c: Point, radius: number, p: Point): Point {
  if (dist(c, p) <= radius) return p;

  const a = c.x;
  const b = c.y;
  const n = p.x;
  const m = p.y;
  const dx = a - n;
  const dy = b - m;
  const d2 = dx * dx + dy * dy;

  let x = Math.sqrt((radius * radius * dx * dx) / d2) + a;
  if (p.x < 0) x *= -1;

  let y = ((x - a) * dy) / dx + b;
  if (dx + b === 0) y = radius;

  return { x, y };
}

/** Intersection of two segments, or null if outside `border` / parallel. */
export function iseg(border: Rect, one: Segment, two: Segment): Point | null {
  return inRect(border, iline(one, two));
}

/** Intersection of two infinite lines, or null if parallel. */
export function iline(one: Segment, two: Segment): Point | null {
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
  if (Math.abs(det1 - det2) < 0.1) throw new Error('Segment included');
  return null;
}

/** 1px-step point list from `a` to `b` (inclusive). */
export function cords(a: Point, b: Point): Point[] {
  const sx = Math.abs(a.x - b.x);
  const sy = Math.abs(a.y - b.y);
  const len = Math.max(sx, sy);
  const out: Point[] = [a];

  const step = (c1: number, c2: number, size: number, i: number): number => {
    if (c2 > c1) return c1 + i * (size / len);
    if (c2 < c1) return c1 - i * (size / len);
    return c1;
  };

  for (let i = 1; i <= len; i += 1) {
    out.push({ x: step(a.x, b.x, sx, i), y: step(a.y, b.y, sy, i) });
  }
  return out;
}
