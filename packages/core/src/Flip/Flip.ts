/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Render } from '../Render/Render';
import { Orientation } from '../Render/Render';
import type { PageFlip } from '../PageFlip';
import { pointsBetween } from '../Helper';
import type { PageRect, Point } from '../BasicTypes';
import { FlipCalculation } from './FlipCalculation';
import type { Page } from '../Page/Page';
import { PageDensity } from '../Page/Page';
import { portraitCurlLocal } from '../geometry';
import { effectiveFlippingTime } from '../reducedMotion';
import { PageFlipError } from '../errors';
import { FlipCorner, FlipDirection, FlippingState } from './enums';

export { FlipCorner, FlipDirection, FlippingState } from './enums';

/**
 * Class representing the flipping process
 */
export class Flip {
  private readonly render: Render;
  private readonly app: PageFlip;

  private flippingPage: Page | null = null;
  private bottomPage: Page | null = null;

  private calc: FlipCalculation | null = null;

  private state: FlippingState = FlippingState.READ;

  constructor(render: Render, app: PageFlip) {
    this.render = render;
    this.app = app;
  }

  /**
   * Called when the page folding (User drags page corner)
   *
   * @param globalPos - Touch Point Coordinates (relative window)
   */
  public fold(globalPos: Point): void {
    this.setState(FlippingState.USER_FOLD);

    // If the process has not started yet
    if (this.calc === null) this.start(globalPos);

    this.do(this.render.convertToPage(globalPos));
  }

  /**
   * Page turning with animation
   *
   * @param globalPos - Touch Point Coordinates (relative window)
   */
  public flip(globalPos: Point, direction?: FlipDirection): boolean {
    // No `disableFlipByClick` check here any more: that is a policy about
    // clicks, and `PageFlip.userStop` is the only path that has one. Keeping a
    // copy here meant a blocked click returned a bare `false` that nobody
    // could tell apart from "there is no next page".

    // the flipping process is already running
    if (this.calc !== null) this.render.finishAnimation();

    if (!this.start(globalPos, direction)) return false;

    const calc = this.calc;
    if (calc === null) return false;

    const rect = this.getBoundsRect();

    this.setState(FlippingState.FLIPPING);

    const corner = calc.getCorner() === FlipCorner.BOTTOM ? 'bottom' : 'top';
    // SAME local curl for forward and back. BACK looks right on screen
    // because convertToGlobal mirrors. Do not send to.x past +pageWidth.
    const curl = portraitCurlLocal(rect.pageWidth, rect.height, corner);

    calc.calc(curl.from);

    this.animateFlippingTo(curl.from, curl.to, true);
    return true;
  }

  /**
   * Start the flipping process. Find direction and corner of flipping. Creating an object for calculation.
   *
   * @param {Point} globalPos - Touch Point Coordinates (relative window)
   * @param {FlipDirection} forcedDirection - Direction for programmatic turns.
   *   User-originated points must omit it so `rtl` hit-testing applies.
   *
   * @returns {boolean} True if flipping is possible, false otherwise
   */
  public start(globalPos: Point, forcedDirection?: FlipDirection): boolean {
    this.reset();

    const bookPos = this.render.convertToBook(globalPos);
    const rect = this.getBoundsRect();

    // Find the direction of flipping
    const direction = forcedDirection ?? this.getDirectionByPoint(bookPos);

    // Find the active corner
    const flipCorner = bookPos.y >= rect.height / 2 ? FlipCorner.BOTTOM : FlipCorner.TOP;

    if (!this.checkDirection(direction)) return false;

    // Setup failures are not caught here. The engine's own typed failures
    // (`PageFlipError` — a boundary, a bad spread) are reported by
    // `PageFlip.requestTurn` as `turnRejected`; anything else is a genuine
    // defect and must surface. Upstream swallowed both, so a broken book just
    // refused to turn with nothing in the console — the silent-failure class
    // §4.6 exists to remove.
    this.flippingPage = this.app.getPageCollection().getFlippingPage(direction);
    this.bottomPage = this.app.getPageCollection().getBottomPage(direction);

    // In landscape, the neighbouring page must take the flipped page's density.
    if (this.render.getOrientation() === Orientation.LANDSCAPE) {
      const neighbour =
        direction === FlipDirection.BACK
          ? this.app.getPageCollection().nextBy(this.flippingPage)
          : this.app.getPageCollection().prevBy(this.flippingPage);

      if (neighbour !== null && this.flippingPage.getDensity() !== neighbour.getDensity()) {
        this.flippingPage.setDrawingDensity(PageDensity.HARD);
        neighbour.setDrawingDensity(PageDensity.HARD);
      }
    }

    this.render.setDirection(direction);
    this.calc = new FlipCalculation(direction, flipCorner, rect.pageWidth, rect.height);

    return true;
  }

