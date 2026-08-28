import { UI } from './UI';
import type { PageFlip } from '../PageFlip';
import type { FlipSetting } from '../Settings';

/**
 * UI for canvas mode
 */
export class CanvasUI extends UI {
  private readonly canvas: HTMLCanvasElement;

  constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
    super(inBlock, app, setting);

    this.wrapper.innerHTML = '<canvas class="stf__canvas"></canvas>';

    const canvas = inBlock.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Canvas element was not created');
    }
    this.canvas = canvas;

    this.distElement = this.canvas;

    this.resizeCanvas();
    this.setHandlers();
  }

  private resizeCanvas(): void {
    const cs = getComputedStyle(this.canvas);
    const width = parseInt(cs.getPropertyValue('width'), 10);
    const height = parseInt(cs.getPropertyValue('height'), 10);

    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Get canvas element
   */
  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public update(): void {
    this.resizeCanvas();
    this.app.getRender().update();
  }
}
