/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PageFlipError } from '../errors';
import type { Render } from '../Render/Render';
import { Orientation } from '../Render/Render';
import type { Page } from '../Page/Page';
import { PageDensity } from '../Page/Page';
import type { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { getPortraitFlippingPage } from './flippingPage';
import { at } from '../arrayAccess';

type NumberArray = number[];

/**
 * Сlass representing a collection of pages
 */
export abstract class PageCollection {
  protected readonly app: PageFlip;
  protected readonly render: Render;
  protected readonly isShowCover: boolean;

  /** Pages List */
  protected pages: Page[] = [];
  /** Index of the current page in list */
  protected currentPageIndex = 0;

  /** Number of the current spread in book */
  protected currentSpreadIndex = 0;
  /**  Two-page spread in landscape mode */
  protected landscapeSpread: NumberArray[] = [];
  /**  One-page spread in portrait mode */
  protected portraitSpread: NumberArray[] = [];

  protected constructor(app: PageFlip, render: Render) {
    this.render = render;
    this.app = app;

    this.currentPageIndex = 0;
    this.isShowCover = this.app.getSettings().showCover;
  }

  /**
   * Load pages
   */
  public abstract load(): void;

  /**
   * Clear pages list
   */
  public destroy(): void {
    // Dropping the array released nothing the pages themselves owned — for
    // canvas, a decoded bitmap and live load callbacks per page.
    for (const page of this.pages) page.dispose();

    this.pages = [];

    // PC3. The spread tables outlived the pages they index, so a destroyed
    // collection answered `getSpreadCount() === 4` and `getSpreadIndexByPage(3)
    // === 3` while `getPageCount()` was 0 — three public methods, two of them
    // describing a book that no longer exists. The tables are pure derived
    // state and nothing reads them across a destroy, so clearing them is free.
    //
    // `currentPageIndex` / `currentSpreadIndex` are deliberately left alone:
    // `PageFlip.clear()` and `updateFromHtml` both document reading the index
    // back off the emptied collection (PF3 / L2). Resetting them here was tried
    // and broke no test, so that dependency is no longer pinned by anything —
    // which makes it a `PageFlip` decision to take deliberately, not one to
    // change in passing from here.
    this.landscapeSpread = [];
    this.portraitSpread = [];
  }

  /**
   * Split the book on the two-page spread in landscape mode and one-page spread in portrait mode
   */
  protected createSpread(): void {
    this.landscapeSpread = [];
    this.portraitSpread = [];

    for (let i = 0; i < this.pages.length; i++) {
      this.portraitSpread.push([i]); // In portrait mode - (one spread = one page)
    }

    if (this.pages.length === 0) return;

    let start = 0;
    if (this.isShowCover) {
      at(this.pages, 0).setDensity(PageDensity.HARD);
      this.landscapeSpread.push([start]);
      start++;
    }

    for (let i = start; i < this.pages.length; i += 2) {
      if (i < this.pages.length - 1) this.landscapeSpread.push([i, i + 1]);
      else {
        this.landscapeSpread.push([i]);

        // PC1. Upstream hardened this leaf unconditionally, and `setDensity`
        // writes the page's PERMANENT density — the one portrait reads too.
        //
        // Portrait has no spreads of two and no covers, so a leaf is only ever
        // here because of LANDSCAPE parity: a 4-page book gets no hard leaf, a
        // 5-page book gets one, and neither has declared a cover. The cost is
        // not cosmetic. `HTMLPage.newTemporaryCopy()` returns `this` for a hard
        // page, so `getPortraitFlippingPage` sees `copy === current` and falls
        // back to upstream's previous-leaf slide-in — measured on a 3-page
        // portrait book: the BACK turn from the last page animated `pages[1]`,
        // and `shouldDrawBottomPage` then skipped the bottom page because the
        // mover WAS the bottom page. That is the §4.1 bug this fork exists to
        // kill, reachable in HTML mode on any odd-length book with no cover.
        //
        // So the inference is gated on the one thing that makes a hard terminal
        // leaf mean something: the book said it has covers. `showCover: false`
        // is a statement that it does not, and the engine must not invent one.
        // A `showCover` book is unchanged, INCLUDING the half this does not
        // fix: whether the back cover lands in a singleton spread is still a
        // parity accident (6 pages ⇒ page 5 hard, 5 pages ⇒ page 4 soft), so
        // `showCover` still only guarantees a hard FRONT cover. Making the last
        // leaf hard whenever `showCover` is set would be the coherent rule and
        // is a deliberate behaviour change for existing books — an owner call,
        // not a drive-by.
        if (this.isShowCover) at(this.pages, i).setDensity(PageDensity.HARD);
      }
    }
  }

  /**
   * Get spread by mode (portrait or landscape)
   */
  protected getSpread(): NumberArray[] {
    return this.render.getOrientation() === Orientation.LANDSCAPE
      ? this.landscapeSpread
      : this.portraitSpread;
  }

  /**
   * Number of spreads in the current orientation. In portrait this equals the
   * page count; in landscape two pages usually share one spread.
   */
  public getSpreadCount(): number {
    return this.getSpread().length;
  }

  /**
   * Get spread index by page number
   *
   * @param {number} pageNum - page index
   */
  public getSpreadIndexByPage(pageNum: number): number | null {
    const spread = this.getSpread();

    for (let i = 0; i < spread.length; i++) {
      const entry = at(spread, i);
      if (pageNum === entry[0] || pageNum === entry[1]) return i;
    }

    return null;
  }

  /**
   * Get the total number of pages
   */
  public getPageCount(): number {
    return this.pages.length;
  }

  /**
   * Get the pages list
   */
  public getPages(): Page[] {
    return this.pages;
  }

  /**
   * Get page by index
   *
   * @param {number} pageIndex
   */
  public getPage(pageIndex: number): Page {
    if (pageIndex >= 0 && pageIndex < this.pages.length) {
      return at(this.pages, pageIndex);
    }

    throw new PageFlipError(`Invalid page index ${pageIndex}`, 'INVALID_PAGE');
  }

  /**
   * Get the next page from the specified
   *
   * @param {Page} current
   */
  public nextBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    // `indexOf` returns -1 for a page that is not in this collection, and
    // `-1 < length - 1` is true — upstream answered `pages[0]` for a stranger.
    // `prevBy` already returned null for the same input.
    if (idx >= 0 && idx < this.pages.length - 1) return at(this.pages, idx + 1);

    return null;
  }

  /**
   * Get previous page from specified
   *
   * @param {Page} current
   */
  public prevBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    if (idx > 0) return at(this.pages, idx - 1);

    return null;
  }

  /**
   * Get flipping page depending on the direction
   *
   * @param {FlipDirection} direction
   */
  public getFlippingPage(direction: FlipDirection): Page {
    const current = this.currentSpreadIndex;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
      return getPortraitFlippingPage(this.pages, current, direction);
    } else {
      const spreads = this.getSpread();
      const spread =
        direction === FlipDirection.FORWARD ? at(spreads, current + 1) : at(spreads, current - 1);

      if (spread.length === 1) return at(this.pages, at(spread, 0));

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 0))
        : at(this.pages, at(spread, 1));
    }
  }

  /**
   * Get Next page at the time of flipping
   *
   * @param {FlipDirection}  direction
   */
  public getBottomPage(direction: FlipDirection): Page {
    const current = this.currentSpreadIndex;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
      return direction === FlipDirection.FORWARD
        ? at(this.pages, current + 1)
        : at(this.pages, current - 1);
    } else {
      const spreads = this.getSpread();
      const spread =
        direction === FlipDirection.FORWARD ? at(spreads, current + 1) : at(spreads, current - 1);

      if (spread.length === 1) return at(this.pages, at(spread, 0));

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 1))
        : at(this.pages, at(spread, 0));
    }
  }

  /**
   * Show next spread
   */
  public showNext(): void {
    // `length - 1`, not `length`: upstream walked one past the end and then
    // read `getSpread()[length]`, which throws inside `showSpread`.
    if (this.currentSpreadIndex < this.getSpread().length - 1) {
      this.currentSpreadIndex++;
      this.showSpread();
    }
  }

  /**
   * Show prev spread
   */
  public showPrev(): void {
    if (this.currentSpreadIndex > 0) {
      this.currentSpreadIndex--;
      this.showSpread();
    }
  }

  /**
   * Get the number of the current spread in book
   */
  public getCurrentPageIndex(): number {
    return this.currentPageIndex;
  }

  /**
   * Show specified page
   * @param {number} pageNum - Page index (from 0s)
   */
  public show(pageNum: number | null = null): void {
    pageNum ??= this.currentPageIndex;

    if (pageNum < 0 || pageNum >= this.pages.length) return;

    const spreadIndex = this.getSpreadIndexByPage(pageNum);
    if (spreadIndex !== null) {
      this.currentSpreadIndex = spreadIndex;
      this.showSpread();
    }
  }

  /**
   * Index of the current page in list
   */
  public getCurrentSpreadIndex(): number {
    return this.currentSpreadIndex;
  }

  /**
   * Set new spread index as current
   *
   * @param {number} newIndex - new spread index
   */
  public setCurrentSpreadIndex(newIndex: number): void {
    if (newIndex >= 0 && newIndex < this.getSpread().length) {
      this.currentSpreadIndex = newIndex;
    } else {
      throw new PageFlipError(
        `Invalid spread index ${newIndex} (have ${this.getSpread().length})`,
        'INVALID_SPREAD',
      );
    }
  }

  /**
   * Show current spread
   */
  private showSpread(): void {
    const spread = at(this.getSpread(), this.currentSpreadIndex);
    const leftIdx = at(spread, 0);

    if (spread.length === 2) {
      const rightIdx = at(spread, 1);
      this.render.setLeftPage(at(this.pages, leftIdx));
      this.render.setRightPage(at(this.pages, rightIdx));
    } else if (this.render.getOrientation() === Orientation.LANDSCAPE) {
      // A landscape spread holding one leaf is either the front cover — which
      // sits to the RIGHT of the spine, with nothing to its left — or the last
      // leaf of the book, which sits to the left.
      //
      // PC2. That used to be decided by `leftIdx === pages.length - 1` alone,
      // and for a ONE-page book with `showCover` both descriptions are true of
      // the same leaf: index 0 is also index `length - 1`, so the last-leaf test
      // won and the cover was placed on the left half with the right half empty.
      // Measured on a 520x300 host (rect.left 60, pageWidth 200): the cover drew
      // at `left: 60px` where every other cover draws at `left: 260px`.
      // `createSpread` only ever emits a `[0]` spread for `showCover`, so the
      // cover is the correct tie-break, and it is written as an exception to the
      // last-leaf test rather than as a third branch: a lone leaf that is
      // neither the cover nor the tail cannot be produced, and a branch for it
      // would be unreachable code with an invented default. Every other book is
      // untouched — the two tests cannot both hold once there is more than one
      // page.
      if (leftIdx === this.pages.length - 1 && !(this.isShowCover && leftIdx === 0)) {
        this.render.setLeftPage(at(this.pages, leftIdx));
        this.render.setRightPage(null);
      } else {
        this.render.setLeftPage(null);
        this.render.setRightPage(at(this.pages, leftIdx));
      }
    } else {
      this.render.setLeftPage(null);
      this.render.setRightPage(at(this.pages, leftIdx));
    }

    this.currentPageIndex = leftIdx;
    this.app.updatePageIndex(this.currentPageIndex);
  }
}
