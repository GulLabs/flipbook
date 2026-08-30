'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { FlipCorner } from '@gullabs/flipbook-core';
import type {
  BookSnapshot,
  FlipBookHandle,
  IEventProps,
  PageOrientation,
  TurnRejected,
} from './types';

/**
 * State + actions for a flipbook. Pass `ref` to `<HTMLFlipBook ref={ref} />`
 * and spread `bookProps`.
 *
 * COMPLETED rather than deleted (Codex design signoff). After D13–D15 a
 * consumer's own `useState` plus `page`/`onPageChange` is most of this hook —
 * but `orientation` alone justifies it: a consumer cannot render correct
 * controls without knowing whether one leaf or two are on screen, and there is
 * no other way to learn that without binding an event by hand.
 *
 * ONE readonly snapshot, updated atomically. The previous shape exposed `page`,
 * `pageCount`, `setPage` and `setPageCount` as four independent pieces, so a
 * caller could set a page the count did not admit, and `setPageCount` wrote to
 * state that is DERIVED from the engine — a value the next event overwrote.
 * Both setters are gone.
 *
 * Before mount (and after unmount) there is no engine behind `ref`, so the
 * actions are no-ops returning `false`. That is the contract, not an oversight:
 * these get called from effects and handlers that can legitimately run early,
 * and throwing there would punish correct code.
 */
export interface FlipbookState {
  /** The spread HEAD — the first leaf on screen. */
  page: number;
  pageCount: number;
  orientation: PageOrientation;
  /** Whether a forward turn is possible from here. */
  canGoNext: boolean;
  canGoPrev: boolean;
  /** The most recent refusal, or `null`. Cleared by the next successful turn. */
  lastRejection: TurnRejected | null;
}

const INITIAL: FlipbookState = {
  page: 0,
  pageCount: 0,
  orientation: 'landscape',
  canGoNext: false,
  canGoPrev: false,
  lastRejection: null,
};

function withBounds(state: FlipbookState): FlipbookState {
  return {
    ...state,
    canGoPrev: state.page > 0,
    canGoNext: state.pageCount > 0 && state.page < state.pageCount - 1,
  };
}

export function usePageFlip(initialPage = 0) {
  const ref = useRef<FlipBookHandle | null>(null);
  const [state, setState] = useState<FlipbookState>(() =>
    withBounds({ ...INITIAL, page: initialPage }),
  );

  const apply = useCallback((snapshot: BookSnapshot) => {
    setState((previous) =>
      withBounds({
        ...previous,
        page: snapshot.page,
        pageCount: snapshot.pageCount,
        orientation: snapshot.orientation === 'portrait' ? 'portrait' : 'landscape',
        lastRejection: null,
      }),
    );
  }, []);

  const flipNext = useCallback((corner?: FlipCorner) => ref.current?.flipNext(corner) ?? false, []);
  const flipPrev = useCallback((corner?: FlipCorner) => ref.current?.flipPrev(corner) ?? false, []);
  const turnToPage = useCallback((next: number) => ref.current?.turnToPage(next) ?? false, []);
  const flipToPage = useCallback((next: number) => ref.current?.flipToPage(next) ?? false, []);

  /**
   * Ask the ENGINE where the book landed; fall back to the payload only when
   * there is no engine to ask (no `ref` spread onto the component, or the event
   * replayed after unmount).
   *
   * `snapshot.page` is a *report* of the engine's index, derived one layer up;
   * `getCurrentPageIndex()` is the index itself. Both are correct today, but
   * this hook can feed a CONTROLLED `page`, so a wrong value here is not a
   * stale label — it re-issues a turn on a leaf that may not exist. Deriving
   * stays right if the emitting layer regresses (which it had:
   * `updateFromHtml` reported the pre-rebuild index), while trusting the
   * payload is right only for as long as every emitter is.
   */
  const onPagesChanged = useCallback(
    (snapshot: BookSnapshot) => {
      const engine = ref.current?.pageFlip() ?? null;
      // A destroyed engine has released its collection, and
      // `getCurrentPageIndex()` would throw `NOT_LOADED` rather than answer.
      const live =
        engine !== null && !engine.isDestroyed() ? engine.getCurrentPageIndex() : snapshot.page;

      apply({ ...snapshot, page: live });
    },
    [apply],
  );

  const onTurnRejected = useCallback((info: TurnRejected) => {
    setState((previous) => ({ ...previous, lastRejection: info }));
  }, []);

  /** Spread onto `<HTMLFlipBook {...bookProps} />`. */
  const bookProps: Pick<
    IEventProps,
    'onPageChange' | 'onPagesChanged' | 'onChangeOrientation' | 'onLoaded' | 'onTurnRejected'
  > = useMemo(
    () => ({
      onPageChange: apply,
      onPagesChanged,
      onLoaded: apply,
      onChangeOrientation: ({ orientation }) =>
        setState((previous) => ({
          ...previous,
          orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
        })),
      // Previously omitted, so `usePageFlip(999)` clamped with no signal at all.
      onTurnRejected,
    }),
    [apply, onPagesChanged, onTurnRejected],
  );

  return {
    ref,
    ...state,
    flipNext,
    flipPrev,
    turnToPage,
    flipToPage,
    bookProps,
  };
}
