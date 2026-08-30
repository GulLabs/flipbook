/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CanvasRender } from '../Render/CanvasRender';
import { Page, PageDensity, PageOrientation } from './Page';
import type { Render } from '../Render/Render';
import type { Point } from '../BasicTypes';
import { foldFill } from '../Render/pageBackground';

/** Radians per second for the loader spinner. */
const LOADER_SPEED = 4.2;

/**
 * Monotonic-ish clock for the loader spinner.
 *
 * Never read at module scope — `performance` is absent in some SSR runtimes,
 * and even where it exists the value must be sampled at draw time.
 */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Class representing a book page as an image on Canvas
 */
export class ImagePage extends Page {
  private readonly image: HTMLImageElement;
  private isLoad = false;

  /**
   * Set by `dispose()`. A disposed page has given up its bitmap, but the
   * renderer may still hold a reference to it for a frame or two, so it has to
   * keep drawing *something* — plain paper, never a spinner for an image that
   * is never coming.
   */
  private disposed = false;

  /** The copy this page animates during a portrait turn. */
  private temporaryCopy: ImagePage | null = null;

  /** True for a page created by `newTemporaryCopy()`, which borrows a bitmap. */
  private readonly isTemporaryCopy: boolean;

  constructor(render: Render, href: string, density: PageDensity, share?: ImagePage) {
    super(render, density);

    if (share) {
      // Share the already-decoded bitmap: a temporary copy must not issue a
      // second request, and has to be drawable on the frame it is created.
      this.image = share.image;
      this.isLoad = share.isLoad;
      this.isTemporaryCopy = true;
      return;
    }

    this.isTemporaryCopy = false;
    this.image = new Image();
    this.image.src = href;
  }

  public draw(_tempDensity?: PageDensity): void {
    const ctx = (this.render as CanvasRender).getContext();

    const pagePos = this.render.convertPointToGlobal(this.state.position);
    const pageWidth = this.render.getRect().pageWidth;
    const pageHeight = this.render.getRect().height;

    ctx.save();
    ctx.translate(pagePos.x, pagePos.y);
    ctx.beginPath();

    for (const p of this.state.area) {
      if (p !== null) {
        const globalPoint = this.render.convertPointToGlobal(p);
        ctx.lineTo(globalPoint.x - pagePos.x, globalPoint.y - pagePos.y);
      }
    }

    ctx.rotate(this.state.angle);

    ctx.clip();

    // The turning leaf is paper before it is art. Without this the bitmap is
    // painted straight onto the already-drawn page beneath, so a transparent
    // PNG reads through the fold — the §4.2 bug `pageBackground` exists to
    // prevent, which was fixed for HTML and missed here.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    // A disposed page is paper and nothing else: the bitmap is gone and no
    // load is pending, so a loader here would spin forever.
    if (!this.disposed) {
      if (!this.isLoad) {
        this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
      } else {
        ctx.drawImage(this.image, 0, 0, pageWidth, pageHeight);
      }
    }

    ctx.restore();
  }

  public simpleDraw(orient: PageOrientation): void {
    const rect = this.render.getRect();
    const ctx = (this.render as CanvasRender).getContext();

    const pageWidth = rect.pageWidth;
    const pageHeight = rect.height;

    const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

    const y = rect.top;

    // Static leaves are opaque paper too — same reason as `draw()`.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.fillRect(x, y, pageWidth, pageHeight);

    // Same reason as `draw()` — see the comment there.
    if (!this.disposed) {
      if (!this.isLoad) {
        this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
      } else {
        ctx.drawImage(this.image, x, y, pageWidth, pageHeight);
      }
    }
  }

  private drawLoader(
    ctx: CanvasRenderingContext2D,
    shiftPos: Point,
    pageWidth: number,
    pageHeight: number,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(200, 200, 200)';
    // Was hardcoded white, which flashed over a custom `pageBackground` for as
    // long as the image took to arrive.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.lineWidth = 1;
    ctx.rect(shiftPos.x + 1, shiftPos.y + 1, pageWidth - 1, pageHeight - 1);
    ctx.stroke();
    ctx.fill();

    const middlePoint: Point = {
      x: shiftPos.x + pageWidth / 2,
      y: shiftPos.y + pageHeight / 2,
    };

    // Derived from the clock, not advanced per call. It used to be `+= 0.07`
    // at the end of this method, which is (a) the wrong rate whenever a page is
    // drawn more than once per frame — and `newTemporaryCopy()` returns `this`,
    // so the mover and the leaf beneath it are routinely the same object, i.e.
    // twice a frame, i.e. double speed — and (b) state mutation inside a draw
    // method, which stops being replayable the moment drawing is scheduled off
    // a dirty flag rather than once per rAF tick.
    const angle = ((nowMs() / 1000) * LOADER_SPEED) % (2 * Math.PI);

    ctx.beginPath();
    ctx.lineWidth = 10;
    ctx.arc(middlePoint.x, middlePoint.y, 20, angle, (3 * Math.PI) / 2 + angle);
    ctx.stroke();
    ctx.closePath();
  }

  public load(): void {
    // Re-arming a disposed page would resurrect the bitmap it just dropped.
    if (this.isLoad || this.disposed) return;

    // A cached image can already be complete by the time we get here. It is
    // also `complete` when it FAILED, so `naturalWidth` is what distinguishes
    // "drawable" from "broken" — checking `complete` alone would draw nothing.
    if (this.image.complete) {
      this.isLoad = this.image.naturalWidth > 0;
      if (this.isLoad) return;
    }

    this.image.onload = (): void => {
      this.isLoad = true;
    };
  }

  /**
   * Detach the load callback and drop the source so the decoded bitmap can be
   * collected. A destroyed book used to keep every page it had ever decoded.
   */
  public override dispose(): void {
    super.dispose();

    // A temporary copy BORROWS its bitmap from the page it was made from.
    // Detaching handlers or dropping `src` here would blank the original, so a
    // copy only marks itself spent.
    if (this.isTemporaryCopy) {
      this.disposed = true;
      return;
    }

    this.image.onload = null;
    this.image.removeAttribute('src');
    this.isLoad = false;
    this.disposed = true;
  }

  public newTemporaryCopy(): Page {
    // Hard pages return `this`, matching `HTMLPage`: a rigid cover swings, it
    // does not curl, so it stays on the vendor previous-leaf path where the
    // mover is not also the leaf beneath it.
    if (this.nowDrawingDensity === PageDensity.HARD) {
      return this;
    }

    // Returning `this` unconditionally is what left the fork's FLAGSHIP FIX
    // absent in canvas mode. `getPortraitFlippingPage` asks for a copy and,
    // seeing the same object back, falls through to `pages[i - 1]` — which is
    // exactly upstream's previous-leaf slide-in, the bug this fork exists to
    // kill.
    //
    // A canvas page has no DOM node to clone. What it needs is a second
    // `PageState` over the same bitmap, so the mover and the leaf beneath it
    // can hold different positions within one frame.
    this.temporaryCopy ??= new ImagePage(this.render, '', this.nowDrawingDensity, this);

    return this.temporaryCopy;
  }

  public getTemporaryCopy(): Page | null {
    return this.temporaryCopy;
  }

  public hideTemporaryCopy(): void {
    // Dropped, not disposed: the copy borrows its bitmap, so disposing it here
    // would blank the page it was copied from.
    this.temporaryCopy = null;
  }
}
