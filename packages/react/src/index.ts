export { HTMLFlipBook } from './HTMLFlipBook';
export { usePageFlip } from './usePageFlip';

export type {
  HTMLFlipBookProps,
  FlipBookHandle,
  IEventProps,
  PageState,
  PageOrientation,
  LiveRegionInfo,
  LiveRegionTextFn,
  WidgetEvent,
  FlipbookEventMap,
  BookSnapshot,
  TurnRejected,
  PageTransition,
} from './types';

export { HTMLFlipBook as default } from './HTMLFlipBook';

/**
 * The core symbols a React consumer needs, re-exported.
 *
 * Measured by a consumer advocate against the published `.d.ts`: thirteen
 * `TS2614`/`TS2724` errors, including `FlipbookState` — the return type of this
 * package's own hook. To pass a `corner` to `flipNext` a React consumer had to
 * add `@gullabs/flipbook-core` to their own `package.json`, for a type they
 * only ever touch through this binding.
 *
 * The React package is a complete product, not a partial view of the core one.
 */
export {
  PageFlip,
  PageFlipError,
  FlipCorner,
  FlippingState,
  SizeMode,
  ALL_POINTERS,
} from '@gullabs/flipbook-core';

export type {
  FlipOptions,
  FlipSetting,
  LiveSetting,
  ReadingDirection,
  FlipOnClick,
  PointerKind,
  PageFlipErrorCode,
  PageFlipErrorKind,
  TurnRejectedReason,
  FlipbookEventName,
  Orientation,
  Point,
  Rect,
  PageRect,
} from '@gullabs/flipbook-core';

export type { FlipbookState } from './usePageFlip';
