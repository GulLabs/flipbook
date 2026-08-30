/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Orientation, Render, type Shadow } from './Render';
import { CanvasUI } from '../UI/CanvasUI';
import { shouldDrawBottomPage } from './bottomPage';
import { foldFill } from './pageBackground';
import type { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { PageOrientation } from '../Page/Page';
import type { FlipSetting } from '../Settings';

/**
 * Class responsible for rendering the Canvas book
 */
export class CanvasRender extends Render {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(app: PageFlip, setting: FlipSetting, inCanvas: HTMLCanvasElement) {
    super(app, setting);

    this.canvas = inCanvas;
    const ctx = inCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available');
    }
    this.ctx = ctx;
  }

  public getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  public reload(): void {
    //
  }

  protected drawFrame(): void {
    // The whole frame is bracketed by save/restore. Upstream applied the
    // portrait clip at the *end* of this method with no restore, so it could
    // not affect the frame that set it — it constrained every *later* frame,
    // including that frame's `clear()`, leaving stale pixels outside the clip.
    // Correctness rested on a canvas resize happening to reset context state.
    // `finally` guarantees the balance even if a page's draw throws.
    this.ctx.save();
    try {
      // Restate the base transform EVERY frame rather than reapplying it when
      // the backing store resizes. A resize-time hook is a conditional
      // invariant split across two objects — `CanvasUI` owns the size,
      // `CanvasRender` owns the transform — and nothing enforces the pairing,
      // so it rots. Doing it here also survives a browser-initiated context
      // reset and any future `resetTransform()`. Cost is one matrix store.
      const { x, y } = this.backingScale();
      this.ctx.setTransform(x, 0, 0, y, 0, 0);

      this.clear();

      // Portrait shows one leaf, so drawing is clipped to it — before anything
      // is painted, which is what upstream intended and never achieved.
      if (this.orientation === Orientation.PORTRAIT) {
        const rect = this.getRect();

        this.ctx.beginPath();
        // `rect.width` is the SPREAD width, so upstream's clip ran a whole page
        // past the book's right edge. Harmless only while nothing paints there;
        // fit modes, insets and hard pages all will.
        this.ctx.rect(rect.left + rect.pageWidth, rect.top, rect.pageWidth, rect.height);
        this.ctx.clip();
      } else if (this.leftPage != null) {
        this.leftPage.simpleDraw(PageOrientation.LEFT);
      }

      if (this.rightPage != null) this.rightPage.simpleDraw(PageOrientation.RIGHT);

      // Same guard the HTML renderer uses. `ImagePage.newTemporaryCopy()` returns
      // `this`, so the mover and the leaf beneath it are routinely the same
      // object here; painting it twice put an unclipped copy under the turning
      // page — StPageFlip#44, "the same image is visible under it".
      if (shouldDrawBottomPage(this.flippingPage, this.bottomPage)) {
        this.bottomPage?.draw();
      }

      this.drawBookShadow();

      if (this.flippingPage != null) this.flippingPage.draw();

      const shadow = this.shadow;

      if (shadow !== null) {
        this.drawOuterShadow(shadow);
        this.drawInnerShadow(shadow);
      }
    } finally {
      this.ctx.restore();
    }
  }

  private drawBookShadow(): void {
    // `drawShadow: false` has to mean *no* shadow. `Render.setShadowData` gates
    // the fold shadows on the setting, but the spine gradient was painted
    // unconditionally — so the setting only ever turned off half the shadows,
    // and the flat-colour e2e probes (which run with `drawShadow: false`) were
    // sampling a gradient. Read the setting here, never cache it: it is
    // runtime-updatable via `updateSettings`.
    if (!this.getSettings().drawShadow) return;

    // C13: a portrait book shows ONE leaf, so it has no spine to shade. The
    // gradient is centred on `rect.left + rect.width / 2` — the middle of the
    // *spread* — and in portrait `rect.width === 2 * pageWidth` while the
    // visible leaf is the right half, so that centre is exactly the leaf's
    // LEFT EDGE. The clip in `drawFrame` then throws away the gradient's left
    // half and leaves its darkest stops (0.5 → 0.4 alpha) painted as a dark
    // band down the edge of the page.
    //
    // Suppress rather than narrow: `HTMLRender` paints no book shadow at all —
    // only fold shadows, which are gated on an active flip — and in portrait it
    // returns from `drawLeftPage` before drawing anything spine-like. Turning
    // this into some page-edge shading would invent a decoration the HTML
    // renderer has never had, and the two renderers must not disagree about
    // whether a one-page view has a spine.
    if (this.orientation === Orientation.PORTRAIT) return;

    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    const shadowSize = rect.width / 20;
    this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

    // C14, the vertical half of the same bug H6 was in `HTMLPage.drawHard`:
    // this translated by y = 0 and then filled `rect.height * 2`, i.e. the band
    // `[0, 2 * height]` in block coordinates — while the book occupies
    // `[rect.top, rect.top + height]`. The clip trims the overhang at the top,
    // so the two agree only while `rect.top <= rect.height`; in a block more
    // than ~3x the book's height the fill ends above the book's bottom edge and
    // the spine shadow is cut off. Translate to the book's top and fill exactly
    // its height, the same way the hard page was fixed. The gradient is
    // horizontal, so the y translation does not disturb it.
    const shadowPos = { x: rect.left + rect.width / 2 - shadowSize / 2, y: rect.top };
    this.ctx.translate(shadowPos.x, shadowPos.y);

    const outerGradient = this.ctx.createLinearGradient(0, 0, shadowSize, 0);

    outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    outerGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.2)');
    outerGradient.addColorStop(0.49, 'rgba(0, 0, 0, 0.1)');
    outerGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    outerGradient.addColorStop(0.51, 'rgba(0, 0, 0, 0.4)');
    outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.clip();

    this.ctx.fillStyle = outerGradient;
    this.ctx.fillRect(0, 0, shadowSize, rect.height);

    this.ctx.restore();
  }

  private drawOuterShadow(shadow: Shadow): void {
    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

    const shadowPos = this.convertPointToGlobal({ x: shadow.pos.x, y: shadow.pos.y });
    this.ctx.translate(shadowPos.x, shadowPos.y);

    this.ctx.rotate(Math.PI + shadow.angle + Math.PI / 2);

    const outerGradient = this.ctx.createLinearGradient(0, 0, shadow.width, 0);

    if (shadow.direction === FlipDirection.FORWARD) {
      this.ctx.translate(0, -100);
      outerGradient.addColorStop(0, `rgba(0, 0, 0, ${shadow.opacity})`);
      outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      this.ctx.translate(-shadow.width, -100);
      outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      outerGradient.addColorStop(1, `rgba(0, 0, 0, ${shadow.opacity})`);
    }

    this.ctx.clip();

    this.ctx.fillStyle = outerGradient;
    this.ctx.fillRect(0, 0, shadow.width, rect.height * 2);

    this.ctx.restore();
  }

  private drawInnerShadow(shadow: Shadow): void {
    const pageRect = this.pageRect;
    if (pageRect === null) return;

    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    const shadowPos = this.convertPointToGlobal({ x: shadow.pos.x, y: shadow.pos.y });

    const globalPageRect = this.convertRectToGlobal(pageRect);
    this.ctx.moveTo(globalPageRect.topLeft.x, globalPageRect.topLeft.y);
    this.ctx.lineTo(globalPageRect.topRight.x, globalPageRect.topRight.y);
    this.ctx.lineTo(globalPageRect.bottomRight.x, globalPageRect.bottomRight.y);
    this.ctx.lineTo(globalPageRect.bottomLeft.x, globalPageRect.bottomLeft.y);
    this.ctx.translate(shadowPos.x, shadowPos.y);

    this.ctx.rotate(Math.PI + shadow.angle + Math.PI / 2);

    const isw = (shadow.width * 3) / 4;
    const innerGradient = this.ctx.createLinearGradient(0, 0, isw, 0);

    if (shadow.direction === FlipDirection.FORWARD) {
      this.ctx.translate(-isw, -100);

      innerGradient.addColorStop(1, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0.9, 'rgba(0, 0, 0, 0.05)');
      innerGradient.addColorStop(0.7, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    } else {
      this.ctx.translate(0, -100);

      innerGradient.addColorStop(0, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0.1, 'rgba(0, 0, 0, 0.05)');
      innerGradient.addColorStop(0.3, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }

    this.ctx.clip();

    this.ctx.fillStyle = innerGradient;
    this.ctx.fillRect(0, 0, isw, rect.height * 2);

    this.ctx.restore();
  }

  private clear(): void {
    // `pageBackground` is this fork's setting and it was only wired into the
    // HTML renderer, so a cream-paper book came out white on canvas.
    // Upstream asked for exactly this: https://github.com/Nodlik/StPageFlip/issues/56
    this.ctx.fillStyle = foldFill(this.getSettings().pageBackground);
    // CSS pixels, not `canvas.width`/`canvas.height` — those are DEVICE pixels
    // and this runs under a scaled CTM. At DPR 1 the two agree, which is why
    // the device-pixel version was right by accident; at DPR 2 it over-fills
    // (harmless overdraw) and at any scale below 1 it UNDER-fills, leaving
    // stale pixels along the right and bottom edges.
    const { x, y } = this.backingScale();
    this.ctx.fillRect(0, 0, this.canvas.width / x, this.canvas.height / y);
  }

  /**
   * Backing pixels per CSS pixel, asked of the UI that owns the canvas.
   *
   * Two earlier versions were wrong in different ways. A structural cast
   * (`ui as { scaleX?: number }`) was a lying type: a rename would still
   * compile and silently fall back to 1:1. Measuring the canvas here with
   * `getBoundingClientRect()` was transform-AWARE, so a `scale(.5)` ancestor
   * made this report 2 while the render geometry stayed in layout pixels — and
   * it forced a style flush on every frame.
   */
  private backingScale(): { x: number; y: number } {
    const ui = this.app.getUI();

    return ui instanceof CanvasUI ? ui.getBackingScale() : { x: 1, y: 1 };
  }
}
