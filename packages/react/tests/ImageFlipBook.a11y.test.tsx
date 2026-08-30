import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ImageFlipBook } from '../src/ImageFlipBook';
import type { CanvasLeaf, FlipBookHandle } from '../src/types';

/**
 * Accessibility of the CANVAS binding.
 *
 * There is no page DOM here, so the semantic mirror rendered by this component
 * is the entire accessible book: if a query below finds nothing, a screen
 * reader finds nothing either. That is why these use role and accessible-name
 * queries rather than `data-testid` — a test id proves a node exists, not that
 * the accessibility tree contains anything.
 *
 * HONEST LIMITS, stated rather than implied:
 *  - jsdom's accessibility tree is `@testing-library/dom`'s approximation of
 *    one. It honours `display:none`, `visibility:hidden` and `aria-hidden`, and
 *    it computes roles and names — but no real AT is involved, and NVDA/JAWS
 *    browse-mode behaviour (how `aria-posinset` is voiced, whether the live
 *    region interrupts) cannot be observed here at all.
 *  - jsdom implements neither `inert` nor `touch-action`.
 *  - No bitmap decodes, so nothing here is evidence about what is painted.
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

/** jsdom measures everything as 0x0, so orientation would otherwise be luck. */
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

const PORTRAIT_BLOCK = { width: 300, height: 300 };
const LANDSCAPE_BLOCK = { width: 900, height: 300 };

const STORY: readonly CanvasLeaf[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'A red fox on a hill' },
  { src: '/fixtures/canvas/page-1.png', alt: 'The fox meets a crow' },
  { src: '/fixtures/canvas/page-2.png', alt: 'They share the cheese' },
  { src: '/fixtures/canvas/page-3.png', alt: 'Both go home full' },
];

function bookRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-flipbook-mode="images"]');
  expect(el).toBeTruthy();
  return el!;
}

function mirrorText(container: HTMLElement): string[] {
  return within(bookRoot(container))
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '');
}

afterEach(cleanup);

