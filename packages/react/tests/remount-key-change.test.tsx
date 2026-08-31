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
