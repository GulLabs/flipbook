/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { at } from '../arrayAccess';
import type { PageFlip } from '../PageFlip';
import type { Point, PageRect, RectPoints } from '../BasicTypes';
import { FlipDirection } from '../Flip/Flip';
import type { Page } from '../Page/Page';
import { PageOrientation } from '../Page/Page';
import type { FlipSetting } from '../Settings';
import { SizeType } from '../Settings';
import { convertPageToGlobal } from '../geometry';
import { PageFlipError } from '../errors';

type FrameAction = () => void;
type AnimationSuccessAction = () => void;

/**
 * Type describing calculated values for drop shadows
 */
export type Shadow = {
  /** Shadow Position Start Point */
  pos: Point;
  /** The angle of the shadows relative to the book */
  angle: number;
  /** Base width shadow */
  width: number;
  /** Base shadow opacity */
  opacity: number;
  /** Flipping Direction, the direction of the shadow gradients */
  direction: FlipDirection;
  /** Flipping progress in percent (0 - 100) */
  progress: number;
};

/**
 * Type describing the animation process
 * Only one animation process can be started at a same time
 */
type AnimationProcess = {
  /** List of frames in playback order. Each frame is a function. */
  frames: FrameAction[];
  /** Total animation duration */
  duration: number;
  /** Animation duration of one frame */
  durationFrame: number;
  /** Сallback at the end of the animation */
  onAnimateEnd: AnimationSuccessAction;
  /** Animation start time (Global Timer) */
  startedAt: number;
  /**
   * Index of the last frame that actually ran, or -1 before the first one.
   * It enforces one invariant — *every frame action runs at most once per
   * animation* — on both paths that can play the final frame: the render
   * loop's overshoot branch (a dropped rAF) and `finishAnimation()`'s forced
   * commit. Neither may replay a frame the other already played.
   */
  lastPlayedIndex: number;
};

/**
 * Book orientation
 */
export const Orientation = {
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape',
} as const;
export type Orientation = (typeof Orientation)[keyof typeof Orientation];

/**
 * Class responsible for rendering the book
 */
export abstract class Render {
  protected readonly setting: FlipSetting;
  protected readonly app: PageFlip;

  /** Left static book page */
  protected leftPage: Page | null = null;
  /** Right static book page */
  protected rightPage: Page | null = null;

  /** Page currently flipping */
  protected flippingPage: Page | null = null;
  /** Next page at the time of flipping */
  protected bottomPage: Page | null = null;

  /** Current flipping direction. Restamped by `setDirection` before every turn. */
  protected direction: FlipDirection = FlipDirection.FORWARD;
  /** Current book orientation */
  protected orientation: Orientation | null = null;
  /** Сurrent state of the shadows */
  protected shadow: Shadow | null = null;
  /** Сurrent animation process */
  protected animation: AnimationProcess | null = null;
  /** Page borders while flipping */
  protected pageRect: RectPoints | null = null;
  /** Current book area */
  private boundsRect: PageRect | null = null;

  /** Timer started from start of rendering */
  protected timer = 0;

  /** Active requestAnimationFrame id; 0 when the loop is stopped. */
  private rafId = 0;

  /**
   * Safari browser definitions for resolving a bug with a css property clip-area
   *
   * https://bugs.webkit.org/show_bug.cgi?id=126207
   */
  private safari = false;

  protected constructor(app: PageFlip, setting: FlipSetting) {
    this.setting = setting;
    this.app = app;

    // detect safari — never touch window at module scope; guard for Node/SSR
    this.safari = isSafariUserAgent();
  }

  /**
   * Rendering action on each requestAnimationFrame call. The entire rendering process is performed only in this method
   */
  protected abstract drawFrame(): void;

  /**
   * Reload the render area, after update pages
   */
  public abstract reload(): void;

