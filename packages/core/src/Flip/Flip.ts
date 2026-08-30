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

  /**
   * Where an in-flight `flipToPage` intends to land, expressed as the spread
   * index the one-step commit has to *step off from* (target ∓ 1).
   *
   * It lives here rather than in the collection because the collection's index
   * is public: parking the phantom there for the whole animation is what let a
   * second `flipToPage` read a spread the book was not on. `null` for every
   * relative turn — `flipNext`, a drag, a click — which lands one spread over
   * from wherever the book actually is.
   */
  private pendingTarget: number | null = null;

  /**
   * Pages whose *drawing* density this turn overrode, so it can be put back.
   * See `applyLandscapeDensity`.
   */
  private densityOverrides: Page[] = [];

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
    // The state is entered only once `start()` has agreed to the turn.
    // Announcing USER_FOLD first meant a *refused* fold — a forward drag on
    // the last spread, or an ordinary right-edge drag at page 0 under
    // `direction: 'rtl'` — left `calc` null, so `do()` no-opped and
    // `stopMove()` returned early. Nothing put the state back, and the book
    // stayed in USER_FOLD for the rest of its life: `showCorner`'s
    // READ/FOLD_CORNER guard then failed forever (corner hover dead), and
    // `UI.onPointerMove`'s `!== READ` test stayed true, so every touchmove
    // called `preventDefault()` and mobile scrolling over the book stopped.
    if (this.calc === null && !this.start(globalPos)) return;

    this.setState(FlippingState.USER_FOLD);

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
    return this.runFlip(globalPos, direction, null);
  }

  /**
   * The one turn-starting path. `target` is the absolute spread destination for
   * `flipToPage` and `null` for every relative turn.
   *
   * The order here is load-bearing: an already-running animation is finished
   * *before* `pendingTarget` is overwritten, so the outgoing turn commits its
   * own destination rather than the incoming one.
   */
  private runFlip(
    globalPos: Point,
    direction: FlipDirection | undefined,
    target: number | null,
  ): boolean {
    // the flipping process is already running
    if (this.calc !== null) this.render.finishAnimation();

    this.pendingTarget = target;

    // A refusal deliberately leaves `pendingTarget` alone: `flipToPage` uses it
    // to tell "the turn never started, the phantom index is still mine to put
    // back" apart from "an instant turn already landed".
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
      this.applyLandscapeDensity(direction, this.flippingPage);
    }

    this.render.setDirection(direction);
    this.calc = new FlipCalculation(direction, flipCorner, rect.pageWidth, rect.height);

    return true;
  }

  /**
   * A soft page next to a hard one has to be drawn hard for the duration of the
   * turn, or the two halves of the spread disagree about how they bend.
   *
   * The override is recorded and put back by `reset()`. Upstream set it and
   * walked away: `draw()` reads the *drawing* density, so one landscape turn
   * left the neighbour permanently hard — drawn by `drawHard`, unable to curl
   * again for the life of the book, and invisible because nothing ever
   * inspected the value it had changed.
   */
  private applyLandscapeDensity(direction: FlipDirection, flippingPage: Page): void {
    const collection = this.app.getPageCollection();
    const neighbour =
      direction === FlipDirection.BACK
        ? collection.nextBy(flippingPage)
        : collection.prevBy(flippingPage);

    // Compared on the *created* density, which is what `getDensity()` returns.
    // Comparing the drawing density would see the override it just wrote and
    // stop re-marking on every later turn.
    if (neighbour === null || flippingPage.getDensity() === neighbour.getDensity()) return;

    for (const page of [flippingPage, neighbour]) {
      page.setDrawingDensity(PageDensity.HARD);
      this.densityOverrides.push(page);
    }
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

    // Finish any turn already in flight *before* reading the index. Policy:
    // finish-then-restart. A second `flipToPage` used to read the phantom index
    // the first one had written, compute its direction from a spread the book
    // was not on, and land somewhere neither call asked for (`flip(5)` then
    // `flip(2)` landed on 3). Refusing the second call was the alternative, but
    // the controlled-`page` binding legitimately issues turns faster than they
    // animate, and §4.6 says the caller must end up where it last asked.
    if (this.calc !== null) this.render.finishAnimation();

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

    const dir = next > current ? FlipDirection.FORWARD : FlipDirection.BACK;
    const phantom = dir === FlipDirection.FORWARD ? next - 1 : next + 1;

    // The collection's spread index is borrowed for the duration of `start()`
    // only: `getFlippingPage` / `getBottomPage` read it, and pointing it one
    // spread short of the target is what makes the *destination* pages animate
    // in rather than the neighbouring ones. It is put back before this call
    // returns and re-installed for the instant the commit needs it, so no
    // caller ever observes the phantom — that is what made
    // `getCurrentPageIndex()` and `getCurrentSpreadIndex()` disagree mid-turn,
    // and what made the *next* `flipToPage` compute its direction from it.
    collection.setCurrentSpreadIndex(phantom);

    let started = false;
    try {
      started = this.runFlip(this.cornerPoint(corner), dir, phantom);
    } catch (err: unknown) {
      this.pendingTarget = null;
      collection.setCurrentSpreadIndex(current);
      throw err;
    }

    // Instant turns (`flippingTime: 0` / reduced motion) run the animation
    // callback synchronously inside `runFlip`: they have already consumed the
    // target and landed. Restoring `current` then would undo a real turn — an
    // unconsumed target is what says the phantom is still ours to put back.
    if (this.pendingTarget !== null) {
      collection.setCurrentSpreadIndex(current);
      if (!started) this.pendingTarget = null;
    }

    if (!started) {
      throw new PageFlipError(`Flip setup failed for page ${page}`, 'FLIP_SETUP');
    }
  }

  /**
   * The synthetic point a programmatic turn starts from, in **global**
   * coordinates.
   *
   * `start()` runs it through `convertToBook`, which subtracts `rect.top`, and
   * re-derives the corner from the reduced y. Passing a book-local y therefore
   * turned every BOTTOM request into a TOP one on any vertically centred book
   * — i.e. the normal `size: 'fixed'` layout, where `rect.top` is half the
   * leftover height. The BOTTOM corner was simply unreachable programmatically.
   *
   * `x` is deliberately the book's own left edge and nothing reads it: the
   * direction is forced, so `getDirectionByPoint` never runs (which is also
   * what keeps `direction: 'rtl'` from inverting a programmatic page index),
   * and the corner comes from `y` alone.
   */
  private cornerPoint(corner: FlipCorner): Point {
    const rect = this.getBoundsRect();

    return {
      x: rect.left,
      y: corner === FlipCorner.TOP ? rect.top + 1 : rect.top + rect.height - 2,
    };
  }

  /**
   * Turn to the next page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipNext(corner: FlipCorner): boolean {
    return this.runFlip(this.cornerPoint(corner), FlipDirection.FORWARD, null);
  }

  /**
   * Turn to the prev page (with animation)
   *
   * @param {FlipCorner} corner - Active page corner when turning
   */
  public flipPrev(corner: FlipCorner): boolean {
    return this.runFlip(this.cornerPoint(corner), FlipDirection.BACK, null);
  }

  /**
   * Called when the user has stopped flipping
   */
  public stopMove(): void {
    if (this.calc === null) {
      // A gesture that never opened a calculation — `start()` refused it at a
      // boundary — still has to hand the state back. Returning silently here
      // is the second half of the stuck-in-USER_FOLD defect: `fold()` no
      // longer announces the state early, and the release path no longer
      // assumes an announced state implies a live calculation.
      this.setState(FlippingState.READ);
      return;
    }

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

      // Read-and-clear: the intent belongs to *this* turn, whether or not it
      // ends up committing one.
      const target = this.pendingTarget;
      this.pendingTarget = null;

      if (isTurned) {
        // A `flipToPage` re-installs its phantom index for exactly this
        // instant, so the one-step commit below steps off it and lands on the
        // requested spread. Between `start()` and here the collection reported
        // the truth.
        if (target !== null) this.app.getPageCollection().setCurrentSpreadIndex(target);

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

    // Put back every drawing density this turn overrode. `getDensity()` is the
    // density the page was created with, so this restores rather than freezes.
    for (const page of this.densityOverrides) page.setDrawingDensity(page.getDensity());
    this.densityOverrides = [];
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
    // The destination goes with the turn: the pages it referred to are the ones
    // being replaced.
    this.pendingTarget = null;
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
