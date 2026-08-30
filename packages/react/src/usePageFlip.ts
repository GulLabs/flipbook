'use client';

import { useCallback, useRef, useState } from 'react';
import type { FlipCorner, FlipbookEventMap, WidgetEvent } from '@gullabs/flipbook-core';
import type { FlipBookHandle, IEventProps } from './types';

/**
 * State + actions for a flipbook. Pass `ref` to `<HTMLFlipBook ref={ref} />`
 * and spread `bookProps` so `page` / `pageCount` stay in sync (FE-004).
 *
 * Before mount (and after unmount) there is no engine behind `ref`, so the
 * actions are no-ops and `flipNext` / `flipPrev` return `false`. That is the
 * contract, not an oversight: these get called from effects and event handlers
 * that can legitimately run early, and throwing there would punish correct
 * code. The engine's own `turnToPage` / `flip` do throw `NOT_LOADED`.
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

  /**
   * Ask the ENGINE where the book landed; fall back to the payload only when
   * there is no engine to ask (no `ref` spread onto the component, or the
   * event replayed after unmount).
   *
   * `e.data.page` is a *report* of the engine's index, derived one layer up;
   * `getCurrentPageIndex()` is the index itself. Both are correct today, but
   * this hook feeds a CONTROLLED `page`, so a wrong value here is not a stale
   * label — it re-issues `turnToPage` on a leaf that may not exist, clamps, and
   * surfaces as `onNavigationError`. Deriving stays right if the emitting layer
   * regresses (which it had: `updateFromHtml` reported the pre-rebuild index),
   * while trusting the payload is right only for as long as every emitter is.
   * Prefer the value that survives the other layer being wrong.
   */
  const onCollectionRebuild = useCallback(
    (e: WidgetEvent<FlipbookEventMap['collectionRebuild']>) => {
      setPageCount(e.data.pageCount);

      const engine = ref.current?.pageFlip() ?? null;
      // A destroyed engine has already released its collection, and
      // `getCurrentPageIndex()` would throw `NOT_LOADED` rather than answer.
      setPage(
        engine !== null && !engine.isDestroyed() ? engine.getCurrentPageIndex() : e.data.page,
      );
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
