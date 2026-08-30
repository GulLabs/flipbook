import { describe, expect, test, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PageFlip } from '@gullabs/flipbook-core';
import { ImageFlipBook } from '../src/ImageFlipBook';
import type { ImagePageLeaf } from '../src/types';

/**
 * ImageFlipBook is the canvas binding. jsdom cannot decode images or paint a
 * real canvas reliably, so these tests lock the React-side contract via spies
 * on `PageFlip.loadFromImages` / `turnToPage`.
 */

const IMAGES: ImagePageLeaf[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'Red' },
  { src: '/fixtures/canvas/page-1.png', alt: 'Blue' },
  { src: '/fixtures/canvas/page-2.png', alt: 'Green' },
  { src: '/fixtures/canvas/page-3.png', alt: 'Yellow' },
];

describe('ImageFlipBook', () => {
  let loadSpy: MockInstance<(imagesHref: string[]) => Promise<void>>;

  beforeEach(() => {
    loadSpy = vi.spyOn(PageFlip.prototype, 'loadFromImages');
  });

  afterEach(() => {
    loadSpy.mockRestore();
  });

  test('renders without children and exposes the images mode marker', async () => {
    const { container } = render(
      <ImageFlipBook width={200} height={150} flippingTime={0} images={IMAGES} />,
    );

    const root = container.querySelector('[data-flipbook-mode="images"]');
    expect(root).toBeTruthy();
    expect(container.querySelector('.stf__item')).toBeNull();

    await waitFor(() => {
      expect(root?.getAttribute('data-hydrated')).toBe('1');
    });
  });

  test('builds a semantic mirror from alt text', async () => {
    const { container } = render(
      <ImageFlipBook width={200} height={150} flippingTime={0} images={IMAGES} />,
    );

    await waitFor(() => {
      const items = container.querySelectorAll('ol li');
      expect([...items].map((li) => li.textContent)).toEqual(['Red', 'Blue', 'Green', 'Yellow']);
    });
  });

  test('decorative blank alts are omitted from the mirror list', async () => {
    const leaves: ImagePageLeaf[] = [
      { blank: true, alt: '' },
      { src: '/fixtures/canvas/page-0.png', alt: 'Art' },
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { container } = render(
      <ImageFlipBook width={200} height={150} flippingTime={0} images={leaves} />,
    );

    await waitFor(() => {
      const items = container.querySelectorAll('ol li');
      expect([...items].map((li) => li.textContent)).toEqual(['Art']);
    });

    warn.mockRestore();
  });

  test('loads bare string URLs, never object descriptors, before Phase 2', async () => {
    // Pre-Phase-2 engines accept any array and coerce objects to
    // "[object Object]". ImageFlipBook must strip to src strings itself.
    render(<ImageFlipBook width={200} height={150} flippingTime={0} images={IMAGES} />);

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
    });

    const arg = loadSpy.mock.calls[0]?.[0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toHaveLength(IMAGES.length);
    for (const item of arg ?? []) {
      expect(typeof item).toBe('string');
      expect(item).not.toBe('[object Object]');
    }
    expect(arg?.[0]).toBe('/fixtures/canvas/page-0.png');
  });

  test('blank leaves are stripped from the string[] load path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const leaves: ImagePageLeaf[] = [
      { blank: true, alt: '' },
      { src: '/fixtures/canvas/page-0.png', alt: 'Art' },
      { blank: true, alt: '' },
    ];

    render(<ImageFlipBook width={200} height={150} flippingTime={0} images={leaves} />);

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
    });

    expect(loadSpy.mock.calls[0]?.[0]).toEqual(['/fixtures/canvas/page-0.png']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('after load settles, turnToPage applies the controlled page', async () => {
    // Isolate the post-load controlled-page path from jsdom canvas limits.
    loadSpy.mockResolvedValue(undefined);

    let current = 0;
    const isDestroyed = vi.spyOn(PageFlip.prototype, 'isDestroyed').mockReturnValue(false);
    const getPageCount = vi.spyOn(PageFlip.prototype, 'getPageCount').mockReturnValue(4);
    const getCurrentPageIndex = vi
      .spyOn(PageFlip.prototype, 'getCurrentPageIndex')
      .mockImplementation(() => current);
    const getOrientation = vi
      .spyOn(PageFlip.prototype, 'getOrientation')
      .mockReturnValue('portrait' as ReturnType<PageFlip['getOrientation']>);
    const turnToPage = vi
      .spyOn(PageFlip.prototype, 'turnToPage')
      .mockImplementation((page: number) => {
        current = page;
      });

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={IMAGES}
        page={2}
      />,
    );

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
      expect(turnToPage).toHaveBeenCalledWith(2);
    });

    isDestroyed.mockRestore();
    getPageCount.mockRestore();
    getCurrentPageIndex.mockRestore();
    getOrientation.mockRestore();
    turnToPage.mockRestore();
  });
});
