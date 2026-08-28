import type { PageCollection } from './Collection/PageCollection';
import { HTMLPageCollection } from './Collection/HTMLPageCollection';
import type { PageRect, Point } from './BasicTypes';
import { Flip, FlipCorner, FlippingState } from './Flip/Flip';
import type { Orientation, Render } from './Render/Render';
import { HTMLUI } from './UI/HTMLUI';
import { Helper } from './Helper';
import type { Page } from './Page/Page';
import { EventObject } from './Event/EventObject';
import { HTMLRender } from './Render/HTMLRender';
import type { FlipSetting } from './Settings';
import { Settings } from './Settings';
import type { UI } from './UI/UI';
import { PageFlipError } from './errors';

/**
 * Class representing a main PageFlip object
 *
 * @extends EventObject
 */
export class PageFlip extends EventObject {
  private mousePosition: Point = { x: 0, y: 0 };
  private isUserTouch = false;
  private isUserMove = false;

  private readonly setting: FlipSetting;
  private readonly block: HTMLElement; // Root HTML Element

  private pages!: PageCollection;
  private flipController: Flip | null = null;
  private render!: Render;

  private ui!: UI;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  /**
   * Create a new PageFlip instance
   *
   * @constructor
   * @param {HTMLElement} inBlock - Root HTML Element
   * @param {Object} setting - Configuration object
   */
  constructor(inBlock: HTMLElement, setting: Partial<FlipSetting>) {
    super();

    this.setting = new Settings().getSettings(setting);
    this.block = inBlock;
  }

