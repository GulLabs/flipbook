/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether the leaf under the curl should paint.
 *
 * Upstream skipped drawing whenever orientation was portrait AND direction was
 * BACK. That was only correct while the previous leaf *was* the mover. Once
 * portrait BACK moves a copy of the current leaf, the previous leaf is the
 * bottom page and MUST be drawn — otherwise the curl reveals a duplicate of
 * the current page.
 *
 * Skip only when the mover *is* the bottom page (hard-cover: newTemporaryCopy
 * returns `this`).
 */
export function shouldDrawBottomPage(flippingPage: unknown, bottomPage: unknown): boolean {
  if (bottomPage == null) {
    return false;
  }
  return flippingPage !== bottomPage;
}
