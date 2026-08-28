import { PageFlip } from '../PageFlip';
import { Point } from '../BasicTypes';
import { FlipSetting, SizeType } from '../Settings';
import { FlipCorner, FlippingState } from '../Flip/Flip';
import { Orientation } from '../Render/Render';
import { ensureFlipbookStyles } from '../styles';

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
    private readonly swipeDistance: number;
    private resizeObserver: ResizeObserver | null = null;
    private handlersBound = false;

    private onResize = (): void => {
        this.update();
    };

    private onVisualViewportResize = (): void => {
        this.update();
    };

    protected constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
        ensureFlipbookStyles();

        this.parentElement = inBlock;

        inBlock.classList.add('stf__parent');
        inBlock.insertAdjacentHTML('afterbegin', '<div class="stf__wrapper"></div>');

        this.wrapper = inBlock.querySelector('.stf__wrapper') as HTMLElement;

        this.app = app;

        const k = this.app.getSettings().usePortrait ? 1 : 2;

        inBlock.style.minWidth = setting.minWidth * k + 'px';
        inBlock.style.minHeight = setting.minHeight + 'px';

        if (setting.size === SizeType.FIXED) {
            inBlock.style.minWidth = setting.width * k + 'px';
            inBlock.style.minHeight = setting.height + 'px';
        }

        if (setting.autoSize) {
            inBlock.style.width = '100%';
            inBlock.style.maxWidth = setting.maxWidth * 2 + 'px';
        }

        inBlock.style.display = 'block';

        this.swipeDistance = setting.swipeDistance;
        this.observeResize();
    }

    public destroy(): void {
        this.removeHandlers();
        this.unobserveResize();
        this.distElement.remove();
        this.wrapper.remove();
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

        if (orientation === Orientation.PORTRAIT) {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / this.app.getSettings().width) * 100 + '%';

            this.wrapper.classList.add('--portrait');
        } else {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / (this.app.getSettings().width * 2)) * 100 +
                    '%';

            this.wrapper.classList.add('--landscape');
        }

        this.update();
    }

    protected removeHandlers(): void {
        if (!this.distElement) return;
        this.distElement.removeEventListener('pointerdown', this.onPointerDown);
        this.distElement.removeEventListener('pointermove', this.onPointerMove);
        this.distElement.removeEventListener('pointerup', this.onPointerUp);
        this.distElement.removeEventListener('pointercancel', this.onPointerUp);
        this.distElement.removeEventListener('pointerleave', this.onPointerLeave);
        this.handlersBound = false;
    }

    protected setHandlers(): void {
        if (!this.app.getSettings().useMouseEvents) return;
        if (!this.distElement) return;

        this.distElement.addEventListener('pointerdown', this.onPointerDown);
        this.distElement.addEventListener('pointermove', this.onPointerMove);
        this.distElement.addEventListener('pointerup', this.onPointerUp);
        this.distElement.addEventListener('pointercancel', this.onPointerUp);
        this.distElement.addEventListener('pointerleave', this.onPointerLeave);
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

    private getMousePos(x: number, y: number): Point {
        const rect = this.distElement.getBoundingClientRect();

        return {
            x: x - rect.left,
            y: y - rect.top,
        };
    }

    private checkTarget(targer: EventTarget | null): boolean {
        if (!this.app.getSettings().clickEventForward) return true;
        if (!targer || !('tagName' in targer)) return true;

        if (['a', 'button'].includes((targer as HTMLElement).tagName.toLowerCase())) {
            return false;
        }

        return true;
    }

    private swipeDirection(dx: number): 'prev' | 'next' {
        const rtl = this.app.getSettings().direction === 'rtl';
        if (dx > 0) {
            return rtl ? 'next' : 'prev';
        }
        return rtl ? 'prev' : 'next';
    }

    private onPointerLeave = (): void => {
        this.touchPoint = null;
        const flip = this.app.getFlipController();
        if (flip && flip.getState() === FlippingState.FOLD_CORNER) {
            this.app.getRender().finishAnimation();
            flip.stopMove();
        }
    };

    private onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (!this.checkTarget(e.target)) return;


        const pos = this.getMousePos(e.clientX, e.clientY);

        try {
            this.distElement.setPointerCapture(e.pointerId);
        } catch {
            // capture is optional
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
        const pos = this.getMousePos(e.clientX, e.clientY);
        let isSwipe = false;

        if (this.touchPoint !== null) {
            const dx = pos.x - this.touchPoint.point.x;
            const distY = Math.abs(pos.y - this.touchPoint.point.y);

            if (
                Math.abs(dx) > this.swipeDistance &&
                distY < this.swipeDistance * 2 &&
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
