/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageFlip } from '../PageFlip';
import type { Point } from '../BasicTypes';
import type { FlipSetting } from '../Settings';
import { SizeType } from '../Settings';
import { FlipCorner, FlippingState } from '../Flip/Flip';
import { Orientation } from '../Render/Render';
import { ensureFlipbookStyles } from '../styles';
import { FLIPBOOK_INTERACTIVE_SELECTOR } from '../interactive';

type SwipeData = {
  point: Point;
  time: number;
};

/**
 * UI Class, represents work with DOM.
 * One pointer-event path (mouse, touch, pen) plus ResizeObserver / visualViewport.
 */
export abstract class UI {
  protected readonly parentElement: HTMLElement;

  protected readonly app: PageFlip;
  protected readonly wrapper: HTMLElement;
  protected distElement!: HTMLElement;

  private touchPoint: SwipeData | null = null;
  private readonly swipeTimeout = 250;
  private resizeObserver: ResizeObserver | null = null;
  /** Active pointer id, so `pointerleave` after `pointerup` is ignored. */
  private activePointerId: number | null = null;
  /**
   * Whether `setPointerCapture` actually took for {@link activePointerId}.
   *
   * X5. The capture call is wrapped in a `try`/`catch` because capture is
   * optional — but the id was recorded either way, and `onPointerLeave`
   * returned early whenever an id was set. So on a browser or an element where
   * capture fails (a detached block, a UA that rejects the id, a synthetic
   * pointer with no capture support) the engine believed it was captured:
   * dragging out of the block produced no `pointerup`, no `pointerleave`
   * handling, and the fold stayed on the page following a button-less cursor
   * for the life of the book — the exact bug the capture work was supposed to
   * close, through the door it left open.
   *
   * So the id and the capture are tracked separately: the id says which pointer
   * owns the gesture (I11's filtering), this says whether the browser will keep
   * routing that pointer's events here after it leaves.
   */
  private pointerCaptured = false;
  /** Whether `autoSize` currently owns the host's width / max-width. */
  private autoSizeOwnsHost = false;
  /** Host inline styles captured at construction so `destroy()` can restore them. */
  private readonly hostStyles: {
    minWidth: string;
    minHeight: string;
    width: string;
    maxWidth: string;
    display: string;
  };

  private onResize = (): void => {
    this.update();
  };

  private onVisualViewportResize = (): void => {
    this.update();
  };

  protected constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
    ensureFlipbookStyles();

    this.parentElement = inBlock;

    // The host element belongs to the caller (the React tree). Remember what it
    // looked like so `destroy()` hands it back unchanged.
    this.hostStyles = {
      minWidth: inBlock.style.minWidth,
      minHeight: inBlock.style.minHeight,
      width: inBlock.style.width,
      maxWidth: inBlock.style.maxWidth,
      display: inBlock.style.display,
    };

    inBlock.classList.add('stf__parent');
    inBlock.insertAdjacentHTML('afterbegin', '<div class="stf__wrapper"></div>');

    this.wrapper = inBlock.querySelector('.stf__wrapper') as HTMLElement;

    this.app = app;

    this.applyHostSize(setting);

