/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Page, PageDensity, PageOrientation } from './Page';
import type { Render } from '../Render/Render';
import { rotatePoint } from '../Helper';
import { FlipDirection } from '../Flip/Flip';
import type { Point } from '../BasicTypes';
import { foldFill } from '../Render/pageBackground';
import { PageFlipError } from '../errors';

/**
 * Every CSS property the engine writes on a leaf. NF4.
 *
 * The draw paths used to assign `style.cssText` wholesale, which REPLACES the
 * element's entire inline style. Adopted leaves get a snapshot restored when
 * they are released, so a vanilla consumer never noticed — but React-portalled
 * leaves are never adopted, so a consumer's `style={{ borderRadius: 8 }}` on a
 * page element was destroyed on the first frame and every frame after, with
 * nothing to restore it and no way to work around it short of `!important`.
 *
 * Listing the engine's own properties is what makes a surgical write possible:
 * anything NOT on this list belongs to the consumer and is left alone. It must
 * stay in sync with the draw paths below — a property written but not listed
 * would never be cleared when a later frame stops writing it, and would stick.
 */
const ENGINE_STYLE_PROPS = [
  'position',
  'z-index',
  'left',
  'top',
  'width',
  'height',
  'background-color',
  'pointer-events',
  'transform',
  'transform-origin',
  'clip-path',
  '-webkit-clip-path',
  'backface-visibility',
  '-webkit-backface-visibility',
] as const;

/**
 * Apply the engine's declarations without disturbing the consumer's.
 *
 * Parses rather than taking an object because the draw paths compose their
 * declarations as strings and several are conditional; converting all three to
 * property maps would be a much larger change to the hot path for the same
 * result. The parse is ~15 declarations on at most four leaves per frame.
 */
function applyEngineStyle(element: HTMLElement, css: string): void {
  const next = new Map<string, string>();

  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;

    const property = declaration.slice(0, colon).trim();
    if (property !== '') next.set(property, declaration.slice(colon + 1).trim());
  }

  // Clear only what the engine itself may have written on an earlier frame.
  for (const property of ENGINE_STYLE_PROPS) {
    if (!next.has(property)) element.style.removeProperty(property);
  }

  for (const [property, value] of next) element.style.setProperty(property, value);
}

/**
 * Every class this renderer puts on a consumer's leaf element.
 *
 * Kept here, next to the code that adds them (`constructor`, `simpleDraw`,
 * `setOrientation`, `setDrawingDensity`), because the list only stays correct
 * if it lives beside the additions. `HTMLUI.clear()` reads it to hand the
 * nodes back undressed — see U1 there.
 */
export const ENGINE_LEAF_CLASSES = [
  'stf__item',
  '--soft',
  '--hard',
  '--left',
  '--right',
  '--simple',
  '--shown',
] as const;

/**
 * Class representing a book page as a HTML Element
 */
export class HTMLPage extends Page {
  private readonly element: HTMLElement;
  private copiedElement: HTMLElement | null = null;

  private temporaryCopy: Page | null = null;

  /**
   * True only for the throwaway leaf built by `newTemporaryCopy()`.
   *
   * `draw()` re-emits the engine's declarations every frame, so anything the
   * clone needs in its inline style has to be re-emitted too rather than set once
   * at clone time. Private, and set by `newTemporaryCopy` on the *other*
   * instance — legal because TypeScript's `private` is per-class, not
   * per-instance.
   */
  private isTemporaryCopy = false;

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
      // U8. This was `this.element.parentElement?.appendChild(...)` below. A
      // detached leaf (a React unmount racing a turn, a consumer removing a
      // page node) made the optional chain a silent no-op — and the copy was
      // still built, still returned, and still animated, so the turn ran to
      // completion against a node that is not in the document: no fold, no
      // error, and a `hideTemporaryCopy()` that "cleans up" something that was
      // never there. The optional chain turned a broken state into an invisible
      // one. There is no correct rendering for a detached leaf, so say so — and
      // say it before anything is cloned or assigned, so a caller that catches
      // this is not left with a half-built copy hanging off the page.
      const parent = this.element.parentElement;

      if (parent === null) {
        throw new PageFlipError(
          'Cannot flip a page whose element is not in the document',
          'DETACHED_PAGE',
        );
      }

      this.copiedElement = this.element.cloneNode(true) as HTMLElement;
      this.copiedElement.style.backgroundColor = foldFill(this.render.getSettings().pageBackground);