describe('the semantic mirror is the whole accessible book', () => {
  stubCanvas2D();
  useMeasuredLayout();

  test('portrait: exactly the current leaf, positioned in a book of N', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });

    // ONE item, not four. Rendering every leaf would let a browse-mode reader
    // read the whole book in one pass while the canvas still showed page one —
    // the audible book and the visible book describing different states.
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });

    // …and the item says which of how many it is, since only it is in the DOM.
    // Without these the native <ol> would compute "item 1 of 1" for every page
    // of a 4-page book, and a reader would never learn the book has a length.
    const item = within(bookRoot(container)).getAllByRole('listitem')[0]!;
    expect(item.getAttribute('aria-posinset')).toBe('1');
    expect(item.getAttribute('aria-setsize')).toBe('4');
  });

  test('portrait: a turn moves the mirror with the book', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });

    act(() => {
      ref.current?.flipNext();
    });

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['The fox meets a crow']);
    });
    const item = within(bookRoot(container)).getAllByRole('listitem')[0]!;
    expect(item.getAttribute('aria-posinset')).toBe('2');
    expect(item.getAttribute('aria-setsize')).toBe('4');
  });

  test('landscape: both leaves of the spread, in reading order', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} images={STORY} ref={ref} />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getOrientation()).toBe('landscape');
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill', 'The fox meets a crow']);
    });

    const items = within(bookRoot(container)).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-posinset'))).toEqual(['1', '2']);
    expect(items.map((li) => li.getAttribute('aria-setsize'))).toEqual(['4', '4']);
  });

  test('a decorative blank leaf is omitted, and does not shift its neighbour’s position', async () => {
    blockSize = LANDSCAPE_BLOCK;
    // `alt: ''` is the author asserting the leaf is decorative. The HTML rule
    // for that is "skip me" — announcing "blank" or an empty list item instead
    // puts a word in the reader's ear the author deliberately did not say.
    //
    // The rule is `alt === ''`, NOT `blank: true`. An IMAGE leaf may also be
    // decorative — a flourish, a rule, a repeated border — and gating on the
    // variant instead of the assertion would announce it as an empty item.
    const leaves: readonly CanvasLeaf[] = [
      { blank: true, alt: '' },
      { src: '/fixtures/canvas/page-0.png', alt: 'Title page' },
      { src: '/fixtures/canvas/page-1.png', alt: 'Chapter one' },
      { src: '/fixtures/canvas/flourish.png', alt: '' },
    ];
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} images={leaves} ref={ref} />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['Title page']);
    });

    // The surviving item keeps its LEAF index: the blank is skipped in speech,
    // not renumbered away. Reporting "1 of 3" here would quietly tell the
    // reader the book is shorter than it is, and disagree with the live region.
    const item = within(bookRoot(container)).getAllByRole('listitem')[0]!;
    expect(item.getAttribute('aria-posinset')).toBe('2');
    expect(item.getAttribute('aria-setsize')).toBe('4');

    // The last spread is [Chapter one, decorative flourish]: the image leaf
    // with `alt: ''` is omitted on the same rule as the blank one.
    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['Chapter one']);
    });
  });

  test('a blank leaf with no `alt` at all is still omitted', async () => {
    blockSize = LANDSCAPE_BLOCK;
    // Core types `BlankPageSource.alt` as `?: ''` — the `blank: true`
    // discriminant IS the decorative assertion. Gating omission on
    // `alt === ''` alone therefore renders a nameless empty list item for the
    // commonest blank leaf of all, which is the "blank, blank, blank" that
    // omitting decorative leaves exists to prevent.
    const leaves: readonly CanvasLeaf[] = [
      { blank: true },
      { src: '/fixtures/canvas/page-0.png', alt: 'Title page' },
    ];
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} images={leaves} ref={ref} />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(2);
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['Title page']);
    });
  });

  test('an image leaf with no `alt` keeps its place, announced by position only', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // ADR 0001: absence is "unknown", NEVER "decorative". Dropping the item
    // would tell the reader the book is shorter than it is; inventing "Page 2"
    // would put an unlocalizable English string in their ear that the author
    // never wrote. It keeps its item, its posinset and its setsize, and has no
    // accessible name — which is exactly what core's warning promises.
    const leaves = [
      { src: '/fixtures/canvas/page-0.png', alt: 'Title page' },
      { src: '/fixtures/canvas/page-1.png' },
    ] as unknown as readonly CanvasLeaf[];
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} images={leaves} ref={ref} />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(2);
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['Title page', '']);
    });
    const items = within(bookRoot(container)).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-posinset'))).toEqual(['1', '2']);
    expect(items.map((li) => li.getAttribute('aria-setsize'))).toEqual(['2', '2']);
    warn.mockRestore();
  });

  test('the canvas itself is hidden from assistive technology', async () => {
    blockSize = PORTRAIT_BLOCK;
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} usePortrait images={STORY} />,
    );

    const canvas = await waitFor(() => {
      const el = bookRoot(container).querySelector('canvas');
      expect(el).toBeTruthy();
      return el!;
    });
    // An unnamed <canvas> is announced as an empty graphic sitting in front of
    // the only content there is.
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
  });

  test('the book still describes itself when the engine never loads', async () => {
    blockSize = PORTRAIT_BLOCK;
    // No 2D context — `stubCanvas2D` is not applied to this test's engine
    // because the describe-level stub is, so force the failure explicitly.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const { container } = render(
        <ImageFlipBook width={200} height={300} flippingTime={0} usePortrait images={STORY} />,
      );

      // Derived from `images`, not from engine state. Reading the page count
      // off the engine gave a book with NO accessible content whenever the
      // load failed — which is exactly when a reader needs to be told
      // something. The name is still on the group, and the leaves are still
      // readable.
      //
      // The SPREAD is the honest limit of this: with no engine there is no
      // orientation, so the component keeps its `landscape` default and shows
      // two leaves even though `usePortrait` is set. Asserting the exact list
      // here would be asserting a guess. What is load-bearing is that the
      // content exists and is correctly positioned in a book of four.
      await waitFor(() => {
        expect(mirrorText(container)[0]).toBe('A red fox on a hill');
      });
      const first = within(bookRoot(container)).getAllByRole('listitem')[0]!;
      expect(first.getAttribute('aria-posinset')).toBe('1');
      expect(first.getAttribute('aria-setsize')).toBe('4');
      expect(bookRoot(container).getAttribute('aria-label')).toBe('Flipbook');
      expect(bookRoot(container).getAttribute('aria-roledescription')).toBe('book');
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});

describe('the live region announces turns, and only turns', () => {
  stubCanvas2D();
  useMeasuredLayout();

  test('mounts empty, then reports the spread it turned to', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    const status = await waitFor(() => {
      const el = within(bookRoot(container)).getByRole('status');
      return el;
    });
    expect(status.getAttribute('aria-live')).toBe('polite');
    // Atomic: the region is re-read whole, so "Page 2 of 4" is not voiced as
    // the single changed word.
    expect(status.getAttribute('aria-atomic')).toBe('true');

    // Empty on arrival. Announcing the opening spread makes every book on the
    // page introduce itself while the reader is somewhere else entirely.
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    expect(status.textContent).toBe('');

    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Page 2 of 4');
    });
  });
});

