/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ImagePage } from '../Page/ImagePage';
import type { Render } from '../Render/Render';
import { PageCollection } from './PageCollection';
import type { PageFlip } from '../PageFlip';
import { PageDensity } from '../Page/Page';
import type { CanvasLeaf } from '../canvasLeaf';
import { isBlankLeaf } from '../canvasLeaf';
import { PageFlipError } from '../errors';
import { at } from '../arrayAccess';

/**
 * One leaf's accessible name, with the blank-leaf discriminant resolved.
 *
 * Free function rather than a method so `getAltTexts` can pass it straight to
 * `map` — `map` supplies an index as the second argument, and a method with an
 * optional second parameter would silently receive it.
 */
function altOf(leaf: CanvasLeaf): string | undefined {
  return isBlankLeaf(leaf) ? '' : leaf.alt;
}

/**
 * The alt surface, as a STRUCTURAL type so a consumer can reach it.
 *
 * `PageFlip.getPageCollection()` is typed as the base `PageCollection`, which
 * has no `getAltText`, and `ImagePageCollection` is deliberately absent from
 * `index.ts` — exporting the class would drag the lazy canvas chunk into the
 * eager graph that every HTML-only consumer downloads. An `instanceof` check on
 * the consumer's side has the same cost for the same reason.
 *
 * So the reachable form is a type: erased at compile time, costs zero bytes,
 * and lets `index.ts` re-export it with one type-only line. See the report /
 * `getAltTexts` for the accessor that should eventually front this on
 * `PageFlip` itself.
 */
export interface CanvasAltSource {
  getAltText: (index: number) => string | undefined;
  getAltTexts: () => readonly (string | undefined)[];
}

/**
 * A collection of canvas leaves — one bitmap or one deliberately blank page
 * each (ADR 0001, "Scope resolved"). There is no text leaf and no HTML leaf.
 *
 * The collection is the only thing that holds the descriptor list, which is
 * what makes it the only thing that can answer for `alt`: a canvas book has no
 * DOM per page, so the descriptor is the entire accessible name (see
 * `getAltTexts`).
 */
export class ImagePageCollection extends PageCollection implements CanvasAltSource {
  private readonly leaves: readonly CanvasLeaf[];

  constructor(app: PageFlip, render: Render, leaves: readonly CanvasLeaf[]) {
    super(app, render);

    this.leaves = leaves;
  }

  public load(): void {
    for (const leaf of this.leaves) {
      // The descriptor's own density is the page's starting density, so that a
      // leaf declared `hard` is hard from the first frame rather than from
      // whenever `createSpread` happens to run. `createSpread` then applies the
      // structural inference, and `applyDeclaredDensity` puts the declaration
      // back on top of it — see the override below for why that order.
      const page = new ImagePage(this.render, leaf, leaf.density ?? PageDensity.SOFT);

      page.load();
      this.pages.push(page);
    }

    this.createSpread();
  }

  /**
   * A DECLARED density beats the structural inference.
   *
   * `PageCollection.createSpread` infers density from shape: with `showCover`
   * it hardens leaf 0, and it hardens a terminal singleton. That inference
   * exists because HTML leaves cannot say anything about themselves — a
   * `CanvasLeaf` can, and `density` is the descriptor saying it.
   *
   * Letting the inference win would make the descriptor lie: a consumer who
   * writes `{ blank: true, alt: '', density: 'soft' }` for an inside cover
   * would get a hard leaf that swings instead of curling, with nothing to
   * explain why the field they set had no effect. So the declaration is
   * re-applied AFTER the inference rather than only at construction — applying
   * it first is indistinguishable from not applying it at all, because
   * `createSpread` calls `setDensity`, which overwrites.
   *
   * The inference is untouched for every leaf that declares nothing, which is
   * the common case and the one `createSpread`'s own comments are about.
   */
  protected override createSpread(): void {
    super.createSpread();

    this.applyDeclaredDensity();
  }

  private applyDeclaredDensity(): void {
    for (let i = 0; i < this.pages.length; i++) {
      const declared = at(this.leaves, i).density;

      if (declared !== undefined) at(this.pages, i).setDensity(declared);
    }
  }

  /**
   * The accessible name of one leaf. THREE answers, and they are all different.
   *
   * - a non-empty string — use it;
   * - `''` — the author said "decorative, skip me", deliberately;
   * - `undefined` — the author said NOTHING. Unknown, never decorative.
   *
   * The third is why the return type is widened rather than defaulted. ADR 0001
   * is explicit that absence is "unknown", and `?? ''` here would convert every
   * unlabelled page into a declared-decorative one — announcing nothing at all
   * for a page carrying the story, with no warning at the point of use. The
   * caller renders a positional fallback ("Page 7") for `undefined`; core does
   * not, because core would have to ship an unlocalisable English string to do
   * it (ADR 0001, and the same reason the broken-image glyph draws no text).
   *
   * A BLANK leaf is the one normalisation, and it is a read of the discriminant
   * rather than an invention: `blank: true` IS the decorative assertion, and
   * `canvasLeaf.ts` says so — it carries strictly more than `alt: ''`, which is
   * why `BlankPageSource.alt` is `?: ''`. So a blank leaf answers `''`, not
   * `undefined`. Without this the caller cannot tell "blank pad, correctly
   * silent" from "image leaf nobody labelled", and would read out "Page 7" over
   * eight parity pads — the exact noise the `?: ''` change was made to prevent.
   *
   * @throws {PageFlipError} `INVALID_PAGE` — same contract as `getPage`.
   */
  public getAltText(index: number): string | undefined {
    if (index < 0 || index >= this.leaves.length) {
      throw new PageFlipError(`Invalid page index ${index}`, 'INVALID_PAGE');
    }

    return altOf(at(this.leaves, index));
  }

  /**
   * Every leaf's accessible name, in page order — same three-valued contract as
   * `getAltText`, including the `undefined` that must survive.
   *
   * This is what a semantic mirror is built from (`ImageFlipBook`'s visually
   * hidden page list). It returns a copy so a caller cannot write back into the
   * descriptor list the collection was constructed with.
   */
  public getAltTexts(): readonly (string | undefined)[] {
    return this.leaves.map(altOf);
  }
}
