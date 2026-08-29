/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CanvasRender } from '../Render/CanvasRender';
import type { PageDensity } from './Page';
import { Page, PageOrientation } from './Page';
import type { Render } from '../Render/Render';
import type { Point } from '../BasicTypes';
import { foldFill } from '../Render/pageBackground';

/**
 * Class representing a book page as an image on Canvas
 */
export class ImagePage extends Page {
  private readonly image: HTMLImageElement;
  private isLoad = false;

  private loadingAngle = 0;

  constructor(render: Render, href: string, density: PageDensity) {
    super(render, density);

    this.image = new Image();
    this.image.src = href;
  }

  public draw(_tempDensity?: PageDensity): void {
    const ctx = (this.render as CanvasRender).getContext();

    const pagePos = this.render.convertPointToGlobal(this.state.position);
    const pageWidth = this.render.getRect().pageWidth;
    const pageHeight = this.render.getRect().height;

    ctx.save();
    ctx.translate(pagePos.x, pagePos.y);
    ctx.beginPath();

    for (const p of this.state.area) {
      if (p !== null) {
        const globalPoint = this.render.convertPointToGlobal(p);
        ctx.lineTo(globalPoint.x - pagePos.x, globalPoint.y - pagePos.y);
      }
    }

    ctx.rotate(this.state.angle);

    ctx.clip();

    // The turning leaf is paper before it is art. Without this the bitmap is
    // painted straight onto the already-drawn page beneath, so a transparent
    // PNG reads through the fold — the §4.2 bug `pageBackground` exists to
    // prevent, which was fixed for HTML and missed here.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    if (!this.isLoad) {
      this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
    } else {
      ctx.drawImage(this.image, 0, 0, pageWidth, pageHeight);
    }

    ctx.restore();
  }

  public simpleDraw(orient: PageOrientation): void {
    const rect = this.render.getRect();
    const ctx = (this.render as CanvasRender).getContext();

    const pageWidth = rect.pageWidth;
    const pageHeight = rect.height;

    const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

    const y = rect.top;

    // Static leaves are opaque paper too — same reason as `draw()`.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.fillRect(x, y, pageWidth, pageHeight);

    if (!this.isLoad) {
      this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
    } else {
      ctx.drawImage(this.image, x, y, pageWidth, pageHeight);
    }
  }

  private drawLoader(
    ctx: CanvasRenderingContext2D,
    shiftPos: Point,
    pageWidth: number,
    pageHeight: number,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(200, 200, 200)';
    // Was hardcoded white, which flashed over a custom `pageBackground` for as
    // long as the image took to arrive.
    ctx.fillStyle = foldFill(this.render.getSettings().pageBackground);
    ctx.lineWidth = 1;
    ctx.rect(shiftPos.x + 1, shiftPos.y + 1, pageWidth - 1, pageHeight - 1);
    ctx.stroke();
    ctx.fill();

    const middlePoint: Point = {
      x: shiftPos.x + pageWidth / 2,
      y: shiftPos.y + pageHeight / 2,
    };

    ctx.beginPath();
    ctx.lineWidth = 10;
    ctx.arc(
      middlePoint.x,
      middlePoint.y,
      20,
      this.loadingAngle,
      (3 * Math.PI) / 2 + this.loadingAngle,
    );
    ctx.stroke();
    ctx.closePath();

    this.loadingAngle += 0.07;
    if (this.loadingAngle >= 2 * Math.PI) {
      this.loadingAngle = 0;
    }
  }

  public load(): void {
    if (!this.isLoad)
      this.image.onload = (): void => {
        this.isLoad = true;
      };
  }

  public newTemporaryCopy(): Page {
    return this;
  }

  public getTemporaryCopy(): Page | null {
    // An image page has no temporary copy: `newTemporaryCopy()` returns `this`.
    // Returning `this` here handed a null-checking caller a truthy non-copy.
    // (A1 will give canvas a real mover; until then, honest is null.)
    return null;
  }

  public hideTemporaryCopy(): void {
    return;
  }
}