  /**
   * Executed when requestAnimationFrame is called. Performs the current animation process and call drawFrame()
   *
   * @param timer
   */
  private render(timer: number): void {
    // R2: stamp the frame clock BEFORE running any frame action or callback.
    // `startAnimation` reads `this.timer` for `startedAt`, so an animation
    // started from inside a frame action — or from an `onAnimateEnd` that
    // chains another turn (auto-advance, a queued turn, a consumer calling
    // `flipNext()` from `onFlip`) — would otherwise be stamped with the
    // PREVIOUS frame's timestamp and begin one whole frame in the past. With a
    // short `flippingTime` that is enough for the very next tick to overshoot
    // the frame list, so the chained turn plays only its final frame.
    this.timer = timer;

    if (this.animation !== null) {
      // Find current frame of animation
      const frameIndex = Math.round(
        (timer - this.animation.startedAt) / this.animation.durationFrame,
      );

      const lastIndex = this.animation.frames.length - 1;

      if (frameIndex < this.animation.frames.length) {
        this.animation.lastPlayedIndex = frameIndex;
        at(this.animation.frames, frameIndex)();
      } else {
        // The clock overshot the end of the list — under load rAF skips
        // frames, and the last one carries the turn's final geometry. Play it
        // before committing, exactly as `finishAnimation()` does; the
        // `lastPlayedIndex` guard keeps it from running twice when the loop
        // already landed on it on the previous tick.
        const animation = this.animation;
        this.animation = null;

        if (animation.lastPlayedIndex !== lastIndex) {
          animation.lastPlayedIndex = lastIndex;
          at(animation.frames, lastIndex)();
        }

        animation.onAnimateEnd();
      }
    }

    this.drawFrame();
  }

  /**
   * Running requestAnimationFrame, and rendering process
   */
  public start(): void {
    // R3: `stop()` guards `cancelAnimationFrame`; this guards its counterpart.
    // The asymmetry is deliberate, not symmetric-by-copy: teardown must never
    // throw (a loop you cannot cancel in an environment without the API was
    // never running), but a loop that cannot START is a fatal misconfiguration
    // — every subsequent frame, turn and commit silently never happens. A
    // book that quietly renders nothing is exactly the failure mode this repo
    // keeps paying for, so it is a typed `PageFlipError` like every other
    // boundary failure here, not a raw `ReferenceError` and not a shrug.
    //
    // This is a call-time guard, not a module-scope one, so the SSR import
    // rule is unaffected: importing the engine on a server stays legal, and
    // only actually driving a render loop there fails.
    if (typeof requestAnimationFrame !== 'function') {
      throw new PageFlipError(
        'requestAnimationFrame is not available in this environment',
        'NO_ANIMATION_FRAME',
      );
    }

    this.update();
    this.stop();

    const loop = (timer: number): void => {
      if (id !== this.rafId) return;
      this.render(timer);
      this.rafId = requestAnimationFrame(loop);
      id = this.rafId;
    };

    let id = requestAnimationFrame(loop);
    this.rafId = id;
  }

