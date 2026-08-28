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
  private handlersBound = false;
  /** Active pointer id, so `pointerleave` after `pointerup` is ignored. */
  private activePointerId: number | null = null;
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
    } else {
      // Hand back what `autoSize` had taken over, or turning it off would
      // leave the host stretched to 100% with a stale max-width.
      host.style.width = this.hostStyles.width;
      host.style.maxWidth = this.hostStyles.maxWidth;
    }

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

  /** Book orientation, or `null` before a render exists. */
  private currentOrientation(): Orientation | null {
    try {
      return this.app.getRender().getOrientation();
    } catch {
      return null;
    }
  }

  public destroy(): void {
    this.removeHandlers();
    this.unobserveResize();

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
    this.releaseCapturedPointer();

    this.distElement.removeEventListener('pointerdown', this.onPointerDown);
    this.distElement.removeEventListener('pointermove', this.onPointerMove);
    this.distElement.removeEventListener('pointerup', this.onPointerUp);
    this.distElement.removeEventListener('pointercancel', this.onPointerUp);
    this.distElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.distElement.removeEventListener('dragstart', this.onDragStart);
    this.handlersBound = false;
  }

  protected setHandlers(): void {
    if (!this.app.getSettings().useMouseEvents) return;

    this.distElement.addEventListener('pointerdown', this.onPointerDown);
    this.distElement.addEventListener('pointermove', this.onPointerMove);
    this.distElement.addEventListener('pointerup', this.onPointerUp);
    this.distElement.addEventListener('pointercancel', this.onPointerUp);
    this.distElement.addEventListener('pointerleave', this.onPointerLeave);
    this.distElement.addEventListener('dragstart', this.onDragStart);
    this.handlersBound = true;
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
   */
  private getMousePos(x: number, y: number): Point {
    const rect = this.distElement.getBoundingClientRect();

    return {
      x: x - rect.left,
      y: y - rect.top,
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
   * Pointer left the book without a release — put the hover corner back.
   *
   * Skipped while a pointer is down: under pointer capture `pointerleave` also
   * fires straight after `pointerup` (always so for touch), and re-entering
   * `stopMove()` there starts a second snap-back over the one `userStop` began.
   */
  private onPointerLeave = (): void => {
    if (this.activePointerId !== null) return;

    this.touchPoint = null;

    const flip = this.app.getFlipController();

    if (flip?.getState() === FlippingState.FOLD_CORNER) {
      this.app.getRender().finishAnimation();
      flip.stopMove();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!this.checkTarget(e.target)) return;

    const pos = this.getMousePos(e.clientX, e.clientY);

    this.activePointerId = e.pointerId;

    try {
      this.distElement.setPointerCapture(e.pointerId);
    } catch {
      // capture is optional; the id is still tracked for pointerleave
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
        const corner =
          this.touchPoint.point.y < this.app.getRender().getRect().height / 2
            ? FlipCorner.TOP
            : FlipCorner.BOTTOM;

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

  protected get handlersAreBound(): boolean {
    return this.handlersBound;
  }
}
