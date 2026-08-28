/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PageFlipError } from './errors';

/**
 * Indexed access under `noUncheckedIndexedAccess`. Prefer this over `!`.
 *
 * The thrown message carries the index and the array length, so a failure is
 * diagnosable without every call site having to name what it was indexing.
 */
export function at<T>(arr: readonly T[], index: number, label?: string): T {
  const value = arr[index];
  if (value === undefined) {
    const what = label === undefined ? 'index' : `${label} index`;
    throw new PageFlipError(`Invalid ${what} ${index} (length ${arr.length})`, 'INVALID_INDEX');
  }
  return value;
}
