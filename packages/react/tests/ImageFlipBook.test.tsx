import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { PageFlip, type CanvasLeaf } from '@gullabs/flipbook-core';
import { ImageFlipBook } from '../src/ImageFlipBook';
import type { FlipBookHandle } from '../src/types';

/**
 * `ImageFlipBook`'s contract with the engine.
 *
 * These run a REAL `PageFlip` wherever they can. jsdom has no 2D context, so
 * `CanvasRender`'s constructor would throw and every book would fail to attach;
 * `stubCanvas2D` supplies a context whose drawing operations do nothing. That
 * is deliberately the only thing stubbed — the page collection, the spread
 * table, the flip state machine and the settings validator are all the real
 * ones, so a test can be wrong about them.
 *
 * What this CANNOT cover: no bitmap ever decodes under jsdom (`Image` does not
 * fetch), so nothing here says anything about drawn pixels. That is `e2e/`.
 */

const CTX_METHODS = [
  'arc',
  'beginPath',
  'clip',
  'closePath',
  'drawImage',
  'fill',
  'fillRect',
  'lineTo',
  'moveTo',
  'rect',
  'restore',
  'rotate',
  'save',
  'setTransform',
  'stroke',
  'translate',
] as const;

function stubCanvas2D(): void {
  const original = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    const context: Record<string, unknown> = {
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    for (const name of CTX_METHODS) context[name] = () => undefined;

    HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
      return kind === '2d' ? context : null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
  });
}

/**
 * Every descriptor field ADR 0001 defines, on one list, so a flattening step
 * anywhere between the prop and the engine has something to lose.
 */
const LEAVES: readonly CanvasLeaf[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'Red', fit: 'cover', density: 'hard' },
  { blank: true, alt: '' },
  {
    src: '/fixtures/canvas/page-2.png',
    alt: 'Green',
    inset: 0.028,
    background: '#f4ecd8',
    crossOrigin: 'anonymous',
  },
  { src: '/fixtures/canvas/page-3.png', alt: 'Yellow' },
];

describe('ImageFlipBook — engine contract', () => {
  stubCanvas2D();

  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    cleanup();
  });

  test('hands the engine the descriptors it was given, field for field', async () => {
    const load = vi.spyOn(PageFlip.prototype, 'loadFromImages');

    render(<ImageFlipBook width={200} height={150} flippingTime={0} images={LEAVES} />);

    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });

    // Deep equality against the WHOLE list, not "an array of strings" and not
    // "was called". The previous implementation called `loadFromImages` too —
    // with `['/fixtures/canvas/page-0.png', …]`, having thrown away `alt`,
    // `fit`, `inset`, `background`, `crossOrigin`, `density` and both blank
    // leaves. A call-happened assertion cannot tell those two apart.
    expect(load.mock.calls[0]?.[0]).toEqual(LEAVES);

    // The dropped-blank-leaf warning is gone because nothing is dropped.
    expect(warn).not.toHaveBeenCalled();

    load.mockRestore();
  });

  test('a blank leaf becomes a real page, not a hole in the collection', async () => {
    // End-to-end rather than at the call boundary: the engine builds one page
    // per descriptor, so the page COUNT is what proves the blank survived
    // validation and page construction, not just the argument list.
    const ref = createRef<FlipBookHandle>();

    render(<ImageFlipBook width={200} height={150} flippingTime={0} images={LEAVES} ref={ref} />);

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    expect(LEAVES.filter((leaf) => 'blank' in leaf)).toHaveLength(1);
  });

  test('an invalid descriptor is reported, not swallowed', async () => {
    const onNavigationError = vi.fn();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        // An empty `src` is a descriptor core rejects outright, and the whole
        // list is refused before anything on screen changes. The component must
        // surface that rather than leaving a component mounted on a book that
        // silently never arrived.
        images={[{ src: '', alt: 'Nothing' }]}
        onNavigationError={onNavigationError}
      />,
    );

    await waitFor(() => {
      expect(onNavigationError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_IMAGE_SOURCE' }),
      );
    });
  });

  test('a missing `alt` warns once and still renders the page', async () => {
    // Core downgraded this from a rejection to a warning: a poor accessible
    // name on page 12 must not stop the book loading for everybody. The
    // component's half of that contract is that the leaf keeps its place.
    const ref = createRef<FlipBookHandle>();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        images={[
          { src: '/fixtures/canvas/page-0.png', alt: 'Cover' },
          { src: '/fixtures/canvas/page-1.png' } as unknown as CanvasLeaf,
        ]}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(2);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no `alt`');
  });
});

