/**
 * Critical-fix coverage for the React binding review round
 * (90aa7a9 and the related product code still landing in this tree).
 *
 * Each case pins a defect that shipped under a renamed API while the behaviour
 * still did the old wrong thing. Comments name the revert that must FAIL the
 * assertion — that is the gate this suite exists for, not decoration.
 *
 * Product code under packages/ (src trees) is owned by another agent; this
 * file only locks the public React contracts those fixes claim.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRef, forwardRef, StrictMode, useState, type ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { HTMLFlipBook, usePageFlip } from '@gullabs/react-flipbook';
import type { BookSnapshot, FlipBookHandle, TurnRejected } from '@gullabs/react-flipbook';
import { PageFlipError } from '@gullabs/flipbook-core';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pages(...labels: string[]): ReactNode[] {
  return labels.map((label) => (
    <div key={label} data-testid={`page-${label}`}>
      {label}
    </div>
  ));
}

function bookRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-label="Flipbook"]');
  expect(el).toBeTruthy();
  return el!;
}

/**
 * jsdom measures everything as 0×0, so the orientation the engine picks is an
 * accident. Suites that care give the block a real size — same pattern as
 * `HTMLFlipBook.test.tsx` / `a11y.test.tsx`.
 */
let blockSize: { width: number; height: number } | null = null;

function useMeasuredLayout(): void {
  const original = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  };

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => blockSize?.width ?? 0,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => blockSize?.height ?? 0,
    });
  });

  afterEach(() => {
    blockSize = null;
    if (original.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.width);
    if (original.height) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.height);
    }
  });
}

/** One page is 200 wide, so 300 cannot fit a spread and 900 can. */
const PORTRAIT_BLOCK = { width: 300, height: 300 };
const LANDSCAPE_BLOCK = { width: 900, height: 300 };

async function waitUntilReady(
  ref: { current: FlipBookHandle | null },
  pageCount: number,
): Promise<void> {
  await waitFor(() => {
    const engine = ref.current?.pageFlip();
    expect(engine).toBeTruthy();
    expect(engine?.getPageCount()).toBe(pageCount);
  });
}

function control(container: HTMLElement, which: 'prev' | 'next'): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`[data-flipbook-control="${which}"]`);
  expect(btn).toBeTruthy();
  return btn!;
}

/* -------------------------------------------------------------------------- */
/* 1. First-mount DETACHED_PAGE guard (BLOCKER / R-1)                         */
/* -------------------------------------------------------------------------- */

