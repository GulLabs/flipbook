import { afterEach, describe, expect, test, vi } from 'vitest';
import { PageFlipError, validateCanvasLeaves } from '@gullabs/flipbook-core';
import type { CanvasLeaf } from '@gullabs/flipbook-core';

/**
 * `validateCanvasLeaves` driven directly, one rejection per test.
 *
 * These paths existed with no test at all — found by coverage after
 * `ImageFlipBook` was un-excluded, at 83% statements on this file. Every
 * uncovered line was a REJECTION path, which is the worst place to have none:
 * a validator whose accept path is tested and whose reject paths are not is
 * indistinguishable from a validator that accepts everything, and it is the
 * public boundary for the whole canvas API.
 *
 * Driven directly rather than through `loadFromImages` on purpose. The engine
 * route needs a jsdom host, a stubbed 2D context and a resolved lazy chunk —
 * every one of which is a place for the fixture to skip the path and pass
 * vacuously, which is how this repo has produced fourteen tests that passed
 * against broken code. There is nothing between these calls and the function.
 */

const code = (leaves: unknown): string => {
  try {
    validateCanvasLeaves(leaves as readonly CanvasLeaf[]);
  } catch (error) {
    return (error as PageFlipError).code;
  }
  return 'NO_THROW';
};

const message = (leaves: unknown): string => {
  try {
    validateCanvasLeaves(leaves as readonly CanvasLeaf[]);
  } catch (error) {
    return (error as PageFlipError).message;
  }
  return 'NO_THROW';
};

const ok = (extra: Record<string, unknown>): unknown => [{ src: 'a.png', alt: 'A', ...extra }];