describe('ImageFlipBook — which props reach the engine', () => {
  stubCanvas2D();
  afterEach(cleanup);

  test('engine settings are forwarded; React-only props are not', async () => {
    const ref = createRef<FlipBookHandle>();
    const liveRegionText = () => 'x';
    const onFlip = () => undefined;

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        pageBackground="#f4ecd8"
        direction="rtl"
        images={LEAVES}
        liveRegionText={liveRegionText}
        onFlip={onFlip}
        aria-label="Book"
        ref={ref}
      />,
    );

    const engine = await waitFor(() => {
      const found = ref.current?.pageFlip();
      expect(found).toBeTruthy();
      return found!;
    });

    const settings = engine.getSettings() as unknown as Record<string, unknown>;
    expect(settings['pageBackground']).toBe('#f4ecd8');
    expect(settings['direction']).toBe('rtl');
    expect(settings['width']).toBe(200);

    // The other half, and the reason the deny-list has to be exhaustive: a
    // React prop landing on the settings object is junk the engine carries for
    // the life of the book, and `images` would put the whole leaf list there.
    for (const key of ['images', 'liveRegionText', 'onFlip', 'aria-label', 'liveRegion']) {
      expect(settings, key).not.toHaveProperty(key);
    }
  });

  test('a prop the consumer left undefined is not forwarded at all', async () => {
    // The engine's own `definedOnly` would drop these anyway, so this is a
    // BOUNDARY assertion rather than an observable-behaviour one, and it is
    // written at the boundary honestly: what is pinned is that the component
    // never hands the engine a key the consumer did not set. A component that
    // forwarded `{ pageBackground: undefined }` is one `definedOnly` away from
    // wiping a default, and `updateSettings` is called on every prop change.
    //
    // Built by SPREAD rather than as JSX attributes, because that is the only
    // way the value arrives in practice: `exactOptionalPropertyTypes` makes
    // `pageBackground={undefined}` a compile error, while
    // `{...defaults, ...overrides}` — the shape every wrapper component ends up
    // with — produces the key with an undefined value and type-checks fine.
    const construct = vi.spyOn(PageFlip.prototype, 'updateSettings');
    const ref = createRef<FlipBookHandle>();

    const props = {
      width: 200,
      height: 150,
      flippingTime: 0,
      pageBackground: undefined,
      direction: undefined,
      images: LEAVES,
    } as unknown as React.ComponentProps<typeof ImageFlipBook>;

    render(<ImageFlipBook {...props} ref={ref} />);

    const engine = await waitFor(() => {
      const found = ref.current?.pageFlip();
      expect(found).toBeTruthy();
      return found!;
    });

    for (const call of construct.mock.calls) {
      const partial = call[0] as Record<string, unknown>;
      expect(Object.keys(partial), JSON.stringify(partial)).not.toContain('pageBackground');
      expect(Object.keys(partial), JSON.stringify(partial)).not.toContain('direction');
    }

    // …and the engine keeps its own defaults rather than an undefined hole.
    const settings = engine.getSettings() as unknown as Record<string, unknown>;
    expect(settings['pageBackground']).toBeTruthy();
    expect(settings['direction']).toBe('ltr');

    construct.mockRestore();
  });

  test('a setting core has not landed yet is still forwarded', async () => {
    // This is the test the previous hand-written allow-list could not pass.
    // `imageFit` is ADR 0001's and is not on `FlipSetting` at the time of
    // writing — hence the cast, which is honest about that — but the whole
    // point of forwarding by exclusion is that the day it lands, a consumer
    // setting it gets it, with no edit here. An enumerated allow-list forwards
    // nothing it has not been told about, and says nothing when it doesn't.
    const ref = createRef<FlipBookHandle>();

    const props = {
      width: 200,
      height: 150,
      flippingTime: 0,
      images: LEAVES,
      imageFit: 'cover',
    } as unknown as React.ComponentProps<typeof ImageFlipBook>;

    render(<ImageFlipBook {...props} ref={ref} />);

    const engine = await waitFor(() => {
      const found = ref.current?.pageFlip();
      expect(found).toBeTruthy();
      return found!;
    });
    expect((engine.getSettings() as unknown as Record<string, unknown>)['imageFit']).toBe('cover');
  });
});

const STORY: readonly CanvasLeaf[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'Red' },
  { src: '/fixtures/canvas/page-1.png', alt: 'Green' },
  { src: '/fixtures/canvas/page-2.png', alt: 'Blue' },
  { src: '/fixtures/canvas/page-3.png', alt: 'Yellow' },
];