  /** Cancel the render loop. Safe to call more than once. */
  public stop(): void {
    if (this.rafId !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
  }

  /**
   * Start a new animation process
   *
   * @param {FrameAction[]} frames - Frame list
   * @param {number} duration - total animation duration
   * @param {AnimationSuccessAction} onAnimateEnd - Animation callback function
   */
  public startAnimation(
    frames: FrameAction[],
    duration: number,
    onAnimateEnd: AnimationSuccessAction,
  ): void {
    this.finishAnimation(); // finish the previous animation process

    if (duration <= 0 || frames.length === 0) {
      if (frames.length > 0) {
        at(frames, frames.length - 1)();
      }
      onAnimateEnd();
      this.animation = null;
      return;
    }

    this.animation = {
      frames,
      duration,
      durationFrame: duration / frames.length,
      onAnimateEnd,
      startedAt: this.timer,
      lastPlayedIndex: -1,
    };
  }

  /**
   * End the current animation process and call the callback
   */
  public finishAnimation(): void {
    if (this.animation !== null) {
      // R1: the same "exactly once" rule the render loop's overshoot branch
      // obeys. `lastPlayedIndex` is one invariant — *every frame action runs at
      // most once per animation* — so it cannot have two implementations.
      //
      // The rejected alternative was to call this an "external forced commit"
      // whose job is to re-assert final geometry. It does not survive contact
      // with the two call sites (Flip.ts:65, Flip.ts:314): both fire from
      // pointer handling with no geometry change in between, so re-running the
      // last frame re-asserts something that was asserted microseconds ago and
      // buys nothing. The risk is asymmetric — a redundant idempotent
      // `this.do(p)` is worth zero, while a frame action that ever acquires a
      // side effect runs twice — so the guard is the cheap side of the trade.
      const lastIndex = this.animation.frames.length - 1;

      if (this.animation.lastPlayedIndex !== lastIndex) {
        this.animation.lastPlayedIndex = lastIndex;
        at(this.animation.frames, lastIndex)();
      }

      this.animation.onAnimateEnd();
    }

    this.animation = null;
  }

  /**
   * Recalculate the size of the displayed area, and update the page orientation
   */
  public update(): void {
    const { rect, orientation, observed } = this.computeBounds();

    // C5: a container with no box is not an observation of a portrait book —
    // it is the absence of an observation (`display: none`, a collapsed tab, a
    // detached node). At width 0 the portrait test (`0 < minWidth * 2`) is
    // trivially true, which is how hiding a book emitted a bogus
    // `changeOrientation` and showing it again emitted the opposite one. Keep
    // the last measured bounds and orientation and stay quiet; the
    // ResizeObserver fires again with a real box when the element becomes
    // visible, and that pass emits only if the orientation really changed.
    //
    // The exception is a book that has never been measured at all: there is no
    // previous observation to retain, and refusing to have an orientation is
    // its own defect (it would leave the book landscape-by-default and rebuild
    // the collection on first paint). So the first pass still establishes one,
    // and only subsequent zero measurements are ignored.
    if (!observed && this.orientation !== null) return;

    this.boundsRect = rect;

    if (this.orientation !== orientation) {
      this.orientation = orientation;
      this.app.updateOrientation(orientation);
    }
  }

  /**
   * Calculate the size and position of the book depending on the parent element and configuration parameters
   *
   * `observed` is false when the container has no measurable box; the rect is
   * still computed (it collapses to the container's zeros) so that geometry
   * callers keep working on a book nobody can see, but callers must not treat
   * it — or the orientation that falls out of it — as a measurement. See
   * {@link update}.
   */
  private computeBounds(): { rect: PageRect; orientation: Orientation; observed: boolean } {
    let orientation: Orientation = Orientation.LANDSCAPE;

    const blockWidth = this.getBlockWidth();
    const blockHeight = this.getBlockHeight();
    const observed = blockWidth > 0 && blockHeight > 0;

    const middlePoint: Point = {
      x: blockWidth / 2,
      y: blockHeight / 2,
    };

    const ratio = this.setting.width / this.setting.height;

    let pageWidth = this.setting.width;
    let pageHeight = this.setting.height;

    let left = middlePoint.x - pageWidth;

    if (this.setting.size === SizeType.STRETCH) {
      if (blockWidth < this.setting.minWidth * 2 && this.app.getSettings().usePortrait)
        orientation = Orientation.PORTRAIT;

      pageWidth = orientation === Orientation.PORTRAIT ? blockWidth : blockWidth / 2;

      if (pageWidth > this.setting.maxWidth) pageWidth = this.setting.maxWidth;

      pageHeight = pageWidth / ratio;
      if (pageHeight > blockHeight) {
        pageHeight = blockHeight;
        pageWidth = pageHeight * ratio;
      }

      left =
        orientation === Orientation.PORTRAIT
          ? middlePoint.x - pageWidth / 2 - pageWidth
          : middlePoint.x - pageWidth;
    } else {
      if (blockWidth < pageWidth * 2 && this.app.getSettings().usePortrait) {
        orientation = Orientation.PORTRAIT;
        left = middlePoint.x - pageWidth / 2 - pageWidth;
      }
    }

    return {
      rect: {
        left,
        top: middlePoint.y - pageHeight / 2,
        width: pageWidth * 2,
        height: pageHeight,
        pageWidth,
      },
      orientation,
      observed,
    };
  }

  /**
   * Set the current parameters of the drop shadow
   *
   * @param {Point} pos - Shadow Position Start Point
   * @param {number} angle - The angle of the shadows relative to the book
   * @param {number} progress - Flipping progress in percent (0 - 100)
   * @param {FlipDirection} direction - Flipping Direction, the direction of the shadow gradients
   */
  public setShadowData(
    pos: Point,
    angle: number,
    progress: number,
    direction: FlipDirection,
  ): void {
    if (!this.app.getSettings().drawShadow) return;

    const maxShadowOpacity = 100 * this.getSettings().maxShadowOpacity;

    this.shadow = {
      pos,
      angle,
      width: (((this.getRect().pageWidth * 3) / 4) * progress) / 100,
      opacity: ((100 - progress) * maxShadowOpacity) / 100 / 100,
      direction,
      progress: progress * 2,
    };
  }

  /**
   * Clear shadow
   */
  public clearShadow(): void {
    this.shadow = null;
  }

  /**
   * Abandon the running animation WITHOUT committing it.
   *
   * `finishAnimation()` is a commit: it runs the final frame and invokes
   * `onAnimateEnd`, which turns the page. When the collection underneath is
   * being replaced, that callback belongs to pages that no longer exist, so the
   * turn must be dropped rather than finished.
   */
  public cancelAnimation(): void {
    this.animation = null;
    this.shadow = null;
    this.flippingPage = null;
    this.bottomPage = null;
  }

  /**
   * Drop every page reference the renderer holds.
   *
   * Emptying the collection is not enough to release pages — and for canvas a
   * page owns a decoded image — because the renderer keeps its own left/right/
   * flipping/bottom references.
   */
  public releasePages(): void {
    this.cancelAnimation();
    this.leftPage = null;
    this.rightPage = null;
  }

  /**
   * Get parent block offset width
   */
  public getBlockWidth(): number {
    return this.app.getUI().getDistElement().offsetWidth;
  }

  /**
   * Get parent block offset height
   */
  public getBlockHeight(): number {
    return this.app.getUI().getDistElement().offsetHeight;
  }

  /**
   * Get current flipping direction
   */
  public getDirection(): FlipDirection {
    return this.direction;
  }

  /**
   * Сurrent size and position of the book
   */
  public getRect(): PageRect {
    // C11: the `RENDER_NOT_READY` throw that used to live here was dead code —
    // `calculateBoundsRect` always assigned `boundsRect`, so the branch could
    // not fire, and an unreachable error is a lie in the published surface.
    //
    // It is deleted rather than made reachable. The candidate for making it
    // real was the unmeasured-container case (C5), but bounds are always
    // derivable — the settings carry width/height and the container carries
    // whatever box it has, including none. Turning "you cannot see this book
    // yet" into a thrown error would mean a book mounted inside `display: none`
    // crashes the rAF loop and every programmatic turn, which is a worse defect
    // than the one being fixed. So geometry is always answerable; what a
    // zero-size container is not allowed to do is *claim an orientation*, and
    // that is where C5's fix lives (see `update`).
    const bounds = this.boundsRect ?? this.computeBounds().rect;

    this.boundsRect = bounds;

    return bounds;
  }

  /**
   * Get configuration object
   */
  public getSettings(): FlipSetting {
    return this.app.getSettings();
  }

  /**
   * Get current book orientation
   */
  public getOrientation(): Orientation {
    // `null` only before the first `update()`; the book is landscape until
    // `calculateBoundsRect` proves otherwise.
    return this.orientation ?? Orientation.LANDSCAPE;
  }

  /**
   * Set page area while flipping
   *
   * @param direction
   */
  public setPageRect(pageRect: RectPoints): void {
    this.pageRect = pageRect;
  }

  /**
   * Set flipping direction
   *
   * @param direction
   */
  public setDirection(direction: FlipDirection): void {
    this.direction = direction;
  }

  /**
   * Set right static book page
   *
   * @param page
   */
  public setRightPage(page: Page | null): void {
    if (page !== null) page.setOrientation(PageOrientation.RIGHT);

    this.rightPage = page;
  }

  /**
   * Set left static book page
   * @param page
   */
  public setLeftPage(page: Page | null): void {
    if (page !== null) page.setOrientation(PageOrientation.LEFT);

    this.leftPage = page;
  }

  /**
   * Set next page at the time of flipping
   * @param page
   */
  public setBottomPage(page: Page | null): void {
    if (page !== null)
      page.setOrientation(
        this.direction === FlipDirection.BACK ? PageOrientation.LEFT : PageOrientation.RIGHT,
      );

    this.bottomPage = page;
  }

  /**
   * Set currently flipping page
   *
   * @param page
   */
  public setFlippingPage(page: Page | null): void {
    if (page !== null)
      page.setOrientation(
        this.direction === FlipDirection.FORWARD && this.orientation !== Orientation.PORTRAIT
          ? PageOrientation.LEFT
          : PageOrientation.RIGHT,
      );

    this.flippingPage = page;
  }

  /**
   * Coordinate conversion function. Window coordinates -> to book coordinates
   *
   * @param {Point} pos - Global coordinates relative to the window
   * @returns {Point} Coordinates relative to the book
   */
  public convertToBook(pos: Point): Point {
    const rect = this.getRect();

    return {
      x: pos.x - rect.left,
      y: pos.y - rect.top,
    };
  }

  public isSafari(): boolean {
    return this.safari;
  }

  /**
   * Coordinate conversion function. Window coordinates -> to current coordinates of the working page
   *
   * @param {Point} pos - Global coordinates relative to the window
   * @param {FlipDirection} direction  - Current flipping direction
   *
   * @returns {Point} Coordinates relative to the work page
   */
  public convertToPage(pos: Point, direction?: FlipDirection | null): Point {
    direction ??= this.direction;

    const rect = this.getRect();
    const x =
      direction === FlipDirection.FORWARD
        ? pos.x - rect.left - rect.width / 2
        : rect.width / 2 - pos.x + rect.left;

    return {
      x,
      y: pos.y - rect.top,
    };
  }

  /**
   * Coordinate conversion function. Coordinates relative to the work page -> Window coordinates
   *
   * @param {Point} pos - Coordinates relative to the work page
   * @param {FlipDirection} direction  - Current flipping direction
   *
   * @returns {Point} Global coordinates relative to the window
   */
  public convertToGlobal(pos: Point | null, direction?: FlipDirection | null): Point | null {
    if (pos == null) return null;

    return this.convertPointToGlobal(pos, direction ?? this.direction);
  }

  /**
   * Non-nullable variant of {@link convertToGlobal} for callers that already
   * hold a point.
   */
  public convertPointToGlobal(pos: Point, direction?: FlipDirection): Point {
    return convertPageToGlobal(pos, direction ?? this.direction, this.getRect());
  }

  /**
   * Casting the coordinates of the corners of the rectangle in the coordinates relative to the window
   *
   * @param {RectPoints} rect - Coordinates of the corners of the rectangle relative to the work page
   * @param {FlipDirection} direction  - Current flipping direction
   *
   * @returns {RectPoints} Coordinates of the corners of the rectangle relative to the window
   */
  public convertRectToGlobal(rect: RectPoints, direction?: FlipDirection): RectPoints {
    const dir = direction ?? this.direction;

    return {
      topLeft: this.convertPointToGlobal(rect.topLeft, dir),
      topRight: this.convertPointToGlobal(rect.topRight, dir),
      bottomLeft: this.convertPointToGlobal(rect.bottomLeft, dir),
      bottomRight: this.convertPointToGlobal(rect.bottomRight, dir),
    };
  }
}

function isSafariUserAgent(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return false;
  }
  return /Version\/[\d.]+.*Safari/.test(navigator.userAgent);
}
