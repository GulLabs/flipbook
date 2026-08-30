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

  // Solve for the largest scale whose CEILED dimensions still fit the budget.
  //
  // `sqrt(MAX / area)` is the answer only if the backing size could be
  // fractional. It cannot — each axis is rounded UP independently — so that
  // scale overshoots by up to one pixel per axis, and the product lands over
  // the cap: 6000x4000 gave 3548x2365 = 8,391,020 against a stated 8,388,608.
  // Small, but this is the third revision of this cap, and "nearly" is what
  // made the previous two wrong.
  //
  // Requiring `(w*s + 1) * (h*s + 1) <= MAX` absorbs the rounding, which is a
  // quadratic in `s`:  (w*h)s^2 + (w+h)s + (1 - MAX) = 0.
  const a = cssWidth * cssHeight;
  const b = cssWidth + cssHeight;
  const areaCap = (-b + Math.sqrt(b * b - 4 * a * (1 - MAX_BACKING_PIXELS))) / (2 * a);

  // NO LOWER BOUND. Flooring at 1 overrode the cap in exactly the case it
  // exists for (a 6000x4000 book got 24M backing pixels against a stated 8.4M
  // ceiling), and flooring at 0.1 did the same thing further out: a 30000x30000
  // canvas has an areaCap of 0.0965, the floor picked 0.1, and the result was
  // 9.0M — still over. A floor and an absolute cap are contradictory claims;
  // the cap wins.
  //
  // No floor is needed for safety either: for finite positive dimensions
  // `areaCap` is itself finite and positive, so the scale stays well defined.
  // Callers guard the zero-size case before reaching here.
  return Math.min(raw, MAX_DEVICE_PIXEL_RATIO, areaCap);
}

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
   * Backing pixels per CSS pixel, per axis. `1` until the first measurement.
   *
   * Two axes rather than one ratio because each dimension is rounded up
   * independently, so they can differ by a fraction of a percent.
   */
  private scaleX = 1;
  private scaleY = 1;

  /**
   * The scale `CanvasRender` must apply as its base transform.
   *
   * Computed from the LAYOUT box at resize time, never re-derived from the
   * canvas's visual box: `getBoundingClientRect()` is transform-aware, so
   * inside a `transform: scale(.5)` ancestor an 800px layout canvas with an
   * 800px backing store would report a scale of 2 while the render geometry
   * stayed in layout pixels — content drawn at the wrong scale and clipped.
   * Reading it from here also removes a forced style flush from every frame.
   */
  public getBackingScale(): { x: number; y: number } {
    return { x: this.scaleX, y: this.scaleY };
  }

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
