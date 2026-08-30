import { describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ImageFlipBook } from '../src/ImageFlipBook';
import type { ImagePageLeaf } from '../src/types';

/**
 * ImageFlipBook is the canvas binding. jsdom cannot decode images or paint a
 * real canvas, so these tests lock the React-side contract: no children, load
 * is attempted, controlled page is accepted, and blank leaves do not crash the
 * tree when the engine only accepts strings.
 */

const IMAGES: ImagePageLeaf[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'Red' },
  { src: '/fixtures/canvas/page-1.png', alt: 'Blue' },
];

describe('ImageFlipBook', () => {
  test('renders without children and exposes the images mode marker', async () => {
    const { container } = render(
      <ImageFlipBook width={200} height={150} flippingTime={0} images={IMAGES} />,
    );

    const root = container.querySelector('[data-flipbook-mode="images"]');
    expect(root).toBeTruthy();
    // No portal host for page DOM — canvas mode has none.
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
      expect([...items].map((li) => li.textContent)).toEqual(['Red', 'Blue']);
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
      // Blank decorative leaf contributes no mirror row.
      expect([...items].map((li) => li.textContent)).toEqual(['Art']);
    });

    warn.mockRestore();
  });

  test('accepts a controlled page prop without throwing', async () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        images={IMAGES}
        page={0}
        onPageChange={onPageChange}
      />,
    );

    rerender(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        images={IMAGES}
        page={1}
        onPageChange={onPageChange}
      />,
    );

    // jsdom may or may not complete loadFromImages; the contract is "no throw".
    expect(true).toBe(true);
  });
});
