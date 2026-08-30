/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { DEFAULT_PAGE_BACKGROUND, isOpaquePageBackground } from './Render/pageBackground';
import { PageFlipError } from './errors';

/**
 * How the book decides its own size.
 *
 * `'stretch'` was the old name for `'responsive'` and it stated something
 * false: the book does not stretch, it fits the host while preserving the
 * declared aspect ratio. Someone reading `stretch` expects distortion.
 */
export type SizeMode = 'fixed' | 'responsive';

export const SizeMode = {
  FIXED: 'fixed' as const,
  RESPONSIVE: 'responsive' as const,
};

/**
 * Which way the book reads and binds.
 *
 * Named `readingDirection`, not `direction`, because `FlipDirection`
 * (`FORWARD` / `BACK`) is a different axis and the two autocompleted together.
 * The bare word "direction" now never appears unqualified in the public API.
 */
export type ReadingDirection = 'ltr' | 'rtl';

/**
 * What a click on the book does.
 *
 * Replaces `disableFlipByClick`, which was false as written: with it `true`,
 * clicking a CORNER still flipped. Three states, one of which — "drag only" —
 * was previously unreachable.
 */
export type FlipOnClick = 'anywhere' | 'corners' | 'never';

/** Pointer hardware the book responds to. */
export type PointerKind = 'mouse' | 'touch' | 'pen';

export const ALL_POINTERS: readonly PointerKind[] = ['mouse', 'touch', 'pen'];

/**
 * What a CALLER writes. Every key optional except the two that are not.
 *
 * Kept separately from the resolved settings for the whole life of the engine,
 * and that is load-bearing rather than tidiness:
 *
 *  - `updateSettings` re-resolves from AUTHORED input, so "was this bound
 *    explicitly supplied?" stays answerable. Merging into the already-resolved
 *    object made every synthesised bound look authored, so a rule about
 *    explicit bounds would have failed an unrelated `updateSettings({ drawShadow })`.
 *  - `getSettings()` can round-trip. Previously `responsive → fixed →
 *    responsive` returned bounds pinned to width/height rather than the ones
 *    the caller declared, because the fixed pass overwrote them in place.
 */
export interface FlipOptions {
  /** Required. A book with no declared page size cannot lay out. */
  width: number;
  /** Required. */
  height: number;

  /** Page the book OPENS on. Opening is not turning: it emits no `flip`. */
  initialPage?: number;
  sizing?: SizeMode;

  /** Only meaningful under `sizing: 'responsive'`. */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;

  drawShadow?: boolean;
  /**
   * Upper bound on a turn's duration in ms — NOT the duration of an ordinary
   * turn, which is scaled by how far the leaf actually travels. A typical move
   * runs at roughly 40% of this. `0` is instant and is not an error.
   */
  flippingTime?: number;

  usePortrait?: boolean;
  startZIndex?: number;
  autoSize?: boolean;
  /** Shadow intensity, 0..1. */
  maxShadowOpacity?: number;

  /**
   * First and last leaves are hard and shown alone. This is the LAYOUT switch
   * for the whole book, not a visibility toggle — the old name `showCover`
   * read as one.
   */
  hardCovers?: boolean;

  /**
   * Let a touch or pen drag scroll the page instead of turning a leaf.
   * Formerly `mobileScrollSupport`, which named a device class it never tested:
   * the check is `pointerType !== 'mouse'`, so it covers pen and every touch
   * surface including a desktop touchscreen.
   */
  allowTouchScroll?: boolean;

  /**
   * Do not start a fold on buttons, links and form controls. Formerly
   * `clickEventForward`, which claimed to forward an event; nothing is
   * forwarded — the engine simply declines to fold.
   */
  respectInteractiveContent?: boolean;

  /**
   * Pointer hardware that can turn a page. Defaults to all three.
   *
   * Formerly the boolean `useMouseEvents`, which gated the ONE pointer path, so
   * `false` silently disabled touch and pen as well — a consumer wanting "no
   * mouse turning, keep swipe on tablets" shipped a book that could not be
   * turned on a phone. A list is the smallest thing that expresses that; `[]`
   * disables pointer turning entirely.
   */
  pointerInput?: readonly PointerKind[];

  swipeDistance?: number;

  /**
   * Peel a corner up when the pointer hovers it. Formerly `showPageCorners`,
   * which showed nothing — the corners are always visible; this enables the
   * hover peel.
   */
  foldCornerOnHover?: boolean;

  flipOnClick?: FlipOnClick;

  /**
   * Opaque fill behind every leaf, so content cannot bleed through a fold.
   *
   * NOT renamed to `foldBackground`: it paints the static leaves too, so that
   * name would describe half the contract.
   */
  pageBackground?: string;

  respectReducedMotion?: boolean;
  readingDirection?: ReadingDirection;
}

/**
 * Settings that are consumed while the book is BUILT and never read again, so
 * `updateSettings` cannot make them take effect. Rejected at compile time
 * rather than warned about at runtime.
 */
