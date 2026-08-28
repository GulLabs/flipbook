export const DEFAULT_PAGE_BACKGROUND = '#fff';

/** Keywords that resolve to something the fold can be seen through. */
const SEE_THROUGH_RE =
  /^(?:transparent|inherit|initial|unset|revert(?:-layer)?|none|currentcolor)$/;

/**
 * Safe CSS color subset for `pageBackground`.
 *
 * The value is interpolated into an element's `cssText`, so a caller that pipes
 * user input into it must not be able to smuggle in `url()`, `expression()`,
 * `var()`, or an extra declaration. Legacy comma syntax only — modern
 * space-separated `rgb(0 0 0 / 50%)`, `color-mix()` and `oklch()` are rejected
 * rather than parsed; they fall back to the default.
 */
const SAFE_CSS_COLOR =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*[\d.]+\s*(?:,\s*[\d.%]+\s*){2,3}\)|hsla?\(\s*[\d.]+\s*(?:,\s*[\d.%]+\s*){2,3}\)|[a-z]{3,20})$/i;

/** Alpha channel of a legacy `rgba()` / `hsla()` value, or `null`. */
function functionalAlpha(value: string): number | null {
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open === -1 || close === -1) return null;

  const parts = value.slice(open + 1, close).split(',');
  if (parts.length < 4) return null;

  const raw = (parts[3] ?? '').trim();
  const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);

  return Number.isFinite(alpha) ? alpha : null;
}

/** Alpha channel of a 4- or 8-digit hex color, or `null`. */
function hexAlpha(value: string): number | null {
  if (value[0] !== '#') return null;

  const digits = value.slice(1);
  if (digits.length === 4) return parseInt(digits.slice(3), 16) / 15;
  if (digits.length === 8) return parseInt(digits.slice(6), 16) / 255;

  return null;
}

/**
 * Whether the given background would paint an opaque leaf.
 *
 * This inspects the value the caller supplied, *not* the normalized one — the
 * whole point is to tell a see-through background apart from a solid one.
 * Absent / empty means "not set", which the engine fills with the opaque
 * default, so it counts as opaque.
 */
export function isOpaquePageBackground(pageBackground?: string): boolean {
  const value = (pageBackground ?? '').trim().toLowerCase();

  if (value.length === 0) return true;
  if (SEE_THROUGH_RE.test(value)) return false;

  const alpha = functionalAlpha(value) ?? hexAlpha(value);

  return alpha === null ? true : alpha >= 1;
}

/**
 * Normalize a page background to a value that is both safe to interpolate and
 * opaque. Anything else falls back to {@link DEFAULT_PAGE_BACKGROUND}: a fold
 * you can read the next page through is the §4.2 bug this setting exists to
 * fix, so a translucent value is treated the same as an unsafe one.
 */
export function safePageBackground(pageBackground?: string): string {
  if (pageBackground == null) return DEFAULT_PAGE_BACKGROUND;

  const value = pageBackground.trim();

  if (value.length === 0) return DEFAULT_PAGE_BACKGROUND;
  if (!SAFE_CSS_COLOR.test(value)) return DEFAULT_PAGE_BACKGROUND;
  if (!isOpaquePageBackground(value)) return DEFAULT_PAGE_BACKGROUND;

  return value;
}

/** Opaque fill for the turning leaf / temporary copy (alias of safePageBackground). */
export const foldFill = safePageBackground;

export function foldFillCss(pageBackground?: string): string {
  return `background-color: ${foldFill(pageBackground)};`;
}
