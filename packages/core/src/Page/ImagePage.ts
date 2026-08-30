/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CanvasRender } from '../Render/CanvasRender';
import { Page, PageDensity, PageOrientation } from './Page';
import type { Render } from '../Render/Render';
import type { FlipSetting } from '../Settings';
import type { Point } from '../BasicTypes';
import { foldFill, isOpaquePageBackground, safePageBackground } from '../Render/pageBackground';
import { type CanvasLeaf, ImageFit, isBlankLeaf } from '../canvasLeaf';
import { fitImage, insetRect } from '../Render/imageFit';

/** Radians per second for the loader spinner. */
const LOADER_SPEED = 4.2;

/** Ink for the loader arc and the broken-image glyph. */
const GLYPH_INK = 'rgb(160, 160, 160)';

const FITS: readonly unknown[] = [ImageFit.CONTAIN, ImageFit.COVER, ImageFit.FILL];

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
 * Normalise a per-leaf background, ONCE, at construction.
 *
 * The two jobs stay separate, per `CLAUDE.md`: `isOpaquePageBackground` answers
 * "can the next page be read through this?" and `safePageBackground` answers
 * "is this safe to hand to CSS?". Collapsing them is how a translucent fold
 * shipped once already, so neither is reimplemented here — this only sequences
 * them and decides what a rejection means.
 *
 * A rejected override returns `undefined`, i.e. it falls back to the BOOK's
 * `pageBackground` rather than to `#fff`: "override absent" and "override
 * rejected" should land in the same place, and that place is the book's own
 * paper colour (ADR 0001, Decision 4).
 */
function resolveLeafBackground(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  if (!isOpaquePageBackground(value)) return undefined;

  const safe = safePageBackground(value);

  return safe === value.trim() ? safe : undefined;
}

function resolveLeafInset(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value >= 0.5) return undefined;
  return value;
}

/**
 * Class representing one leaf of a canvas book: a bitmap, or a deliberate blank.
 *
 * Canvas mode draws images and blank leaves and nothing else — no text, no
 * HTML. That is an owner decision recorded in `docs/adr/0001-image-page-api.md`
 * ("Scope resolved"), and it is what makes a blank leaf a first-class variant
 * rather than "an image that has not loaded".
 */
export class ImagePage extends Page {
  /**
   * The descriptor this leaf was built from. Held so a temporary copy can be
   * constructed from the same one — a copy that resolved its own fit, inset or
   * background independently could disagree with the leaf underneath it.
   */
  private readonly leaf: CanvasLeaf;

  /**
   * `null` for a blank leaf, and that is the whole point of the variant.
   *
   * A blank leaf owns no bitmap, issues no request, and can never fail. Before
   * the union it would have had to be modelled as an image that is permanently
   * still loading, which draws a spinner forever — the BH-1 failure with a
   * different cause.
   */
  private readonly image: HTMLImageElement | null;

  private isLoad = false;

  /**
   * The request settled and there is no bitmap: a 404, a decode failure, a CORS
   * refusal. Distinct from `isLoad === false`, which means "not yet", and from
   * a blank leaf, which means "there was never going to be one".
   *
   * Only the states are distinguishable — an `<img>` error event carries no
   * diagnostic — so this is deliberately a boolean and not a reason. The typed
   * `imageError` payload and `retryImage` / `replaceImage` need the collection
   * and are not implemented here.
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

  /** Per-leaf overrides, normalised once. `undefined` means "inherit the book's". */
  private readonly leafFit: ImageFit | undefined;
  private readonly leafInset: number | undefined;
  private readonly leafBackground: string | undefined;

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

  constructor(render: Render, leaf: CanvasLeaf, density: PageDensity, share?: ImagePage) {
    super(render, density);

    this.leaf = leaf;
    this.leafBackground = resolveLeafBackground(leaf.background);

    if (isBlankLeaf(leaf)) {
      this.leafFit = undefined;
      this.leafInset = undefined;
      this.origin = share ?? null;
      this.image = null;
      return;
    }

    this.leafFit = leaf.fit;
    this.leafInset = resolveLeafInset(leaf.inset);

    if (share) {
      // Share the already-decoded bitmap: a temporary copy must not issue a
      // second request, and has to be drawable on the frame it is created.
      this.image = share.image;
      this.origin = share;
      return;
    }

    this.origin = null;

    const image = new Image();

    // BEFORE `src`, which is the only order in which the attribute has any
    // effect on the fetch. Omitted by default: see `ImagePageSource.crossOrigin`
    // — defaulting to `'anonymous'` blanks every book on a CDN without CORS
    // headers, to protect a pixel-readback facility this engine never uses.
    if (leaf.crossOrigin !== undefined) image.crossOrigin = leaf.crossOrigin;

    image.src = leaf.src;
    this.image = image;
  }

  /** The paper colour for THIS leaf: its own override, else the book's. */
  private paperFill(): string {
    return foldFill(this.leafBackground ?? this.render.getSettings().pageBackground);
  }

