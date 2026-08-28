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
    this.pages = [];
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
      at(this.pages, 0, 'page').setDensity(PageDensity.HARD);
      this.landscapeSpread.push([start]);
      start++;
    }

    for (let i = start; i < this.pages.length; i += 2) {
      if (i < this.pages.length - 1) this.landscapeSpread.push([i, i + 1]);
      else {
        this.landscapeSpread.push([i]);
        at(this.pages, i, 'page').setDensity(PageDensity.HARD);
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
      const entry = at(spread, i, 'spread');
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
      return at(this.pages, pageIndex, 'page');
    }

    throw new Error('Invalid page number');
  }

  /**
   * Get the next page from the specified
   *
   * @param {Page} current
   */
  public nextBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    if (idx < this.pages.length - 1) return at(this.pages, idx + 1, 'page');

    return null;
  }

  /**
   * Get previous page from specified
   *
   * @param {Page} current
   */
  public prevBy(current: Page): Page | null {
    const idx = this.pages.indexOf(current);

    if (idx > 0) return at(this.pages, idx - 1, 'page');

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
        direction === FlipDirection.FORWARD
          ? at(spreads, current + 1, 'spread')
          : at(spreads, current - 1, 'spread');

      if (spread.length === 1) return at(this.pages, at(spread, 0, 'spread page'), 'page');

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 0, 'spread page'), 'page')
        : at(this.pages, at(spread, 1, 'spread page'), 'page');
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
        ? at(this.pages, current + 1, 'page')
        : at(this.pages, current - 1, 'page');
    } else {
      const spreads = this.getSpread();
      const spread =
        direction === FlipDirection.FORWARD
          ? at(spreads, current + 1, 'spread')
          : at(spreads, current - 1, 'spread');

      if (spread.length === 1) return at(this.pages, at(spread, 0, 'spread page'), 'page');

      return direction === FlipDirection.FORWARD
        ? at(this.pages, at(spread, 1, 'spread page'), 'page')
        : at(this.pages, at(spread, 0, 'spread page'), 'page');
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
      throw new Error('Invalid page');
    }
  }

  /**
   * Show current spread
   */
  private showSpread(): void {
    const spread = at(this.getSpread(), this.currentSpreadIndex, 'spread');
    const leftIdx = at(spread, 0, 'spread page');

    if (spread.length === 2) {
      const rightIdx = at(spread, 1, 'spread page');
      this.render.setLeftPage(at(this.pages, leftIdx, 'page'));
      this.render.setRightPage(at(this.pages, rightIdx, 'page'));
    } else if (this.render.getOrientation() === Orientation.LANDSCAPE) {
      if (leftIdx === this.pages.length - 1) {
        this.render.setLeftPage(at(this.pages, leftIdx, 'page'));
        this.render.setRightPage(null);
      } else {
        this.render.setLeftPage(null);
        this.render.setRightPage(at(this.pages, leftIdx, 'page'));
      }
    } else {
      this.render.setLeftPage(null);
      this.render.setRightPage(at(this.pages, leftIdx, 'page'));
    }

    this.currentPageIndex = leftIdx;
    this.app.updatePageIndex(this.currentPageIndex);
  }
}