describe('ImageFlipBook — the controlled `page` prop', () => {
  stubCanvas2D();
  afterEach(cleanup);

  test('an initial `page` is applied AFTER the async load settles', async () => {
    // `loadFromImages` is a promise, so at the moment the controlled-page
    // effect first runs the engine is still NOT_LOADED and every getter throws.
    // A binding that only watched the prop would therefore silently drop the
    // opening page of every book that specified one, and the reader would land
    // on page 1 of a book they resumed at page 3.
    const ref = createRef<FlipBookHandle>();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        page={2}
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(2);
    });
  });

  test('a later `page` change turns the book, in both directions', async () => {
    const ref = createRef<FlipBookHandle>();
    const view = (page: number) => (
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        page={page}
        images={STORY}
        ref={ref}
      />
    );
    const { rerender } = render(view(0));

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);

    rerender(view(3));
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(3);
    });

    // Backwards too: an effect that only ever moved forward would pass the
    // assertion above and strand a reader who scrubbed a slider to the left.
    rerender(view(1));
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });
  });

  test('a `page` outside the book is reported, and leaves the book where it was', async () => {
    const onNavigationError = vi.fn();
    const ref = createRef<FlipBookHandle>();
    const view = (page: number) => (
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        page={page}
        images={STORY}
        onNavigationError={onNavigationError}
        ref={ref}
      />
    );
    const { rerender } = render(view(1));

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });
    expect(onNavigationError).not.toHaveBeenCalled();

    // `turnToPage` throws rather than landing one page short (CLAUDE.md), so
    // the binding's job is to surface that instead of letting it escape an
    // effect — and to leave the reader on the page they could actually see.
    rerender(view(99));
    await waitFor(() => {
      expect(onNavigationError).toHaveBeenCalledWith({
        code: 'INVALID_PAGE',
        requested: 99,
        actual: 1,
      });
    });
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
  });

  test('an initial `page` outside the book is reported by the load itself', async () => {
    // The load path applies the initial page, so it owns this failure: without
    // its own report, a book opened at a bad index fails silently at exactly
    // the moment there is no later prop change to notice it.
    const onNavigationError = vi.fn();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        page={42}
        images={STORY}
        onNavigationError={onNavigationError}
      />,
    );

    await waitFor(() => {
      expect(onNavigationError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_PAGE', requested: 42, actual: 0 }),
      );
    });
  });
});

describe('ImageFlipBook — the imperative handle', () => {
  stubCanvas2D();
  afterEach(cleanup);

  test('every method drives the real engine', async () => {
    const ref = createRef<FlipBookHandle>();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });

    expect(ref.current?.flipNext()).toBe(true);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });

    expect(ref.current?.flipPrev()).toBe(true);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    });

    // `turnToPage` jumps without animating; `flipToPage` animates there. Both
    // must reach the page — a handle that forwarded both to the same method
    // would pass a one-method test.
    act(() => {
      ref.current?.turnToPage(3);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(3);
    });

    act(() => {
      ref.current?.flipToPage(1);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });
  });

  test('a handle kept past unmount refuses rather than throwing', async () => {
    // A consumer holding the handle in a ref, an event listener, or a timeout
    // outranges the component. Every method has to answer for a book that is
    // gone: `flipNext`/`flipPrev` report refusal as `false` (the engine's own
    // "refusal is a boolean" contract), and nothing may throw into a callback
    // whose only crime is firing late.
    let captured: FlipBookHandle | null = null;

    const { unmount } = render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={(handle) => {
          if (handle) captured = handle;
        }}
      />,
    );

    await waitFor(() => {
      expect((captured as FlipBookHandle | null)?.pageFlip()?.getPageCount()).toBe(4);
    });

    unmount();

    const handle = captured as unknown as FlipBookHandle;
    expect(handle.pageFlip()).toBeNull();
    expect(handle.flipNext()).toBe(false);
    expect(handle.flipPrev()).toBe(false);
    expect(() => {
      handle.turnToPage(1);
    }).not.toThrow();
    expect(() => {
      handle.flipToPage(1);
    }).not.toThrow();
  });
});