describe('the live region names the spread in the book’s own terms', () => {
  stubCanvas2D();
  useMeasuredLayout();

  test('a landscape turn is announced as BOTH leaves, not the head of the spread', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook width={200} height={300} flippingTime={0} images={STORY} ref={ref} />,
    );

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill', 'The fox meets a crow']);
    });
    const status = within(bookRoot(container)).getByRole('status');

    act(() => {
      ref.current?.flipNext();
    });

    // Two leaves are on screen, so both are named. Announcing only the head
    // ("Page 3 of 4") describes half of what the reader is looking at, and the
    // half it omits is the one their eye lands on second.
    await waitFor(() => {
      expect(status.textContent).toBe('Pages 3 and 4 of 4');
    });
  });

  test('with a cover, the outer spreads are NAMED rather than numbered', async () => {
    blockSize = LANDSCAPE_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        showCover
        images={STORY}
        ref={ref}
      />,
    );

    // `showCover` makes leaf 0 and the trailing leaf single-leaf spreads. Those
    // are not "Page 1 of 4" and "Page 4 of 4" — a cover is not page one, and
    // numbering it says the book has a page before its first page.
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    const status = within(bookRoot(container)).getByRole('status');

    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Pages 2 and 3 of 4');
    });

    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Back cover');
    });
    // Single leaf, and it is the LAST one — the mirror agrees with the words.
    expect(mirrorText(container)).toEqual(['Both go home full']);

    act(() => {
      ref.current?.flipPrev();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Pages 2 and 3 of 4');
    });
    act(() => {
      ref.current?.flipPrev();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Front cover');
    });
    expect(mirrorText(container)).toEqual(['A red fox on a hill']);
  });

  test('without a cover the same outer spreads ARE numbered', async () => {
    blockSize = PORTRAIT_BLOCK;
    // The control for the test above: "Front cover" is not a property of being
    // leaf 0, it is a property of the author having said leaf 0 is a cover. A
    // book without `showCover` that announced "Front cover" would be inventing
    // a fact about the content.
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    const status = within(bookRoot(container)).getByRole('status');

    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Page 2 of 4');
    });
    act(() => {
      ref.current?.flipPrev();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Page 1 of 4');
    });
  });

  test('a book emptied at runtime says it is a book, never “Page 1 of 0”', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const view = (images: readonly CanvasLeaf[]) => (
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={images}
        ref={ref}
      />
    );
    const { container, rerender } = render(view(STORY));

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    const status = within(bookRoot(container)).getByRole('status');

    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(status.textContent).toBe('Page 2 of 4');
    });

    // A leaf list that empties — a filtered chapter, a failed fetch replaced
    // with nothing — must not be described in page numbers it no longer has.
    // "Page 2 of 0" is a sentence about a book that does not exist.
    rerender(view([]));
    await waitFor(() => {
      expect(status.textContent).toBe('Book');
    });
    expect(mirrorText(container)).toEqual([]);
  });

  test('liveRegion={false} removes the region, not the turn', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        liveRegion={false}
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    expect(within(bookRoot(container)).queryByRole('status')).toBeNull();

    // The book itself is untouched: a consumer who suppresses announcements
    // (their own status region, an embedded reader) still gets a working book
    // and a mirror that tracks it. Suppressing the region by breaking the turn
    // would pass a "no announcement" assertion just as well.
    act(() => {
      ref.current?.flipNext();
    });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['The fox meets a crow']);
    });
  });
});

