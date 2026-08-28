export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function effectiveFlippingTime(
  flippingTime: number,
  respectReducedMotion: boolean,
): number {
  if (flippingTime <= 0) {
    return 0;
  }
  if (respectReducedMotion && prefersReducedMotion()) {
    return 0;
  }
  return flippingTime;
}
