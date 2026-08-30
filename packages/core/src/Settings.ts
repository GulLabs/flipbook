/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

/**
 * `x > 0` is *false* for `NaN`, so a comparison alone never rejects one; the
 * NaN then flows into the bounds rect and out as `min-width: NaNpx`.
 */
const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/**
 * `Partial<FlipSetting>` permits an *explicit* `undefined`, and a spread copies
 * that key over the default instead of falling through to it. Dropping the
 * undefined-valued keys first makes `{ width: undefined }` mean "not supplied".
 */
function definedOnly(setting: Partial<FlipSetting>): Partial<FlipSetting> {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(setting)) {
    const value = (setting as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }

  return out;
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
    const result: FlipSetting = { ...this._default, ...definedOnly(userSetting) };

    const size = result.size as string;
    if (size !== SizeType.STRETCH && size !== SizeType.FIXED) {
      throw new PageFlipError('Invalid size (fixed|stretch)', 'INVALID_SIZE');
    }

    if (!isPositive(result.width) || !isPositive(result.height)) {
      throw new PageFlipError('Invalid width or height', 'INVALID_SIZE');
    }

    // `0` is the documented "unset" value for the stretch bounds below, so the
    // constraint is non-negative-and-finite rather than positive.
    if (
      !isNonNegative(result.minWidth) ||
      !isNonNegative(result.maxWidth) ||
      !isNonNegative(result.minHeight) ||
      !isNonNegative(result.maxHeight)
    ) {
      throw new PageFlipError('Invalid min/max width or height', 'INVALID_SIZE');
    }

    // `0` is documented as instant, so only negatives and non-numbers are bad.
    if (!isNonNegative(result.flippingTime)) {
      throw new PageFlipError('Invalid flipping time', 'INVALID_FLIPPING_TIME');
    }

    // A negative threshold can never be met (`distY < -swipeDistance` is never
    // true for a real gesture), so it silently disables swiping. `0` is a
    // legitimate "no threshold".
    if (!isNonNegative(result.swipeDistance)) {
      throw new PageFlipError('Invalid swipe distance', 'INVALID_SWIPE_DISTANCE');
    }

    // Interpolated straight into `z-index:${startZIndex + n}`. A negative base
    // is valid CSS and is left alone; `NaN`/`Infinity` produce a declaration
    // the browser drops, silently losing the whole z-order.
    if (!Number.isFinite(result.startZIndex)) {
      throw new PageFlipError('Invalid start z-index', 'INVALID_Z_INDEX');
    }

    const direction = result.direction as string;
    if (direction !== 'ltr' && direction !== 'rtl') {
      throw new PageFlipError('Invalid direction (ltr|rtl)', 'INVALID_DIRECTION');
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
