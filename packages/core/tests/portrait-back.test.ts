import { describe, expect, test } from 'vitest';
import {
  FlipDirection,
  getPortraitFlippingPage,
  shouldDrawBottomPage,
} from '@gullabs/flipbook-core';

type Leaf = {
  id: string;
  hard?: boolean;
  newTemporaryCopy(): Leaf;
};

function leaf(id: string, hard = false): Leaf {
  const page: Leaf = {
    id,
    hard,
    newTemporaryCopy() {
      if (hard) return page;
      return { id: `copy-${id}`, newTemporaryCopy() { return this; } };
    },
  };
  return page;
}

describe('portrait BACK flipping page (shipped getPortraitFlippingPage)', () => {
  test('BACK moves a temporary copy of the current leaf, not the previous', () => {
    const pages = [leaf('0'), leaf('1'), leaf('2')];
    const moving = getPortraitFlippingPage(pages, 2, FlipDirection.BACK);
    expect(moving.id).toBe('copy-2');
    expect(getPortraitFlippingPage(pages, 2, FlipDirection.FORWARD).id).toBe('copy-2');
  });

  test('FORWARD still uses a copy of the current leaf', () => {
    const pages = [leaf('0'), leaf('1')];
    expect(getPortraitFlippingPage(pages, 1, FlipDirection.FORWARD).id).toBe('copy-1');
  });

  test('hard leaf (newTemporaryCopy returns this) stays on the previous-leaf path', () => {
    const pages = [leaf('0'), leaf('1', true)];
    const moving = getPortraitFlippingPage(pages, 1, FlipDirection.BACK);
    expect(moving.id).toBe('0');
  });
});

describe('drawBottomPage skip (shipped shouldDrawBottomPage)', () => {
  test('paints the bottom leaf on portrait BACK unless flippingPage === bottomPage', () => {
    const flipping = { id: 'copy-of-current' };
    const bottom = { id: 'previous' };
    expect(shouldDrawBottomPage(flipping, bottom)).toBe(true);
    expect(shouldDrawBottomPage(bottom, bottom)).toBe(false);
    expect(shouldDrawBottomPage(flipping, null)).toBe(false);
  });
});
