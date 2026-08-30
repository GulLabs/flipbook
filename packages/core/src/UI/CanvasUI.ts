/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UI } from './UI';
import type { PageFlip } from '../PageFlip';
import type { FlipSetting } from '../Settings';

/**
 * Backing-store scale for a canvas of a given CSS size.
 *
 * Capped by AREA, not by a flat DPR ceiling. A flat cap gets it wrong in both
 * directions: a 390x700 phone at DPR 3 is 2.5M backing pixels — cheaper than a
 * desktop at DPR 2 — so refusing it denies quality where it is cheapest; while
 * a 3840-wide window at DPR 2 is 16.6M pixels, which sits on top of the canvas
 * area limits on iOS, where exceeding them does not degrade, it returns BLANK.
 */
function effectiveDevicePixelRatio(cssWidth: number, cssHeight: number): number {
  const raw =
    typeof devicePixelRatio === 'number' &&
    Number.isFinite(devicePixelRatio) &&
    devicePixelRatio > 0
      ? devicePixelRatio
      : 1;

  const areaCap = Math.sqrt(MAX_BACKING_PIXELS / (cssWidth * cssHeight));

  // NOT `Math.max(1, ...)`. Flooring at 1 overrides the area cap in exactly the
  // case the cap exists for: a canvas whose CSS box alone already exceeds the
  // limit. A 6000x4000 book was allowed 24M backing pixels against a stated
  // 8.4M ceiling — and on iOS, exceeding the limit does not degrade, the canvas
  // comes back BLANK. Below 1 is a real and correct answer: render the book at
  // less than one backing pixel per CSS pixel rather than not at all.
  //
  // The lower bound only keeps the scale positive and finite so the transform
  // and the division in `backingScale()` stay well defined.
  return Math.min(raw, MAX_DEVICE_PIXEL_RATIO, Math.max(areaCap, MIN_DEVICE_PIXEL_RATIO));
}

/** Enough to keep a transform invertible; a book this large is unusable anyway. */
const MIN_DEVICE_PIXEL_RATIO = 0.1;

/** ~2896 squared. Conservative against the smallest documented canvas limits. */
const MAX_BACKING_PIXELS = 8_388_608;

/** Beyond 3x the returns are invisible and the memory is not. */
const MAX_DEVICE_PIXEL_RATIO = 3;

/**
 * UI for canvas mode
 */
export class CanvasUI extends UI {
  private readonly canvas: HTMLCanvasElement;

  constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
    super(inBlock, app, setting);

    this.wrapper.innerHTML = '<canvas class="stf__canvas"></canvas>';

    // Scoped to the wrapper this UI just created, rather than a document-order
    // query over the whole block. B3 was withdrawn as harmless — it is only
    // harmless because `UI` PREPENDS its wrapper — but the coupling is real.
    const canvas = this.wrapper.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Canvas element was not created');
    }
    this.canvas = canvas;

    this.distElement = this.canvas;

    this.resizeCanvas();
    this.setHandlers();
  }

  /**
   * CSS pixels per backing pixel, per axis. `1` until the first measurement.
   *
   * Read by `CanvasRender` to set the base transform every frame. Two axes
   * rather than one ratio because each dimension is rounded up independently,
   * so they can differ by a fraction of a percent on a fractional box.
   */
  public scaleX = 1;
  public scaleY = 1;

  private resizeCanvas(): void {
    // The original bug here was `parseInt`, which TRUNCATED a fractional layout
    // box. The obvious fix — `getBoundingClientRect()` — is wrong for a
    // different reason: that box is transform-AWARE, while `Render` measures the
    // book with `offsetWidth`, which is transform-blind. Inside any
    // `transform: scale()` ancestor (a zoom-to-fit shell, a responsive wrapper)
    // the two would disagree and the backing store would be sized for the
    // visual box while the geometry stayed in layout pixels.
    //
    // `parseFloat` on the computed style keeps the LAYOUT box, which is what
    // `Render` uses, and is fractional, which is what `parseInt` threw away.
    const cs = getComputedStyle(this.canvas);
    const cssWidth = parseFloat(cs.getPropertyValue('width'));
    const cssHeight = parseFloat(cs.getPropertyValue('height'));

    // A hidden book measures 0. Treat that as NO OBSERVATION: keep the last
    // scales, allocate nothing, and wait for the ResizeObserver to report a
    // real box when the element is shown again.
    if (!(cssWidth > 0) || !(cssHeight > 0)) {
      if (this.canvas.width !== 0 || this.canvas.height !== 0) {
        this.canvas.width = 0;
        this.canvas.height = 0;
      }
      return;
    }

    const dpr = effectiveDevicePixelRatio(cssWidth, cssHeight);
    const backingWidth = Math.ceil(cssWidth * dpr);
    const backingHeight = Math.ceil(cssHeight * dpr);

    this.scaleX = backingWidth / cssWidth;
    this.scaleY = backingHeight / cssHeight;

    // Assigning `width`/`height` resets the ENTIRE context state — transform,
    // fillStyle, clip — and whether assigning the same value is a no-op differs
    // between engines. So only assign when the integer backing size actually
    // changes, and let `CanvasRender` restate the transform every frame rather
    // than trying to keep a cross-object invariant in sync.
    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }
  }

  /**
   * Get canvas element
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public update(): void {
    this.resizeCanvas();
    this.app.getRender().update();
  }
}
