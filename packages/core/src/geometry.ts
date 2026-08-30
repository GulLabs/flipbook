/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { PageRect, Point } from './BasicTypes';
import { FlipDirection } from './Flip/enums';

export type CurlCorner = 'top' | 'bottom';

export type Curl = {
  from: Point;
  to: Point;
};

/**
 * Local-space curl used by FlipCalculation.
 *
 * Visual direction is NOT this vector:
 * - FORWARD: convertPageToGlobal leaves x alone → curl goes LEFT on screen.
 * - BACK: convertPageToGlobal mirrors x → the same local path goes RIGHT on screen.
 *
 * A "smarter" back curl with to.x = pageWidth*2 is the slide-in regression —
 * BACK mirroring turns that into a leftward slide.
 */
export function portraitCurlLocal(
  pageWidth: number,
  height: number,
  corner: CurlCorner = 'top',
): Curl {
  // BOUNDED BY THE LEAF'S OWN WIDTH, not only by its height.
  //
  // `height / 10` is a sensible corner inset on ordinary proportions and
  // nonsense on a tall narrow leaf: a valid 20x300 page gives `pad = 30`, so
  // the curl STARTS at local `x = pageWidth - pad = -10` — already past the
  // spine, and `FlipCalculation` reads that as roughly 75% of the turn already
  // complete. A programmatic turn on such a book jumps most of the way in its
  // first frame instead of animating.
  //
  // `Settings` permits any positive dimensions, and the existing geometry tests
  // only ever used 400x600 and 320x480, so nothing noticed.
  //
  // The bound is HALF THE PAGE WIDTH, not a tenth of the shorter side. The
  // shorter side was the first attempt and it is wrong: on any leaf taller than
  // it is wide — which is every portrait book — the shorter side IS the width,
  // so `min(h, w) / 10` would have re-tuned the curl of essentially every book
  // that exists. A 400x600 leaf would have dropped from 60 to 40. The test for
  // "ordinary proportions are unchanged" caught it.
  //
  // What actually has to hold is `from.x = pageWidth - pad > 0`, so the
  // constraint belongs on the width alone. Half of it keeps the start point
  // clearly inside the leaf, and it is genuinely inert wherever
  // `height / 10 < pageWidth / 2` — every ordinary ratio, including 400x600,
  // which keeps its 60 exactly as before.
  const pad = Math.min(height / 10, pageWidth / 2);
  const yStart = corner === 'bottom' ? height - pad : pad;
  const yDest = corner === 'bottom' ? height : 0;
  return {
    from: { x: pageWidth - pad, y: yStart },
    to: { x: -pageWidth, y: yDest },
  };
}

export function curlGoesLeft(curl: Curl): boolean {
  return curl.to.x < curl.from.x;
}

/**
 * Coordinates relative to the work page → window / book-global coordinates.
 * BACK mirrors x; that mirror is what makes a leftward local path read as a
 * rightward on-screen curl.
 */
export function convertPageToGlobal(pos: Point, direction: FlipDirection, rect: PageRect): Point {
  const x =
    direction === FlipDirection.FORWARD
      ? pos.x + rect.left + rect.width / 2
      : rect.width / 2 - pos.x + rect.left;

  return {
    x,
    y: pos.y + rect.top,
  };
}

/**
 * True when a BACK turn will appear to move right on screen.
 * Local curl still goes left; BACK mirroring is what makes it read as right.
 */
export function backCurlAppearsRight(
  localCurl: Curl,
  direction: FlipDirection,
  rect?: PageRect,
): boolean {
  if (direction !== FlipDirection.BACK || !curlGoesLeft(localCurl)) {
    return false;
  }
  if (!rect) {
    return true;
  }
  const from = convertPageToGlobal(localCurl.from, direction, rect);
  const to = convertPageToGlobal(localCurl.to, direction, rect);
  return to.x > from.x;
}

export const FLIP_DIR_FORWARD = FlipDirection.FORWARD;
export const FLIP_DIR_BACK = FlipDirection.BACK;
