/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UI } from './UI';
import type { PageFlip } from '../PageFlip';
import type { FlipSetting } from '../Settings';
import { ENGINE_LEAF_CLASSES } from '../Page/HTMLPage';

/** What a leaf looked like before this UI adopted it. See `adopted`. */
type AdoptedLeaf = {
  /**
   * The leaf's own inline style, captured before any draw.
   *
   * `HTMLPage.draw` writes `style.cssText` WHOLESALE every frame, so by the
   * time a leaf is released the consumer's inline style is gone and cannot be
   * recovered by removing properties — the only way back is the copy taken
   * here.
   */
  cssText: string;
  /**
   * Engine class names the leaf ALREADY carried at adoption time.
   *
   * `--left` and `--right` are plausible names for a consumer to use, and this
   * engine adds them. Releasing must not strip a class the consumer brought
   * with them, so the ones already present are excluded from the removal.
   */
  preexistingEngineClasses: string[];
};

/**
 * UI for HTML mode
 */
export class HTMLUI extends UI {
  private items: NodeListOf<HTMLElement> | HTMLElement[];

  /**
   * Leaves this UI moved into `.stf__block` itself, and what they looked like
   * before it did.
   *
   * A leaf that was already inside the block belongs to whoever put it there —
   * React's portal renders its pages straight into it — and `clear()` must
   * leave those alone. Releasing them would move nodes out from under React's
   * recorded parent, and the next removal or reorder throws `NotFoundError`:
   * exactly the failure the portal exists to prevent.
   */
  private readonly adopted = new Map<HTMLElement, AdoptedLeaf>();

  constructor(
    inBlock: HTMLElement,
    app: PageFlip,
    setting: FlipSetting,
    items: NodeListOf<HTMLElement> | HTMLElement[],
  ) {
    super(inBlock, app, setting);

    // Second wrapper to HTML page
    this.wrapper.insertAdjacentHTML('afterbegin', '<div class="stf__block"></div>');

    const block = inBlock.querySelector('.stf__block');
    if (!block) {
      throw new Error('HTML block missing');
    }
    const dist = block as HTMLElement;
    this.distElement = dist;

    this.items = items;
    for (const item of items) {
      this.adopt(item);
    }

    this.setHandlers();
  }

  /**
   * Hand the adopted leaves back to the host, undressed.
   *
   * U1. Returning the nodes was only half of it: `HTMLPage` had stamped them
   * as engine leaves — `stf__item`, `--soft`/`--hard`, `--left`/`--right`,
   * `--simple`, plus an inline `position:absolute` / `clip-path` / `transform`
   * written wholesale by `draw`. A vanilla consumer who destroys the book and
   * re-renders their own markup got a stack of absolutely positioned,
   * clip-pathed pages piled on the origin.
   *
   * The engine restores what it changed and nothing else — the same contract
   * `UI` already honours for the HOST element's inline styles — but the two
   * halves are restored differently, deliberately:
   *
   * - **Inline style is restored wholesale** from the snapshot taken at
   *   adoption. `draw` replaces `cssText` on every frame, so a live leaf cannot
   *   be carrying a consumer inline style anyway; there is nothing to preserve
   *   and nothing to merge. Stripping "only the properties `draw` writes"
   *   would leave `simpleDraw`'s and `drawHard`'s different property sets to
   *   track separately, and would still not put back what `draw` destroyed.
   * - **Classes are removed selectively**, never restored wholesale. The engine
   *   only ever ADDS classes here, and a consumer may legitimately toggle their
   *   own on a live leaf (`.is-current`, an animation hook); resetting
   *   `className` to the adoption-time value would silently discard those. So
   *   exactly the engine's own class names come off — minus any the leaf
   *   already had when it was adopted.
   */
  public clear(): void {
    // Hand back only what we took. See `adopted`.
    for (const item of Array.from(this.adopted.keys())) {
      this.undress(item);
      this.parentElement.appendChild(item);
    }

    this.adopted.clear();
  }

  /**
   * Undo the engine's styling of one adopted leaf. See `clear()` for why the
   * inline style is restored but the classes are only subtracted. No-op for a
   * node this UI never adopted.
   */
  private undress(item: HTMLElement): void {
    const original = this.adopted.get(item);
    if (original === undefined) return;

    item.style.cssText = original.cssText;

    for (const name of ENGINE_LEAF_CLASSES) {
      if (!original.preexistingEngineClasses.includes(name)) item.classList.remove(name);
    }
  }

  /**
   * `destroy()` is about to remove `.stf__block`, which is where the adopted
   * leaves physically live. Hand them back to the host first — `clear()` moves
   * exactly the ones we took and leaves everything else (React's portalled
   * pages, the render's shadows) where it found them.
   */
  protected override releaseNodes(): void {
    this.clear();
  }

  /**
   * Move a leaf into the block, remembering that we were the one who moved it
   * and what it looked like beforehand.
   *
   * The snapshot has to be taken HERE, before the leaf is ever drawn: `draw()`
   * overwrites `cssText` on the first frame, so anything captured later is the
   * engine's own styling, not the consumer's.
   */
  private adopt(item: HTMLElement): void {
    const dist = this.distElement;
    if (item.parentElement === dist) return;

    if (!this.adopted.has(item)) {
      this.adopted.set(item, {
        cssText: item.style.cssText,
        preexistingEngineClasses: ENGINE_LEAF_CLASSES.filter((name) =>
          item.classList.contains(name),
        ),
      });
    }

    dist.appendChild(item);
  }

  /**
   * Update page list from HTMLElements
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public updateItems(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    this.removeHandlers();

    const next = new Set<HTMLElement>(items);

    // Drop only the leaves we adopted last time. `innerHTML = ''` also wiped
    // the render's shadow elements, and it deletes nodes a framework may
    // still consider its own (React portals its pages in here).
    for (const previous of Array.from(this.items)) {
      // Only leaves we adopted are ours to delete. A framework that rendered
      // its page into the block still owns that node — removing it here is the
      // same stale-parent failure `clear()` used to cause, just on the other
      // side of the lifecycle. React removes its own pages; we must not.
      if (!next.has(previous) && this.adopted.has(previous)) {
        // Undress before dropping it: the consumer handed this node over and
        // may well keep and reuse it, and a detached node still carrying
        // `position:absolute` and a `clip-path` is the same U1 failure as one
        // handed back by `clear()`.
        this.undress(previous);
        previous.remove();
        this.adopted.delete(previous);
      }
    }

    for (const item of items) {
      this.adopt(item);
    }

    this.items = items;

    this.setHandlers();
  }

  public update(): void {
    this.app.getRender().update();
  }
}
