/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// `pinch-zoom` is listed alongside `pan-y` deliberately. `touch-action:pan-y`
// alone tells the browser that vertical panning is the ONLY gesture it may
// handle itself — which silently disables pinch-to-zoom over the whole book.
// For a low-vision reader, magnifying the page is the primary way to read it,
// and a picture book is exactly the content people zoom into (WCAG 1.4.4
// Resize Text / 1.4.10 Reflow; disabling zoom is the classic failure). Adding
// the keyword hands two-finger zoom back to the browser while leaving
// single-finger horizontal drags — the page fold — to the engine, which is the
// only gesture `pan-y` was there to protect.
export const FLIPBOOK_CSS =
  '.stf__parent{position:relative;display:block;box-sizing:border-box;transform:translateZ(0);-ms-touch-action:pan-y pinch-zoom;touch-action:pan-y pinch-zoom}' +
  '.stf__wrapper{position:relative;width:100%;box-sizing:border-box}' +
  '.stf__block{position:absolute;width:100%;height:100%;box-sizing:border-box;perspective:2000px;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;user-drag:none}' +
  '.stf__item{display:none;position:absolute;transform-style:preserve-3d}' +
  '.stf__outerShadow,.stf__innerShadow,.stf__hardShadow,.stf__hardInnerShadow{position:absolute;left:0;top:0}';

const STYLE_ATTR = 'data-gullabs-flipbook';

export function ensureFlipbookStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.head.querySelector(`style[${STYLE_ATTR}]`)) {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = FLIPBOOK_CSS;
  document.head.appendChild(style);
}
