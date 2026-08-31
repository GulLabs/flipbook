/**
 * Portrait / landscape curl invariants that used to be enforced by a
 * consumer-side monkey-patch of the engine.
 */
import { describe, expect, test } from 'vitest';
import {
  backCurlAppearsRight,
  convertPageToGlobal,
  curlGoesLeft,
  portraitCurlLocal,
} from '../src/geometry';
import { getPortraitFlippingPage } from '../src/Collection/flippingPage';
import { shouldDrawBottomPage } from '../src/Render/bottomPage';
import { FlipDirection } from '../src/Flip/Flip';

const RECT = {
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  pageWidth: 400,
};

type Leaf = { id: string; newTemporaryCopy(): Leaf };

function pages(...ids: string[]): Leaf[] {
  return ids.map((id) => {
    const page: Leaf = {
      id,
      newTemporaryCopy: () => ({ id: `copy-${id}`, newTemporaryCopy: () => page }),
    };
    return page;
  });
}

describe('reader-flip invariants without consumer monkey-patches', () => {
  test('1. portrait BACK copies the current leaf', () => {
    const list = pages('0', '1', '2');
    expect(getPortraitFlippingPage(list, 2, FlipDirection.BACK).id).toBe('copy-2');
  });

  test('2. local path is leftward (to.x = -pageWidth)', () => {
    const local = portraitCurlLocal(400, 600, 'top');
    expect(local.to.x).toBe(-400);
    expect(curlGoesLeft(local)).toBe(true);
  });

  test('3. BACK + convertToGlobal mirror ⇒ visual right', () => {
    const local = portraitCurlLocal(400, 600, 'top');
    const from = convertPageToGlobal(local.from, FlipDirection.BACK, RECT);
    const to = convertPageToGlobal(local.to, FlipDirection.BACK, RECT);
    expect(to.x).toBeGreaterThan(from.x);
    expect(backCurlAppearsRight(local, FlipDirection.BACK, RECT)).toBe(true);
  });

  test('4. bottom page paints on portrait BACK unless mover === bottom', () => {
    expect(shouldDrawBottomPage({ id: 'copy' }, { id: 'prev' })).toBe(true);
    expect(shouldDrawBottomPage({ id: 'hard' }, { id: 'hard' })).toBe(true);
    const same = { id: 'self' };
    expect(shouldDrawBottomPage(same, same)).toBe(false);
  });

  test('5. collection rebuild is a new getPortraitFlippingPage call (no patch flag)', () => {
    const first = pages('0', '1');
    expect(getPortraitFlippingPage(first, 1, FlipDirection.BACK).id).toBe('copy-1');
    const replaced = pages('0', '1');
    expect(getPortraitFlippingPage(replaced, 1, FlipDirection.BACK).id).toBe('copy-1');
  });

  test('6. landscape is not this path — portrait helper is portrait-only', () => {
    const list = pages('0', '1', '2');
    expect(getPortraitFlippingPage(list, 2, FlipDirection.FORWARD).id).toBe('copy-2');
  });
});
