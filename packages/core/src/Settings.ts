import { DEFAULT_PAGE_BACKGROUND, safePageBackground } from './Render/pageBackground';
import { PageFlipError } from './errors';

/**
 * Book size calculation type
 */
export type SizeType = 'fixed' | 'stretch';

export const SizeType = {
  FIXED: 'fixed' as const,
  STRETCH: 'stretch' as const,
};

export type FlipDirectionSetting = 'ltr' | 'rtl';

/**
 * Configuration object
 */
export interface FlipSetting {
  /** Page number from which to start viewing */
  startPage: number;
  /** Whether the book will be stretched under the parent element or not */
  size: SizeType;

  width: number;
  height: number;

  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;

  /** Draw shadows or not when page flipping */
  drawShadow: boolean;
  /**
   * Flipping animation time in ms. `0` is instant (no throw).
   * Combined with `respectReducedMotion`.
   */
  flippingTime: number;

  /** Enable switching to portrait mode */
  usePortrait: boolean;
  /** Initial value to z-index */
  startZIndex: number;
  /** If this value is true, the parent element will be equal to the size of the book */
  autoSize: boolean;
  /** Shadow intensity (1: max intensity, 0: hidden shadows) */
  maxShadowOpacity: number;

  /** If this value is true, the first and the last pages will be marked as hard and will be shown in single page mode */
  showCover: boolean;
  /** Disable content scrolling when touching a book on mobile devices */
  mobileScrollSupport: boolean;

  /** Set the forward event of clicking on child elements (buttons, links) */
  clickEventForward: boolean;

  /** Using pointer events to page flipping */
  useMouseEvents: boolean;

  swipeDistance: number;

  /** if this value is true, fold the corners of the book when the mouse pointer is over them. */
  showPageCorners: boolean;

  /** if this value is true, flipping by clicking on the whole book will be locked. Only on corners */
  disableFlipByClick: boolean;

  /**
   * Opaque fill for the turning leaf / temporary copy so content cannot bleed
   * through the fold. Default `#fff`.
   */
  pageBackground: string;

  /**
   * When true (default), `prefers-reduced-motion: reduce` makes turns instant.
   */
  respectReducedMotion: boolean;

  /**
   * Reading direction. `rtl` mirrors the *turn direction* for user input —
   * click, corner fold, drag and swipe all treat the left edge as "next" — while
   * pointer coordinates stay unmirrored so the fold follows the finger.
   * Programmatic `flipNext`/`flipPrev` still advance by page index.
   */
  direction: FlipDirectionSetting;
}

export class Settings {
  private readonly _default: FlipSetting = {
    startPage: 0,
    size: SizeType.FIXED,
    width: 0,
    height: 0,
    minWidth: 0,
    maxWidth: 0,
    minHeight: 0,
    maxHeight: 0,
    drawShadow: true,
    flippingTime: 1000,
    usePortrait: true,
    startZIndex: 0,
    autoSize: true,
    maxShadowOpacity: 1,
    showCover: false,
    mobileScrollSupport: true,
    swipeDistance: 30,
    clickEventForward: true,
    useMouseEvents: true,
    showPageCorners: true,
    disableFlipByClick: false,
    pageBackground: DEFAULT_PAGE_BACKGROUND,
    respectReducedMotion: true,
    direction: 'ltr',
  };

  /**
   * Processing parameters received from the user. Substitution default values
   */
  public getSettings(userSetting: Partial<FlipSetting>): FlipSetting {
    const result: FlipSetting = { ...this._default, ...userSetting };

    const size = result.size as string;
    if (size !== SizeType.STRETCH && size !== SizeType.FIXED) {
      throw new PageFlipError(
        'Invalid size type. Available only "fixed" and "stretch" value',
        'INVALID_SIZE',
      );
    }

    if (result.width <= 0 || result.height <= 0) {
      throw new PageFlipError('Invalid width or height', 'INVALID_SIZE');
    }

    if (result.flippingTime < 0) {
      throw new PageFlipError('Invalid flipping time', 'INVALID_FLIPPING_TIME');
    }

    const direction = result.direction as string;
    if (direction !== 'ltr' && direction !== 'rtl') {
      throw new PageFlipError(
        'Invalid direction. Available only "ltr" and "rtl"',
        'INVALID_DIRECTION',
      );
    }

    result.pageBackground = safePageBackground(result.pageBackground);

    if (result.size === SizeType.STRETCH) {
      if (result.minWidth <= 0) result.minWidth = 100;
      if (result.maxWidth < result.minWidth) result.maxWidth = 2000;
      if (result.minHeight <= 0) result.minHeight = 100;
      if (result.maxHeight < result.minHeight) result.maxHeight = 2000;
    } else {
      result.minWidth = result.width;
      result.maxWidth = result.width;
      result.minHeight = result.height;
      result.maxHeight = result.height;
    }

    return result;
  }
}
