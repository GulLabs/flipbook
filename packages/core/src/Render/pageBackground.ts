/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
 * Pattern + opacity: the half that is cheap enough to repeat on every draw.
 *
 * A fold you can read the next page through is the §4.2 bug this setting
 * exists to fix, so a translucent value is rejected exactly like an unsafe one.
 */
function normalizePageBackground(pageBackground?: string): string {
  // `typeof`, not a null check. The declared parameter type is not a guarantee
  // here: `foldFill` runs every frame on `getSettings().pageBackground`, and
  // `getSettings()` returns the LIVE settings object — the whole reason this
  // draw-time guard exists (see `foldFill` below). An untyped consumer
  // assigning `settings.pageBackground = 0` skipped the settings boundary
  // entirely and reached `.trim()`, which threw a bare TypeError out of the
  // render loop on the next frame: the book stops mid-turn, not at the
  // assignment. A wrong-typed value takes the same route a missing one does.
  if (typeof pageBackground !== 'string') return DEFAULT_PAGE_BACKGROUND;

  const value = pageBackground.trim();

  if (value.length === 0) return DEFAULT_PAGE_BACKGROUND;
  if (!SAFE_CSS_COLOR.test(value)) return DEFAULT_PAGE_BACKGROUND;
  if (!isOpaquePageBackground(value)) return DEFAULT_PAGE_BACKGROUND;

  return value;
}

/**
 * Full validation, for the settings boundary — crossed once per book, or once
 * per `updateSettings`.
 *
 * Adds the platform check the pattern cannot do: it accepts any short word as a
 * named colour, but only ~148 are real, and an invented one fails silently in
 * the place it matters. CSS drops an unparseable declaration, leaving a
 * transparent fold, and canvas keeps whatever `fillStyle` was there before.
 * Node has no `CSS`, and an older engine can have `CSS` without `supports`.
 */
export function safePageBackground(pageBackground?: string): string {
  const value = normalizePageBackground(pageBackground);

  // The DOM lib types `CSS` as always present, so the type system thinks these
  // checks are dead. They are not: Node has no `CSS` at all, and an older
  // engine can expose it without `supports`.
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return value;
  if (!CSS.supports('color', value)) return DEFAULT_PAGE_BACKGROUND;

  return value;
}

/**
 * Draw-time guard for the turning leaf and its temporary copy.
 *
 * `Settings.getSettings` already ran the full check, so this is a second line
 * rather than the first: `getSettings()` hands back the live settings object,
 * and assigning to it skips validation entirely and puts the value straight in
 * front of the fold. `CSS.supports` parses, and this runs for every page on
 * every frame, so only the cheap half is repeated here.
 */
export const foldFill = normalizePageBackground;