export type LiveSetting = Omit<FlipOptions, 'hardCovers' | 'initialPage'>;

/**
 * The resolved, fully-populated settings the engine reads. Every key present.
 *
 * `maxHeight` is gone: it was validated, defaulted, echoed back by
 * `getSettings()` and never read by anything.
 */
export interface FlipSetting {
  initialPage: number;
  sizing: SizeMode;
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  drawShadow: boolean;
  flippingTime: number;
  usePortrait: boolean;
  startZIndex: number;
  autoSize: boolean;
  maxShadowOpacity: number;
  hardCovers: boolean;
  allowTouchScroll: boolean;
  respectInteractiveContent: boolean;
  pointerInput: readonly PointerKind[];
  swipeDistance: number;
  foldCornerOnHover: boolean;
  flipOnClick: FlipOnClick;
  pageBackground: string;
  respectReducedMotion: boolean;
  readingDirection: ReadingDirection;
}

/**
 * `x > 0` is *false* for `NaN`, so a comparison alone never rejects one; the
 * NaN then flows into the bounds rect and out as `min-width: NaNpx`.
 */
const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/**
 * Every boolean setting, listed once so the validator cannot drift from the
 * type. `satisfies` makes a misspelled or removed key a compile error.
 */
const BOOLEAN_SETTINGS = [
  'drawShadow',
  'usePortrait',
  'autoSize',
  'hardCovers',
  'allowTouchScroll',
  'respectInteractiveContent',
  'foldCornerOnHover',
  'respectReducedMotion',
] as const satisfies readonly (keyof FlipSetting)[];

/** Bounds that only mean something under `sizing: 'responsive'`. */
const RESPONSIVE_ONLY_BOUNDS = ['minWidth', 'maxWidth', 'minHeight'] as const;

/**
 * `Partial<T>` permits an *explicit* `undefined`, and a spread copies that key
 * over the default instead of falling through to it. Dropping undefined-valued
 * keys makes `{ width: undefined }` mean "not supplied".
 */
function definedOnly<T extends object>(setting: T): Partial<T> {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(setting)) {
    const value = (setting as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }

  return out as Partial<T>;
}

/**
 * Say what arrived and what was expected, not merely which category failed.
 *
 * `'Invalid width or height'` does not say which one, what came in, or what to
 * do — and it is the first error a new consumer hits, typically because a prop
 * arrived as a string from a CMS or as `NaN` from a layout measurement. The
 * byte budget these were golfed for returned 19 bytes.
 */
function reject(key: keyof FlipSetting, received: unknown, expected: string): never {
  const shown =
    typeof received === 'string'
      ? JSON.stringify(received)
      : typeof received === 'number' || typeof received === 'boolean' || received === null
        ? String(received)
        : Array.isArray(received)
          ? `an array`
          : typeof received;

  throw new PageFlipError(`${key}: expected ${expected}, received ${shown}`, 'INVALID_SETTING', {
    setting: key,
  });
}

const DEFAULTS: Omit<FlipSetting, 'width' | 'height'> = {
  initialPage: 0,
  sizing: SizeMode.FIXED,
  minWidth: 0,
  maxWidth: 0,
  minHeight: 0,
  drawShadow: true,
  flippingTime: 1000,
  usePortrait: true,
  startZIndex: 0,
  autoSize: true,
  maxShadowOpacity: 1,
  hardCovers: false,
  allowTouchScroll: true,
  respectInteractiveContent: true,
  pointerInput: ALL_POINTERS,
  swipeDistance: 30,
  foldCornerOnHover: true,
  flipOnClick: 'anywhere',
  pageBackground: DEFAULT_PAGE_BACKGROUND,
  respectReducedMotion: true,
  readingDirection: 'ltr',
};

