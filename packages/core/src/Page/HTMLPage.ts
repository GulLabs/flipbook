/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Page, PageDensity, PageOrientation } from './Page';
import type { Render } from '../Render/Render';
import { rotatePoint } from '../Helper';
import { FlipDirection } from '../Flip/Flip';
import type { Point } from '../BasicTypes';
import { foldFill } from '../Render/pageBackground';

/**
 * Class representing a book page as a HTML Element
 */
export class HTMLPage extends Page {
  private readonly element: HTMLElement;
  private copiedElement: HTMLElement | null = null;

  private temporaryCopy: Page | null = null;

  private isLoad = false;

  constructor(render: Render, element: HTMLElement, density: PageDensity) {
    super(render, density);

    this.element = element;
    this.element.classList.add('stf__item');
    this.element.classList.add(`--${density}`);
  }

  public newTemporaryCopy(): Page {
    if (this.nowDrawingDensity === PageDensity.HARD) {
      return this;
    }

    if (this.temporaryCopy === null) {
      this.copiedElement = this.element.cloneNode(true) as HTMLElement;
      this.copiedElement.style.backgroundColor = foldFill(this.render.getSettings().pageBackground);
      this.element.parentElement?.appendChild(this.copiedElement);

      this.temporaryCopy = new HTMLPage(this.render, this.copiedElement, this.nowDrawingDensity);
    }

    return this.temporaryCopy;
  }

  public getTemporaryCopy(): Page | null {
    return this.temporaryCopy;
  }

  public hideTemporaryCopy(): void {
    if (this.temporaryCopy !== null) {
      this.copiedElement?.remove();
      this.copiedElement = null;
      this.temporaryCopy = null;
    }
  }

  public draw(tempDensity?: PageDensity): void {
    const density = tempDensity ?? this.nowDrawingDensity;

    const pagePos = this.render.convertToGlobal(this.state.position) ?? { x: 0, y: 0 };
    const pageWidth = this.render.getRect().pageWidth;
    const pageHeight = this.render.getRect().height;

    this.element.classList.remove('--simple');

    const commonStyle = `display:block;z-index:${this.element.style.zIndex};left:0;top:0;width:${pageWidth}px;height:${pageHeight}px;background-color:${foldFill(this.render.getSettings().pageBackground)};`;

    if (density === PageDensity.HARD) {
      this.drawHard(commonStyle);
    } else {
      this.drawSoft(pagePos, commonStyle);
    }
  }

  private drawHard(commonStyle = ''): void {
    const rect = this.render.getRect();

    // The spine in block coordinates. The element itself is laid out at
    // left:0 with width = pageWidth, so every hard page has to be translated
    // into place and rotated about the spine.
    //
    // `transform-origin` is expressed in the element's own (untranslated) box
    // and travels with the translation, so the rotation axis ends up at
    //   translateX + originX
    // and that sum has to equal the spine for both orientations:
    //   RIGHT: origin 0            → translateX = spine
    //   LEFT:  origin pageWidth    → translateX = spine - pageWidth
    // which also puts the left page's right edge exactly on the spine.
    //
    // Upstream anchored LEFT at origin `pageWidth` with no translation, i.e.
    // an axis at block-local pageWidth. That equals the spine only when
    // rect.left === 0 (a book filling its block); with `size: 'stretch'` +
    // maxWidth, rect.left is routinely non-zero and the cover rotated about
    // the wrong axis and drew in the wrong place.
    const spine = rect.left + rect.width / 2;

    // H6, the vertical half of the same bug. `commonStyle` pins the element at
    // `top:0` in the block, but the book is centred in the block:
    // `rect.top = blockHeight / 2 - pageHeight / 2`. Soft pages pick that up —
    // `convertPageToGlobal` adds `rect.top` to y, and `simpleDraw` writes
    // `top:${rect.top}` — so a hard page translated by y = 0 sits `rect.top`
    // pixels ABOVE every other leaf. With `size: 'stretch'` (or any fixed book
    // in a taller host) that is a visible jump the instant the cover starts
    // turning. Translate by `rect.top` so the hard element's box coincides with
    // the soft one; the rotation is about Y, so the origin's y component is
    // irrelevant to the axis and stays 0.
    const top = rect.top;

    const angle = this.state.hardDrawingAngle;

    const transform =
      this.orientation === PageOrientation.LEFT
        ? `transform-origin:${rect.pageWidth}px 0;transform:translate3d(${spine - rect.pageWidth}px,${top}px,0) rotateY(${angle}deg);`
        : `transform-origin:0 0;transform:translate3d(${spine}px,${top}px,0) rotateY(${angle}deg);`;

    this.element.style.cssText =
      `${commonStyle}backface-visibility:hidden;-webkit-backface-visibility:hidden;` +
      `clip-path:none;-webkit-clip-path:none;${transform}`;
  }

  private drawSoft(position: Point, commonStyle = ''): void {
    let polygon = 'polygon( ';
    for (const p of this.state.area) {
      if (p !== null) {
        let g =
          this.render.getDirection() === FlipDirection.BACK
            ? {
                x: -p.x + this.state.position.x,
                y: p.y - this.state.position.y,
              }
            : {
                x: p.x - this.state.position.x,
                y: p.y - this.state.position.y,
              };

        g = rotatePoint(g, { x: 0, y: 0 }, this.state.angle);
        polygon += `${g.x}px ${g.y}px, `;
      }
    }
    polygon = polygon.slice(0, -2);
    polygon += ')';

    // Safari drops the clip-path on a 3d-transformed element at angle 0.
    // https://bugs.webkit.org/show_bug.cgi?id=126207
    // Safari drops clip-path on a 3d-transformed element at angle 0 (webkit#126207).
    const transform =
      this.render.isSafari() && this.state.angle === 0
        ? `transform:translate(${position.x}px,${position.y}px);`
        : `transform:translate3d(${position.x}px,${position.y}px,0) rotate(${this.state.angle}rad);`;

    this.element.style.cssText = `${commonStyle}transform-origin:0 0;clip-path:${polygon};-webkit-clip-path:${polygon};${transform}`;
  }

  public simpleDraw(orient: PageOrientation): void {
    const rect = this.render.getRect();
    const pageWidth = rect.pageWidth;
    const pageHeight = rect.height;
    const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;
    const y = rect.top;

    this.element.classList.add('--simple');
    // Static pages are opaque too: a transparent leaf lets the page under
    // the fold read through at the start / end of a turn.
    this.element.style.cssText =
      `position:absolute;display:block;height:${pageHeight}px;left:${x}px;top:${y}px;` +
      `width:${pageWidth}px;background-color:${foldFill(this.render.getSettings().pageBackground)};` +
      `z-index:${this.render.getSettings().startZIndex + 1};`;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public load(): void {
    this.isLoad = true;
  }

  public setOrientation(orientation: PageOrientation): void {
    super.setOrientation(orientation);
    this.element.classList.remove('--left', '--right');

    this.element.classList.add(orientation === PageOrientation.RIGHT ? '--right' : '--left');
  }

  public setDrawingDensity(density: PageDensity): void {
    this.element.classList.remove('--soft', '--hard');
    this.element.classList.add(`--${density}`);

    super.setDrawingDensity(density);
  }
}
