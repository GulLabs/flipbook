import { afterEach, describe, expect, test, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getByLabelText('Flipbook')).toBeTruthy();
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
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };
    function Harness() {
      const [page, setPage] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setPage(1)}>
            go
          </button>
          <HTMLFlipBook
            ref={(h) => {
              handleRef.current = h;
            }}
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
    render(<Harness />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });
    expect(screen.getByText(/Page 2 of/)).toBeTruthy();
  });

  test('live region is announced but not painted', async () => {
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    const live = container.querySelector<HTMLElement>('[data-flipbook-live]');
    expect(live).toBeTruthy();
    expect(live?.getAttribute('aria-live')).toBe('polite');
    // Visible text under the book was the bug: it must be clipped away.
    expect(live?.style.position).toBe('absolute');
    expect(live?.style.clipPath).toBe('inset(50%)');
    expect(live?.style.width).toBe('1px');
  });

  test('an inline onFlip does not rebuild the page collection on every turn', async () => {
    const onCollectionRebuild = vi.fn();

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
            // Inline identities: new on every render, which is the whole point.
            onFlip={() => {}}
            onPageChange={(page) => book.setPage(page)}
            onCollectionRebuild={onCollectionRebuild}
          >
            {pages('a', 'b', 'c')}
          </HTMLFlipBook>
        </>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-a"]')).toBeTruthy();
    });

    onCollectionRebuild.mockClear();
    fireEvent.click(screen.getByText('next'));

    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 2 of 3/);
    });

    expect(onCollectionRebuild).not.toHaveBeenCalled();
  });

  test('removing and reordering children does not throw', async () => {
    function Harness() {
      const [labels, setLabels] = useState(['a', 'b', 'c']);
      return (
        <>
          <button type="button" onClick={() => setLabels(['c', 'a'])}>
            shuffle
          </button>
          <HTMLFlipBook width={200} height={300} flippingTime={0}>
            {pages(...labels)}
          </HTMLFlipBook>
        </>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-c"]')).toBeTruthy();
    });

    expect(() => fireEvent.click(screen.getByText('shuffle'))).not.toThrow();

    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-b"]')).toBeNull();
      expect(container.querySelector('[data-testid="page-c"]')).toBeTruthy();
    });
  });

  test('a consumer ref on a page element still fires', async () => {
    const seen: (HTMLElement | null)[] = [];

    render(
      <HTMLFlipBook width={200} height={300} flippingTime={0}>
        <div
          data-testid="page-a"
          ref={(el: HTMLDivElement | null) => {
            if (el) seen.push(el);
          }}
        >
          a
        </div>
        <div data-testid="page-b">b</div>
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
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
          <button type="button" onClick={() => book.flipPrev()}>
            prev
          </button>
          <button type="button" onClick={() => book.turnToPage(2)}>
            turn-end
          </button>
          <button type="button" onClick={() => book.flipToPage(0)}>
            flip-start
          </button>
          <HTMLFlipBook
            ref={book.ref}
            width={200}
            height={300}
            flippingTime={0}
            {...book.bookProps}
          >
            {pages('a', 'b', 'c')}
          </HTMLFlipBook>
          <span data-testid="page-state">{book.page}</span>
          <span data-testid="page-count">{book.pageCount}</span>
        </>
      );
    }
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 2 of 3/);
    });
    fireEvent.click(screen.getByText('prev'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 1 of 3/);
    });
    fireEvent.click(screen.getByText('turn-end'));
    await waitFor(() => {
      expect(screen.getByTestId('page-state').textContent).toBe('2');
    });
    fireEvent.click(screen.getByText('flip-start'));
    await waitFor(() => {
      expect(screen.getByTestId('page-state').textContent).toBe('0');
    });
    await waitFor(() => {
      expect(Number(screen.getByTestId('page-count').textContent)).toBeGreaterThan(0);
    });
  });
});

test('useKeyboard defaults on and live region has role=status', async () => {
  const { container } = render(
    <HTMLFlipBook width={200} height={300} flippingTime={0}>
      {pages('a', 'b', 'c')}
    </HTMLFlipBook>,
  );
  await waitFor(() => {
    const root = container.querySelector('[aria-label="Flipbook"]');
    expect(root?.getAttribute('tabindex')).toBe('0');
    expect(root?.getAttribute('aria-keyshortcuts')).toContain('ArrowLeft');
    expect(container.querySelector('[data-flipbook-live][role="status"]')).toBeTruthy();
  });
});

