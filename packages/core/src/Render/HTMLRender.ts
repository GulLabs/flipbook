import { Orientation, Render, type Shadow } from './Render';
import type { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { PageDensity, PageOrientation } from '../Page/Page';
import type { HTMLPage } from '../Page/HTMLPage';
import { Helper } from '../Helper';
import type { FlipSetting } from '../Settings';
import { shouldDrawBottomPage } from './bottomPage';
import { PageFlipError } from '../errors';

/**
 * Class responsible for rendering the HTML book
 */
export class HTMLRender extends Render {
    /** Parent HTML Element */
    private readonly element: HTMLElement;

    private outerShadow!: HTMLElement;
    private innerShadow!: HTMLElement;
    private hardShadow!: HTMLElement;
    private hardInnerShadow!: HTMLElement;

    /**
     * @constructor
     *
     * @param {PageFlip} app - PageFlip object
     * @param {FlipSetting} setting - Configuration object
     * @param {HTMLElement} element - Parent HTML Element
     */
    constructor(app: PageFlip, setting: FlipSetting, element: HTMLElement) {
        super(app, setting);

        this.element = element;

        this.createShadows();
    }

    private createShadows(): void {
        this.element.insertAdjacentHTML(
            'beforeend',
            `<div class="stf__outerShadow"></div>
             <div class="stf__innerShadow"></div>
             <div class="stf__hardShadow"></div>
             <div class="stf__hardInnerShadow"></div>`
        );

        const outer = this.element.querySelector<HTMLElement>('.stf__outerShadow');
        const inner = this.element.querySelector<HTMLElement>('.stf__innerShadow');
        const hard = this.element.querySelector<HTMLElement>('.stf__hardShadow');
        const hardInner = this.element.querySelector<HTMLElement>('.stf__hardInnerShadow');

        if (!outer || !inner || !hard || !hardInner) {
            throw new PageFlipError('Failed to create flipbook shadow elements', 'RENDER_SETUP');
        }

        this.outerShadow = outer;
        this.innerShadow = inner;
        this.hardShadow = hard;
        this.hardInnerShadow = hardInner;
    }

    public clearShadow(): void {
        super.clearShadow();

        this.outerShadow.style.cssText = 'display: none';
        this.innerShadow.style.cssText = 'display: none';
        this.hardShadow.style.cssText = 'display: none';
        this.hardInnerShadow.style.cssText = 'display: none';
    }

    public reload(): void {
        const testShadow = this.element.querySelector('.stf__outerShadow');

        if (!testShadow) {
            this.createShadows();
        }
    }

    /**
     * Draw inner shadow to the hard page
     */
    private drawHardInnerShadow(shadow: Shadow): void {
        const rect = this.getRect();

        const progress = shadow.progress > 100 ? 200 - shadow.progress : shadow.progress;

        let innerShadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (innerShadowSize > rect.pageWidth) innerShadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 5).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to right,
                rgba(0, 0, 0, ${(shadow.opacity * progress) / 100}) 5%,
                rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0);`
                : `transform: translate3d(0, 0, 0) rotateY(180deg);`;

        this.hardInnerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the hard page
     */
    private drawHardOuterShadow(shadow: Shadow): void {
        const rect = this.getRect();

        const progress = shadow.progress > 100 ? 200 - shadow.progress : shadow.progress;

        let shadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (shadowSize > rect.pageWidth) shadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 4).toString(10)};
            width: ${shadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to left, rgba(0, 0, 0, ${
                shadow.opacity
            }) 5%, rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0) rotateY(180deg);`
                : `transform: translate3d(0, 0, 0);`;

        this.hardShadow.style.cssText = newStyle;
    }

    /**
     * Draw inner shadow to the soft page
     */
    private drawInnerShadow(shadow: Shadow): void {
        const pageRect = this.pageRect;
        if (pageRect === null) return;

        const rect = this.getRect();

        const innerShadowSize = (shadow.width * 3) / 4;
        const shadowTranslate = this.getDirection() === FlipDirection.FORWARD ? innerShadowSize : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to left' : 'to right';

        const shadowPos = this.convertPointToGlobal(shadow.pos);

        const angle = shadow.angle + (3 * Math.PI) / 2;

        const clip = [
            pageRect.topLeft,
            pageRect.topRight,
            pageRect.bottomRight,
            pageRect.bottomLeft,
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            let g =
                this.getDirection() === FlipDirection.BACK
                    ? {
                          x: -p.x + shadow.pos.x,
                          y: p.y - shadow.pos.y,
                      }
                    : {
                          x: p.x - shadow.pos.x,
                          y: p.y - shadow.pos.y,
                      };

            g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

            polygon += `${g.x  }px ${  g.y  }px, `;
        }
        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection},
                rgba(0, 0, 0, ${shadow.opacity}) 5%,
                rgba(0, 0, 0, 0.05) 15%,
                rgba(0, 0, 0, ${shadow.opacity}) 35%,
                rgba(0, 0, 0, 0) 100%);
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.innerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the soft page
     */
    private drawOuterShadow(shadow: Shadow): void {
        const rect = this.getRect();

        const shadowPos = this.convertPointToGlobal({ x: shadow.pos.x, y: shadow.pos.y });

        const angle = shadow.angle + (3 * Math.PI) / 2;
        const shadowTranslate = this.getDirection() === FlipDirection.BACK ? shadow.width : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to right' : 'to left';

        const clip = [
            { x: 0, y: 0 },
            { x: rect.pageWidth, y: 0 },
            { x: rect.pageWidth, y: rect.height },
            { x: 0, y: rect.height },
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            let g =
                this.getDirection() === FlipDirection.BACK
                    ? {
                          x: -p.x + shadow.pos.x,
                          y: p.y - shadow.pos.y,
                      }
                    : {
                          x: p.x - shadow.pos.x,
                          y: p.y - shadow.pos.y,
                      };

            g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

            polygon += `${g.x  }px ${  g.y  }px, `;
        }

        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${shadow.width}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection}, rgba(0, 0, 0, ${
            shadow.opacity
        }), rgba(0, 0, 0, 0));
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.outerShadow.style.cssText = newStyle;
    }

    /**
     * Draw left static page
     */
    private drawLeftPage(): void {
        if (this.orientation === Orientation.PORTRAIT || this.leftPage === null) return;

        if (
            this.direction === FlipDirection.BACK &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.leftPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.leftPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.leftPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.leftPage.simpleDraw(PageOrientation.LEFT);
        }
    }

    /**
     * Draw right static page
     */
    private drawRightPage(): void {
        if (this.rightPage === null) return;

        if (
            this.direction === FlipDirection.FORWARD &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.rightPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.rightPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.rightPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.rightPage.simpleDraw(PageOrientation.RIGHT);
        }
    }

    /**
     * Draw the next page at the time of flipping.
     * Skip only when the mover is the bottom page (hard-cover), never on
     * portrait BACK as a direction — that skip is the duplicate-current-page bug.
     */
    public drawBottomPage(): void {
        const bottomPage = this.bottomPage;

        if (bottomPage === null) return;
        if (!shouldDrawBottomPage(this.flippingPage, bottomPage)) return;

        const tempDensity =
            this.flippingPage !== null ? this.flippingPage.getDrawingDensity() : undefined;

        (bottomPage as HTMLPage).getElement().style.zIndex = (
            this.getSettings().startZIndex + 3
        ).toString(10);

        bottomPage.draw(tempDensity);
    }

    protected drawFrame(): void {
        this.clear();

        this.drawLeftPage();

        this.drawRightPage();

        this.drawBottomPage();

        const flippingPage = this.flippingPage;

        if (flippingPage !== null) {
            (flippingPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            flippingPage.draw();
        }

        const shadow = this.shadow;

        if (shadow !== null && flippingPage !== null) {
            if (flippingPage.getDrawingDensity() === PageDensity.SOFT) {
                this.drawOuterShadow(shadow);
                this.drawInnerShadow(shadow);
            } else {
                this.drawHardOuterShadow(shadow);
                this.drawHardInnerShadow(shadow);
            }
        }
    }

    private clear(): void {
        for (const page of this.app.getPageCollection().getPages()) {
            if (
                page !== this.leftPage &&
                page !== this.rightPage &&
                page !== this.flippingPage &&
                page !== this.bottomPage
            ) {
                (page as HTMLPage).getElement().style.cssText = 'display: none';
            }

            if (page.getTemporaryCopy() !== this.flippingPage) {
                page.hideTemporaryCopy();
            }
        }
    }

    public update(): void {
        super.update();

        if (this.rightPage !== null) {
            this.rightPage.setOrientation(PageOrientation.RIGHT);
        }

        if (this.leftPage !== null) {
            this.leftPage.setOrientation(PageOrientation.LEFT);
        }
    }
}
