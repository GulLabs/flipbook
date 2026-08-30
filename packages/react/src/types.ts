import type { CSSProperties, ReactNode, Ref } from 'react';
import type {
  BlankPageSource,
  CanvasLeaf,
  FlipCorner,
  FlipSetting,
  FlipbookEventMap,
  ImageFit,
  ImagePageSource,
  PageFlip,
  WidgetEvent,
} from '@gullabs/flipbook-core';

export type { WidgetEvent, FlipbookEventMap };

export type IFlipSetting = FlipSetting;

export type PageState = 'user_fold' | 'fold_corner' | 'flipping' | 'read';
export type PageOrientation = 'portrait' | 'landscape';

/**
 * What is actually on screen when the live region speaks.
 *
 * `pages` holds the leaf indices of the current spread — one in portrait, up to
 * two in landscape — because "the current page" is not a single number for a
 * book showing two leaves at once.
 */
export type LiveRegionInfo = {
  /** Leaf indices of the current spread, in reading order. */
  pages: number[];
  orientation: PageOrientation;
  /** Whether leaf 0 is a cover rather than a numbered page. */
  showCover: boolean;
};

/**
 * `page` and `pageCount` come first so a consumer's existing two-argument
 * function keeps type-checking and keeps working.
 */
export type LiveRegionTextFn = (page: number, pageCount: number, info: LiveRegionInfo) => string;

export type IBookState = {
  page: number;
  mode: PageOrientation;
};

export type IEventProps = {
  onFlip?: (flipEvent: WidgetEvent<FlipbookEventMap['flip']>) => void;
  onChangeOrientation?: (flipEvent: WidgetEvent<FlipbookEventMap['changeOrientation']>) => void;
  onChangeState?: (flipEvent: WidgetEvent<FlipbookEventMap['changeState']>) => void;
  onInit?: (flipEvent: WidgetEvent<FlipbookEventMap['init']>) => void;
  onUpdate?: (flipEvent: WidgetEvent<FlipbookEventMap['update']>) => void;
  onPageChange?: (page: number) => void;
  onCollectionRebuild?: (flipEvent: WidgetEvent<FlipbookEventMap['collectionRebuild']>) => void;
  onTurnRejected?: (flipEvent: WidgetEvent<FlipbookEventMap['turnRejected']>) => void;
  onNavigationError?: (info: { code: string; requested: number; actual: number }) => void;
};

export type FlipBookHandle = {
  pageFlip: () => PageFlip | null;
  flipNext: (corner?: FlipCorner) => boolean;
  flipPrev: (corner?: FlipCorner) => boolean;
  turnToPage: (page: number) => void;
  flipToPage: (page: number) => void;
};

export type HTMLFlipBookProps = {
  /** Required page width in CSS pixels. */
  width: number;
  /** Required page height in CSS pixels. */
  height: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  renderOnlyPageLengthChange?: boolean;
  /** Controlled page index. */
  page?: number;
  /** Keyboard turning (Arrow/Home/End). Default true. */
  useKeyboard?: boolean;
  /** Mount only leaves within this many pages of the current index. */
  lazyRadius?: number;
  /** Accessible name for the book. */
  'aria-label'?: string;
  /**
   * `aria-roledescription` for the book. Localisable: VoiceOver and NVDA
   * substitute it for the role, so a hardcoded English string is worse than
   * none for a book in another language.
   */
  roleDescription?: string;
  /** When false, no live region is rendered. Default true. */
  liveRegion?: boolean;
  liveRegionText?: LiveRegionTextFn;
  ref?: Ref<FlipBookHandle | null>;
} & Partial<Omit<FlipSetting, 'width' | 'height'>> &
  IEventProps;

// ---------------------------------------------------------------------------
// Canvas / images mode — ADR 0001
//
// The leaf descriptor is core's (`packages/core/src/canvasLeaf.ts`) and is
// re-exported rather than restated: a second copy of a structural type is a
// second thing to keep in step, and the two would agree only until one of them
// changed. There is exactly one `alt` contract and core owns it.
// ---------------------------------------------------------------------------

export type { CanvasLeaf, ImagePageSource, BlankPageSource, ImageFit };

/**
 * Props of `ImageFlipBook`.
 *
 * The engine settings half is `Partial<Omit<FlipSetting, …>>` and nothing else
 * — no locally declared canvas settings. A prop that names a setting the engine
 * does not have is a type that lies: it compiles, it is forwarded, and it is
 * silently ignored at runtime. When core's `FlipSetting` grows `imageFit`,
 * `imageInset`, `imageLoadRadius`, `imageKeepRadius`, they appear here and are
 * forwarded automatically, because `pickSettings` denies React-only keys rather
 * than allowing an enumerated list of engine keys.
 *
 * `onImageError` is deliberately absent for the same reason: `imageError` is a
 * Phase 3 event and core's `FlipbookEventMap` does not carry it. Adding a prop
 * later is a widening (ADR 0001); shipping one that never fires is not.
 */
export type ImageFlipBookProps = {
  width: number;
  height: number;
  /** Leaves of the book. No `children` — canvas mode has no page DOM. */
  images: readonly CanvasLeaf[];
  className?: string;
  style?: CSSProperties;
  /** Controlled page index. */
  page?: number;
  useKeyboard?: boolean;
  'aria-label'?: string;
  roleDescription?: string;
  liveRegion?: boolean;
  liveRegionText?: LiveRegionTextFn;
  ref?: Ref<FlipBookHandle | null>;
} & Partial<Omit<FlipSetting, 'width' | 'height'>> &
  IEventProps;
