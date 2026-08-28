import { afterEach, describe, expect, test, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HTMLFlipBook, usePageFlip } from '@gullabs/react-flipbook';

afterEach(() => {
  cleanup();
});

function pages(...labels: string[]) {
  return labels.map((label) => (
    <div key={label} data-testid={`page-${label}`}>
      {label}
    </div>
  ));
}

describe('HTMLFlipBook (shipped binding)', () => {
  test('flippingTime: 0 mounts without throwing', () => {
    expect(() =>
      render(
        <HTMLFlipBook width={200} height={300} flippingTime={0}>
          {pages('a', 'b')}
        </HTMLFlipBook>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('group', { name: 'Flipbook' })).toBeTruthy();
  });

  test('renders a stable pre-hydration placeholder attribute then hydrates', async () => {
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );
    await waitFor(() => {
      const root = container.querySelector('[aria-label="Flipbook"]');
      expect(root).toBeTruthy();
      expect(root?.hasAttribute('data-flipbook-placeholder')).toBe(false);
    });
  });

  test('onUpdate fires on children change', async () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} onUpdate={onUpdate}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    rerender(
      <HTMLFlipBook width={200} height={300} flippingTime={0} onUpdate={onUpdate}>
        {pages('a', 'b', 'c')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(onUpdate.mock.calls.length).toBeGreaterThan(0);
    });
  });

  test('Strict Mode double-mount does not lose the book', async () => {
    const { container } = render(
      <StrictMode>
        <HTMLFlipBook width={200} height={300} flippingTime={0}>
          {pages('a', 'b', 'c')}
        </HTMLFlipBook>
      </StrictMode>,
    );
    await waitFor(() => {
      const books = container.querySelectorAll('[aria-label="Flipbook"]');
      expect(books.length).toBe(1);
      expect(container.querySelector('[data-testid="page-a"]')).toBeTruthy();
    });
  });

  test('controlled page + onPageChange', async () => {
    function Harness() {
      const [page, setPage] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setPage(1)}>
            go
          </button>
          <HTMLFlipBook
            width={200}
            height={300}
            flippingTime={0}
            page={page}
            onPageChange={setPage}
          >
            {pages('a', 'b', 'c')}
          </HTMLFlipBook>
        </>
      );
    }
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => {
      expect(container.querySelector('[aria-label="Flipbook"]')).toBeTruthy();
    });
  });

  test('usePageFlip actions are wired to the handle', async () => {
    function Harness() {
      const book = usePageFlip();
      return (
        <>
          <button type="button" onClick={() => book.flipNext()}>
            next
          </button>
          <HTMLFlipBook
            ref={book.ref}
            width={200}
            height={300}
            flippingTime={0}
            onPageChange={book.setPage}
          >
            {pages('a', 'b', 'c')}
          </HTMLFlipBook>
        </>
      );
    }
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 2 of 3/);
    });
  });
});
