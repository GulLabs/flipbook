/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export class PageFlipError extends Error {
  readonly code: string;

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

  constructor(message: string, code = 'PAGE_FLIP', options?: { cause?: unknown }) {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
