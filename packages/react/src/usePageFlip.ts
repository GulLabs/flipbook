'use client';

import { useCallback, useRef, useState } from 'react';
import type { FlipCorner } from '@gullabs/flipbook-core';
import type { FlipBookHandle } from './types';

/**
 * State + actions for a flipbook. Pass `ref` to `<HTMLFlipBook ref={ref} />`.
 */
export function usePageFlip(initialPage = 0) {
  const ref = useRef<FlipBookHandle | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageCount, setPageCount] = useState(0);

  const flipNext = useCallback((corner?: FlipCorner) => {
    ref.current?.flipNext(corner);
  }, []);

  const flipPrev = useCallback((corner?: FlipCorner) => {
    ref.current?.flipPrev(corner);
  }, []);

  const turnToPage = useCallback((next: number) => {
    ref.current?.turnToPage(next);
  }, []);

  const flipToPage = useCallback((next: number) => {
    ref.current?.flipToPage(next);
  }, []);

  return {
    ref,
    page,
    setPage,
    pageCount,
    setPageCount,
    flipNext,
    flipPrev,
    turnToPage,
    flipToPage,
  };
}