  /**
   * Perform calculations for the current page position. Pass data to render object
   *
   * @param {Point} pagePos - Touch Point Coordinates (relative active page)
   */
  private do(pagePos: Point): void {
    const calc = this.calc;
    const bottomPage = this.bottomPage;
    const flippingPage = this.flippingPage;

    // Flipping process not started
    if (calc === null || bottomPage === null || flippingPage === null) return;

    if (calc.calc(pagePos)) {
      // Perform calculations for a specific position
      const progress = calc.getFlippingProgress();

      bottomPage.setArea(calc.getBottomClipArea());
      bottomPage.setPosition(calc.getBottomPagePosition());
      bottomPage.setAngle(0);
      bottomPage.setHardAngle(0);

      flippingPage.setArea(calc.getFlippingClipArea());
      flippingPage.setPosition(calc.getActiveCorner());
      flippingPage.setAngle(calc.getAngle());

      if (calc.getDirection() === FlipDirection.FORWARD) {
        flippingPage.setHardAngle((90 * (200 - progress * 2)) / 100);
      } else {
        flippingPage.setHardAngle((-90 * (200 - progress * 2)) / 100);
      }

      this.render.setPageRect(calc.getRect());

      this.render.setBottomPage(bottomPage);
      this.render.setFlippingPage(flippingPage);

      const shadowStart = calc.getShadowStartPoint();

      if (shadowStart !== null) {
        this.render.setShadowData(
          shadowStart,
          calc.getShadowAngle(),
          progress,
          calc.getDirection(),
        );
      }
    }
  }

  /**
   * Turn to the specified page number (with animation)
   *
   * @param {number} page - New page number
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipToPage(page: number, corner: FlipCorner): void {
    const collection = this.app.getPageCollection();
    const current = collection.getCurrentSpreadIndex();
    const next = collection.getSpreadIndexByPage(page);

    if (next == null) {
      throw new PageFlipError(
        `Cannot flip to page ${page}: page is not in any spread`,
        'FLIP_SETUP',
      );
    }
    if (next === current) {
      return;
    }

    const dir = next > current ? 'next' : 'prev';
    collection.setCurrentSpreadIndex(dir === 'next' ? next - 1 : next + 1);

    let started = false;
    try {
      started = dir === 'next' ? this.flipNext(corner) : this.flipPrev(corner);
    } catch (err: unknown) {
      collection.setCurrentSpreadIndex(current);
      throw err;
    }

    // Instant turns (`flippingTime: 0` / reduced motion) reset `calc` in
    // the animation callback before we return. Do not treat that as failure.
    if (!started) {
      collection.setCurrentSpreadIndex(current);
      throw new PageFlipError(`Flip setup failed for page ${page}`, 'FLIP_SETUP');
    }
  }

  /**
   * Turn to the next page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipNext(corner: FlipCorner): boolean {
    // `x` is deliberately arbitrary. Forcing the direction means `start` never
    // calls `getDirectionByPoint`, and the only other thing it reads from this
    // point is `y`, to pick the corner. The old right-edge arithmetic computed
    // a coordinate nothing looked at.
    //
    // Forcing it also keeps `direction: 'rtl'` from inverting the page index:
    // a synthetic point must not go through reading-direction hit-testing.
    return this.flip(
      { x: 0, y: corner === FlipCorner.TOP ? 1 : this.render.getRect().height - 2 },
      FlipDirection.FORWARD,
    );
  }

  /**
   * Turn to the prev page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipPrev(corner: FlipCorner): boolean {
    return this.flip(
      { x: 0, y: corner === FlipCorner.TOP ? 1 : this.render.getRect().height - 2 },
      FlipDirection.BACK,
    );
  }

  /**
   * Called when the user has stopped flipping
   */
  public stopMove(): void {
    if (this.calc === null) return;

    const pos = this.calc.getPosition();
    const rect = this.getBoundsRect();

    const y = this.calc.getCorner() === FlipCorner.BOTTOM ? rect.height : 0;

    if (pos.x <= 0) this.animateFlippingTo(pos, { x: -rect.pageWidth, y }, true);
    else this.animateFlippingTo(pos, { x: rect.pageWidth, y }, false);
  }

  /**
   * Fold the corners of the book when the mouse pointer is over them.
   * Called when the mouse pointer is over the book without clicking
   *
   * @param globalPos
   */
  public showCorner(globalPos: Point): void {
    if (!this.checkState(FlippingState.READ, FlippingState.FOLD_CORNER)) return;

    const rect = this.getBoundsRect();
    const pageWidth = rect.pageWidth;

    if (this.isPointOnCorners(globalPos)) {
      if (this.calc === null) {
        if (!this.start(globalPos)) return;

        const calc = this.calc as FlipCalculation | null;
        if (calc === null) return;

        this.setState(FlippingState.FOLD_CORNER);

        calc.calc({ x: pageWidth - 1, y: 1 });

        const fixedCornerSize = 50;
        const yStart = calc.getCorner() === FlipCorner.BOTTOM ? rect.height - 1 : 1;

        const yDest =
          calc.getCorner() === FlipCorner.BOTTOM ? rect.height - fixedCornerSize : fixedCornerSize;

        this.animateFlippingTo(
          { x: pageWidth - 1, y: yStart },
          { x: pageWidth - fixedCornerSize, y: yDest },
          false,
          false,
        );
      } else {
        this.do(this.render.convertToPage(globalPos));
      }
    } else {
      this.setState(FlippingState.READ);
      this.render.finishAnimation();

      this.stopMove();
    }
  }

