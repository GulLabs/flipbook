/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ImageFit } from '../canvasLeaf';

/**
 * How a bitmap is placed on a leaf — defect A3 (`docs/CANVAS_FIRST_CLASS.md`),
 * decided in `docs/adr/0001-image-page-api.md` Decision 4.
 *
 * Deliberately a pure module, alongside `geometry.ts`, `bottomPage.ts` and
 * `pageBackground.ts`. There is no canvas in the unit environment, so a fit
 * implemented inside `ImagePage.draw` could only ever be "tested" by asserting
 * that a mocked `drawImage` was called — which is exactly the class of
 * non-discriminating test this repo has already caught fourteen of. On numbers
 * alone the geometry is checkable to the last pixel.
 */
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the bitmap goes, and which part of it.
 *
 * `source === null` means the whole bitmap is used and the five-argument
 * `drawImage` is enough. `cover` is the only fit that crops, and it crops by
 * choosing a SOURCE rect rather than by overflowing the destination and leaning
 * on the caller's clip: the clip in `ImagePage.draw` is the folded page shape,
 * not the leaf rect, so an overflowing `cover` would bleed across the spine
 * during a turn. The ADR's sketch says `fitImage` returns a rect "with `cover`
 * additionally returning the source-rect crop"; this is that, as one value.
 */
export interface FitPlacement {
  readonly dest: FitRect;
  readonly source: FitRect | null;
}

/**
 * Clamp the inset to the range the descriptor contract already validates.
 *
 * Validation happens at the public boundary (`validateCanvasLeaves`), but this
 * module is also reachable from a directly constructed `ImagePage`, and a
 * `NaN` here becomes a `NaN` destination rect and a silently blank page. Total
 * in, total out — the `Helper.ts` I16/I18 lesson.
 */
function clampInset(inset: number): number {
  if (!Number.isFinite(inset)) return 0;
  if (inset <= 0) return 0;
  return Math.min(inset, 0.5);
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The content box: the leaf rect less the inset on all four edges.
 *
 * The inset is a FRACTION OF PAGE WIDTH, so all four edges resolve against
 * width — the same rule as CSS percentage padding, and the reason it survives
 * the continuous resizing a book gets (ADR Decision 4, addendum §3). A pixel
 * inset would be correct at exactly one book size.
 */
export function insetRect(inset: number, pageWidth: number, pageHeight: number): FitRect {
  const w = usable(pageWidth) ? pageWidth : 0;
  const h = usable(pageHeight) ? pageHeight : 0;
  const pad = clampInset(inset) * w;

  return {
    x: pad,
    y: pad,
    width: Math.max(0, w - pad * 2),
    height: Math.max(0, h - pad * 2),
  };
}

/**
 * Place a bitmap of intrinsic size `naturalWidth` × `naturalHeight` on a leaf.
 *
 * The intrinsic size must come from the element's `naturalWidth` /
 * `naturalHeight`. The descriptor deliberately carries no caller-supplied
 * dimensions: a second declared authority can disagree with the decoded bitmap
 * and produce wrong `contain` / `cover` geometry that nothing can check
 * (ADR addendum §2).
 *
 * Total: a zero or non-finite intrinsic size yields the full inset rect rather
 * than `NaN`, because a bitmap whose size we do not know cannot be fitted and
 * the honest fallback is the leaf itself.
 */
export function fitImage(
  fit: ImageFit,
  inset: number,
  pageWidth: number,
  pageHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): FitPlacement {
  const box = insetRect(inset, pageWidth, pageHeight);

  // Nothing to draw into. Returning early also keeps every division below safe.
  if (box.width <= 0 || box.height <= 0) return { dest: box, source: null };

  if (!usable(naturalWidth) || !usable(naturalHeight)) return { dest: box, source: null };

  if (fit === ImageFit.FILL) return { dest: box, source: null };

  if (fit === ImageFit.COVER) {
    // Crop the source instead of overflowing the destination. Take the largest
    // sub-rect of the bitmap with the box's aspect ratio, centred.
    const sourceWidth = Math.min(naturalWidth, (naturalHeight * box.width) / box.height);
    const sourceHeight = Math.min(naturalHeight, (naturalWidth * box.height) / box.width);

    return {
      dest: box,
      source: {
        x: (naturalWidth - sourceWidth) / 2,
        y: (naturalHeight - sourceHeight) / 2,
        width: sourceWidth,
        height: sourceHeight,
      },
    };
  }

  // CONTAIN, and anything unrecognised. `contain` is the default because it is
  // the only fit that cannot destroy information: `cover` crops and `fill`
  // distorts, both silently (ADR Decision 4). An unknown value landing here
  // rather than throwing keeps a draw call total; the descriptor validator is
  // where a bad `fit` is rejected loudly.
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    dest: {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    },
    source: null,
  };
}
