/**
 * Flipping direction
 */
export enum FlipDirection {
  FORWARD = 0,
  BACK = 1,
}

/**
 * Active corner when flipping
 */
export enum FlipCorner {
  TOP = 'top',
  BOTTOM = 'bottom',
}

/**
 * State of the book
 */
export enum FlippingState {
  /** The user folding the page */
  USER_FOLD = 'user_fold',

  /** Mouse over active corners */
  FOLD_CORNER = 'fold_corner',

  /** During flipping animation */
  FLIPPING = 'flipping',

  /** Base state */
  READ = 'read',
}
