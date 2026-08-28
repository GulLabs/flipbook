'use client';

import { useCallback, useRef, useState } from 'react';
import type { FlipCorner, FlipbookEventMap, WidgetEvent } from '@gullabs/flipbook-core';
import type { FlipBookHandle, IEventProps } from './types';

/**
 * State + actions for a flipbook. Pass `ref` to `<HTMLFlipBook ref={ref} />`
 * and spread `bookProps` so `page` / `pageCount` stay in sync (FE-004).
 */
export function usePageFlip(initialPage = 0) {
  const ref = useRef<FlipBookHandle | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageCount, setPageCount] = useState(0);

  const flipNext = useCallback((corner?: FlipCorner) => {
    return ref.current?.flipNext(corner) ?? false;
  }, []);

  const flipPrev = useCallback((corner?: FlipCorner) => {
    return ref.current?.flipPrev(corner) ?? false;
  }, []);

  const turnToPage = useCallback((next: number) => {
    ref.current?.turnToPage(next);
  }, []);

  const flipToPage = useCallback((next: number) => {
    ref.current?.flipToPage(next);
  }, []);

  const onPageChange = useCallback((next: number) => {
    setPage(next);
  }, []);

  const onCollectionRebuild = useCallback(
    (e: WidgetEvent<FlipbookEventMap['collectionRebuild']>) => {
      setPageCount(e.data.pageCount);
      setPage(e.data.page);
    },
    [],
  );

  /** Spread onto `<HTMLFlipBook {...bookProps} />` so pageCount stays live. */
  const bookProps: Pick<IEventProps, 'onPageChange' | 'onCollectionRebuild'> = {
    onPageChange,
    onCollectionRebuild,
  };

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
    bookProps,
  };
}
