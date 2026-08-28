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