export class Settings {
  /**
   * Validate authored input and resolve it. Throws `PageFlipError` with
   * `code: 'INVALID_SETTING'` and a machine-readable `setting` key.
   */
  public resolve(authored: FlipOptions): FlipSetting {
    const supplied = definedOnly(authored);
    const result = { ...DEFAULTS, ...supplied } as FlipSetting;

    const sizing = result.sizing as string;
    if (sizing !== SizeMode.RESPONSIVE && sizing !== SizeMode.FIXED) {
      reject('sizing', result.sizing, `'fixed' or 'responsive'`);
    }

    if (!isPositive(result.width)) reject('width', result.width, 'a positive number of pixels');
    if (!isPositive(result.height)) reject('height', result.height, 'a positive number of pixels');

    // A fixed book derives all its bounds from width/height, so a bound
    // supplied alongside `sizing: 'fixed'` does nothing. It used to be
    // overwritten silently and then echoed back by `getSettings()` as though
    // the caller had written it — a config a reasonable person writes, that has
    // no effect and no signal.
    //
    // Answerable only because `supplied` is the AUTHORED object. Asking this of
    // the resolved settings would see the synthesised bounds as authored and
    // fail every later `updateSettings`.
    if (result.sizing === SizeMode.FIXED) {
      for (const bound of RESPONSIVE_ONLY_BOUNDS) {
        if (supplied[bound] !== undefined) {
          reject(
            bound,
            supplied[bound],
            `no value under sizing: 'fixed' (it derives from width/height)`,
          );
        }
      }
    }

    for (const bound of RESPONSIVE_ONLY_BOUNDS) {
      if (!isNonNegative(result[bound])) {
        reject(bound, result[bound], 'a non-negative number of pixels, or 0 for unset');
      }
    }

    if (!isNonNegative(result.flippingTime)) {
      reject('flippingTime', result.flippingTime, 'a non-negative number of ms (0 is instant)');
    }

    if (!isNonNegative(result.swipeDistance)) {
      reject('swipeDistance', result.swipeDistance, 'a non-negative number of pixels');
    }

    // Interpolated into `z-index:${startZIndex + n}`. `z-index` takes an
    // integer, so a fraction is discarded by the browser just as quietly as a
    // NaN — losing the whole z-order. Finiteness alone was not enough.
    if (!Number.isInteger(result.startZIndex)) {
      reject('startZIndex', result.startZIndex, 'an integer');
    }

    // The declared range is 0..1. Rejecting only negatives let `2` through to
    // produce alphas above 1, which browsers clamp — so the setting appeared to
    // do nothing past 1 rather than to be wrong.
    if (
      !Number.isFinite(result.maxShadowOpacity) ||
      result.maxShadowOpacity < 0 ||
      result.maxShadowOpacity > 1
    ) {
      reject('maxShadowOpacity', result.maxShadowOpacity, 'a number from 0 to 1');
    }

    // Not validated at all before this, and the failure was silent and
    // BACKWARDS: `drawShadow: 'false'` survived verbatim, and `'false'` is a
    // truthy string, so shadows stayed on for someone who had just written
    // "false". Every ordinary configuration source hands over strings —
    // `data-*` attributes, query parameters, `JSON.parse` of a CMS response.
    for (const key of BOOLEAN_SETTINGS) {
      if (typeof result[key] !== 'boolean') reject(key, result[key], 'true or false');
    }

    const reading = result.readingDirection as string;
    if (reading !== 'ltr' && reading !== 'rtl') {
      reject('readingDirection', result.readingDirection, `'ltr' or 'rtl'`);
    }

    const click = result.flipOnClick as string;
    if (click !== 'anywhere' && click !== 'corners' && click !== 'never') {
      reject('flipOnClick', result.flipOnClick, `'anywhere', 'corners' or 'never'`);
    }

    const pointers: unknown = result.pointerInput;
    if (!Array.isArray(pointers)) {
      reject('pointerInput', pointers, `an array of 'mouse' | 'touch' | 'pen'`);
    }
    for (const kind of pointers as readonly unknown[]) {
      if (typeof kind !== 'string' || !ALL_POINTERS.includes(kind as PointerKind)) {
        reject('pointerInput', kind, `only 'mouse', 'touch' or 'pen'`);
      }
    }

    if (!Number.isInteger(result.initialPage) || result.initialPage < 0) {
      reject('initialPage', result.initialPage, 'a non-negative integer');
    }

    // D3. THROW here, rather than substituting white and saying nothing.
    //
    // This was the one setting in the whole engine that failed silently, and
    // the accepted grammar is a narrow legacy subset — so an ordinary 2026
    // colour (`oklch(...)`, `color-mix(...)`, modern `rgb(... / ...)`) produced
    // a white fold with no diagnostic whatsoever.
    //
    // The draw-time fallback in `HTMLPage` STAYS. It guards the untyped path
    // and the fold-opacity invariant, which outranks syntactic convenience;
    // this check is about telling the author, not about the pixel.
    const background: unknown = result.pageBackground;
    if (typeof background !== 'string') {
      reject('pageBackground', background, 'a CSS colour string');
    }
    if (background.trim() !== '' && !isOpaquePageBackground(background)) {
      reject(
        'pageBackground',
        background,
        'an opaque CSS colour (a translucent fold lets the page underneath bleed through)',
      );
    }
    result.pageBackground = background.trim() === '' ? DEFAULT_PAGE_BACKGROUND : background;

    if (result.sizing === SizeMode.RESPONSIVE) {
      if (result.minWidth <= 0) result.minWidth = 100;
      // `Math.max`, not a bare 2000: a flat 2000 put the upper bound BELOW a
      // `minWidth` the caller declared above it, so `minWidth: 3000` gave a book
      // that was "too narrow" below 6000px and simultaneously capped at 2000px —
      // never able to reach its own declared minimum, silently.
      if (result.maxWidth < result.minWidth) result.maxWidth = Math.max(2000, result.minWidth);
      if (result.minHeight <= 0) result.minHeight = 100;
    } else {
      result.minWidth = result.width;
      result.maxWidth = result.width;
      result.minHeight = result.height;
    }

    return result;
  }
}
