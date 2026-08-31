/**
 * Coverage is a byproduct, not the goal — assert real fold geometry, not stubs.
 */
import { describe, expect, test } from 'vitest';
import { FlipCorner } from '@gullabs/flipbook-core';
import { FlipCalculation } from '../src/Flip/FlipCalculation';
import { FlipDirection } from '../src/Flip/Flip';

const W = 400;
const H = 600;

function midFold(direction: FlipDirection, corner: FlipCorner, pos = { x: 220, y: 80 }) {
  const calc = new FlipCalculation(direction, corner, W, H);
  expect(calc.calc(pos)).toBe(true);
  return calc;
}

describe('FlipCalculation fold geometry', () => {
  test('FORWARD TOP produces a finite angle and leftward progress from mid-page', () => {
    const calc = midFold(FlipDirection.FORWARD, FlipCorner.TOP, { x: 200, y: 40 });
    expect(Number.isFinite(calc.getAngle())).toBe(true);
    // FORWARD negates the internal angle.
    expect(calc.getAngle()).toBeLessThan(0);
    expect(calc.getDirection()).toBe(FlipDirection.FORWARD);
    expect(calc.getCorner()).toBe(FlipCorner.TOP);
    expect(calc.getPosition().x).toBeGreaterThan(0);
    expect(calc.getFlippingProgress()).toBeGreaterThan(0);
    expect(calc.getFlippingProgress()).toBeLessThanOrEqual(100);
  });

  test('BACK TOP mirrors the angle sign relative to FORWARD at the same local point', () => {
    const forward = midFold(FlipDirection.FORWARD, FlipCorner.TOP, { x: 180, y: 60 });
    const back = midFold(FlipDirection.BACK, FlipCorner.TOP, { x: 180, y: 60 });
    // Same internal magnitude; getters invert for FORWARD only.
    expect(back.getAngle()).toBeCloseTo(-forward.getAngle(), 5);
    expect(back.getActiveCorner()).not.toEqual(forward.getActiveCorner());
    expect(back.getBottomPagePosition()).toEqual({ x: 400, y: 0 });
    expect(forward.getBottomPagePosition()).toEqual({ x: 0, y: 0 });
  });

  test('BOTTOM corner folds from the lower edge and keeps clip polygons non-empty', () => {
    const calc = midFold(FlipDirection.FORWARD, FlipCorner.BOTTOM, { x: 250, y: 520 });
    expect(calc.getCorner()).toBe(FlipCorner.BOTTOM);
    const flipClip = calc.getFlippingClipArea().filter((p) => p !== null);
    const bottomClip = calc.getBottomClipArea().filter((p) => p !== null);
    expect(flipClip.length).toBeGreaterThanOrEqual(2);
    expect(bottomClip.length).toBeGreaterThanOrEqual(2);
    const shadow = calc.getShadowStartPoint();
    expect(shadow).not.toBeNull();
    expect(Number.isFinite(calc.getShadowAngle())).toBe(true);
  });

  test('FORWARD and BACK shadow angles differ by a π complement at the same pose', () => {
    const pos = { x: 160, y: 90 };
    const f = midFold(FlipDirection.FORWARD, FlipCorner.TOP, pos);
    const b = midFold(FlipDirection.BACK, FlipCorner.TOP, pos);
    const fa = f.getShadowAngle();
    const ba = b.getShadowAngle();
    expect(Number.isFinite(fa)).toBe(true);
    expect(Number.isFinite(ba)).toBe(true);
    expect(ba + fa).toBeCloseTo(Math.PI, 4);
  });

  test('deep left fold still yields a page rect and clip path (near full turn)', () => {
    const calc = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, W, H);
    expect(calc.calc({ x: -350, y: 20 })).toBe(true);
    const rect = calc.getRect();
    expect(rect.topLeft).toBeDefined();
    expect(rect.topRight).toBeDefined();
    expect(rect.bottomLeft).toBeDefined();
    expect(rect.bottomRight).toBeDefined();
    expect(calc.getFlippingProgress()).toBeGreaterThan(50);
    const clip = calc.getFlippingClipArea();
    expect(clip[0]).toEqual(rect.topLeft);
  });

  test('near the page spine calc rejects the degenerate zero-fold point', () => {
    const calc = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, W, H);
    expect(calc.calc({ x: 400, y: 0 })).toBe(false);
  });

  test('BOTTOM BACK fold produces bottom clip that includes the page edge', () => {
    const calc = midFold(FlipDirection.BACK, FlipCorner.BOTTOM, { x: 200, y: 500 });
    const bottom = calc.getBottomClipArea();
    const hasRightEdge = bottom.some(
      (p) => p !== null && Math.abs(p.x - 400) < 1 && Math.abs(p.y - 600) < 1,
    );
    expect(hasRightEdge).toBe(true);
    expect(calc.getShadowStartPoint()).not.toBeNull();
  });

  test('position is clamped when the finger goes past the page circle', () => {
    const calc = new FlipCalculation(FlipDirection.FORWARD, FlipCorner.TOP, W, H);
    expect(calc.calc({ x: 900, y: 40 })).toBe(true);
    const pos = calc.getPosition();
    const d = Math.hypot(pos.x, pos.y);
    expect(d).toBeLessThanOrEqual(400 + 1);
  });
});