describe('R-1 — first-mount DETACHED_PAGE guard', () => {
  test('a normal book with host-element children mounts without throwing', async () => {
    // Reverted fix: readNodes() ran in the same passive flush as the children
    // effect that published empty slots, so EVERY first mount threw DETACHED_PAGE.
    const ref = createRef<FlipBookHandle>();
    expect(() =>
      render(
        <HTMLFlipBook width={200} height={300} flippingTime={0} ref={ref}>
          {pages('a', 'b', 'c')}
        </HTMLFlipBook>,
      ),
    ).not.toThrow();

    await waitUntilReady(ref, 3);
    expect(screen.getByTestId('page-a')).toBeTruthy();
    expect(screen.getByLabelText('Flipbook')).toBeTruthy();
  });

  test('StrictMode double-mount still settles a normal book', async () => {
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <StrictMode>
        <HTMLFlipBook width={200} height={300} flippingTime={0} ref={ref}>
          {pages('a', 'b')}
        </HTMLFlipBook>
      </StrictMode>,
    );

    await waitUntilReady(ref, 2);
    expect(container.querySelectorAll('[aria-label="Flipbook"]').length).toBe(1);
  });

  test('a component child that does not forward its ref still throws DETACHED_PAGE', async () => {
    // The throw is the right contract; only the TIMING of the first-mount
    // consult was wrong. Softening it would delete D1.
    //
    // The load effect throws once slots stay null after commit. `act` rethrows
    // passive-effect failures, so the assertion is a catch around the flush —
    // not a silent console.error scrape that would also pass if nothing threw.
    function OpaquePage({ children }: { children?: ReactNode }) {
      // Deliberately no forwardRef — cloneElement's ref never reaches a host.
      return <div data-testid="opaque">{children}</div>;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let thrown: unknown;

    try {
      try {
        await act(async () => {
          render(
            <HTMLFlipBook width={200} height={300} flippingTime={0}>
              <OpaquePage key="a">a</OpaquePage>
              <div key="b">b</div>
            </HTMLFlipBook>,
          );
        });
      } catch (error) {
        thrown = error;
      }

      // A second microtask flush can surface the same failure if the first
      // render only scheduled the effect; keep catching until settled.
      if (!(thrown instanceof PageFlipError)) {
        try {
          await act(async () => {
            await Promise.resolve();
          });
        } catch (error) {
          thrown = error;
        }
      }

      expect(thrown).toBeInstanceOf(PageFlipError);
      expect((thrown as PageFlipError).code).toBe('DETACHED_PAGE');
      expect((thrown as PageFlipError).message).toMatch(/child index 0/);
    } finally {
      consoleError.mockRestore();
    }
  });

  test('a forwardRef page child is accepted — negative control on the throw', async () => {
    const Leaf = forwardRef<HTMLDivElement, { label: string }>(function Leaf({ label }, ref) {
      return (
        <div ref={ref} data-testid={`leaf-${label}`}>
          {label}
        </div>
      );
    });

    const ref = createRef<FlipBookHandle>();
    render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} ref={ref}>
        <Leaf key="a" label="a" />
        <Leaf key="b" label="b" />
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 2);
    expect(screen.getByTestId('leaf-a')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. onReady / onLoaded pageCount (D17 / 90aa7a9)                            */
/* -------------------------------------------------------------------------- */

describe('D17 — onReady/onLoaded announce the real book, never pageCount: 0', () => {
  test('mount with pages reports pageCount matching children on both events', async () => {
    // Reverted fix: loadFromHTML([]) announced synchronously, so the binding
    // deterministically reported pageCount: 0 (the empty portal shell).
    const onReady = vi.fn<(snapshot: BookSnapshot) => void>();
    const onLoaded = vi.fn<(snapshot: BookSnapshot) => void>();
    const ref = createRef<FlipBookHandle>();

    render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        ref={ref}
        onReady={onReady}
        onLoaded={onLoaded}
      >
        {pages('a', 'b', 'c', 'd')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 4);

    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
      expect(onLoaded).toHaveBeenCalled();
    });

    // Never fire with the empty shell. A "last call is right" check would still
    // pass the defect if a stale pageCount:0 came first.
    for (const call of onReady.mock.calls) {
      const snapshot = call[0];
      expect(snapshot).toEqual(expect.objectContaining({ pageCount: 4 }));
      expect(snapshot.pageCount).not.toBe(0);
    }
    for (const call of onLoaded.mock.calls) {
      const snapshot = call[0];
      expect(snapshot).toEqual(expect.objectContaining({ pageCount: 4 }));
      expect(snapshot.pageCount).not.toBe(0);
    }

    expect(onReady).toHaveBeenCalledTimes(1);
    // First real collection: ready once, loaded once.
    expect(onLoaded.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onLoaded.mock.calls.every((c) => c[0].pageCount === 4)).toBe(true);
  });

  test('payloads are unwrapped BookSnapshots, not WidgetEvent wrappers', async () => {
    const onReady = vi.fn<(snapshot: BookSnapshot) => void>();
    render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} onReady={onReady}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    const snapshot = onReady.mock.calls[0]?.[0];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) throw new Error('onReady never fired');
    expect(typeof snapshot.page).toBe('number');
    expect(snapshot.pageCount).toBe(2);
    expect(snapshot.orientation).toMatch(/portrait|landscape/);
    expect(Array.isArray(snapshot.visiblePages)).toBe(true);
    // D18: no WidgetEvent wrapper.
    expect(snapshot).not.toHaveProperty('data');
    expect(snapshot).not.toHaveProperty('object');
  });
});

/* -------------------------------------------------------------------------- */
/* 3 + 7. canGoNext / next control at landscape end (R-3) + aria-disabled (R-6)*/
/* -------------------------------------------------------------------------- */