test('startPage opens on the requested index when uncontrolled', async () => {
  const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
    current: null,
  };
  render(
    <HTMLFlipBook
      ref={(h) => {
        handleRef.current = h;
      }}
      width={200}
      height={300}
      flippingTime={0}
      startPage={1}
      usePortrait
    >
      {pages('a', 'b', 'c')}
    </HTMLFlipBook>,
  );
  await waitFor(() => {
    expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
  });
});

test('keyboard ArrowRight turns with userEvent', async () => {
  const user = userEvent.setup();
  const onPageChange = vi.fn();
  render(
    <HTMLFlipBook width={200} height={300} flippingTime={0} onPageChange={onPageChange}>
      {pages('a', 'b', 'c')}
    </HTMLFlipBook>,
  );
  const root = await screen.findByLabelText('Flipbook');
  root.focus();
  await user.keyboard('{ArrowRight}');
  await waitFor(() => {
    expect(onPageChange.mock.calls.length).toBeGreaterThan(0);
  });
});

test('nested interactive keeps Arrow keys (does not turn the book)', async () => {
  const onPageChange = vi.fn();
  const { container } = render(
    <HTMLFlipBook width={200} height={300} flippingTime={0} onPageChange={onPageChange}>
      <div key="a">
        <button type="button">Inside</button>
        <div role="combobox" tabIndex={0} aria-label="Combo">
          Combo
        </div>
      </div>
      <div key="b">b</div>
      <div key="c">c</div>
    </HTMLFlipBook>,
  );
  await waitFor(() => expect(container.querySelector('button')).toBeTruthy());
  onPageChange.mockClear();
  const btn = container.querySelector('button')!;
  const combo = container.querySelector('[role="combobox"]')!;
  fireEvent.keyDown(btn, { key: 'ArrowRight', bubbles: true });
  fireEvent.keyDown(combo, { key: 'ArrowRight', bubbles: true });
  expect(onPageChange).not.toHaveBeenCalled();
});
describe('usePageFlip actions + keyboard / error paths', () => {
  test('flipPrev, turnToPage, and flipToPage all move the engine', async () => {
    function Harness() {
      const book = usePageFlip();
      return (
        <>
          <button type="button" onClick={() => book.flipNext()}>
            next
          </button>
          <button type="button" onClick={() => book.flipPrev()}>
            prev
          </button>
          <button type="button" onClick={() => book.turnToPage(2)}>
            turn2
          </button>
          <button type="button" onClick={() => book.flipToPage(1)}>
            flip1
          </button>
          <span data-testid="page-state">{book.page}</span>
          <HTMLFlipBook
            ref={book.ref}
            width={200}
            height={300}
            flippingTime={0}
            onPageChange={book.setPage}
            onInit={() => book.setPageCount(3)}
          >
            {pages('a', 'b', 'c')}
          </HTMLFlipBook>
        </>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-a"]')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 2 of 3/);
    });

    fireEvent.click(screen.getByText('prev'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 1 of 3/);
    });

    fireEvent.click(screen.getByText('turn2'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 3 of 3/);
    });

    fireEvent.click(screen.getByText('flip1'));
    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-live]')?.textContent).toMatch(/Page 2 of 3/);
    });
  });

  test('keyboard arrows and Home/End drive turns (ltr)', async () => {
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };
    const { container } = render(
      <HTMLFlipBook
        ref={(h) => {
          handleRef.current = h;
        }}
        width={200}
        height={300}
        flippingTime={0}
        useKeyboard
      >
        {pages('a', 'b', 'c', 'd')}
      </HTMLFlipBook>,
    );

    const root = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[aria-label="Flipbook"]');
      expect(el).toBeTruthy();
      return el!;
    });

    root.focus();
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });

    fireEvent.keyDown(root, { key: 'End' });
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(3);
    });

    fireEvent.keyDown(root, { key: 'Home' });
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    });

    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    // already at 0 — stays put
    expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
  });

  test('rtl keyboard mirrors arrow directions', async () => {
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };
    const { container } = render(
      <HTMLFlipBook
        ref={(h) => {
          handleRef.current = h;
        }}
        width={200}
        height={300}
        flippingTime={0}
        direction="rtl"
        useKeyboard
      >
        {pages('a', 'b', 'c')}
      </HTMLFlipBook>,
    );

    const root = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[aria-label="Flipbook"]');
      expect(el).toBeTruthy();
      return el!;
    });

    root.focus();
    // rtl: ArrowLeft = next
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });

    fireEvent.keyDown(root, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    });
  });

  test('controlled page out of range is ignored without throwing', async () => {
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };
    function Harness() {
      const [page, setPage] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setPage(99)}>
            bad
          </button>
          <HTMLFlipBook
            ref={(h) => {
              handleRef.current = h;
            }}
            width={200}
            height={300}
            flippingTime={0}
            page={page}
            onPageChange={setPage}
          >
            {pages('a', 'b')}
          </HTMLFlipBook>
        </>
      );
    }

    render(<Harness />);
    await waitFor(() => {
      expect(handleRef.current?.pageFlip()).toBeTruthy();
    });

    expect(() => fireEvent.click(screen.getByText('bad'))).not.toThrow();
    // Binding clamps OOB `page` to the last leaf and reports onNavigationError.
    await waitFor(() => {
      expect(handleRef.current!.pageFlip()!.getCurrentPageIndex()).toBe(1);
    });
  });

  test('imperative handle exposes pageFlip after mount', async () => {
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };

    render(
      <HTMLFlipBook
        ref={(h) => {
          handleRef.current = h;
        }}
        width={200}
        height={300}
        flippingTime={0}
      >
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(handleRef.current?.pageFlip()?.getPageCount()).toBe(2);
    });
  });

  test('onChangeState fires across a programmatic flip', async () => {
    const onChangeState = vi.fn();
    const handleRef: { current: import('@gullabs/react-flipbook').FlipBookHandle | null } = {
      current: null,
    };

    render(
      <HTMLFlipBook
        ref={(h) => {
          handleRef.current = h;
        }}
        width={200}
        height={300}
        flippingTime={0}
        onChangeState={onChangeState}
      >
        {pages('a', 'b', 'c')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(handleRef.current?.pageFlip()).toBeTruthy();
    });

    handleRef.current?.flipNext();
    await waitFor(() => {
      expect(onChangeState.mock.calls.length).toBeGreaterThan(0);
    });
  });
});

