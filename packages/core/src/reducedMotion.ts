/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function effectiveFlippingTime(flippingTime: number, respectReducedMotion: boolean): number {
  if (flippingTime <= 0) {
    return 0;
  }
  if (respectReducedMotion && prefersReducedMotion()) {
    return 0;
  }
  return flippingTime;
}