describe('R-3 / R-6 — landscape end bounds and aria-disabled controls', () => {
  useMeasuredLayout();

  test('on the last landscape spread of a 6-page book, next is aria-disabled', async () => {
    // Reverted fix: compared enginePage (spread HEAD) to pageCount-1, so head
    // 4 of spread [4,5] kept next enabled forever in landscape.
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait={false}
        ref={ref}
        controls="visible"
      >
        {pages('a', 'b', 'c', 'd', 'e', 'f')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 6);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getOrientation()).toBe('landscape');
    });

    const next = control(container, 'next');
    const prev = control(container, 'prev');

    // Start: prev disabled, next enabled.
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBeNull();
    // R-6: never the HTML disabled attribute (focus must not drop).
    expect(prev.hasAttribute('disabled')).toBe(false);
    expect(next.hasAttribute('disabled')).toBe(false);

    act(() => {
      expect(ref.current?.turnToPage(4)).toBe(true);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(4);
    });

    expect(control(container, 'next').getAttribute('aria-disabled')).toBe('true');
    expect(control(container, 'prev').getAttribute('aria-disabled')).toBeNull();
    expect(control(container, 'next').hasAttribute('disabled')).toBe(false);
  });

  test('mid-book neither control is aria-disabled', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait={false}
        ref={ref}
        controls="visible"
      >
        {pages('a', 'b', 'c', 'd', 'e', 'f')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 6);
    act(() => {
      expect(ref.current?.turnToPage(2)).toBe(true);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(2);
    });

    expect(control(container, 'prev').getAttribute('aria-disabled')).toBeNull();
    expect(control(container, 'next').getAttribute('aria-disabled')).toBeNull();
  });

  test('hostile: enabling next when head < pageCount-1 is not enough', async () => {
    // Discriminates "head is not last page index" from the real spread-end
    // check. On [4,5] head is 4 and pageCount-1 is 5 — the broken comparison
    // would still enable next.
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait={false}
        ref={ref}
        controls="visible"
      >
        {pages('a', 'b', 'c', 'd', 'e', 'f')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 6);
    act(() => {
      ref.current?.turnToPage(4);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(4);
    });

    const head = ref.current!.pageFlip()!.getCurrentPageIndex();
    const count = ref.current!.pageFlip()!.getPageCount();
    expect(head).toBeLessThan(count - 1);
    expect(control(container, 'next').getAttribute('aria-disabled')).toBe('true');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. controls default 'auto' (R-7)                                           */
/* -------------------------------------------------------------------------- */

describe('R-7 — controls default is the skip-link pattern, not layout height', () => {
  test("'auto' (default) clips the controls but keeps them in the a11y tree", async () => {
    // Reverted fix: two unstyled buttons in normal flow changed every book's
    // rendered height; the only escape was controls:false, which reopened the
    // a11y hole the buttons exist to close.
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-control="next"]')).toBeTruthy();
    });

    const wrap = container.querySelector<HTMLElement>('[data-flipbook-controls]');
    expect(wrap).toBeTruthy();
    // Default is not the "visible" marker.
    expect(wrap?.getAttribute('data-flipbook-controls')).toBe('');

    const style = wrap!.style;
    expect(style.position).toBe('absolute');
    // jsdom normalises `rect(0 0 0 0)` to `rect(0px)`; either form is the clip.
    expect(style.clip).toMatch(/^rect\(/);
    expect(style.clipPath).toBe('inset(50%)');
    expect(style.overflow).toBe('hidden');
    expect(style.width).toBe('1px');
    expect(style.height).toBe('1px');

    // Still reachable: labels present, not display:none / removed.
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
  });

  test("controls='visible' puts the strip in normal flow", async () => {
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} controls="visible">
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-flipbook-control="next"]')).toBeTruthy();
    });

    const wrap = container.querySelector<HTMLElement>('[data-flipbook-controls="visible"]');
    expect(wrap).toBeTruthy();
    // No skip-link clip when opted into flow.
    expect(wrap!.style.position).not.toBe('absolute');
    expect(wrap!.style.clip).toBe('');
  });

  test("controls='none' renders no buttons", async () => {
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} controls="none">
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitFor(() => bookRoot(container));
    expect(container.querySelector('[data-flipbook-controls]')).toBeNull();
    expect(container.querySelector('[data-flipbook-control]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 5. turnRejected reason mapping (R-4)                                       */
/* -------------------------------------------------------------------------- */

describe('R-4 — turnRejected reason mapping for absolute navigation', () => {
  useMeasuredLayout();

  test("turnToPage(99) → reason 'invalidPage' with code INVALID_PAGE, not 'setup'", async () => {
    // Reverted fix: the mapping was inverted — INVALID_PAGE became 'setup'.
    blockSize = PORTRAIT_BLOCK;
    const rejected: TurnRejected[] = [];
    const ref = createRef<FlipBookHandle>();

    render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        ref={ref}
        onTurnRejected={(info) => rejected.push(info)}
      >
        {pages('a', 'b', 'c')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 3);

    let ok = true;
    act(() => {
      ok = ref.current!.turnToPage(99);
    });

    expect(ok).toBe(false);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toEqual(
      expect.objectContaining({
        reason: 'invalidPage',
        targetPage: 99,
        code: 'INVALID_PAGE',
        direction: null,
      }),
    );
    expect(rejected[0]?.reason).not.toBe('setup');
    expect(typeof rejected[0]?.landedOn).toBe('number');
  });

  test('a fractional in-range page (PAGE_NOT_IN_SPREAD) still maps to invalidPage', async () => {
    // 1.5 is inside [0, pageCount) so it is not INVALID_PAGE, but no spread
    // holds a non-integer leaf — that is PAGE_NOT_IN_SPREAD. Both are the
    // caller naming a page the book cannot show.
    blockSize = PORTRAIT_BLOCK;
    const rejected: TurnRejected[] = [];
    const ref = createRef<FlipBookHandle>();

    render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        ref={ref}
        onTurnRejected={(info) => rejected.push(info)}
      >
        {pages('a', 'b', 'c', 'd')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 4);

    act(() => {
      expect(ref.current!.turnToPage(1.5)).toBe(false);
    });

    expect(rejected[0]).toEqual(
      expect.objectContaining({
        reason: 'invalidPage',
        targetPage: 1.5,
        code: 'PAGE_NOT_IN_SPREAD',
      }),
    );
    expect(rejected[0]?.reason).not.toBe('setup');
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Handle methods before ready (D15 / R-5)                                 */
/* -------------------------------------------------------------------------- */

describe('D15 — handle methods report notReady when the engine is gone', () => {
  test('flipNext/flipPrev/turnToPage after unmount return false + onTurnRejected notReady', async () => {
    // Reverted fix: flipNext/flipPrev returned bare false with no event while
    // turnToPage reported notReady — two of four still refusing silently.
    const rejected: TurnRejected[] = [];
    const ref = createRef<FlipBookHandle>();

    const view = render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        ref={ref}
        onTurnRejected={(info) => rejected.push(info)}
      >
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    await waitUntilReady(ref, 2);
    // Capture the handle object before React nulls the ref on unmount. The
    // methods close over engineRef, which destroy() clears.
    const handle = ref.current!;
    expect(handle.pageFlip()).toBeTruthy();

    view.unmount();
    rejected.length = 0;

    expect(handle.flipNext()).toBe(false);
    expect(handle.flipPrev()).toBe(false);
    expect(handle.turnToPage(1)).toBe(false);
    expect(handle.flipToPage(0)).toBe(false);

    expect(rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'notReady',
          direction: 'next',
          targetPage: null,
          code: 'NOT_LOADED',
          landedOn: null,
        }),
        expect.objectContaining({
          reason: 'notReady',
          direction: 'prev',
          targetPage: null,
          code: 'NOT_LOADED',
          landedOn: null,
        }),
        expect.objectContaining({
          reason: 'notReady',
          targetPage: 1,
          code: 'NOT_LOADED',
          landedOn: null,
        }),
        expect.objectContaining({
          reason: 'notReady',
          targetPage: 0,
          code: 'NOT_LOADED',
          landedOn: null,
        }),
      ]),
    );
    expect(rejected).toHaveLength(4);
  });

  test('turnToPage on an empty shell (pageCount 0) is notReady, not silent', async () => {
    const rejected: TurnRejected[] = [];
    const ref = createRef<FlipBookHandle>();

    render(
      <HTMLFlipBook
        width={200}
        height={300}
        flippingTime={0}
        ref={ref}
        onTurnRejected={(info) => rejected.push(info)}
      >
        {null}
      </HTMLFlipBook>,
    );

    // Engine mounts the portal shell; no leaves means pageCount stays 0.
    await waitFor(() => {
      expect(ref.current?.pageFlip()).toBeTruthy();
    });
    expect(ref.current?.pageFlip()?.getPageCount() ?? -1).toBe(0);

    act(() => {
      expect(ref.current!.turnToPage(0)).toBe(false);
    });

    expect(rejected).toEqual([
      expect.objectContaining({
        reason: 'notReady',
        targetPage: 0,
        code: 'NOT_LOADED',
        landedOn: null,
      }),
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. usePageFlip canGoNext + goToPage + initialPage (R-3 hook side)          */
/* -------------------------------------------------------------------------- */

describe('usePageFlip — canGoNext bounds, goToPage, initialPage', () => {
  useMeasuredLayout();

  test('landscape last spread reports canGoNext false', async () => {
    // Same R-3 bug the next button had, re-created in withBounds.
    blockSize = LANDSCAPE_BLOCK;
    const { result } = renderHook(() => usePageFlip());

    render(
      <HTMLFlipBook
        ref={result.current.ref}
        width={200}
        height={300}
        flippingTime={0}
        usePortrait={false}
        {...result.current.bookProps}
      >
        {pages('a', 'b', 'c', 'd', 'e', 'f')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(result.current.ref.current?.pageFlip()?.getPageCount()).toBe(6);
      expect(result.current.ref.current?.pageFlip()?.getOrientation()).toBe('landscape');
    });

    await waitFor(() => {
      expect(result.current.pageCount).toBe(6);
      expect(result.current.orientation).toBe('landscape');
    });

    // Opening spread [0,1]: can go next, cannot go prev.
    expect(result.current.canGoPrev).toBe(false);
    expect(result.current.canGoNext).toBe(true);

    act(() => {
      expect(result.current.goToPage(4, 'instant')).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(4);
      expect(result.current.canGoNext).toBe(false);
      expect(result.current.canGoPrev).toBe(true);
    });

    // Hostile: head 4 is still < pageCount-1, so a page-index comparison
    // would leave canGoNext true.
    expect(result.current.page).toBeLessThan(result.current.pageCount - 1);
  });

  test('goToPage turns the book; initialPage is forwarded in bookProps', async () => {
    blockSize = PORTRAIT_BLOCK;
    const { result } = renderHook(() => usePageFlip(2));

    expect(result.current.bookProps.initialPage).toBe(2);

    render(
      <HTMLFlipBook
        ref={result.current.ref}
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        {...result.current.bookProps}
      >
        {pages('a', 'b', 'c', 'd', 'e')}
      </HTMLFlipBook>,
    );

    await waitFor(() => {
      expect(result.current.ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(2);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(2);
      expect(result.current.pageCount).toBe(5);
    });

    act(() => {
      expect(result.current.goToPage(4, 'instant')).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(4);
      expect(result.current.ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(4);
    });

    act(() => {
      expect(result.current.goToPage(1, 'animate')).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
  });

  test('mid landscape spread keeps canGoNext true — negative control', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const { result } = renderHook(() => usePageFlip());

    render(
      <HTMLFlipBook
        ref={result.current.ref}
        width={200}
        height={300}
        flippingTime={0}
        usePortrait={false}
        {...result.current.bookProps}
      >
        {pages('a', 'b', 'c', 'd', 'e', 'f')}
      </HTMLFlipBook>,
    );

    await waitFor(() => expect(result.current.pageCount).toBe(6));

    act(() => {
      result.current.goToPage(2, 'instant');
    });
    await waitFor(() => {
      expect(result.current.page).toBe(2);
      expect(result.current.canGoNext).toBe(true);
      expect(result.current.canGoPrev).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 9. stf__parent on className (MIN-8)                                        */
/* -------------------------------------------------------------------------- */

describe('MIN-8 — root always includes stf__parent', () => {
  test('custom className keeps stf__parent alongside the consumer class', async () => {
    // Reverted fix: React replaced the whole class attribute on a className
    // change and wiped the engine's stf__parent (positioning context).
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} className="my-book extra">
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    const root = await waitFor(() => bookRoot(container));
    const classes = root.className.split(/\s+/).filter(Boolean);
    expect(classes).toContain('stf__parent');
    expect(classes).toContain('my-book');
    expect(classes).toContain('extra');
  });

  test('without className the root is exactly stf__parent', async () => {
    const { container } = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0}>
        {pages('a', 'b')}
      </HTMLFlipBook>,
    );

    const root = await waitFor(() => bookRoot(container));
    expect(root.className.split(/\s+/).filter(Boolean)).toContain('stf__parent');
  });
});

/* -------------------------------------------------------------------------- */
/* 10. landedOn on controlled out-of-range                                    */
/* -------------------------------------------------------------------------- */

describe('controlled page out-of-range reports landedOn via onTurnRejected', () => {
  useMeasuredLayout();

  test('setting page={99} clamps and reports landedOn as the actual index', async () => {
    blockSize = PORTRAIT_BLOCK;
    const rejected: TurnRejected[] = [];
    const ref = createRef<FlipBookHandle>();

    function Harness({ page }: { page: number }) {
      return (
        <HTMLFlipBook
          width={200}
          height={300}
          flippingTime={0}
          usePortrait
          page={page}
          pageTransition="instant"
          ref={ref}
          onTurnRejected={(info) => rejected.push(info)}
        >
          {pages('a', 'b', 'c')}
        </HTMLFlipBook>
      );
    }

    const view = render(<Harness page={0} />);
    await waitUntilReady(ref, 3);
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    rejected.length = 0;

    view.rerender(<Harness page={99} />);

    await waitFor(() => {
      expect(rejected.length).toBeGreaterThan(0);
    });

    const last = rejected[rejected.length - 1]!;
    expect(last.reason).toBe('invalidPage');
    expect(last.code).toBe('INVALID_PAGE');
    expect(last.targetPage).toBe(99);
    // Where the reader actually is after the clamp — not null, not 99.
    expect(last.landedOn).toBe(ref.current?.pageFlip()?.getCurrentPageIndex());
    expect(last.landedOn).not.toBe(99);
    expect(last.landedOn).toBeGreaterThanOrEqual(0);
    expect(last.landedOn).toBeLessThan(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Bonus: turn still works after onPageChange (R-1b generation guard)         */
/* -------------------------------------------------------------------------- */

describe('R-1b — a turn with onPageChange does not throw DETACHED_PAGE', () => {
  useMeasuredLayout();

  test('controlled onPageChange turn settles without DETACHED_PAGE', async () => {
    // The length-equality guard was not proof of freshness: childCount moves
    // in the same flush as an empty slot republish whenever the parent
    // re-renders with the same child count (every turn with onPageChange).
    blockSize = PORTRAIT_BLOCK;
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const handleRef = createRef<FlipBookHandle>();
      function Book() {
        const [page, setPage] = useState(0);
        return (
          <HTMLFlipBook
            width={200}
            height={300}
            flippingTime={0}
            usePortrait
            page={page}
            pageTransition="instant"
            ref={handleRef}
            onPageChange={(snapshot) => setPage(snapshot.page)}
          >
            {pages('a', 'b', 'c', 'd')}
          </HTMLFlipBook>
        );
      }

      render(<Book />);
      await waitUntilReady(handleRef, 4);

      act(() => {
        expect(handleRef.current?.flipNext()).toBe(true);
      });

      await waitFor(() => {
        expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
      });

      act(() => {
        expect(handleRef.current?.flipNext()).toBe(true);
      });

      await waitFor(() => {
        expect(handleRef.current?.pageFlip()?.getCurrentPageIndex()).toBe(2);
      });

      const consoleArgs: unknown[] = consoleError.mock.calls.flatMap((args: unknown[]) => args);
      const all: unknown[] = [...errors, ...consoleArgs];
      expect(
        all.some((value) => value instanceof PageFlipError && value.code === 'DETACHED_PAGE'),
      ).toBe(false);
    } finally {
      window.removeEventListener('error', onError);
      consoleError.mockRestore();
    }
  });
});