describe('usePageFlip before a book is attached', () => {
  /**
   * Consumers call these from event handlers that can fire before mount or
   * after unmount — the hook's `?.` / `?? false` fallbacks are that contract,
   * not dead code.
   */
  test('actions are safe no-ops and report failure while ref is unset', () => {
    const seen: { next?: boolean; prev?: boolean } = {};

    function Harness() {
      const book = usePageFlip();
      // Rendered without <HTMLFlipBook>, so `book.ref.current` stays null.
      return (
        <button
          type="button"
          onClick={() => {
            seen.next = book.flipNext();
            seen.prev = book.flipPrev();
            book.turnToPage(2);
            book.flipToPage(3);
          }}
        >
          act
        </button>
      );
    }

    render(<Harness />);
    expect(() => fireEvent.click(screen.getByText('act'))).not.toThrow();

    // A turn that never reached an engine must report `false`, not `undefined`:
    // callers branch on this to show "already at the last page" affordances.
    expect(seen.next).toBe(false);
    expect(seen.prev).toBe(false);
  });
});

describe('responsive size', () => {
  /**
   * A book sized from its container (`width={measuredWidth}`) changes width on
   * every resize step. Keying the engine's identity on width meant each of
   * those destroyed and rebuilt the engine — losing the current page, the rAF
   * loop and any in-flight turn. Size is a restyle, not a remount.
   */
  test('changing width restyles the host instead of rebuilding the engine', async () => {
    let inits = 0;

    function Harness() {
      const [width, setWidth] = useState(300);
      return (
        <>
          <button type="button" onClick={() => setWidth(320)}>
            resize
          </button>
          <HTMLFlipBook
            width={width}
            height={400}
            flippingTime={0}
            onInit={() => {
              inits += 1;
            }}
          >
            {pages('a', 'b', 'c', 'd')}
          </HTMLFlipBook>
        </>
      );
    }

    const { container } = render(<Harness />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="page-a"]')).toBeTruthy();
    });

    const host = container.querySelector('.stf__parent');
    expect(host).toBeInstanceOf(HTMLElement);
    await waitFor(() => {
      expect(inits).toBe(1);
    });

    fireEvent.click(screen.getByText('resize'));

    // The new width reaches the host element…
    await waitFor(() => {
      expect((host as HTMLElement).style.minWidth).toBe('320px');
    });

    // …without a second `init`, which would mean a fresh engine.
    expect(inits).toBe(1);
  });
});
