import { UI } from './UI';
import type { PageFlip } from '../PageFlip';
import type { FlipSetting } from '../Settings';

/**
 * UI for HTML mode
 */
export class HTMLUI extends UI {
  private items: NodeListOf<HTMLElement> | HTMLElement[];

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
      throw new Error('Failed to create flipbook HTML block');
    }
    this.distElement = block as HTMLElement;

    this.items = items;
    for (const item of items) {
      this.distElement.appendChild(item);
    }

    this.setHandlers();
  }

  public clear(): void {
    for (const item of this.items) {
      this.parentElement.appendChild(item);
    }
  }

  /**
   * Update page list from HTMLElements
   *
   * @param {(NodeListOf<HTMLElement>|HTMLElement[])} items - List of pages as HTML Element
   */
  public updateItems(items: NodeListOf<HTMLElement> | HTMLElement[]): void {
    this.removeHandlers();

    const next = new Set<HTMLElement>(Array.from(items));

    // Drop only the leaves we adopted last time. `innerHTML = ''` also wiped
    // the render's shadow elements, and it deletes nodes a framework may
    // still consider its own (React portals its pages in here).
    for (const previous of Array.from(this.items)) {
      if (!next.has(previous) && previous.parentElement === this.distElement) {
        previous.remove();
      }
    }

    for (const item of items) {
      if (item.parentElement !== this.distElement) {
        this.distElement.appendChild(item);
      }
    }

    this.items = items;

    this.setHandlers();
  }

  public update(): void {
    this.app.getRender().update();
  }
}