  /**
   * Book-level settings, READ AT DRAW TIME and never cached on the page.
   *
   * `CLAUDE.md`: a setting must be read where it is used, or `updateSettings`
   * silently stops working for it — which is exactly how `swipeDistance`
   * shipped ignoring every runtime update.
   *
   * This used to return a structural `BookImageSettings` shim through a double
   * cast, because `imageFit` / `imageInset` were not on `FlipSetting` yet. They
   * are now, and are validated at the boundary, so the shim is gone: the real
   * type is both honest and stricter.
   */
  private bookSettings(): FlipSetting {
    return this.render.getSettings();
  }

  /** Per-leaf override, else the book's `imageFit`, else `contain`. */
  private resolveFit(): ImageFit {
    if (this.leafFit !== undefined) return this.leafFit;

    // `imageFit` is validated by `Settings.getSettings`, so the book value is
    // already an `ImageFit`. The defensive `FITS.includes` stays anyway: this
    // reads the LIVE settings object, and `updateSettings` mutates it in place
    // — so a JS consumer can still assign rubbish to it between frames without
    // going through the validator.
    const book = this.bookSettings().imageFit;

    return FITS.includes(book) ? book : ImageFit.CONTAIN;
  }

  /** Per-leaf override, else the book's `imageInset`, else none. */
  private resolveInset(): number {
    if (this.leafInset !== undefined) return this.leafInset;

    const book = this.bookSettings().imageInset;

    if (typeof book !== 'number') return 0;

    return resolveLeafInset(book) ?? 0;
  }

  /**
   * What this leaf has to paint this frame.
   *
   * Four states, one place: nothing to draw (paper), still arriving (loader),
   * drawable (bitmap), and settled-with-no-bitmap (the broken glyph). A
   * temporary copy answers with its origin's state — it is a second `PageState`
   * over one bitmap, not a second resource.
   */
  private drawState(): 'paper' | 'loader' | 'image' | 'broken' {
    if (this.disposed) return 'paper';

    // A blank leaf is a leaf, not a failure and not a pending load. It has no
    // request to wait for and no bitmap to be broken about, so it is paper —
    // and paper is its FINAL answer, unlike the `failed` case below.
    if (this.image === null) return 'paper';

    if (this.origin !== null) return this.origin.drawState();

    // BH-1. A LEAF THAT WILL NEVER ARRIVE MUST NOT KEEP SPINNING.
    //
    // The loader is a promise that something is coming. For a 404, a decode
    // failure, or a CORS refusal, nothing is — so it spun forever on a page
    // that would never appear, and the book read as "still loading" for the
    // rest of the session.
    //
    // Paper alone was the interim answer. It is not the final one: a blank leaf
    // is now a real, deliberate thing, so "failed" and "deliberately blank"
    // would be pixel-identical and neither would be distinguishable from "still
    // loading, but the spinner just stopped". The glyph is what tells them
    // apart (ADR 0001, addendum §4).
    if (this.failed) return 'broken';

    return this.isLoad ? 'image' : 'loader';
  }

  /**
   * Paint whatever sits on top of the paper, in the leaf's own coordinates
   * offset by `origin`.
   *
   * Shared by `draw` and `simpleDraw` so the two paths cannot drift — they have
   * drifted before (`simpleDraw` shipped without the opaque background, and
   * without a `save`/`restore` bracket).
   */
  private drawContent(
    ctx: CanvasRenderingContext2D,
    at: Point,
    pageWidth: number,
    pageHeight: number,
  ): void {
    const state = this.drawState();

    if (state === 'loader') {
      this.drawLoader(ctx, at, pageWidth, pageHeight);
      return;
    }

    if (state === 'broken') {
      this.drawBrokenGlyph(ctx, at, pageWidth, pageHeight);
      return;
    }

    if (state !== 'image') return;

    // A copy holds the SAME element as its origin, so there is one place to
    // read the intrinsic size from. It is read off the element and never off
    // the descriptor: a caller-declared size can disagree with the decoded
    // bitmap and nothing could check it (ADR addendum §2).
    const image = this.image;
    if (image === null) return;

    const placement = fitImage(
      this.resolveFit(),
      this.resolveInset(),
      pageWidth,
      pageHeight,
      image.naturalWidth,
      image.naturalHeight,
    );
    const { dest, source } = placement;

    // A zero-area destination draws nothing, and a zero-area SOURCE is
    // specified to throw `IndexSizeError`. Both are reachable from a legitimate
    // book: a leaf mid-resize can measure zero.
    if (dest.width <= 0 || dest.height <= 0) return;

    if (source === null) {
      ctx.drawImage(image, at.x + dest.x, at.y + dest.y, dest.width, dest.height);
      return;
    }

    if (source.width <= 0 || source.height <= 0) return;

    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      at.x + dest.x,
      at.y + dest.y,
      dest.width,
      dest.height,
    );
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
      // prevent, which was fixed for HTML and missed here. It is also what
      // fills the letterbox that `contain` and `inset` create, which is why G2
      // and A3 are one change.
      ctx.fillStyle = this.paperFill();
      ctx.fillRect(0, 0, pageWidth, pageHeight);

