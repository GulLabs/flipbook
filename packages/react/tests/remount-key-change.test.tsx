/**
 * A runtime change to a remount-key prop (`hardCovers`, `initialPage`,
 * `injectStyles`) rebuilds the engine — and must not crash React.
 *
 * Measured pre-fix: any such change threw
 * `NotFoundError: The node to be removed is not a child of this node` out of
 * the portal re-target. Two halves, both required:
 *  - the mount cleanup returns the released leaves to the OLD block, so
 *    React's recorded parent is true when it moves them;
 *  - the pages effect refuses to hand nodes to an engine whose block is not
 *    the committed portal target (the remount pass runs it once with the old
 *    `pageHost` closure and the new engine).
 */
// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { HTMLFlipBook } from '@gullabs/react-flipbook';
import type { FlipBookHandle } from '@gullabs/react-flipbook';

afterEach(cleanup);

const pages = ['a', 'b', 'c', 'd'].map((id) => (
  <div key={id} style={{ width: '100%', height: '100%' }}>
    {id}
  </div>
));

test('toggling hardCovers mid-life rebuilds the engine without NotFoundError', () => {
  const ref = createRef<FlipBookHandle>();
  const view = render(
    <HTMLFlipBook width={200} height={300} flippingTime={0} ref={ref}>
      {pages}
    </HTMLFlipBook>,
  );
  const before = ref.current?.pageFlip();
  expect(before?.getPageCount()).toBe(4);
  expect(before?.getSettings().hardCovers).toBe(false);

  view.rerender(
    <HTMLFlipBook width={200} height={300} flippingTime={0} hardCovers ref={ref}>
      {pages}
    </HTMLFlipBook>,
  );

  const after = ref.current?.pageFlip();
  expect(after).not.toBe(before);
  expect(after?.getSettings().hardCovers).toBe(true);
  expect(after?.getPageCount()).toBe(4);
  // The rebuilt book still turns — the leaves survived two portal moves.
  expect(ref.current?.flipNext()).toBe(true);
});

test('remounting right after a turn warns about the URL-sync footgun (dev only)', () => {
  // Puddlebend Issue 2: initialPage fed from searchParams + onPageChange
  // writing the URL remounts the engine on every turn. The library cannot fix
  // the consumer's data flow, but it can name it the moment it happens.
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (msg: unknown) => warned.push(String(msg));

  try {
    const ref = createRef<FlipBookHandle>();
    const view = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} initialPage={0} ref={ref}>
        {pages}
      </HTMLFlipBook>,
    );

    expect(ref.current?.pageFlip()?.flipNext()).toBe(true);

    // The turn "wrote the URL", the URL handed back a new initialPage.
    view.rerender(
      <HTMLFlipBook width={200} height={300} flippingTime={0} initialPage={1} ref={ref}>
        {pages}
      </HTMLFlipBook>,
    );

    expect(warned.join(' ')).toMatch(/remounted within 1s of a page turn/);
    expect(warned.join(' ')).toMatch(/initialPage/);
  } finally {
    console.warn = original;
  }
});

test('an ordinary remount long after any turn stays silent', () => {
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (msg: unknown) => warned.push(String(msg));

  try {
    const ref = createRef<FlipBookHandle>();
    const view = render(
      <HTMLFlipBook width={200} height={300} flippingTime={0} ref={ref}>
        {pages}
      </HTMLFlipBook>,
    );

    // No turn at all — a layout-driven remount (key change, hardCovers) is
    // legitimate and must not nag.
    view.rerender(
      <HTMLFlipBook width={200} height={300} flippingTime={0} hardCovers ref={ref}>
        {pages}
      </HTMLFlipBook>,
    );

    expect(warned.join(' ')).not.toMatch(/remounted within 1s/);
  } finally {
    console.warn = original;
  }
});
