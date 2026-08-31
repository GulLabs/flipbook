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
  // VISIBILITY, not display — the two must not share a property.
  //
  // Moving the hidden state to a `display` CLASS fixed inline `display:flex`
  // (inline beats a class) and left a consumer's own CLASS losing or tying:
  // `.stf__item.--shown` is (0,2,0), so `.ds-page{display:flex}` loses and
  // `.book .ds-page` ties and is decided by bundler-dependent document order.
  // Design systems style with classes, which is the consumer this was fixed
  // for.
  //
  // `visibility` decouples the axes so they cannot collide at any specificity.
  // The leaves are absolutely positioned, so a hidden one costs no layout; it
  // is not hit-testable and is skipped by find-in-page, which is what the old
  // `display:none` bought.
  '.stf__item{visibility:hidden;position:absolute;transform-style:preserve-3d}' +
  '.stf__item.--shown{visibility:visible}' +
  // THE PAPER, on a pseudo-element behind the leaf's own background.
  //
  // The invariant is "something opaque behind the content", not "this element's
  // background is opaque" — and writing `background-color` on the leaf meant the
  // engine's paper BEAT a consumer's per-page colour, so sepia on one chapter
  // did nothing. A negative z-index inside the leaf's own stacking context puts
  // the paper behind the element's background, so a consumer's colour paints
  // over it and even a translucent one has opaque paper underneath. The engine
  // writes only the custom property.
  '.stf__item::before{content:"";position:absolute;inset:0;z-index:-1;' +
  'background:var(--stf-paper,#fff);pointer-events:none}' +
  // The engine used to stamp `display:block` inline on every frame, which
  // silently reverted a consumer's `display:flex` on a page — content stuck
  // to the top-left and the library looked like it did not support flex.
  // It never needed `block`: an absolutely positioned element is already
  // block-LEVEL, and `display:flex` on one stays flex. All the engine needs
  // is 'not none', which a class says without overriding anything.
  '.stf__item.--shown{display:block}' +
  '.stf__outerShadow,.stf__innerShadow,.stf__hardShadow,.stf__hardInnerShadow{position:absolute;left:0;top:0}' +
  // The book root's focus ring, and the H4 controls' skip-link reveal.
  //
  // Here rather than in a React `<style>` tag: an inline stylesheet is blocked
  // by a strict CSP without 'unsafe-inline', which took the reveal with it — a
  // sighted keyboard user then focused a control they could not see. The
  // accessibility contract held either way (the controls stay in the a11y tree
  // and the tab order), but the visible affordance is the point of revealing
  // them at all. This sheet is injected once per document.
  '[data-flipbook-kb]:focus{outline:none}' +
  '[data-flipbook-kb]:focus-visible{outline:2px solid #2563eb;outline-offset:2px}' +
  '[data-flipbook-controls]:focus-within{position:static!important;width:auto!important;' +
  'height:auto!important;margin:0!important;overflow:visible!important;clip:auto!important;' +
  'clip-path:none!important;white-space:normal!important}';

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
