import { PageFlipError } from './errors';

/** Indexed access under `noUncheckedIndexedAccess`. Prefer this over `!`. */
export function at<T>(arr: readonly T[], index: number, label = 'i'): T {
  const value = arr[index];
  if (value === undefined) {
    throw new PageFlipError(`Invalid ${label} index ${index}`, 'INVALID_INDEX');
  }
  return value;
}
