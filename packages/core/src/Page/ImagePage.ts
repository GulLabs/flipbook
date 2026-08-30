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
   * The request settled and there is no bitmap: a 404, a decode failure, a CORS
   * refusal. Distinct from `isLoad === false`, which means "not yet".
   *
   * Only the two are distinguishable at all — an `<img>` error event carries no
   * diagnostic — so this is deliberately a boolean and not a reason. The typed
   * `imageError` payload is Phase 2's (see docs/adr/0001-image-page-api.md).
   */
  private failed = false;

  /**
   * Set by `dispose()`. A disposed page has given up its bitmap, but the
   * renderer may still hold a reference to it for a frame or two, so it has to
   * keep drawing *something* — plain paper, never a spinner for an image that
   * is never coming.
   */
  private disposed = false;

  /** The copy this page animates during a portrait turn. */
  private temporaryCopy: ImagePage | null = null;

  /**
   * The page this one borrows its bitmap from — `null` for a real page.
   *
   * A temporary copy owns no resource, so it must own no resource *state*
   * either. It used to snapshot `share.isLoad` at construction: the origin's
   * `onload` sets the origin's flag, so a copy made while the bitmap was still
   * decoding stayed `isLoad === false` for good — and `newTemporaryCopy()`
   * caches the copy, so that leaf's fold spun a loader for the rest of the
   * session while the static leaf underneath showed the picture. The same
   * snapshot in the other direction is worse: after the origin is `dispose()`d
   * its `src` is removed, which puts the element in the *broken* state, and
   * `drawImage` on a broken image throws `InvalidStateError` out of the frame.
   */
  private readonly origin: ImagePage | null;

  constructor(render: Render, href: string, density: PageDensity, share?: ImagePage) {
    super(render, density);

    if (share) {
      // Share the already-decoded bitmap: a temporary copy must not issue a
      // second request, and has to be drawable on the frame it is created.
      this.image = share.image;
      this.origin = share;
      return;
    }

    this.origin = null;
    this.image = new Image();
    this.image.src = href;
  }

  /**
   * What this leaf has to paint this frame.
   *
   * Three states, one place: gone (paper only), still arriving (loader), and
   * drawable (bitmap). A temporary copy answers with its origin's state — it is
   * a second `PageState` over one bitmap, not a second resource.
   */
  private drawState(): 'paper' | 'loader' | 'image' {
    if (this.disposed) return 'paper';
    if (this.origin !== null) return this.origin.drawState();

    // BH-1. A LEAF THAT WILL NEVER ARRIVE MUST NOT KEEP SPINNING.
    //
    // The loader is a promise that something is coming. For a 404, a decode
    // failure, or a CORS refusal, nothing is — so it spun forever on a page
    // that would never appear, and the book read as "still loading" for the
    // rest of the session.
    //
    // Paper is the honest interim answer, not the final one: the ADR specifies
    // a vector broken-image glyph (no text, so core ships no unlocalizable
    // string) and an `imageError` event, both of which need the Phase 2 error
    // contract. This stops the lie now without inventing that API early.
    if (this.failed) return 'paper';

    return this.isLoad ? 'image' : 'loader';
  }

  public draw(_tempDensity?: PageDensity): void {
    const ctx = (this.render as CanvasRender).getContext();

    const pagePos = this.render.convertPointToGlobal(this.state.position);
    const pageWidth = this.render.getRect().pageWidth;
    const pageHeight = this.render.getRect().height;

    // `finally`, for the same reason `CanvasRender.drawFrame` has one: a
    // canvas op in here can throw. `drawImage` is specified to raise
    // `InvalidStateError` for an image element in the *broken* state, which is
    // what an element becomes when its `src` is removed. An unbalanced `save()`
    // does not just lose this leaf: the enclosing frame's `restore()` then pops
    // THIS save instead of its own, so the frame's base transform and the
    // portrait clip survive into every later frame — defect G1 again, arrived
    // at from the other end.
    ctx.save();
    try {
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
      const state = this.drawState();

      if (state === 'loader') {
        this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
      } else if (state === 'image') {
        ctx.drawImage(this.image, 0, 0, pageWidth, pageHeight);
      }
    } finally {
      ctx.restore();
    }
  }

  public simpleDraw(orient: PageOrientation): void {
    const rect = this.render.getRect();
    const ctx = (this.render as CanvasRender).getContext();

    const pageWidth = rect.pageWidth;
    const pageHeight = rect.height;

    const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

    const y = rect.top;

    // Bracketed like `draw()`. This path used to write `fillStyle`, and
    // `drawLoader` `strokeStyle` and `lineWidth`, straight onto the shared
    // context with nothing to put them back — so a still-loading LEFT leaf left
    // a 10px grey pen set for whatever drew next, and a throw from `drawImage`
    // would have escaped with those still in place.
    ctx.save();
    try {
      // Static leaves are opaque paper too — same reason as `draw()`.
      ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
      ctx.fillRect(x, y, pageWidth, pageHeight);

      // Same reason as `draw()` — see the comment there.
      const state = this.drawState();

      if (state === 'loader') {
        this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
      } else if (state === 'image') {
        ctx.drawImage(this.image, x, y, pageWidth, pageHeight);
      }
    } finally {
      ctx.restore();
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
    // A copy has no request of its own, and the image element it borrows
    // already carries the origin's `onload`. Arming one here would overwrite
    // that handler and leave the ORIGIN permanently in the loader state.
    if (this.origin !== null) return;

    // Re-arming a disposed page would resurrect the bitmap it just dropped.
    if (this.isLoad || this.disposed) return;

    // A cached image can already be complete by the time we get here. It is
    // also `complete` when it FAILED, so `naturalWidth` is what distinguishes
    // "drawable" from "broken" — checking `complete` alone would draw nothing.
    if (this.image.complete) {
      this.isLoad = this.image.naturalWidth > 0;
      if (this.isLoad) return;

      // BH-1. RETURN, rather than falling through to arm `onload`.
      //
      // The image has already SETTLED, and it settled as a failure. `onload`
      // will never fire again for it, so arming one left the leaf on the loader
      // arc permanently — the exact case a cached 404 produces, which is also
      // the most likely one, because a book that failed once is usually
      // reloaded.
      this.failed = true;
      return;
    }

    // Both handlers, and `onerror` is the one that was missing entirely: a slow
    // 404 — one that errors AFTER this method runs — had nothing listening, so
    // it spun forever too.
    this.image.onerror = (): void => {
      this.failed = true;
    };

    this.image.onload = (): void => {
      // BH-2. `naturalWidth`, not the mere fact that `load` fired. The
      // `complete` branch above already documents that `naturalWidth` is the
      // real signal for "drawable"; this branch ignored it and set `isLoad`
      // unconditionally, so a decode that fires `load` with a zero-size bitmap
      // was drawn as a successful page — an empty `drawImage` producing a blank
      // leaf beside siblings that look fine, with nothing reporting it.
      if (this.image.naturalWidth > 0) {
        this.isLoad = true;
      } else {
        this.failed = true;
      }
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
    if (this.origin !== null) {
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
