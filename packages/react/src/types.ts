import type { CSSProperties, ReactNode, Ref } from 'react';
import type {
  FlipCorner,
  FlipSetting,
  FlipbookEventMap,
  PageFlip,
  WidgetEvent,
} from '@gullabs/flipbook-core';

export type { WidgetEvent, FlipbookEventMap };

export type IFlipSetting = FlipSetting;

export type PageState = 'user_fold' | 'fold_corner' | 'flipping' | 'read';
export type PageOrientation = 'portrait' | 'landscape';

export type IBookState = {
  page: number;
  mode: PageOrientation;
};

export type IEventProps = {
  onFlip?: (flipEvent: WidgetEvent<FlipbookEventMap['flip']>) => void;
  onChangeOrientation?: (
    flipEvent: WidgetEvent<FlipbookEventMap['changeOrientation']>,
  ) => void;
  onChangeState?: (flipEvent: WidgetEvent<FlipbookEventMap['changeState']>) => void;
  onInit?: (flipEvent: WidgetEvent<FlipbookEventMap['init']>) => void;
  onUpdate?: (flipEvent: WidgetEvent<FlipbookEventMap['update']>) => void;
  onPageChange?: (page: number) => void;
  onCollectionRebuild?: (
    flipEvent: WidgetEvent<FlipbookEventMap['collectionRebuild']>,
  ) => void;
};

export type FlipBookHandle = {
  pageFlip: () => PageFlip | null;
  flipNext: (corner?: FlipCorner) => void;
  flipPrev: (corner?: FlipCorner) => void;
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
  /** Opt-in arrow / Home / End keyboard turning. */
  useKeyboard?: boolean;
  /** Mount only leaves within this many pages of the current index. */
  lazyRadius?: number;
  /** Accessible name for the book. */
  'aria-label'?: string;
  /** When false, no live region is rendered. Default true. */
  liveRegion?: boolean;
  liveRegionText?: (page: number, pageCount: number) => string;
  ref?: Ref<FlipBookHandle | null>;
} & Partial<Omit<FlipSetting, 'width' | 'height'>> &
  IEventProps;