      // RB6. `cloneNode(true)` duplicates the CONSUMER's subtree into the live
      // document for the length of a turn: their ids, their ARIA, their test
      // ids, and — the part that actually hurts — their focusable controls. A
      // screen reader read the page twice and a Tab press could land inside a
      // decoration that is about to be deleted.
      //
      // The clone exists for one reason: to show the leaf's front face while
      // the original shows something else. It is pixels, nothing more, so it is
      // removed from the accessibility tree AND from the focus/interaction
      // model. `inert` is the platform's exact primitive for that pairing;
      // `aria-hidden` on its own would leave the worst of both worlds — content
      // a keyboard can reach but a screen reader cannot describe.
      //
      // What is deliberately NOT done: the ids are left alone. The clone has to
      // LOOK identical, and `#id` selectors are a normal way for a consumer to
      // style a page; stripping ids would silently restyle the fold. The
      // duplicates are harmless here because both `getElementById` and IDREF
      // resolution (`for`, `aria-labelledby`) take the FIRST match in tree
      // order, and the clone is appended after the original — so every lookup
      // still resolves to the real page. `data-stf-clone` is the marker to
      // filter on when a duplicate would otherwise be ambiguous (a strict-mode
      // `getByTestId`, say).
      this.copiedElement.style.pointerEvents = 'none';
      this.copiedElement.setAttribute('aria-hidden', 'true');
      this.copiedElement.setAttribute('inert', '');
      this.copiedElement.setAttribute('data-stf-clone', '');

      parent.appendChild(this.copiedElement);

      const copy = new HTMLPage(this.render, this.copiedElement, this.nowDrawingDensity);
      copy.isTemporaryCopy = true;

      this.temporaryCopy = copy;
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

    // The clone must not swallow input. `inert` already says so, but hit
    // testing is the half that matters to this engine: `UI.checkTarget` walks
    // up from `event.target`, so a cloned `<a>`/`<button>` under the finger
    // would suppress the drag (and, without `inert`, could be activated).
    // `pointer-events:none` lets the hit test fall through to the real leaf, so
    // a pointer landing on the fold still starts a turn. It is set once at
    // clone time (for the gap before the first frame) and re-emitted here,
    // because `draw()` replaces `cssText` wholesale on every frame — setting it
    // only at clone time would last exactly one frame.
    // X8. `draw()` replaces `cssText` wholesale, so the z-index `HTMLRender`
    // stamped on this element moments ago has to be re-emitted or the wipe
    // would drop it. But a leaf that has NO inline z-index reads back `''`, and
    // interpolating that produced the literal declaration `z-index:;` — invalid
    // CSS, written on every frame of every draw. The CSSOM discards exactly
    // that declaration and keeps the rest, so it costs nothing today; it is
    // still a malformed token emitted 60×/second, and "the parser throws it
    // away for us" is not a property worth depending on. Omit the declaration
    // when there is no value, rather than emitting an empty one.
    const zIndex = this.element.style.zIndex;
    const zIndexStyle = zIndex === '' ? '' : `z-index:${zIndex};`;

    // Y4. `position:absolute` is stated INLINE, exactly as `simpleDraw` does.
    // It used to be left to `.stf__item{position:absolute}` in the injected
    // stylesheet, so a drawn leaf's positioning was the only part of its layout
    // a consumer rule could take away: `#book .page{position:relative}` — an
    // ordinary rule, and more specific than a single class — un-positioned the
    // FLIPPING leaf while the static ones, which state it inline, stayed put.
    // The fold dropped out of the book mid-turn.
    //
    // Inline rather than a more specific selector in `styles.ts`: the stylesheet
    // ships as `@gullabs/flipbook-core/style.css`, so its selectors are public
    // surface and changing them is a consumer-visible change (§5) — and it would
    // only move the arms race, since any id selector out-specifies any chain of
    // classes. An inline declaration beats every author rule short of
    // `!important`, and `cssText` is not public surface. It also makes the two
    // draw paths agree, which is what made this asymmetry survivable.
    const commonStyle = `position:absolute;${zIndexStyle}left:0;top:0;width:${pageWidth}px;height:${pageHeight}px;background-color:${foldFill(this.render.getSettings().pageBackground)};${this.isTemporaryCopy ? 'pointer-events:none;' : ''}`;

    this.element.classList.add('--shown');

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

