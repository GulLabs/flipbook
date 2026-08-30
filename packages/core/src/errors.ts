/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every code this engine emits.
 *
 * S7. `code` was typed `string`, so a consumer could not narrow on it — the
 * whole reason a code exists beside the message. A union makes
 * `switch (err.code)` exhaustive and a typo in a comparison a compile error.
 *
 * Two codes used to carry more than one meaning, distinguishable only by
 * reading the human-readable message — which is the one part of an error a
 * library is free to reword:
 *
 * - `INVALID_SIZE` covered the `size` enum, the width/height pair, AND the
 *   min/max bounds. It is now the enum only; the other two are
 *   `INVALID_DIMENSIONS` and `INVALID_BOUNDS`.
 * - `INVALID_PAGE` covered both "that page number is out of range" and "that
 *   page exists but is in no spread" — a caller wanting to clamp the first and
 *   report the second could not tell them apart. The second is now
 *   `PAGE_NOT_IN_SPREAD`.
 *
 * Split now because neither package is published yet, so it costs nothing
 * today and would be a breaking change the moment it is.
 */
export type PageFlipErrorCode =
  | 'CANVAS_REMOVED'
  | 'COLLINEAR_SEGMENTS'
  | 'DEGENERATE_SEGMENT'
  | 'DESTROYED'
  | 'DETACHED_PAGE'
  | 'FLIP_SETUP'
  | 'INVALID_BOOLEAN'
  | 'INVALID_BOUNDS'
  | 'INVALID_DIMENSIONS'
  | 'INVALID_DIRECTION'
  | 'INVALID_FLIPPING_TIME'
  | 'INVALID_INDEX'
  | 'INVALID_PAGE'
  | 'INVALID_SHADOW_OPACITY'
  | 'INVALID_SIZE'
  | 'INVALID_SPREAD'
  | 'INVALID_SWIPE_DISTANCE'
  | 'INVALID_Z_INDEX'
  | 'NOT_LOADED'
  | 'NO_ANIMATION_FRAME'
  | 'PAGE_FLIP'
  | 'PAGE_NOT_IN_SPREAD'
  | 'RENDER_SETUP'
  | 'WRONG_MODE';

export class PageFlipError extends Error {
  readonly code: PageFlipErrorCode;

  /**
   * The error this one wraps, when the constructor was given one.
   *
   * Declared, not just assigned. `lib` is `ES2020` here, which predates
   * `Error.cause`, so the inherited `Error` type has no such member and the
   * published `.d.ts` denied a property the constructor has always attached —
   * `catch (e) { e.cause }` did not compile for a consumer without a cast.
   *
   * No initializer, deliberately: at `target: es2020`,
   * `useDefineForClassFields` is `false`, so this emits nothing and an error
   * built without a cause keeps no own `cause` key. That is emit, not
   * contract — a bump to `es2022` would flip it — so the contract the tests
   * pin is `cause === undefined`, not the key's absence.
   */
  readonly cause?: unknown;

  constructor(
    message: string,
    code: PageFlipErrorCode = 'PAGE_FLIP',
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
