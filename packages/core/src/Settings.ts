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
 * Every boolean setting, listed once so the validator cannot drift from the
 * type. Adding a boolean to `FlipSetting` without adding it here leaves it
 * unvalidated — which is exactly how all ten of these went unchecked until S6.
 *
 * `satisfies` is doing real work: it makes the list a compile error if a name
 * here is not a key of `FlipSetting`, while keeping the tuple's literal types
 * so the loop below indexes precisely.
 */
const BOOLEAN_SETTINGS = [
  'drawShadow',
  'usePortrait',
  'autoSize',
  'showCover',
  'mobileScrollSupport',
  'clickEventForward',
  'useMouseEvents',
  'showPageCorners',
  'disableFlipByClick',
  'respectReducedMotion',
] as const satisfies readonly (keyof FlipSetting)[];

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
      throw new PageFlipError('Invalid width or height', 'INVALID_DIMENSIONS');
    }

    // `0` is the documented "unset" value for the stretch bounds below, so the
    // constraint is non-negative-and-finite rather than positive.
    if (
      !isNonNegative(result.minWidth) ||
      !isNonNegative(result.maxWidth) ||
      !isNonNegative(result.minHeight) ||
      !isNonNegative(result.maxHeight)
    ) {
      throw new PageFlipError('Invalid min/max width or height', 'INVALID_BOUNDS');
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
    // is valid CSS and is left alone. `NaN`/`Infinity` produce a declaration
    // the browser drops, silently losing the whole z-order — and so does a
    // FRACTION: `z-index` takes an integer, so `z-index:5.5` is discarded just
    // as quietly. Finiteness alone was not enough.
    if (!Number.isInteger(result.startZIndex)) {
      throw new PageFlipError('Invalid start z-index (must be an integer)', 'INVALID_Z_INDEX');
    }

    // NOT validated here, deliberately. Codex flagged that a fractional or NaN
    // `startPage` reaches `PageCollection.show()`, which silently declines it —
    // but the load path ALREADY reports that as `INVALID_PAGE`, and the React
    // binding surfaces it through `onNavigationError` with the requested and
    // actual page. A test pins that behaviour, and it is better than throwing:
    // the book still renders, and the consumer is told precisely what happened.
    // Throwing from the constructor would replace a good diagnostic with a
    // dead component.

    // Feeds `opacity` on the shadow elements and the alpha of the canvas
    // gradients. A non-finite value produces a declaration the browser drops,
    // which reads as a shadow at FULL opacity rather than as an error.
    // The declared range is [0, 1] — 1 is documented as maximum intensity — and
    // the value flows straight into a computed alpha. Rejecting only negatives
    // let `2` through to produce alphas above 1, which browsers clamp silently,
    // so the setting appeared to do nothing past 1 rather than to be wrong.
    if (
      !Number.isFinite(result.maxShadowOpacity) ||
      result.maxShadowOpacity < 0 ||
      result.maxShadowOpacity > 1
    ) {
      throw new PageFlipError('Invalid max shadow opacity (0..1)', 'INVALID_SHADOW_OPACITY');
    }

    // S6. Every boolean setting, validated as a BOOLEAN and nothing else.
    //
    // Not validated at all before this, and the failure was silent and
    // backwards: `drawShadow: 'false'` survived verbatim, and `'false'` is a
    // truthy string, so shadows stayed ON for someone who had just written
    // "false". The author gets the opposite of what they asked for and no
    // signal at all.
    //
    // That is not a hypothetical typo. Every ordinary source of configuration
    // hands over strings — `data-*` attributes, URL query parameters,
    // `JSON.parse` of a settings file or CMS response — and `data-draw-shadow="false"`
    // is exactly what a person writes.
    //
    // TypeScript does not help here and cannot: `FlipSetting.drawShadow` has
    // been typed `boolean` the whole time, but types are erased at runtime, so
    // they protect the developer writing a literal and nobody else. The type
    // and this check cover two different paths and both are needed.
    //
    // THROWING, not coercing or warning, and deliberately unlike the `alt`
    // decision elsewhere in this engine: there the engine could still proceed
    // truthfully without the value, so a warning was right. Here it cannot —
    // `'false'` means the opposite of the intent, and silently doing the
    // opposite is worse than a loud failure.
    //
    // `0` and `1` throw too. They were accepted since 2.x, which makes this a
    // break, and the owner took it deliberately (2026-08-30): a boolean is a
    // datatype a schema can validate, and accepting two spellings of it invites
    // the third and fourth.
    for (const key of BOOLEAN_SETTINGS) {
      if (typeof result[key] !== 'boolean') {
        throw new PageFlipError(
          `Invalid ${key}: expected true or false, got ${typeof result[key]}`,
          'INVALID_BOOLEAN',
        );
      }
    }

    const direction = result.direction as string;
    if (direction !== 'ltr' && direction !== 'rtl') {
      throw new PageFlipError('Invalid direction (ltr|rtl)', 'INVALID_DIRECTION');
    }

    // `safePageBackground` reads `.trim()` off whatever it is handed, so a
    // JS caller passing a non-string (`0`, `{}`, an array) got a bare
    // `TypeError: pageBackground.trim is not a function` out of the PageFlip
    // constructor — the one input in this whole function that did not produce
    // a `PageFlipError`. `null` already meant "not supplied" and fell through
    // to the opaque default; a value of the wrong type is no more usable than
    // `null`, so it takes the same route. This is the sanitising job only —
    // the opacity check still runs inside `safePageBackground`, on the
    // caller's own value.
    const suppliedBackground: unknown = result.pageBackground;
    result.pageBackground = safePageBackground(
      typeof suppliedBackground === 'string' ? suppliedBackground : undefined,
    );

    if (result.size === SizeType.STRETCH) {
      if (result.minWidth <= 0) result.minWidth = 100;
      // `Math.max`, not a bare 2000: the fallback exists to fill in an absent
      // upper bound, and a flat 2000 put it BELOW a `minWidth` the caller
      // declared above it. `Render.computeBounds` reads both — it goes
      // portrait under `minWidth * 2` (Render.ts:506) and then clamps
      // `pageWidth` to `maxWidth` (Render.ts:511) — so `minWidth: 3000` gave a
      // book that was "too narrow" below 6000px and simultaneously capped at
      // 2000px, i.e. never able to reach its own declared minimum, silently.
      if (result.maxWidth < result.minWidth) result.maxWidth = Math.max(2000, result.minWidth);
      if (result.minHeight <= 0) result.minHeight = 100;
      if (result.maxHeight < result.minHeight) result.maxHeight = Math.max(2000, result.minHeight);
    } else {
      result.minWidth = result.width;
      result.maxWidth = result.width;
      result.minHeight = result.height;
      result.maxHeight = result.height;
    }

    return result;
  }
}
