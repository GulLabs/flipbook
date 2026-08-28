import type { PageFlip } from './PageFlip';
import { CanvasUI } from './UI/CanvasUI';
import { CanvasRender } from './Render/CanvasRender';
import { ImagePageCollection } from './Collection/ImagePageCollection';

export function loadFromImages(app: PageFlip, imagesHref: string[]): void {
  const ui = new CanvasUI(app.getBlock(), app, app.getSettings());
  const render = new CanvasRender(app, app.getSettings(), ui.getCanvas());
  const pages = new ImagePageCollection(app, render, imagesHref);
  app.attachMode(ui, render, pages);
}

export function updateFromImages(app: PageFlip, imagesHref: string[]): void {
  const current = app.getCurrentPageIndex();
  const pages = new ImagePageCollection(app, app.getRender(), imagesHref);
  app.replacePages(pages, current);
}
