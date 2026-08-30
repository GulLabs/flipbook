/**
 * RB5 — `usePageFlip` must report where the ENGINE is after a collection
 * rebuild, not what the rebuild event says.
 *
 * The hook feeds a *controlled* `page`, so a wrong index here is not a stale
 * label: it re-issues `turnToPage` on a leaf that may no longer exist, the
 * binding clamps, and the consumer gets an `onNavigationError` for a
 * navigation they never asked for.
 *
 * The first test deliberately hands the hook a WRONG payload, so it fails if
 * the hook goes back to trusting `e.data.page` even though the core-side fix
 * (RB4) now makes the real payload correct. The integration test below covers
 * the two layers together; on its own it would pass with either hook.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { HTMLFlipBook, usePageFlip } from '@gullabs/react-flipbook';
import type { PageFlip, WidgetEvent } from '@gullabs/flipbook-core';

afterEach(() => {
  cleanup();
});

function pages(...labels: string[]): ReactNode[] {
  return labels.map((label) => (
    <div key={label} data-testid={`page-${label}`}>
      {label}
    </div>
  ));
}

function rebuildEvent(
  engine: PageFlip | null,
  data: { page: number; pageCount: number },
): WidgetEvent<{ page: number; pageCount: number }> {
  return { data, object: engine as PageFlip };
}

describe('usePageFlip derives the page from the engine on rebuild (RB5)', () => {
  test('a rebuild event carrying a stale index does not move the controlled page', async () => {
    const { result } = renderHook(() => usePageFlip());

    render(
      <HTMLFlipBook
        ref={result.current.ref}
        width={200}
        height={300}
        flippingTime={0}
        {...result.current.bookProps}
      >
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(result.current.ref.current?.pageFlip()).toBeTruthy();
    });

    const engine = result.current.ref.current?.pageFlip() ?? null;
    expect(engine).not.toBeNull();

    act(() => {
      result.current.turnToPage(1);
    });
    expect(engine?.getCurrentPageIndex()).toBe(1);

    // The payload lies. `updateFromHtml` reported exactly this shape before
    // RB4 — the index carried in from the collection that was destroyed.
    act(() => {
      result.current.bookProps.onCollectionRebuild?.(
        rebuildEvent(engine, { page: 9, pageCount: 2 }),
      );
    });

    expect(result.current.pageCount).toBe(2);
    // 9 is not a page of this book. Feeding it back as a controlled `page`
    // is what produced the spurious clamp + `onNavigationError`.
    expect(result.current.page).toBe(engine?.getCurrentPageIndex());
    expect(result.current.page).toBe(1);

    // And a payload that is merely WRONG rather than out of range: in
    // landscape a stale index is usually still a valid page number, so
    // "trust the payload when it is in range" is not a fix either.
    act(() => {
      result.current.bookProps.onCollectionRebuild?.(
        rebuildEvent(engine, { page: 0, pageCount: 2 }),
      );
    });
    expect(result.current.page).toBe(1);
  });

  test('with no engine to ask, the payload is still used', () => {
    // `bookProps` is spreadable onto anything; a hook whose `ref` was never
    // attached (or whose book has unmounted) must not silently pin page 0.
    const { result } = renderHook(() => usePageFlip());

    act(() => {
      result.current.bookProps.onCollectionRebuild?.(rebuildEvent(null, { page: 3, pageCount: 5 }));
    });

    expect(result.current.page).toBe(3);
    expect(result.current.pageCount).toBe(5);
  });

  test('a destroyed engine falls back to the payload rather than throwing', async () => {
    const { result } = renderHook(() => usePageFlip());

    const view = render(
      <HTMLFlipBook
        ref={result.current.ref}
        width={200}
        height={300}
        flippingTime={0}
        {...result.current.bookProps}
      >
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(result.current.ref.current?.pageFlip()).toBeTruthy();
    });
    const engine = result.current.ref.current?.pageFlip() ?? null;
    act(() => {
      engine?.destroy();
    });

    expect(() => {
      act(() => {
        result.current.bookProps.onCollectionRebuild?.(
          rebuildEvent(engine, { page: 1, pageCount: 2 }),
        );
      });
    }).not.toThrow();
    expect(result.current.page).toBe(1);

    view.unmount();
  });
});

describe('the two layers together: shrinking a controlled book (RB4 + RB5)', () => {
  type Api = ReturnType<typeof usePageFlip>;

  function Consumer({
    labels,
    onReady,
    onNavigationError,
  }: {
    labels: string[];
    onReady: (api: Api) => void;
    onNavigationError: (info: { code: string; requested: number; actual: number }) => void;
  }) {
    const api = usePageFlip();
    useEffect(() => {
      onReady(api);
    });

    return (
      <>
        <div data-testid="state">{`${String(api.page)}/${String(api.pageCount)}`}</div>
        <HTMLFlipBook
          ref={api.ref}
          width={200}
          height={300}
          flippingTime={0}
          page={api.page}
          onNavigationError={onNavigationError}
          {...api.bookProps}
        >
          {pages(...labels)}
        </HTMLFlipBook>
      </>
    );
  }

  test('shrinking below the current page reports the engine index and raises no navigation error', async () => {
    const onNavigationError = vi.fn();
    let api: Api | null = null;
    const onReady = (next: Api) => {
      api = next;
    };

    const view = render(
      <Consumer
        labels={['a', 'b', 'c', 'd', 'e', 'f']}
        onReady={onReady}
        onNavigationError={onNavigationError}
      />,
    );

    await waitFor(() => {
      expect(api?.ref.current?.pageFlip()).toBeTruthy();
    });

    act(() => {
      api?.turnToPage(5);
    });
    await waitFor(() => {
      expect(api?.ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(5);
    });
    onNavigationError.mockClear();

    view.rerender(
      <Consumer labels={['a', 'b']} onReady={onReady} onNavigationError={onNavigationError} />,
    );

    await waitFor(() => {
      const engine = api?.ref.current?.pageFlip();
      expect(engine?.getPageCount()).toBe(2);
      expect(api?.page).toBe(engine?.getCurrentPageIndex());
    });

    expect(view.getByTestId('state').textContent).toBe('1/2');

    // Honest about what is left: the commit that shrinks the book still has
    // `page={5}` in flight, so the controlled-page effect fires once against
    // the new 2-page book and reports one INVALID_PAGE. That is a binding
    // ordering issue in `HTMLFlipBook` (recorded, not fixed here), not the
    // rebuild index — every such report must resolve to the engine's index.
    for (const call of onNavigationError.mock.calls) {
      expect((call[0] as { actual: number }).actual).toBe(1);
    }

    // What these fixes remove is the *repeat*: with a stale rebuild index the
    // hook re-issues page 5 on every subsequent render, so the error never
    // stops. After settling there must be nothing further to report.
    onNavigationError.mockClear();
    view.rerender(
      <Consumer labels={['a', 'b']} onReady={onReady} onNavigationError={onNavigationError} />,
    );
    await waitFor(() => {
      expect(view.getByTestId('state').textContent).toBe('1/2');
    });
    expect(onNavigationError).not.toHaveBeenCalled();

    view.unmount();
  });
});