  /**
   * Destructor. Remove a root HTML element and all event handlers
   */
  public destroy(): void {
    this.destroyed = true;
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    // May be called before create() finishes wiring render/ui.
    this.render?.stop();
    this.ui?.destroy();
    // The host owns `block` (React/SSR). Do not remove it from the DOM.
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Update the render area. Re-show current page.
   */
  public update(): void {
    this.render?.update();
    this.pages?.show();
  }

  public getBlock(): HTMLElement {
    return this.block;
  }

  /**
   * Wire UI + render + pages after construction. Used by HTML load and the
   * lazily-loaded canvas path so CanvasRender stays out of the HTML bundle.
   */
  public replacePages(pages: PageCollection, current: number): void {
    if (this.destroyed) return;
    this.pages.destroy();
    this.pages = pages;
    this.pages.load();
    this.pages.show(current);
    this.trigger('update', this, {
      page: current,
      mode: this.render.getOrientation(),
    });
    this.trigger('collectionRebuild', this, {
      page: current,
      pageCount: this.pages.getPageCount(),
    });
  }

  public attachMode(ui: UI, render: Render, pages: PageCollection): void {
    if (this.destroyed) {
      ui.destroy();
      render.stop();
      return;
    }
    this.ui = ui;
    this.render = render;
    this.flipController = new Flip(render, this);
    this.pages = pages;
    this.pages.load();
    this.render.start();
    this.pages.show(this.setting.startPage);

    if (this.initTimer !== null) clearTimeout(this.initTimer);
    this.initTimer = setTimeout(() => {
      this.initTimer = null;
      this.ui.update();
      this.trigger('init', this, {
        page: this.setting.startPage,
        mode: this.render.getOrientation(),
      });
    }, 1);
  }

  /**
   * Load pages from images on the Canvas mode.
   * Canvas renderer is a separate chunk so the HTML engine stays ≤ 45 kB
   * uncompressed / ≤ 15 kB gzip (see packages/core size-limit).
   */
  public loadFromImages(imagesHref: string[]): Promise<void> {
    return import('./canvas-loader')
      .catch((err: unknown) => {
        throw new PageFlipError(
          `Failed to load canvas renderer: ${err instanceof Error ? err.message : String(err)}`,
          'CANVAS_LOAD',
        );
      })
      .then((m) => {
        if (this.destroyed) return;
        m.loadFromImages(this, imagesHref);
      });
  }

  /**
   * Load pages from HTML elements on the HTML mode
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    const ui = new HTMLUI(this.block, this, this.setting, items);
    const render = new HTMLRender(this, this.setting, ui.getDistElement());
    const pages = new HTMLPageCollection(this, render, ui.getDistElement(), items);
    this.attachMode(ui, render, pages);
  }

  /**
   * Update current pages from images
   *
   * @param {string[]} imagesHref - List of paths to images
   */
  public updateFromImages(imagesHref: string[]): Promise<void> {
    return import('./canvas-loader')
      .catch((err: unknown) => {
        throw new PageFlipError(
          `Failed to load canvas renderer: ${err instanceof Error ? err.message : String(err)}`,
          'CANVAS_LOAD',
        );
      })
      .then((m) => {
        if (this.destroyed) return;
        m.updateFromImages(this, imagesHref);
      });
  }

  /**
   * Update current pages from HTML
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    const current = this.pages.getCurrentPageIndex();

    this.pages.destroy();
    this.pages = new HTMLPageCollection(this, this.render, this.ui.getDistElement(), items);
    this.pages.load();
    (this.ui as HTMLUI).updateItems(items);
    this.render.reload();

    this.pages.show(current);
    this.trigger('update', this, {
      page: current,
      mode: this.render.getOrientation(),
    });
    this.trigger('collectionRebuild', this, {
      page: current,
      pageCount: this.pages.getPageCount(),
    });
  }

  /**
   * Merge settings at runtime. Input handlers rebind when `useMouseEvents` changes;
   * layout is recalculated for portrait / size updates.
   */
  public updateSettings(partial: Partial<FlipSetting>): FlipSetting {
    const next = new Settings().getSettings({ ...this.setting, ...partial });
    const mouseChanged = next.useMouseEvents !== this.setting.useMouseEvents;
    Object.assign(this.setting, next);

    // updateSettings can run before create() wires render/ui (React effects).

    if (this.ui && mouseChanged) {
      this.ui.refreshHandlers();
    }

    if (this.render) {
      this.update();
    }
    return this.setting;
  }

  /**
   * Clear pages from HTML (remove to initinalState)
   */
  public clear(): void {
    this.pages.destroy();
    (this.ui as HTMLUI).clear();
  }

  /**
   * Turn to the previous page (without animation)
   */
  public turnToPrevPage(): void {
    this.pages.showPrev();
  }

  /**
   * Turn to the next page (without animation)
   */
  public turnToNextPage(): void {
    this.pages.showNext();
  }

  /**
   * Turn to the specified page number (without animation)
   *
   * @param {number} page - New page number
   */
  public turnToPage(page: number): void {
    if (page < 0 || page >= this.pages.getPageCount()) {
      throw new PageFlipError(`Invalid page: ${page}`, 'INVALID_PAGE');
    }
    const spreadIndex = this.pages.getSpreadIndexByPage(page);
    if (spreadIndex === null) {
      throw new PageFlipError(`Cannot turn to page ${page}: not in any spread`, 'INVALID_PAGE');
    }
    this.pages.show(page);
  }

  /**
   * Turn to the next page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipNext(corner: FlipCorner = FlipCorner.TOP): void {
    this.flipController?.flipNext(corner);
  }

  /**
   * Turn to the prev page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipPrev(corner: FlipCorner = FlipCorner.TOP): void {
    this.flipController?.flipPrev(corner);
  }

  /**
   * Turn to the specified page number (with animation)
   *
   * @param {number} page - New page number
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flip(page: number, corner: FlipCorner = FlipCorner.TOP): void {
    this.flipController?.flipToPage(page, corner);
  }

  /**
   * Call a state change event trigger
   *
   * @param {FlippingState} newState - New  state of the object
   */
  public updateState(newState: FlippingState): void {
    this.trigger('changeState', this, newState);
  }

  /**
   * Call a page number change event trigger
   *
   * @param {number} newPage - New page Number
   */
  public updatePageIndex(newPage: number): void {
    this.trigger('flip', this, newPage);
  }

  /**
   * Call a page orientation change event trigger. Update UI and rendering area
   *
   * @param {Orientation} newOrientation - New page orientation (portrait, landscape)
   */
  public updateOrientation(newOrientation: Orientation): void {
    this.ui.setOrientationStyle(newOrientation);
    this.update();
    this.trigger('changeOrientation', this, newOrientation);
  }

  /**
   * Get the total number of pages in a book
   *
   * @returns {number}
   */
  public getPageCount(): number {
    return this.pages.getPageCount();
  }

  /**
   * Get the index of the current page in the page list (starts at 0)
   *
   * @returns {number}
   */
  public getCurrentPageIndex(): number {
    return this.pages.getCurrentPageIndex();
  }

  /**
   * Get page from collection by number
   *
   * @param {number} pageIndex
   * @returns {Page}
   */
  public getPage(pageIndex: number): Page {
    return this.pages.getPage(pageIndex);
  }

  /**
   * Get the current rendering object
   *
   * @returns {Render}
   */
  public getRender(): Render {
    return this.render;
  }

  /**
   * Get current object responsible for flipping
   *
   * @returns {Flip} `null` until `loadFromHTML` / `loadFromImages` runs.
   */
  public getFlipController(): Flip | null {
    return this.flipController;
  }

  /**
   * Get current page orientation
   *
   * @returns {Orientation} Сurrent orientation: portrait or landscape
   */
  public getOrientation(): Orientation {
    return this.render.getOrientation();
  }

  /**
   * Get current book sizes and position
   *
   * @returns {PageRect}
   */
  public getBoundsRect(): PageRect {
    return this.render.getRect();
  }

  /**
   * Get configuration object
   *
   * @returns {FlipSetting}
   */
  public getSettings(): FlipSetting {
    return this.setting;
  }

  /**
   * Get UI object
   *
   * @returns {UI}
   */
  public getUI(): UI {
    return this.ui;
  }

  /**
   * Get current flipping state
   *
   * @returns {FlippingState}
   */
  public getState(): FlippingState {
    return this.flipController?.getState() ?? FlippingState.READ;
  }

  /**
   * Get page collection
   *
   * @returns {PageCollection}
   */
  public getPageCollection(): PageCollection {
    return this.pages;
  }

  /**
   * Start page turning. Called when a user clicks or touches
   *
   * @param {Point} pos - Touch position in coordinates relative to the book
   */
  public startUserTouch(pos: Point): void {
    this.mousePosition = pos; // Save touch position
    this.isUserTouch = true;
    this.isUserMove = false;
  }

  /**
   * Called when a finger / mouse moves
   *
   * @param {Point} pos - Touch position in coordinates relative to the book
   * @param {boolean} isTouch - True if there was a touch event, not a mouse click
   */
  public userMove(pos: Point, isTouch: boolean): void {
    if (!this.isUserTouch && !isTouch && this.setting.showPageCorners) {
      this.flipController?.showCorner(pos); // fold Page Corner
    } else if (this.isUserTouch) {
      if (Helper.GetDistanceBetweenTwoPoint(this.mousePosition, pos) > 5) {
        this.isUserMove = true;
        this.flipController?.fold(pos);
      }
    }
  }

  /**
   * Сalled when the user has stopped touching
   *
   * @param {Point} pos - Touch end position in coordinates relative to the book
   * @param {boolean} isSwipe - true if there was a mobile swipe event
   */
  public userStop(pos: Point, isSwipe = false): void {
    if (this.isUserTouch) {
      this.isUserTouch = false;

      if (!isSwipe) {
        if (!this.isUserMove) this.flipController?.flip(pos);
        else this.flipController?.stopMove();
      }
    }
  }
}