    this.observeResize();
  }

  /**
   * Stamp the host element's sizing constraints from the current settings.
   *
   * Also called on `updateSettings`, so a responsive `width` / `height` is a
   * restyle rather than a teardown. Without this the React binding had to
   * treat size as constructor-only and rebuild the whole engine on every
   * resize step — losing the current page and any in-flight turn.
   *
   * @internal Wiring seam for `PageFlip.updateSettings`. Not part of the
   * supported API; it may change in a minor release.
   */
  public applyHostSize(setting: FlipSetting = this.app.getSettings()): void {
    const host = this.parentElement;
    const k = this.app.getSettings().usePortrait ? 1 : 2;

    host.style.minWidth = `${setting.minWidth * k}px`;
    host.style.minHeight = `${setting.minHeight}px`;

    if (setting.size === SizeType.FIXED) {
      host.style.minWidth = `${setting.width * k}px`;
      host.style.minHeight = `${setting.height}px`;
    }

    if (setting.autoSize) {
      host.style.width = '100%';
      host.style.maxWidth = `${setting.maxWidth * 2}px`;
    } else if (this.autoSizeOwnsHost) {
      // Only on the transition out of autoSize: hand back what it took over.
      // Doing this on every settings update would clobber a width the caller
      // set themselves after construction.
      host.style.width = this.hostStyles.width;
      host.style.maxWidth = this.hostStyles.maxWidth;
    }

    this.autoSizeOwnsHost = setting.autoSize;

    host.style.display = 'block';

    this.applyWrapperRatio();
  }

  /**
   * The wrapper reserves the book's aspect ratio with bottom padding while
   * `autoSize` is on. It is derived from width/height, so a live size change
   * has to recompute it — otherwise a 300×400 book resized to 320×400 keeps
   * 133.33% and renders at the old proportions.
   */
  private applyWrapperRatio(orientation?: Orientation): void {
    const setting = this.app.getSettings();

    if (!setting.autoSize) {
      this.wrapper.style.paddingBottom = '';
      return;
    }

    // The constructor runs before the render exists. Skipping is safe there:
    // `render.start()` calls `update()`, which reports the orientation back
    // through `setOrientationStyle` and lands here with a real value.
    const resolved = orientation ?? this.currentOrientation();
    if (resolved === null) return;

    const spreadWidth = resolved === Orientation.PORTRAIT ? setting.width : setting.width * 2;

    this.wrapper.style.paddingBottom = `${(setting.height / spreadWidth) * 100}%`;
  }

  /**
   * Book orientation, or `null` before a render exists.
   *
   * `UI` is constructed before `attachMode` wires up the render, so this runs
   * with nothing behind it during construction. The controller is set in the
   * same step as the render, so asking whether it exists is the same question
   * — and unlike catching, it cannot swallow a real fault by accident.
   */
  private currentOrientation(): Orientation | null {
    if (this.app.getFlipController() === null) return null;

    return this.app.getRender().getOrientation();
  }

  public destroy(): void {
    this.removeHandlers();
    this.unobserveResize();

    // `distElement` is `.stf__block` in HTML mode, and it holds the page
    // elements the engine ADOPTED from the caller. Removing the block with
    // them still inside deletes the consumer's own DOM: a vanilla book that
    // is destroyed and re-created (hot reload, mode switch, route remount)
    // came back empty. Hand the adopted leaves back first.
    this.releaseNodes();

    this.distElement.remove();
    this.wrapper.remove();

    // Hand the host element back the way we found it.
    this.parentElement.classList.remove('stf__parent');
    this.parentElement.style.minWidth = this.hostStyles.minWidth;
    this.parentElement.style.minHeight = this.hostStyles.minHeight;
    this.parentElement.style.width = this.hostStyles.width;
    this.parentElement.style.maxWidth = this.hostStyles.maxWidth;
    this.parentElement.style.display = this.hostStyles.display;
  }

  /**
   * Hand back caller-owned nodes this UI moved into `distElement`, before the
   * block is removed in `destroy()`.
   *
   * The base implementation does nothing: the subclass is the only thing that
   * knows what it adopted. `HTMLUI` already tracks exactly that (its `adopted`
   * set) and already has the release routine (`clear()`), so it forwards here
   * rather than the base class growing a second, parallel notion of ownership
   * — and a canvas book, which draws its pages instead of adopting them, keeps
   * a genuine no-op.
   */
  protected releaseNodes(): void {
    // Nothing adopted by default.
  }

  public abstract update(): void;

  /**
   * Rebind input handlers after `updateSettings({ useMouseEvents })`.
   */
  public refreshHandlers(): void {
    this.removeHandlers();
    this.setHandlers();
  }

  public getDistElement(): HTMLElement {
    return this.distElement;
  }

  public getWrapper(): HTMLElement {
    return this.wrapper;
  }

  public setOrientationStyle(orientation: Orientation): void {
    this.wrapper.classList.remove('--portrait', '--landscape');
    this.wrapper.classList.add(orientation === Orientation.PORTRAIT ? '--portrait' : '--landscape');

    this.applyWrapperRatio(orientation);
    this.update();
  }

  protected removeHandlers(): void {
    // Unbinding can happen in the middle of a gesture — `refreshHandlers` from
    // `updateSettings({ useMouseEvents })`, and `HTMLUI.updateItems`. The real
    // `pointerup` then lands on nothing, so the gesture has to be ended here
    // or the engine stays in `USER_FOLD` with `isUserTouch` set and the fold
    // follows a button-less cursor forever.
    this.cancelGesture();

    this.distElement.removeEventListener('pointerdown', this.onPointerDown);
    this.distElement.removeEventListener('pointermove', this.onPointerMove);
    this.distElement.removeEventListener('pointerup', this.onPointerUp);
    this.distElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.distElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.distElement.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.distElement.removeEventListener('dragstart', this.onDragStart);
  }

  protected setHandlers(): void {
    // X7. Suppressing the native drag ghost is NOT a mouse-input feature, and
    // it used to sit behind this early return: with `useMouseEvents: false` the
    // engine turns off page turning by pointer, but the browser still starts
    // its own image / text drag inside a page — a translucent copy of the
    // artwork peeling away from a book that has deliberately disabled dragging.
    // Bound before the return, removed unconditionally in `removeHandlers`.
    this.distElement.addEventListener('dragstart', this.onDragStart);

    if (!this.app.getSettings().useMouseEvents) return;

    this.distElement.addEventListener('pointerdown', this.onPointerDown);
    this.distElement.addEventListener('pointermove', this.onPointerMove);
    this.distElement.addEventListener('pointerup', this.onPointerUp);
    this.distElement.addEventListener('pointercancel', this.onPointerCancel);
    this.distElement.addEventListener('pointerleave', this.onPointerLeave);
    // The browser can take a capture away mid-gesture (a `pointercancel`, the
    // element being removed, an OS gesture claiming the pointer). After that
    // the events stop coming here, so the gesture is in the same position as
    // one that never captured at all — see `pointerCaptured`.
    this.distElement.addEventListener('lostpointercapture', this.onLostPointerCapture);
  }

  private observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.parentElement);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize, false);
    }

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.onVisualViewportResize);
    }
  }

  private unobserveResize(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    } else if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }

    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onVisualViewportResize);
    }
  }

  /**
   * Pointer position in book space. RTL must NOT mirror x here: the fold has to
   * follow the finger. Reading direction is applied to the *turn direction*
   * only — `Flip.getDirectionByPoint` for drag/click, `swipeDirection` below
   * for swipes.
   *
   * U3 / I14 — the third instance of one bug class, and the only one that needs
   * a CONVERSION rather than a change of ruler.
   *
   * Three coordinate spaces meet here:
   *
   *  - the pointer arrives in **client (visual) pixels** — that is all a
   *    `PointerEvent` has, and it is measured through every ancestor transform;
   *  - `getBoundingClientRect()` is likewise **transform-aware**, so it is the
   *    right thing to locate the block's origin *in that same space*;
   *  - but `Render` measures the book with `offsetWidth` / `offsetHeight`
   *    ({@link Render.getBlockWidth}), which is **transform-blind** — pure
   *    layout pixels. Every rect, page width and fold vertex downstream is in
   *    layout pixels.
   *
   * Subtracting `rect.left` alone therefore produced a *visual*-pixel offset
   * and handed it to layout-pixel geometry. At scale 1 the two spaces coincide,
   * which is exactly why this survived; inside any `transform: scale()`
   * ancestor — a zoom-to-fit shell, a responsive wrapper, a slide deck — the
   * fold tracked the finger at the wrong ratio, and the error grows with the
   * distance from the block's origin, so it is worst at the outer edge where
   * folds actually start.
   *
   * The two canvas fixes for the same mismatch (`CanvasUI.resizeCanvas`,
   * `CanvasRender.backingScale`) could simply stop measuring the visual box and
   * measure the layout box instead, because both were measuring *the element*.
   * That option does not exist here: the input genuinely is a visual-pixel
   * point, so the choice is not which box to measure but which space to end up
   * in — and it must be `Render`'s. Hence: locate the origin with the
   * transform-aware rect (same space as the pointer), then divide by the
   * visual-per-layout ratio of the very same element. **Output is layout
   * pixels, relative to `distElement`** — the space `Render.convertToBook`
   * expects.
   *
   * `offsetWidth`, not `getComputedStyle().width`, is the denominator on
   * purpose: the aim is not the truest layout box but *the one `Render` uses*.
   * Where the two differ (offset* is rounded to an integer) matching `Render`
   * is what keeps the block's far edge in pointer space equal to the block's
   * far edge in geometry space.
   *
   * Both axes are derived independently — a non-uniform `scale(sx, sy)` is
   * legal CSS — and a zero or missing measurement (a hidden book, jsdom's
   * unlaid-out DOM) falls back to 1:1 rather than dividing by zero.
   */
  private getMousePos(x: number, y: number): Point {
    const el = this.distElement;
    const rect = el.getBoundingClientRect();

    const layoutWidth = el.offsetWidth;
    const layoutHeight = el.offsetHeight;

    const scaleX = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
    const scaleY = layoutHeight > 0 && rect.height > 0 ? rect.height / layoutHeight : 1;

    return {
      x: (x - rect.left) / scaleX,
      y: (y - rect.top) / scaleY,
    };
  }

  private checkTarget(targer: EventTarget | null): boolean {
    if (!this.app.getSettings().clickEventForward) return true;
    if (!(targer instanceof Element)) return true;
    return targer.closest(FLIPBOOK_INTERACTIVE_SELECTOR) === null;
  }

  /** Release pointer capture and forget the active pointer. Idempotent. */
  private releaseCapturedPointer(): void {
    if (this.activePointerId === null) return;

    try {
      this.distElement.releasePointerCapture(this.activePointerId);
    } catch {
      // already released
    }

    this.activePointerId = null;
    this.pointerCaptured = false;
  }

  /**
   * End an in-flight gesture without committing anything.
   *
   * Releasing the capture is not enough: `PageFlip.isUserTouch` and the fold
   * state live in the engine, and only a `pointerup` clears them. `userStop`
   * with `isSwipe` set unwinds the touch flag while deliberately committing
   * neither a click-turn nor a snap-back — the gesture is being abandoned, not
   * finished — and `abandon()` drops the fold and returns the state to READ,
   * the same pairing `PageFlip.replacePages` uses when pages vanish under a
   * gesture. Idempotent: a no-op when nothing is in flight.
   */
  private cancelGesture(): void {
    const wasActive = this.touchPoint !== null || this.activePointerId !== null;
    const lastPos = this.touchPoint?.point ?? { x: 0, y: 0 };

    this.touchPoint = null;
    this.releaseCapturedPointer();

    if (!wasActive) return;

    // The controller is the witness that a mode is attached: it and the page
    // collection are wired in the same step, so this also proves `show()`
    // below has something to draw and cannot throw `NOT_LOADED`.
    const flip = this.app.getFlipController();
    if (flip === null) return;

    this.app.userStop(lastPos, true);
    flip.abandon();

    // Repaint the spread: the last frame drawn was a fold that no longer
    // exists. Skipped during teardown, where there is nothing left to draw to.
    if (!this.app.isDestroyed()) this.app.getPageCollection().show();
  }

  private swipeDirection(dx: number): 'prev' | 'next' {
    const rtl = this.app.getSettings().direction === 'rtl';

    if (dx > 0) {
      return rtl ? 'next' : 'prev';
    }

    return rtl ? 'prev' : 'next';
  }

  private onDragStart = (e: DragEvent): void => {
    e.preventDefault();
  };

  /**
   * The browser took the capture back mid-gesture.
   *
   * The pointer id stays the gesture's owner — the finger is still down — but
   * from here on its events are no longer routed to this element, so leaving
   * the block is terminal exactly as it is for a gesture that never captured.
   */
  private onLostPointerCapture = (e: PointerEvent): void => {
    if (this.activePointerId !== e.pointerId) return;

    this.pointerCaptured = false;
  };

  /**
   * Pointer left the book without a release.
   *
   * Three cases, and the middle one is X5:
   *
   * - **No gesture** — a hover walked off the book; put the hover corner back.
   * - **A gesture we do NOT hold the capture for** — no `pointerup` will ever
   *   reach this element again, so this is the last event of the gesture. It
   *   has to end here, without committing (the pointer left the book; that is
   *   an abandonment, not a turn) or the engine stays in `USER_FOLD` with the
   *   fold following a button-less cursor forever.
   * - **A captured gesture** — skipped. Under capture `pointerleave` also fires
   *   straight after `pointerup` (always so for touch), and re-entering
   *   `stopMove()` there starts a second snap-back over the one `userStop`
   *   already began.
   */
  private onPointerLeave = (): void => {
    if (this.activePointerId !== null) {
      if (this.pointerCaptured) return;

      this.cancelGesture();
      return;
    }

    this.touchPoint = null;

    this.unfoldHoverCorner();
  };

  /** Put a hover-folded corner back. Only the hover fold — never a drag. */
  private unfoldHoverCorner(): void {
    const flip = this.app.getFlipController();

    if (flip?.getState() === FlippingState.FOLD_CORNER) {
      this.app.getRender().finishAnimation();
      flip.stopMove();
    }
  }

  /**
   * Does this event belong to the gesture in progress?
   *
   * With no active pointer there is no gesture to belong to — that is a hover,
   * which every pointer may drive. Once one pointer owns the gesture, the
   * others are ignored: a second finger used to overwrite `activePointerId`
   * (orphaning the first pointer's capture) and then drive the fold, so a
   * two-finger pinch-zoom over the book folded a page and lifting either
   * finger ran `userStop` — committing a turn nobody asked for.
   */
  private isActivePointer(e: PointerEvent): boolean {
    return this.activePointerId === null || this.activePointerId === e.pointerId;
  }

  private onPointerDown = (e: PointerEvent): void => {
    // A gesture is already in progress and belongs to another pointer.
    if (this.activePointerId !== null) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!this.checkTarget(e.target)) return;

    const pos = this.getMousePos(e.clientX, e.clientY);

    this.activePointerId = e.pointerId;
    this.pointerCaptured = false;

    try {
      this.distElement.setPointerCapture(e.pointerId);
      // Ask rather than assume. A UA that implements capture can still decline
      // this particular one (a pointer that is no longer active, an element
      // just detached) WITHOUT throwing, and believing the call is the same
      // failure as swallowing the throw was. Written against the runtime value
      // because `lib.dom` declares the query as always present: where it is
      // missing — jsdom, older UAs — a bare call would throw into the `catch`
      // below and report every capture as failed, so a call that did not throw
      // is the best evidence available there.
      this.pointerCaptured =
        typeof this.distElement.hasPointerCapture === 'function'
          ? this.distElement.hasPointerCapture(e.pointerId)
          : true;
    } catch {
      // Capture is optional. The id is still tracked, so this pointer owns the
      // gesture and others are filtered out — but `pointerleave` must now treat
      // leaving the block as the end of it. See `pointerCaptured`.
      this.pointerCaptured = false;
    }

    this.touchPoint = {
      point: pos,
      time: Date.now(),
    };

    this.app.startUserTouch(pos);

    if (!this.app.getSettings().mobileScrollSupport && e.pointerType !== 'mouse') {
      if (e.cancelable) e.preventDefault();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isActivePointer(e)) return;

    // The `clickEventForward` guard ran on `pointerdown` only, so the click
    // was forwarded correctly while the *hover* still folded the corner up
    // over the link or button the user was reaching for. A hover that lands on
    // an interactive target unfolds instead — the same thing leaving the book
    // does. Only hovers: a drag under capture reports the block as its target
    // and must keep following the finger.
    if (this.activePointerId === null && !this.checkTarget(e.target)) {
      this.unfoldHoverCorner();
      return;
    }

    const pos = this.getMousePos(e.clientX, e.clientY);
    const isTouch = e.pointerType !== 'mouse';

    if (this.app.getSettings().mobileScrollSupport && isTouch) {
      if (this.touchPoint !== null) {
        if (
          Math.abs(this.touchPoint.point.x - pos.x) > 10 ||
          this.app.getState() !== FlippingState.READ
        ) {
          this.app.userMove(pos, true);
        }
      }

      if (this.app.getState() !== FlippingState.READ) {
        if (e.cancelable) e.preventDefault();
      }
    } else {
      this.app.userMove(pos, isTouch);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    // Lifting a finger that never owned the gesture must not end it.
    if (!this.isActivePointer(e)) return;

    this.releaseCapturedPointer();
    const pos = this.getMousePos(e.clientX, e.clientY);
    let isSwipe = false;

    if (this.touchPoint !== null) {
      const dx = pos.x - this.touchPoint.point.x;
      const distY = Math.abs(pos.y - this.touchPoint.point.y);
      // Read live: caching this at construction meant `updateSettings` was
      // accepted and reported back by `getSettings()` while the gesture kept
      // using the old threshold.
      const { swipeDistance } = this.app.getSettings();

      if (
        Math.abs(dx) > swipeDistance &&
        distY < swipeDistance * 2 &&
        Date.now() - this.touchPoint.time < this.swipeTimeout
      ) {
        // `touchPoint.point` is relative to `distElement`; `rect.height` is the
        // book's. Comparing them directly ignored `rect.top`, so on a book
        // centred in a taller host every upper-half swipe was classified
        // BOTTOM. `Flip.start` converts first — this call site was the odd one
        // out. (`>=` matches `Flip.start`'s split exactly.)
        const render = this.app.getRender();
        const bookPos = render.convertToBook(this.touchPoint.point);
        const corner =
          bookPos.y >= render.getRect().height / 2 ? FlipCorner.BOTTOM : FlipCorner.TOP;

        if (this.swipeDirection(dx) === 'prev') {
          this.app.flipPrev(corner);
        } else {
          this.app.flipNext(corner);
        }
        isSwipe = true;
      }

      this.touchPoint = null;
    }

    this.app.userStop(pos, isSwipe);
  };

  /**
   * U2. The OS took the pointer away — a system back-swipe, a browser gesture
   * takeover, palm rejection, the pointer's device being removed.
   *
   * This was bound to `onPointerUp`, which runs the swipe branch: a fast
   * cancelled drag met the distance / time thresholds and COMMITTED the turn
   * the user's gesture had just been aborted out of. A cancellation is the
   * platform telling us the gesture never happened; it must abandon, never
   * commit.
   *
   * It reuses `cancelGesture()` rather than growing a second cancel path: the
   * semantics wanted here are exactly the ones that path already implements —
   * release the capture, unwind `PageFlip.isUserTouch` without committing a
   * click-turn or a snap-back, drop the fold, repaint the spread. The only
   * things that differ are entry conditions, and those belong at the handler:
   * a cancel from a pointer that never owned the gesture must not end it, and a
   * cancelled *hover* has no gesture to abandon but may have left a corner
   * folded up.
   */
  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.isActivePointer(e)) return;

    if (this.activePointerId === null && this.touchPoint === null) {
      this.unfoldHoverCorner();
      return;
    }

    this.cancelGesture();
  };
}