describe('ImageFlipBook — engine events reach the consumer', () => {
  stubCanvas2D();
  afterEach(cleanup);

  test('a refused turn is reported as `turnRejected`, not as a flip', async () => {
    // The engine's contract is that a declined turn is `false` PLUS an event.
    // A binding that forwarded only `flip` leaves a consumer whose "next"
    // button does nothing at the end of the book with no way to know why.
    const onTurnRejected = vi.fn();
    const onPageChange = vi.fn();
    const ref = createRef<FlipBookHandle>();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={STORY}
        onTurnRejected={onTurnRejected}
        onPageChange={onPageChange}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    onPageChange.mockClear();

    expect(ref.current?.flipPrev()).toBe(false);

    await waitFor(() => {
      expect(onTurnRejected).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reason: 'boundary' } }),
      );
    });
    // …and no phantom page change went out alongside it.
    expect(onPageChange).not.toHaveBeenCalled();
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
  });

  test('a collection replaced through the handle updates the component, not just the engine', async () => {
    // `pageFlip()` is public API, so a consumer may drive `updateFromImages`
    // themselves. `collectionRebuild` is the only announcement of that, and the
    // component's page count and current index are derived from it — without
    // the handler the controlled-page effect goes on comparing against a count
    // from a collection that no longer exists.
    const onCollectionRebuild = vi.fn();
    const onUpdate = vi.fn();
    const ref = createRef<FlipBookHandle>();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={STORY}
        onCollectionRebuild={onCollectionRebuild}
        onUpdate={onUpdate}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });

    await act(async () => {
      await ref.current?.pageFlip()?.updateFromImages(STORY.slice(0, 2));
    });

    await waitFor(() => {
      expect(onCollectionRebuild).toHaveBeenCalledWith(
        expect.objectContaining({ data: { page: 0, pageCount: 2 } }),
      );
    });
    // `update` is the other half of the atomic pair core dispatches; a binding
    // that forwarded only the rebuild would drop the layout half of it.
    expect(onUpdate).toHaveBeenCalled();
    expect(ref.current?.pageFlip()?.getPageCount()).toBe(2);
  });

  test('replacing `images` rebuilds the book and does not strand the reader past its end', async () => {
    // A leaf list is data: a chapter loads, a filter narrows, a fetch replaces
    // it. The reload must leave the reader inside the book that now exists —
    // and the mirror must describe THAT book, not the one they arrived in.
    const ref = createRef<FlipBookHandle>();
    const view = (images: readonly CanvasLeaf[]) => (
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        usePortrait
        images={images}
        ref={ref}
      />
    );
    const { container, rerender } = render(view(STORY));

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    act(() => {
      ref.current?.turnToPage(3);
    });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(3);
    });

    rerender(view(STORY.slice(0, 2)));

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(2);
    });
    // Index 3 does not exist any more. Keeping it would leave every getter
    // reading past the end of the spread table.
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBeLessThan(2);

    // And the accessible book is re-sized with it — `aria-setsize` still
    // claiming 4 would tell a reader there are two pages they can never reach.
    const items = Array.from(container.querySelectorAll('li'));
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) expect(li.getAttribute('aria-setsize')).toBe('2');
  });
});

describe('ImageFlipBook — a load that never arrives', () => {
  stubCanvas2D();
  afterEach(cleanup);

  test('a failure that is not a PageFlipError is still reported, as UNKNOWN', async () => {
    // The canvas renderer is a separate chunk, so a load can fail for reasons
    // core never wrapped — a network error on the dynamic import, a bundler
    // misconfiguration. Only `PageFlipError` carries a `code`; anything else
    // must still reach `onNavigationError` rather than becoming an unhandled
    // rejection and a blank book with no explanation.
    const load = vi
      .spyOn(PageFlip.prototype, 'loadFromImages')
      .mockRejectedValue(new Error('Failed to fetch dynamically imported module'));
    const onNavigationError = vi.fn();

    render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        images={STORY}
        onNavigationError={onNavigationError}
      />,
    );

    await waitFor(() => {
      expect(onNavigationError).toHaveBeenCalledWith({
        code: 'UNKNOWN',
        requested: 0,
        actual: -1,
      });
    });

    load.mockRestore();
  });

  test('a load that fails after unmount reports nothing to anybody', async () => {
    // The consumer's component is gone; calling its handler is a state update
    // on an unmounted tree at best and a listener resurrecting dead UI at
    // worst. The cancellation flag has to be checked on the FAILURE path too —
    // it is the one an aborted navigation actually takes.
    let reject: (err: Error) => void = () => undefined;
    const load = vi.spyOn(PageFlip.prototype, 'loadFromImages').mockReturnValue(
      new Promise<void>((_resolve, rejectFn) => {
        reject = rejectFn;
      }),
    );
    const onNavigationError = vi.fn();

    const { unmount } = render(
      <ImageFlipBook
        width={200}
        height={150}
        flippingTime={0}
        images={STORY}
        onNavigationError={onNavigationError}
      />,
    );

    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });

    unmount();
    await act(async () => {
      reject(new Error('too late'));
      await Promise.resolve();
    });

    expect(onNavigationError).not.toHaveBeenCalled();
    load.mockRestore();
  });
});
