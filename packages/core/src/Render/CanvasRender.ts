import { Orientation, Render, type Shadow } from './Render';
import type { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { PageOrientation } from '../Page/Page';
import type { FlipSetting } from '../Settings';

/**
 * Class responsible for rendering the Canvas book
 */
export class CanvasRender extends Render {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(app: PageFlip, setting: FlipSetting, inCanvas: HTMLCanvasElement) {
    super(app, setting);

    this.canvas = inCanvas;
    const ctx = inCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available');
    }
    this.ctx = ctx;
  }

  public getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  public reload(): void {
    //
  }

  protected drawFrame(): void {
    this.clear();

    if (this.orientation !== Orientation.PORTRAIT)
      if (this.leftPage != null) this.leftPage.simpleDraw(PageOrientation.LEFT);

    if (this.rightPage != null) this.rightPage.simpleDraw(PageOrientation.RIGHT);

    if (this.bottomPage != null) this.bottomPage.draw();

    this.drawBookShadow();

    if (this.flippingPage != null) this.flippingPage.draw();

    const shadow = this.shadow;

    if (shadow !== null) {
      this.drawOuterShadow(shadow);
      this.drawInnerShadow(shadow);
    }

    const rect = this.getRect();

    if (this.orientation === Orientation.PORTRAIT) {
      this.ctx.beginPath();
      this.ctx.rect(rect.left + rect.pageWidth, rect.top, rect.width, rect.height);
      this.ctx.clip();
    }
  }

  private drawBookShadow(): void {
    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    const shadowSize = rect.width / 20;
    this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

    const shadowPos = { x: rect.left + rect.width / 2 - shadowSize / 2, y: 0 };
    this.ctx.translate(shadowPos.x, shadowPos.y);

    const outerGradient = this.ctx.createLinearGradient(0, 0, shadowSize, 0);

    outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    outerGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.2)');
    outerGradient.addColorStop(0.49, 'rgba(0, 0, 0, 0.1)');
    outerGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    outerGradient.addColorStop(0.51, 'rgba(0, 0, 0, 0.4)');
    outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.clip();

    this.ctx.fillStyle = outerGradient;
    this.ctx.fillRect(0, 0, shadowSize, rect.height * 2);

    this.ctx.restore();
  }

  private drawOuterShadow(shadow: Shadow): void {
    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

    const shadowPos = this.convertPointToGlobal({ x: shadow.pos.x, y: shadow.pos.y });
    this.ctx.translate(shadowPos.x, shadowPos.y);

    this.ctx.rotate(Math.PI + shadow.angle + Math.PI / 2);

    const outerGradient = this.ctx.createLinearGradient(0, 0, shadow.width, 0);

    if (shadow.direction === FlipDirection.FORWARD) {
      this.ctx.translate(0, -100);
      outerGradient.addColorStop(0, `rgba(0, 0, 0, ${shadow.opacity})`);
      outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      this.ctx.translate(-shadow.width, -100);
      outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      outerGradient.addColorStop(1, `rgba(0, 0, 0, ${shadow.opacity})`);
    }

    this.ctx.clip();

    this.ctx.fillStyle = outerGradient;
    this.ctx.fillRect(0, 0, shadow.width, rect.height * 2);

    this.ctx.restore();
  }

  private drawInnerShadow(shadow: Shadow): void {
    const pageRect = this.pageRect;
    if (pageRect === null) return;

    const rect = this.getRect();

    this.ctx.save();
    this.ctx.beginPath();

    const shadowPos = this.convertPointToGlobal({ x: shadow.pos.x, y: shadow.pos.y });

    const globalPageRect = this.convertRectToGlobal(pageRect);
    this.ctx.moveTo(globalPageRect.topLeft.x, globalPageRect.topLeft.y);
    this.ctx.lineTo(globalPageRect.topRight.x, globalPageRect.topRight.y);
    this.ctx.lineTo(globalPageRect.bottomRight.x, globalPageRect.bottomRight.y);
    this.ctx.lineTo(globalPageRect.bottomLeft.x, globalPageRect.bottomLeft.y);
    this.ctx.translate(shadowPos.x, shadowPos.y);

    this.ctx.rotate(Math.PI + shadow.angle + Math.PI / 2);

    const isw = (shadow.width * 3) / 4;
    const innerGradient = this.ctx.createLinearGradient(0, 0, isw, 0);

    if (shadow.direction === FlipDirection.FORWARD) {
      this.ctx.translate(-isw, -100);

      innerGradient.addColorStop(1, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0.9, 'rgba(0, 0, 0, 0.05)');
      innerGradient.addColorStop(0.7, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    } else {
      this.ctx.translate(0, -100);

      innerGradient.addColorStop(0, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(0.1, 'rgba(0, 0, 0, 0.05)');
      innerGradient.addColorStop(0.3, `rgba(0, 0, 0, ${shadow.opacity})`);
      innerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }

    this.ctx.clip();

    this.ctx.fillStyle = innerGradient;
    this.ctx.fillRect(0, 0, isw, rect.height * 2);

    this.ctx.restore();
  }

  private clear(): void {
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
