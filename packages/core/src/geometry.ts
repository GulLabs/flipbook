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
  const pad = height / 10;
  const yStart = corner === 'bottom' ? height - pad : pad;
  const yDest = corner === 'bottom' ? height : 0;
  return {
    from: { x: pageWidth - pad, y: yStart },
    to: { x: -pageWidth, y: yDest },
  };
}

export function portraitForwardCurl(
  pageWidth: number,
  height: number,
  corner: CurlCorner = 'top',
): Curl {
  return portraitCurlLocal(pageWidth, height, corner);
}

export function portraitBackCurl(
  pageWidth: number,
  height: number,
  corner: CurlCorner = 'top',
): Curl {
  return portraitCurlLocal(pageWidth, height, corner);
}

export function curlGoesLeft(curl: Curl): boolean {
  return curl.to.x < curl.from.x;
}

/**
 * Coordinates relative to the work page → window / book-global coordinates.
 * BACK mirrors x; that mirror is what makes a leftward local path read as a
 * rightward on-screen curl.
 */
export function convertPageToGlobal(
  pos: Point,
  direction: FlipDirection,
  rect: PageRect,
): Point {
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
