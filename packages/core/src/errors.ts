/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export class PageFlipError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PAGE_FLIP', options?: { cause?: unknown }) {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