    applyEngineStyle(
      this.element,
      `${commonStyle}backface-visibility:hidden;-webkit-backface-visibility:hidden;` +
        `clip-path:none;-webkit-clip-path:none;${transform}`,
    );
  }

  private drawSoft(position: Point, commonStyle = ''): void {
    const vertices: string[] = [];

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
        vertices.push(`${g.x}px ${g.y}px`);
      }
    }

    // U7. The polygon used to be built by appending `"x y, "` and then
    // `slice(0, -2)`. With no non-null points in `state.area` that leaves the
    // literal string `polygon)` — invalid CSS, which the browser DROPS. A
    // dropped `clip-path` is not "no fold": it is NO CLIP, so the flipping leaf
    // paints as a full opaque rectangle across the spread for that frame. That
    // is the worst available outcome, and it is the one with no guard.
    //
    // Fewer than three vertices cannot enclose any area, so the correct
    // rendering of such a frame is nothing at all. The two alternatives were
    // rejected: falling back to the page rect is the bug restated, and keeping
    // the previous frame's clip leaves a fold hanging in a shape the state no
    // longer describes (and needs per-page history to do it). A valid,
    // zero-area polygon says exactly what is true — this leaf covers nothing
    // this frame — with no state and no chance of the browser dropping it.
    const polygon =
      vertices.length >= 3
        ? `polygon( ${vertices.join(', ')})`
        : 'polygon(0px 0px, 0px 0px, 0px 0px)';

    // Safari drops the clip-path on a 3d-transformed element at angle 0.
    // https://bugs.webkit.org/show_bug.cgi?id=126207
    // Safari drops clip-path on a 3d-transformed element at angle 0 (webkit#126207).
    const transform =
      this.render.isSafari() && this.state.angle === 0
        ? `transform:translate(${position.x}px,${position.y}px);`
        : `transform:translate3d(${position.x}px,${position.y}px,0) rotate(${this.state.angle}rad);`;

    applyEngineStyle(
      this.element,
      `${commonStyle}transform-origin:0 0;clip-path:${polygon};-webkit-clip-path:${polygon};${transform}`,
    );
  }

  public simpleDraw(orient: PageOrientation): void {
    const rect = this.render.getRect();
    const pageWidth = rect.pageWidth;
    const pageHeight = rect.height;
    const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;
    const y = rect.top;

    this.element.classList.add('--simple');
    this.element.classList.add('--shown');
    // Static pages are opaque too: a transparent leaf lets the page under
    // the fold read through at the start / end of a turn.
    applyEngineStyle(
      this.element,
      `position:absolute;height:${pageHeight}px;left:${x}px;top:${y}px;` +
        `width:${pageWidth}px;background-color:${foldFill(this.render.getSettings().pageBackground)};` +
        `z-index:${this.render.getSettings().startZIndex + 1};`,
    );
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  /**
   * H7. Nothing to do: an HTML leaf is its element, and the element exists
   * before the page does. `ImagePage.load()` decodes a bitmap and its `isLoad`
   * genuinely gates drawing; this class carried a field of the same name that
   * was written here and read nowhere, which reads like a gate and is not one.
   * The method stays because `Page.load()` is abstract and the collections call
   * it; the field is gone.
   */
  public load(): void {
    //
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

  /**
   * NF1. The class follows the density, and it only did for ONE of the two
   * setters.
   *
   * `setDrawingDensity` above syncs it; `setDensity` — which writes the page's
   * PERMANENT density and is what `PageCollection.createSpread` calls to make a
   * cover hard — did not. So an engine-inferred cover ended up
   * `getDensity() === 'hard'` while its element still read
   * `class="stf__item --soft"`. Consumer CSS written against `.stf__item.--hard`
   * therefore never matched a cover, and `--soft` matched a leaf the engine
   * draws through `drawHard` — the class asserted the opposite of the truth.
   *
   * Safe to overwrite, because this class is engine OUTPUT and not input: the
   * density a consumer DECLARES is `data-density="hard"`, which
   * `HTMLPageCollection.load` reads, and nothing anywhere reads `--hard` back.
   * A consumer who styles against it is reading a value the engine publishes,
   * so publishing the true one is the fix rather than the risk.
   *
   * It is also only safe to do now. Until `updateFromHtml` was reordered to
   * adopt before loading (NF2), `HTMLUI.adopt` snapshotted its "pre-existing
   * engine classes" AFTER the engine had already stamped them — so a class
   * written here would have been recorded as the consumer's and left behind on
   * their element forever.
   */
  public setDensity(density: PageDensity): void {
    super.setDensity(density);

    this.element.classList.remove('--soft', '--hard');
    this.element.classList.add(`--${density}`);
  }
}
