/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export { PageFlip } from './PageFlip';
export { Settings, SizeType } from './Settings';
export type { FlipSetting, FlipDirectionSetting } from './Settings';
export { Flip, FlipDirection, FlipCorner, FlippingState } from './Flip/Flip';
export { Orientation } from './Render/Render';
export { HTMLRender } from './Render/HTMLRender';
export { Render } from './Render/Render';
export { PageCollection } from './Collection/PageCollection';
export { HTMLPageCollection } from './Collection/HTMLPageCollection';
export { HTMLPage } from './Page/HTMLPage';
export { Page, PageDensity, PageOrientation } from './Page/Page';
export { PageFlipError } from './errors';
export { ImageFit, isBlankLeaf, validateCanvasLeaves } from './canvasLeaf';
export type { CanvasLeaf, ImagePageSource, BlankPageSource } from './canvasLeaf';
export type { PageFlipErrorCode } from './errors';
export {
  convertPageToGlobal,
  portraitCurlLocal,
  portraitBackCurl,
  portraitForwardCurl,
  curlGoesLeft,
  backCurlAppearsRight,
  FLIP_DIR_FORWARD,
  FLIP_DIR_BACK,
} from './geometry';
export type { Curl, CurlCorner } from './geometry';
export { getPortraitFlippingPage } from './Collection/flippingPage';
export { shouldDrawBottomPage } from './Render/bottomPage';
// Same reasoning as `geometry.ts` and `shouldDrawBottomPage`: the fit maths is
// pure, separately testable, and the thing a consumer needs in order to place
// their own overlay in the same coordinates the engine drew the bitmap in.
export { fitImage, insetRect } from './Render/imageFit';
export type { FitRect, FitPlacement } from './Render/imageFit';
export {
  safePageBackground,
  isOpaquePageBackground,
  DEFAULT_PAGE_BACKGROUND,
} from './Render/pageBackground';
export { effectiveFlippingTime, prefersReducedMotion } from './reducedMotion';
export { ensureFlipbookStyles, FLIPBOOK_CSS } from './styles';
// `FlipbookEventName` alongside the map: a consumer writing a helper that takes
// "an event name" could not type its parameter, because the union existed in
// the module and never reached the published `.d.ts`.
export type { WidgetEvent, FlipbookEventMap, FlipbookEventName } from './Event/EventObject';
export type { Point, PageRect, Rect, RectPoints, Segment } from './BasicTypes';
export { FLIPBOOK_INTERACTIVE_SELECTOR, isInteractivePointerTarget } from './interactive';