describe('validateCanvasLeaves — the rejection paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a non-array is rejected before anything is indexed', () => {
    expect(code(null)).toBe('INVALID_IMAGE_SOURCE');
    expect(code(undefined)).toBe('INVALID_IMAGE_SOURCE');
    expect(code('a.png')).toBe('INVALID_IMAGE_SOURCE');
    expect(code({ 0: { src: 'a.png', alt: 'A' }, length: 1 })).toBe('INVALID_IMAGE_SOURCE');
  });

  test('a bare URL string is rejected BY NAME, not as "not an object"', () => {
    // This message was unreachable dead code until the string check was moved
    // above the object check: a string fails `typeof !== 'object'` and threw
    // there first. It is the single most likely mistake for anyone migrating
    // from 2.x, so it is worth a message that names the actual problem — and a
    // test that proves the message is reachable at all.
    expect(message(['page-1.jpg'])).toMatch(/bare URL strings are no longer accepted/);
    expect(message([{ src: 'a.png', alt: 'A' }, 'page-2.jpg'])).toMatch(/leaf 1/);
  });

  test('a non-object leaf reports what it actually got', () => {
    expect(message([42])).toMatch(/expected a descriptor object, got number/);
    expect(message([null])).toMatch(/expected a descriptor object, got object/);
  });

  test('`src` must be a non-empty string', () => {
    expect(code([{ alt: 'A' }])).toBe('INVALID_IMAGE_SOURCE');
    expect(code([{ src: '', alt: 'A' }])).toBe('INVALID_IMAGE_SOURCE');
    expect(code([{ src: 42, alt: 'A' }])).toBe('INVALID_IMAGE_SOURCE');
  });

  test('`background` must be a string, opaque, AND a colour the engine accepts', () => {
    // Three separate rejections, asserted separately because they are three
    // different jobs. CLAUDE.md is explicit that collapsing the opacity check
    // and the CSS-safety check is how a translucent fold shipped once already,
    // so a test that only proved "some backgrounds are rejected" would let that
    // collapse back in unnoticed.
    expect(code(ok({ background: 42 }))).toBe('INVALID_IMAGE_SOURCE');
    expect(message(ok({ background: 'rgba(0, 0, 0, 0.4)' }))).toMatch(/must be opaque/);
    expect(message(ok({ background: 'url(javascript:alert(1))' }))).toMatch(/not a colour/);

    // The negative control: an opaque, safe colour survives all three.
    expect(code(ok({ background: '#f4ecd8' }))).toBe('NO_THROW');
  });

  test('a blank leaf is still held to `background` and `density`', () => {
    // `isBlankLeaf` returns EARLY, so anything checked after it does not apply
    // to blank leaves. These two are checked before it deliberately — a blank
    // leaf paints its background, so a translucent one is exactly as wrong
    // there as on an image leaf.
    expect(message([{ blank: true, background: 'rgba(0,0,0,0.2)' }])).toMatch(/must be opaque/);
    expect(code([{ blank: true, density: 'papery' }])).toBe('INVALID_IMAGE_SOURCE');

    // …and NOT to `src`, which it has none of. If this ever throws, the early
    // return has been moved and every blank leaf in every book stops loading.
    expect(code([{ blank: true }])).toBe('NO_THROW');
    expect(code([{ blank: true, alt: '' }])).toBe('NO_THROW');
  });

  test('`density`, `crossOrigin` and `fit` reject unknown values', () => {
    expect(code(ok({ density: 'papery' }))).toBe('INVALID_IMAGE_SOURCE');
    expect(code(ok({ crossOrigin: 'yes-please' }))).toBe('INVALID_IMAGE_SOURCE');
    expect(code(ok({ fit: 'containn' }))).toBe('INVALID_IMAGE_SOURCE');

    // Negative controls for each, so this cannot pass for a validator that
    // rejects every value of these fields.
    expect(code(ok({ density: 'hard' }))).toBe('NO_THROW');
    expect(code(ok({ crossOrigin: 'use-credentials' }))).toBe('NO_THROW');
    expect(code(ok({ fit: 'cover' }))).toBe('NO_THROW');
  });

  test('`inset` is a fraction, and the message says so with the value', () => {
    // `12` is the mistake worth catching loudly: a plausible-looking pixel
    // margin and a catastrophic fraction. The message quotes the value back
    // precisely because the author believed they passed something reasonable.
    expect(message(ok({ inset: 12 }))).toMatch(/fraction of page width in \[0, 0\.5\), got 12/);
    expect(code(ok({ inset: 0.5 }))).toBe('INVALID_IMAGE_SOURCE');
    expect(code(ok({ inset: -0.1 }))).toBe('INVALID_IMAGE_SOURCE');
    expect(code(ok({ inset: NaN }))).toBe('INVALID_IMAGE_SOURCE');
    expect(code(ok({ inset: Infinity }))).toBe('INVALID_IMAGE_SOURCE');

    expect(code(ok({ inset: 0 }))).toBe('NO_THROW');
    expect(code(ok({ inset: 0.499 }))).toBe('NO_THROW');
  });

  test('a missing `alt` warns once per book and names the indices', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    validateCanvasLeaves([
      { src: 'a.png', alt: 'A' },
      { src: 'b.png' },
      { src: 'c.png' },
    ] as unknown as readonly CanvasLeaf[]);

    // ONCE — not once per leaf. Fifty identical console lines is how a real
    // warning gets scrolled past and then filtered out.
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0]?.[0]);
    expect(text).toMatch(/2 canvas leaf/);
    expect(text).toMatch(/index 1, 2/);
    // The distinction the whole design rests on must be in the text a human
    // reads, not only in the types.
    expect(text).toMatch(/unknown, not decorative/);
  });

  test('a missing `alt` does NOT throw — the book still loads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // The point of the whole warn-instead-of-throw decision. Validation is
    // eager over the entire list, so throwing here meant one unlabelled leaf
    // took down the entire book for every user, sighted or not — converting
    // "page 12 has a poor accessible name" into "the product does not load".
    expect(code([{ src: 'a.png' }])).toBe('NO_THROW');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('an explicit `alt: ""` is silent — it is a deliberate assertion', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    validateCanvasLeaves([
      { src: 'a.png', alt: '' },
      { blank: true },
    ] as unknown as readonly CanvasLeaf[]);

    // If this ever warns, the absence/`''` distinction has collapsed and every
    // author who correctly marked a leaf decorative is being told off for it.
    expect(warn).not.toHaveBeenCalled();
  });

  test('a valid list of every leaf shape is accepted', () => {
    // The overall negative control. Without it every assertion above is
    // satisfied by a validator that simply rejects everything.
    expect(
      code([
        { src: 'a.png', alt: 'The fox at the gate' },
        { src: 'b.png', alt: '', fit: 'cover', inset: 0.03, background: '#fff', density: 'hard' },
        { src: 'c.png', alt: 'C', crossOrigin: 'anonymous' },
        { blank: true },
        { blank: true, alt: '', background: '#000' },
      ]),
    ).toBe('NO_THROW');

    expect(code([])).toBe('NO_THROW');
  });
});
