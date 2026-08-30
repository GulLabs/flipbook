/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageFlip } from './PageFlip';
import { CanvasUI } from './UI/CanvasUI';
import { CanvasRender } from './Render/CanvasRender';
import { PageFlipError } from './errors';
import { ImagePageCollection } from './Collection/ImagePageCollection';
import type { CanvasLeaf } from './canvasLeaf';

/**
 * Both entry points take an ALREADY-VALIDATED list.
 *
 * `PageFlip` runs `validateCanvasLeaves` before it even imports this chunk, so
 * that an invalid descriptor list rejects without a canvas ever being built —
 * see the comment on `PageFlip.loadFromImages`. Re-validating here would be
 * dead work and, worse, would move the failure to after `new CanvasUI(...)` has
 * already mutated the host.
 */
export function loadFromImages(app: PageFlip, leaves: readonly CanvasLeaf[]): void {
  // `CanvasUI`'s constructor MUTATES THE HOST — it builds the wrapper and
  // block, stamps `stf__parent`, records the caller's styles and binds
  // handlers — and `CanvasRender`'s constructor is the next thing that can
  // throw, because acquiring a 2D context can be refused (browsers cap live
  // contexts). Without a bracket, that throw left the wrapper in the consumer's
  // DOM, the host restyled, the `stf__parent` reference count incremented and
  // the handlers bound, while `PageFlip` never received the UI and so had
  // nothing to destroy. The book was unusable AND the page was left dirty, and
  // a retry then built a second UI on top of the first.
  const ui = new CanvasUI(app.getBlock(), app, app.getSettings());

  try {
    const render = new CanvasRender(app, app.getSettings(), ui.getCanvas());
    const pages = new ImagePageCollection(app, render, leaves);
    app.attachMode(ui, render, pages);
  } catch (err: unknown) {
    // Hand the host back before rethrowing. `attachMode` is the point of no
    // return: once it has the UI, teardown is its job, and it does not throw.
    ui.destroy();
    throw err;
  }
}

export function updateFromImages(app: PageFlip, leaves: readonly CanvasLeaf[]): void {
  const render = app.getRender();

  // Building ImagePages against an HTMLRender produced a book whose pages tried
  // to draw into a 2d context that does not exist. Cross-mode updates are not
  // supported; load the mode you want.
  if (!(render instanceof CanvasRender)) {
    throw new PageFlipError(
      'updateFromImages requires canvas mode; use loadFromImages to switch modes.',
      'WRONG_MODE',
    );
  }

  const current = app.getCurrentPageIndex();
  const pages = new ImagePageCollection(app, render, leaves);
  app.replacePages(pages, current);
}