describe('keyboard: the book takes only the keys it promised', () => {
  stubCanvas2D();
  useMeasuredLayout();

  test('modified Arrow/Home/End are neither acted on nor swallowed', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    const root = bookRoot(container);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    root.focus();

    // `fireEvent` returns false when the event was canceled, so both halves of
    // the defect are asserted: the book must not turn, AND must not eat the
    // key. Alt+Arrow is Back/Forward, Cmd+ArrowLeft is Back on macOS, and
    // Ctrl+Home/End is how a screen-reader user leaves a widget. A fix that
    // only skipped the turn would still block Back.
    for (const modifier of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect(fireEvent.keyDown(root, { key: 'ArrowRight', ...modifier })).toBe(true);
      expect(fireEvent.keyDown(root, { key: 'ArrowLeft', ...modifier })).toBe(true);
    }
    expect(fireEvent.keyDown(root, { key: 'End', ctrlKey: true })).toBe(true);
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);

    // Control: the same key unmodified still turns, so this cannot pass by the
    // handler being broken outright.
    expect(fireEvent.keyDown(root, { key: 'ArrowRight' })).toBe(false);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });
  });

  test('a key press that started below the root belongs to whatever has focus', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });

    // Ownership is decided by `event.target !== event.currentTarget`, not by an
    // interactive-element selector: a selector under-matches every focusable
    // thing nobody thought to list, and then the book steals its arrow keys
    // and calls `preventDefault` on them.
    const descendant = bookRoot(container).querySelector('ol');
    expect(descendant).toBeTruthy();

    expect(fireEvent.keyDown(descendant!, { key: 'ArrowRight', bubbles: true })).toBe(true);
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
  });

  test('Home and End are bounded by the book, and announced as shortcuts', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    const root = bookRoot(container);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    expect(root.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight Home End');
    expect(root.getAttribute('tabindex')).toBe('0');

    root.focus();
    fireEvent.keyDown(root, { key: 'End' });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(3);
    });
    fireEvent.keyDown(root, { key: 'Home' });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    });
  });

  test('ArrowLeft goes back, and is bounded by the first page', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        images={STORY}
        ref={ref}
      />,
    );

    const root = bookRoot(container);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    root.focus();

    fireEvent.keyDown(root, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(1);
    });

    // Back, and the mirror follows — a handler wired to `flipNext` for both
    // arrows still passes an "it turned" assertion.
    expect(fireEvent.keyDown(root, { key: 'ArrowLeft' })).toBe(false);
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });

    // Refused at the boundary, not wrapped to the end of the book.
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
    });
  });

  test('direction="rtl" mirrors which arrow means forward', async () => {
    blockSize = PORTRAIT_BLOCK;
    // RTL inverts the TURN, never the page order: leaf 1 still follows leaf 0.
    // What changes is that the page the reader turns towards is on the left, so
    // ArrowLeft advances and ArrowRight goes back. A binding that forwarded the
    // key without consulting `direction` sends an Arabic or Hebrew reader
    // backwards through their own book every time they press "next".
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        direction="rtl"
        images={STORY}
        ref={ref}
      />,
    );

    const root = bookRoot(container);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });
    root.focus();

    // ArrowRight is BACK here, and page 0 is where back runs out.
    expect(fireEvent.keyDown(root, { key: 'ArrowRight' })).toBe(false);
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);

    // ArrowLeft advances.
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['The fox meets a crow']);
    });

    // …and ArrowRight now genuinely retreats, so the first assertion cannot
    // have passed by ArrowRight being inert.
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(mirrorText(container)).toEqual(['A red fox on a hill']);
    });
  });

  test('useKeyboard={false} removes the shortcuts and the tab stop, not the focus target', async () => {
    blockSize = PORTRAIT_BLOCK;
    const ref = createRef<FlipBookHandle>();
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        usePortrait
        useKeyboard={false}
        images={STORY}
        ref={ref}
      />,
    );

    const root = bookRoot(container);
    await waitFor(() => {
      expect(ref.current?.pageFlip()?.getPageCount()).toBe(4);
    });

    expect(root.getAttribute('aria-keyshortcuts')).toBeNull();
    // `-1`, not absent: the root stays a valid programmatic focus target while
    // staying out of the tab order.
    expect(root.getAttribute('tabindex')).toBe('-1');

    root.focus();
    expect(fireEvent.keyDown(root, { key: 'ArrowRight' })).toBe(true);
    expect(ref.current?.pageFlip()?.getCurrentPageIndex()).toBe(0);
  });
});

describe('the book root names itself as a book', () => {
  stubCanvas2D();

  test('group + roledescription + name, and never role="application"', async () => {
    const { container } = render(
      <ImageFlipBook
        width={200}
        height={300}
        flippingTime={0}
        images={STORY}
        aria-label="The fox and the crow"
        roleDescription="livre"
      />,
    );

    const root = await waitFor(() => bookRoot(container));
    expect(root.getAttribute('role')).toBe('group');
    // `application` strips the virtual cursor from NVDA and JAWS for the whole
    // subtree. In canvas mode the mirror is all there is, so that would leave a
    // screen-reader user with nothing readable at all.
    expect(root.getAttribute('role')).not.toBe('application');
    // Localisable: AT substitutes this for the role, so a hardcoded English
    // string is worse than none for a book in another language.
    expect(root.getAttribute('aria-roledescription')).toBe('livre');
    expect(within(container).getByRole('group', { name: 'The fox and the crow' })).toBe(root);
  });
});
