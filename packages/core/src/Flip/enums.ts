/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Flipping direction (const object — no TS enum reverse map in the bundle). */
export const FlipDirection = {
  FORWARD: 0,
  BACK: 1,
} as const;
export type FlipDirection = (typeof FlipDirection)[keyof typeof FlipDirection];

/** Active corner when flipping. */
export const FlipCorner = {
  TOP: 'top',
  BOTTOM: 'bottom',
} as const;
export type FlipCorner = (typeof FlipCorner)[keyof typeof FlipCorner];

/** State of the book. */
export const FlippingState = {
  USER_FOLD: 'user_fold',
  FOLD_CORNER: 'fold_corner',
  FLIPPING: 'flipping',
  READ: 'read',
} as const;
export type FlippingState = (typeof FlippingState)[keyof typeof FlippingState];
