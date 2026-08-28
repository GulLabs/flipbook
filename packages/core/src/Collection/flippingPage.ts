import { PageFlipError } from '../errors';
import { FlipDirection } from '../Flip/enums';

/**
 * Portrait flipping-page selection.
 *
 * Upstream returns pages[current - 1] on BACK, so the *previous* leaf is what
 * animates (the slide-in). We animate a temporary copy of the *current* leaf
 * instead. Hard pages return themselves from newTemporaryCopy; those stay on
 * the vendor previous-leaf path so the mover is not also the bottom page.
 */
export function getPortraitFlippingPage<T extends { newTemporaryCopy(): T }>(
  pages: T[],
  currentSpreadIndex: number,
  direction: FlipDirection,
): T {
  const current = pages[currentSpreadIndex];
  // Runtime guard: index may be OOB even if TS array access is typed as T.

  if (current === undefined) {
    throw new PageFlipError(`Invalid current spread index ${currentSpreadIndex}`, 'INVALID_SPREAD');
  }

  if (direction === FlipDirection.FORWARD) {
    return current.newTemporaryCopy();
  }

  const copy = current.newTemporaryCopy();
  if (copy === current) {
    const previous = pages[currentSpreadIndex - 1];

    if (previous === undefined) {
      throw new PageFlipError(
        `No previous page at index ${currentSpreadIndex - 1} for portrait BACK`,
        'INVALID_PAGE',
      );
    }
    return previous;
  }
  return copy;
}
