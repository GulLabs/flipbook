/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The public API of `@gullabs/flipbook-core`.
 *
 * This file IS the contract — the `exports` map blocks deep imports, so nothing
 * absent here is reachable. It used to carry ~40 names in four categories, of
 * which one was designed; the rest accreted. The tell was `getUI(): UI` with
 * `UI` never exported, so a consumer could not name the return type of a public
 * method. A designed surface cannot produce that.
 *
 * WHAT WAS REMOVED, and why each is not a public concern:
 *
 * - **The internal algorithms** — `convertPageToGlobal`, `portraitCurlLocal`,
 *   `curlGoesLeft`, `backCurlAppearsRight`, `FLIP_DIR_*`,
 *   `getPortraitFlippingPage`, `shouldDrawBottomPage`, `safePageBackground`,
 *   `isOpaquePageBackground`, `effectiveFlippingTime`, `prefersReducedMotion`.
 *   These are how the engine computes a fold. A consumer calling
 *   `portraitCurlLocal` is not using the library, they are reimplementing it.
 *   They were published so unit tests could import them by package name —
 *   TESTABILITY NEVER JUSTIFIES A PUBLIC EXPORT. The runner already aliases
 *   this package to `src`, and 18 core suites already deep-import `../src/`.
 *
 * - **The implementation classes** — `Render`, `Page`, `PageCollection`,
 *   `Flip`, `Settings` (and, before the 3.1 collapse, their `HTML*` halves).
 *   They were exported only because the façade's getters returned them. Those
 *   getters are gone, replaced by methods that answer the question directly
 *   (`getVisiblePages`, `canTurn`, `getBlockElement`, `getPageElement`,
 *   `isReady`), so nothing public mentions these types any more.
 *
 *   Exporting them as VALUES also advertised an extension point that does not
 *   exist: `class MyRenderer extends Render` compiled, and then there was no
 *   way to install it — `loadFromHTML` constructs `new Render(...)`
 *   directly. An extension point that type-checks and dead-ends is worse than
 *   none, because it absorbs the effort of whoever tries.
 *
 * When a second renderer is real, the seam to extract is a headless controller
 * over the spread model plus a progress signal — see `docs/WEBGL_RENDERER.md`,
 * which concludes `Render` is the wrong seam because its interface is
 * DOM-shaped. Collapsing is reversible; publishing is not.
 */

export { PageFlip } from './PageFlip';
export { PageFlipError } from './errors';
export type { PageFlipErrorCode, PageFlipErrorKind } from './errors';

export { SizeMode, ALL_POINTERS } from './Settings';
export type {
  FlipOptions,
  FlipSetting,
  LiveSetting,
  ReadingDirection,
  FlipOnClick,
  PointerKind,
} from './Settings';

// Enums a consumer reads off an event payload or passes to a turn.
//
// `FlipCorner` is a `flipNext`/`flipPrev` argument; `FlippingState` and
// `Orientation` appear in `changeState` / `BookSnapshot`.
export { FlipCorner, FlippingState } from './Flip/Flip';
export { Orientation } from './Render/Render';

// `PageDensity` is the value of the `data-density` attribute a consumer writes
// on a leaf, so it is vocabulary even though no signature returns it.
export { PageDensity } from './Page/Page';

// NOT exported: `FlipDirection` and `PageOrientation`. Both were orphans — no
// public signature mentions either, and neither is anything a consumer sets.
// `FlipDirection` is the engine's internal turn axis (and `Render` overloads it
// as a physical fold side, which is a separate confusion not worth publishing);
// `PageOrientation` drives the `--left` / `--right` classes, which are the
// documented surface rather than the enum.

export type {
  WidgetEvent,
  FlipbookEventMap,
  FlipbookEventName,
  BookSnapshot,
  TurnRejected,
  TurnRejectedReason,
} from './Event/EventObject';

// Geometry DATA types, for `getBoundsRect()`. Not the algorithms.
export type { Point, PageRect, Rect } from './BasicTypes';

// Styling: the stylesheet a consumer may inject themselves, and the selector
// describing which targets decline to start a fold.
export { ensureFlipbookStyles, FLIPBOOK_CSS } from './styles';
export { FLIPBOOK_INTERACTIVE_SELECTOR, isInteractivePointerTarget } from './interactive';
export { DEFAULT_PAGE_BACKGROUND } from './Render/pageBackground';
