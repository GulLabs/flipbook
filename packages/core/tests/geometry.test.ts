import { describe, expect, test } from 'vitest';
import {
  FlipDirection,
  backCurlAppearsRight,
  convertPageToGlobal,
  curlGoesLeft,
  portraitBackCurl,
  portraitCurlLocal,
  portraitForwardCurl,
} from '@gullabs/flipbook-core';

const PAGE_WIDTH = 400;
const HEIGHT = 600;
const RECT = {
  left: 0,
  top: 0,
  width: PAGE_WIDTH * 2,
  height: HEIGHT,
  pageWidth: PAGE_WIDTH,
};

describe('portrait curl geometry (shipped engine)', () => {
  test('portrait back and forward share the same local curl (vendor FlipCalculation space)', () => {
    const back = portraitBackCurl(PAGE_WIDTH, HEIGHT, 'top');
    const forward = portraitForwardCurl(PAGE_WIDTH, HEIGHT, 'top');
    const local = portraitCurlLocal(PAGE_WIDTH, HEIGHT, 'top');
    expect(back).toEqual(forward);
    expect(back).toEqual(local);
    expect(curlGoesLeft(back)).toBe(true);
    expect(back.to.x).toBeLessThan(0);
    expect(backCurlAppearsRight(back, FlipDirection.BACK, RECT)).toBe(true);
    expect(backCurlAppearsRight(back, FlipDirection.FORWARD, RECT)).toBe(false);
  });

  test('local curl destination is left of the page for both FORWARD and BACK', () => {
    const top = portraitCurlLocal(PAGE_WIDTH, HEIGHT, 'top');
    const bottom = portraitCurlLocal(320, 480, 'bottom');
    expect(top.to.x).toBeLessThan(0);
    expect(bottom.to.x).toBeLessThan(0);
    expect(bottom.to.y).toBe(480);
    expect(bottom.from.y).toBeGreaterThan(240);
  });

  test('BACK + convertToGlobal mirror yields a rightward on-screen curl', () => {
    const local = portraitCurlLocal(PAGE_WIDTH, HEIGHT, 'top');
    const from = convertPageToGlobal(local.from, FlipDirection.BACK, RECT);
    const to = convertPageToGlobal(local.to, FlipDirection.BACK, RECT);
    expect(local.to.x).toBe(-PAGE_WIDTH);
    expect(to.x).toBeGreaterThan(from.x);
    expect(backCurlAppearsRight(local, FlipDirection.BACK, RECT)).toBe(true);
  });

  test('FORWARD convertToGlobal does not claim visual-right', () => {
    const local = portraitCurlLocal(PAGE_WIDTH, HEIGHT, 'top');
    const from = convertPageToGlobal(local.from, FlipDirection.FORWARD, RECT);
    const to = convertPageToGlobal(local.to, FlipDirection.FORWARD, RECT);
    expect(to.x).toBeLessThan(from.x);
  });
});

/**
 * The curl's corner inset is bounded by the leaf's SHORTER side.
 *
 * `height / 10` is sensible on ordinary proportions and nonsense on a tall
 * narrow leaf — and `Settings` permits any positive dimensions.
 */
describe('portraitCurlLocal — extreme aspect ratios', () => {
  test('a tall narrow leaf does not start the turn already past the spine', () => {
    const pageWidth = 20;
    const height = 300;
    const curl = portraitCurlLocal(pageWidth, height);

    // Reverted fix: `pad = 30`, so `from.x = 20 - 30 = -10` — past the spine
    // before the first frame, which `FlipCalculation` reads as roughly 75% of
    // the turn already done. A programmatic turn jumps most of the way
    // instantly instead of animating.
    expect(curl.from.x).toBeGreaterThan(0);
    expect(curl.from.x).toBeLessThan(pageWidth);
  });

  test('a wide short leaf is bounded too, and the start stays inside', () => {
    const curl = portraitCurlLocal(400, 20);

    // The control on the other axis: a variant that clamped only by width would
    // satisfy the case above and fail here.
    expect(curl.from.x).toBeGreaterThan(0);
    expect(curl.from.x).toBeLessThan(400);
    expect(curl.from.y).toBeGreaterThan(0);
    expect(curl.from.y).toBeLessThan(20);
  });

  test('ordinary proportions are unchanged', () => {
    // Inert where it should be: a 400x600 leaf keeps the 60px inset it always
    // had, so this is a bound and not a re-tuning of every book's curl.
    const curl = portraitCurlLocal(400, 600);
    expect(curl.from).toEqual({ x: 340, y: 60 });
    expect(curl.to).toEqual({ x: -400, y: 0 });
  });
});
