/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UI } from './UI';
import type { PageFlip } from '../PageFlip';
import type { FlipSetting } from '../Settings';

/**
 * UI for HTML mode
 */
export class HTMLUI extends UI {
  private items: NodeListOf<HTMLElement> | HTMLElement[];

  /**
   * Leaves this UI moved into `.stf__block` itself.
   *
   * A leaf that was already inside the block belongs to whoever put it there —
   * React's portal renders its pages straight into it — and `clear()` must
   * leave those alone. Releasing them would move nodes out from under React's
   * recorded parent, and the next removal or reorder throws `NotFoundError`:
   * exactly the failure the portal exists to prevent.
   */
  private readonly adopted = new Set<HTMLElement>();

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

  public clear(): void {
    // Hand back only what we took. See `adopted`.
    for (const item of this.adopted) {
      this.parentElement.appendChild(item);
    }

    this.adopted.clear();
  }

  /** Move a leaf into the block, remembering that we were the one who moved it. */
  private adopt(item: HTMLElement): void {
    const dist = this.distElement;
    if (item.parentElement === dist) return;

    this.adopted.add(item);
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