      this.drawContent(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
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
      ctx.fillStyle = this.paperFill();
      ctx.fillRect(x, y, pageWidth, pageHeight);

      this.drawContent(ctx, { x, y }, pageWidth, pageHeight);
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
    ctx.fillStyle = this.paperFill();
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

  /**
   * The broken-image mark: a picture frame with a torn diagonal through it.
   *
   * Three properties are load-bearing rather than decorative:
   *
   * - **No text.** Core would otherwise ship an unlocalizable English string,
   *   and under images-only canvas there is no text-drawing capability for one
   *   to live in at all (ADR "Scope resolved"). The descriptor's `alt` is what
   *   carries meaning, through the semantic mirror.
   * - **No `arc`.** The loader arc is how every canvas test in this repo tells
   *   "still loading" from anything else. A glyph drawn with arcs would make
   *   that discriminator ambiguous, and the tests would go quietly blind.
   * - **Deterministic.** No clock, no randomness: two draws of the same failed
   *   leaf in one frame must produce identical pixels, the C10 rule.
   */
  private drawBrokenGlyph(
    ctx: CanvasRenderingContext2D,
    shiftPos: Point,
    pageWidth: number,
    pageHeight: number,
  ): void {
    // Scaled off the short edge so the mark keeps its proportions on any page,
    // and inside the same inset the bitmap would have used.
    const box = insetRect(this.resolveInset(), pageWidth, pageHeight);
    if (box.width <= 0 || box.height <= 0) return;

    const size = Math.min(box.width, box.height) * 0.28;
    if (!(size > 0)) return;

    const left = shiftPos.x + box.x + (box.width - size) / 2;
    const top = shiftPos.y + box.y + (box.height - size) / 2;
    const right = left + size;
    const bottom = top + size;

    ctx.strokeStyle = GLYPH_INK;
    ctx.lineWidth = Math.max(1, size / 24);

    // The frame.
    ctx.beginPath();
    ctx.rect(left, top, size, size);
    ctx.stroke();

    // The "photo" inside it: a two-segment horizon line, the universal picture
    // mark, drawn as strokes so it needs no fill and no font.
    ctx.beginPath();
    ctx.moveTo(left + size * 0.12, bottom - size * 0.22);
    ctx.lineTo(left + size * 0.38, top + size * 0.45);
    ctx.lineTo(left + size * 0.58, bottom - size * 0.22);
    ctx.lineTo(left + size * 0.72, top + size * 0.6);
    ctx.lineTo(right - size * 0.12, bottom - size * 0.22);
    ctx.stroke();

    // The tear: corner to corner, which is what makes it read as broken rather
    // than as a picture.
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, bottom);
    ctx.stroke();
  }

  public load(): void {
    // A blank leaf has nothing to fetch, and must never enter the failed state
    // — it is not "an image that did not load".
    const image = this.image;
    if (image === null) return;

    // A copy has no request of its own, and the image element it borrows
    // already carries the origin's `onload`. Arming one here would overwrite
    // that handler and leave the ORIGIN permanently in the loader state.
    if (this.origin !== null) return;

    // Re-arming a disposed page would resurrect the bitmap it just dropped.
    if (this.isLoad || this.disposed) return;

    // A cached image can already be complete by the time we get here. It is
    // also `complete` when it FAILED, so `naturalWidth` is what distinguishes
    // "drawable" from "broken" — checking `complete` alone would draw nothing.
    if (image.complete) {
      this.isLoad = image.naturalWidth > 0;
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
    image.onerror = (): void => {
      this.failed = true;
    };

    image.onload = (): void => {
      // BH-2. `naturalWidth`, not the mere fact that `load` fired. The
      // `complete` branch above already documents that `naturalWidth` is the
      // real signal for "drawable"; this branch ignored it and set `isLoad`
      // unconditionally, so a decode that fires `load` with a zero-size bitmap
      // was drawn as a successful page — an empty `drawImage` producing a blank
      // leaf beside siblings that look fine, with nothing reporting it.
      if (image.naturalWidth > 0) {
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
    // copy only marks itself spent. A blank leaf has nothing to release.
    if (this.origin !== null || this.image === null) {
      this.disposed = true;
      return;
    }

    this.image.onload = null;
    this.image.onerror = null;
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
    //
    // Built from the SAME descriptor, so the copy resolves the same fit, inset
    // and background as the leaf it is standing in for: a fold that letterboxed
    // differently from the page underneath it would be visible on every turn.
    this.temporaryCopy ??= new ImagePage(this.render, this.leaf, this.nowDrawingDensity, this);

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