  /**
   * Starting the flipping animation process
   *
   * @param {Point} start - animation start point
   * @param {Point} dest - animation end point
   * @param {boolean} isTurned - will the page turn over, or just bring it back
   * @param {boolean} needReset - reset the flipping process at the end of the animation
   */
  private animateFlippingTo(start: Point, dest: Point, isTurned: boolean, needReset = true): void {
    const points = pointsBetween(start, dest);

    // Create frames
    const frames = [];
    for (const p of points) frames.push(() => this.do(p));

    const duration = this.getAnimationDuration(points.length);

    this.render.startAnimation(frames, duration, () => {
      // callback function
      if (!this.calc) return;

      if (isTurned) {
        if (this.calc.getDirection() === FlipDirection.BACK) this.app.turnToPrevPage();
        else this.app.turnToNextPage();
      }

      if (needReset) {
        this.render.setBottomPage(null);
        this.render.setFlippingPage(null);
        this.render.clearShadow();

        this.setState(FlippingState.READ);
        this.reset();
      }
    });
  }

  /**
   * Get the current calculations object. `null` while the book is at rest.
   */
  public getCalculation(): FlipCalculation | null {
    return this.calc;
  }

  /**
   * Get current flipping state
   */
  public getState(): FlippingState {
    return this.state;
  }

  private setState(newState: FlippingState): void {
    if (this.state !== newState) {
      this.app.updateState(newState);
      this.state = newState;
    }
  }

  /**
   * Direction for a *user-originated* point. `direction: 'rtl'` mirrors the
   * hit-test so the left edge turns forward, matching the swipe mapping in
   * `UI` and the keyboard mapping in the React binding. Programmatic turns
   * pass an explicit direction and never reach this.
   */
  private getDirectionByPoint(touchPos: Point): FlipDirection {
    const rect = this.getBoundsRect();
    let direction: FlipDirection = FlipDirection.FORWARD;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
      if (touchPos.x - rect.pageWidth <= rect.width / 5) {
        direction = FlipDirection.BACK;
      }
    } else if (touchPos.x < rect.width / 2) {
      direction = FlipDirection.BACK;
    }

    if (this.app.getSettings().direction === 'rtl') {
      direction = direction === FlipDirection.FORWARD ? FlipDirection.BACK : FlipDirection.FORWARD;
    }

    return direction;
  }

  private getAnimationDuration(size: number): number {
    const settings = this.app.getSettings();
    const defaultTime = effectiveFlippingTime(settings.flippingTime, settings.respectReducedMotion);

    if (defaultTime <= 0) return 0;

    if (size >= 1000) return defaultTime;

    return (size / 1000) * defaultTime;
  }

  /**
   * A turn is possible only when there is another *spread* to move to.
   * Page-index arithmetic is wrong in landscape, where the last spread can
   * hold two pages: it let a forward turn start on the final spread and then
   * read past the end of the spread list.
   */
  private checkDirection(direction: FlipDirection): boolean {
    const collection = this.app.getPageCollection();

    if (direction === FlipDirection.FORWARD)
      return collection.getCurrentSpreadIndex() < collection.getSpreadCount() - 1;

    return collection.getCurrentSpreadIndex() >= 1;
  }

  /**
   * Drop any in-flight fold. Callers inside a turn use this between frames, so
   * it deliberately does NOT touch `state` — see `abandon()` for the case where
   * the pages themselves are going away.
   */
  private reset(): void {
    this.calc = null;
    this.flippingPage = null;
    this.bottomPage = null;
  }

  /**
   * Abandon an in-flight fold or turn and return to READ.
   *
   * Used when the page collection is replaced underneath an active gesture:
   * the calculation refers to pages that are about to be destroyed, so the turn
   * is dropped rather than committed.
   *
   * @internal Wiring seam for `PageFlip.replacePages` / `destroy`.
   */
  public abandon(): void {
    this.reset();
    this.setState(FlippingState.READ);
  }

  private getBoundsRect(): PageRect {
    return this.render.getRect();
  }

  private checkState(...states: FlippingState[]): boolean {
    for (const state of states) {
      if (this.state === state) return true;
    }

    return false;
  }

  /**
   * @internal Wiring seam for `PageFlip.userStop`, which owns the
   * `disableFlipByClick` policy so a refused click can be reported.
   */
  public isPointOnCorners(globalPos: Point): boolean {
    const rect = this.getBoundsRect();
    const pageWidth = rect.pageWidth;

    const operatingDistance = Math.sqrt(pageWidth * pageWidth + rect.height * rect.height) / 5;

    const bookPos = this.render.convertToBook(globalPos);

    return (
      bookPos.x > 0 &&
      bookPos.y > 0 &&
      bookPos.x < rect.width &&
      bookPos.y < rect.height &&
      (bookPos.x < operatingDistance || bookPos.x > rect.width - operatingDistance) &&
      (bookPos.y < operatingDistance || bookPos.y > rect.height - operatingDistance)
    );
  }
}
