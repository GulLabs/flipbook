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

  return Math.max(1, Math.min(raw, MAX_DEVICE_PIXEL_RATIO, areaCap));
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
   * CSS pixels per backing pixel, per axis. `1` until the first measurement.
   *
   * Read by `CanvasRender` to set the base transform every frame. Two axes
   * rather than one ratio because each dimension is rounded up independently,
   * so they can differ by a fraction of a percent on a fractional box.
   */
  public scaleX = 1;
  public scaleY = 1;

  private resizeCanvas(): void {
    // `getComputedStyle` + `parseInt` was wrong twice over: it forces a style
    // flush inside a resize callback, and it truncates a fractional layout box.
    const box = this.canvas.getBoundingClientRect();
    const cssWidth = box.width;
    const cssHeight = box.height;

    // A hidden book measures 0. Treat that as NO OBSERVATION: keep the last
    // scales, allocate nothing, and wait for the ResizeObserver to report a
    // real box when the element is shown again.
    if (cssWidth <= 0 || cssHeight <= 0) {
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
