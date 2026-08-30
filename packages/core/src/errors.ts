/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FlipSetting } from './Settings';

/**
 * Every code this engine emits.
 *
 * `code` was typed `string`, so a consumer could not narrow on it — the whole
 * reason a code exists beside the message. A union makes `switch (err.code)`
 * exhaustive and a typo in a comparison a compile error.
 *
 * D20. The eight `INVALID_*` settings codes collapsed into one
 * `INVALID_SETTING` carrying a machine-readable {@link PageFlipError.setting}.
 * That is strictly MORE information from a smaller union: `INVALID_BOOLEAN`
 * told you a boolean was wrong but not which one, so a consumer wanting to
 * highlight the offending field had to parse the message — the one part of an
 * error a library is free to reword.
 */
export type PageFlipErrorCode =
  // usage — the caller did something wrong and can fix it
  | 'INVALID_SETTING'
  | 'INVALID_PAGE'
  | 'PAGE_NOT_IN_SPREAD'
  | 'INVALID_INDEX'
  | 'WRONG_MODE'
  | 'CANVAS_REMOVED'
  // lifecycle — the call was fine, the engine was not in a state to serve it
  | 'DESTROYED'
  | 'NOT_LOADED'
  | 'DETACHED_PAGE'
  | 'NO_ANIMATION_FRAME'
  // internal — an engine invariant broke; a consumer can neither cause nor fix it
  | 'COLLINEAR_SEGMENTS'
  | 'DEGENERATE_SEGMENT'
  | 'FLIP_SETUP'
  | 'INVALID_SPREAD'
  | 'RENDER_SETUP'
  | 'PAGE_FLIP';

/**
 * The axis the flat union was missing.
 *
 * Roughly a third of the codes are engine-invariant violations a consumer can
 * neither cause nor fix, and `switch (err.code)` — the thing the union exists
 * for — offered no way to write "report this and move on" once. Derived from
 * the code by the table below rather than passed in, so the two cannot drift.
 */
export type PageFlipErrorKind = 'usage' | 'lifecycle' | 'internal';

const KIND: Record<PageFlipErrorCode, PageFlipErrorKind> = {
  INVALID_SETTING: 'usage',
  INVALID_PAGE: 'usage',
  PAGE_NOT_IN_SPREAD: 'usage',
  INVALID_INDEX: 'usage',
  WRONG_MODE: 'usage',
  CANVAS_REMOVED: 'usage',

  DESTROYED: 'lifecycle',
  NOT_LOADED: 'lifecycle',
  DETACHED_PAGE: 'lifecycle',
  NO_ANIMATION_FRAME: 'lifecycle',

  COLLINEAR_SEGMENTS: 'internal',
  DEGENERATE_SEGMENT: 'internal',
  FLIP_SETUP: 'internal',
  INVALID_SPREAD: 'internal',
  RENDER_SETUP: 'internal',
  PAGE_FLIP: 'internal',
};

export class PageFlipError extends Error {
  readonly code: PageFlipErrorCode;

  /**
   * `'usage'` — fix the call. `'lifecycle'` — the engine was destroyed or not
   * loaded. `'internal'` — an engine bug; report it.
   */
  readonly kind: PageFlipErrorKind;

  /**
   * Which setting was rejected, for `code: 'INVALID_SETTING'`.
   *
   * This is what lets one code replace eight and still say more: a form can
   * highlight the offending field without reading the message.
   */
  readonly setting?: keyof FlipSetting;

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
    options?: { cause?: unknown; setting?: keyof FlipSetting },
  ) {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
    this.kind = KIND[code];
    if (options?.cause !== undefined) this.cause = options.cause;
    if (options?.setting !== undefined) this.setting = options.setting;
  }
}

/**
 * The sentinel the pointer hot path throws to unwind, compared by IDENTITY.
 *
 * Three sites used to throw bare `Error`s, two of them as control flow inside a
 * broad `catch` on `pointermove` — so a genuine `TypeError` there was swallowed
 * on every frame of a drag, and the bug it represented was invisible.
 */
export const GEOMETRY_ABORT: unique symbol = Symbol('flipbook.geometryAbort');

export class GeometryAbort extends Error {
  readonly token = GEOMETRY_ABORT;

  constructor(message: string) {
    super(message);
    this.name = 'GeometryAbort';
  }
}

export const isGeometryAbort = (error: unknown): error is GeometryAbort =>
  error instanceof GeometryAbort && error.token === GEOMETRY_ABORT;
