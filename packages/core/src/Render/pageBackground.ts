/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const DEFAULT_PAGE_BACKGROUND = '#fff';

/**
 * WHY THIS MODULE WAS REWRITTEN.
 *
 * The boundary and the draw path used DIFFERENT predicates, so a value could
 * pass construction and then be rejected on every frame. Measured against the
 * built engine:
 *
 *   'oklch(0.7 0.1 200)'   accepted   → painted #fff
 *   'color-mix(in srgb…)'  accepted   → painted #fff
 *   'var(--paper)'         accepted   → painted #fff
 *   'rgb(0 0 0 / 50%)'     accepted as OPAQUE → painted #fff
 *
 * So an ordinary 2026 colour produced a white fold with no error and no
 * warning, and a genuinely see-through modern colour was reported opaque —
 * the opacity check this module exists for did not understand the syntax it
 * was checking.
 *
 * Twenty lines away in the same function, `Settings.resolve` throws loudly for
 * `drawShadow: 'false'`. Two philosophies in one validator. The loud one is
 * right.
 *
 * THE RULE NOW: one predicate, used by both ends.
 *
 *  1. Reject anything that could break out of the declaration — this value is
 *     interpolated into `cssText`, so `red;position:fixed` is an injection, not
 *     a colour, and it is refused on syntax whatever its opacity.
 *  2. Ask the PLATFORM whether it is a colour (`CSS.supports`), rather than
 *     enumerating the colour functions CSS will keep adding. Falling back to a
 *     pattern only where there is no DOM.
 *  3. Reject what is provably translucent.
 *
 * Anything that passes is DRAWN VERBATIM. The draw-time fallback survives only
 * for the untyped path (assigning to the live settings object bypasses the
 * boundary entirely), and can no longer silently disagree with a value the
 * boundary accepted.
 */

/** Keywords that resolve to something the fold can be seen through. */
const SEE_THROUGH_RE =
  /^(?:transparent|inherit|initial|unset|revert(?:-layer)?|none|currentcolor)$/;

/**
 * Characters and constructs that let a value escape the declaration it is
 * interpolated into, or reach the network.
 *
 * Deliberately NOT a colour grammar: `/` is legal in modern colour syntax
 * (`rgb(0 0 0 / 50%)`), so this bans only what cannot appear in any colour.
 */
const INJECTION_RE = /[;{}\\]|\/\*|<|url\s*\(|expression\s*\(|@import/i;

/**
 * SSR fallback for "is this a colour", used only where there is no `CSS`.
 *
 * Deliberately permissive about the FUNCTION NAME — `oklch`, `lab`, `lch`,
 * `color-mix`, `color`, `hwb` and whatever comes next all take the same shape —
 * because the injection guard above is what provides the safety, and guessing
 * at the closed set of colour functions is how this module got it wrong before.
 *
 * It is therefore MORE PERMISSIVE than a browser: `notacolour` matches the
 * named-colour shape and passes under SSR, where `CSS.supports` would refuse
 * it. Accepted knowingly, and the argument that actually closes it is not
 * "SSR does not paint" but that the value is RE-CHECKED in the browser by
 * `foldFill` before it reaches a pixel — so the permissive path cannot produce
 * a wrong colour, only a late rejection.
 */
const COLOUR_SHAPE_RE =
  /^(?:#[0-9a-f]{3,8}|[a-z][a-z-]{1,30}|[a-z-]{2,20}\(\s*[^()]*(?:\([^()]*\)[^()]*)*\))$/i;

/**
 * `var(--x, fallback)` — the FALLBACK IS REQUIRED, and that closes a real hole.
 *
 * A bare `var(--typo)` whose property is never defined is invalid at
 * computed-value time, which for `background-color` means TRANSPARENT — a
 * see-through fold, the exact §4.2 failure this setting exists to prevent, and
 * reached by a plain typo. The documented trade ("a translucent custom property
 * is the caller's to get right") covers a property that resolves to something;
 * it does not cover one that resolves to nothing.
 *
 * Requiring the fallback makes the value total: whatever the property does, the
 * declaration still yields a colour. The fallback itself is not validated —
 * that would mean parsing arbitrary nesting — so this is a guarantee of
 * well-formedness, not of opacity.
 */
const VAR_RE = /^var\(\s*--[\w-]+\s*,[^;]+\)$/i;

/**
 * Alpha channel, for both legacy comma syntax and the modern slash form.
 *
 * The old version split on commas and required four parts, so it saw
 * `rgb(0 0 0 / 50%)` as having one part and reported `null` — "no alpha
 * found" — which the caller then read as opaque. A translucent colour passing
 * an opacity check is the failure this whole module exists to prevent.
 */
function functionalAlpha(value: string): number | null {
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open === -1 || close === -1) return null;

  const inner = value.slice(open + 1, close);

  // Modern: the alpha follows a slash, in any colour function.
  const slash = inner.lastIndexOf('/');
  if (slash !== -1) {
    const raw = inner.slice(slash + 1).trim();
    const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    return Number.isFinite(alpha) ? alpha : null;
  }

  // Legacy: the fourth comma-separated component.
  const parts = inner.split(',');
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
 * `var(--x, fallback)` returns TRUE and that is a deliberate, stated trade: a
 * custom property cannot be resolved without layout, and it is the single most
 * likely value a design-system consumer passes. Rejecting it to defend an
 * invariant we cannot verify either way would be worse than accepting it and
 * saying so — a translucent custom property is then the caller's to get right.
 * The FALLBACK is mandatory, so an undefined property cannot produce a
 * transparent fold; see {@link VAR_RE}.
 */
export function isOpaquePageBackground(pageBackground?: string): boolean {
  const value = (pageBackground ?? '').trim().toLowerCase();

  if (value.length === 0) return true;
  if (SEE_THROUGH_RE.test(value)) return false;
  if (VAR_RE.test(value)) return true;

  const alpha = functionalAlpha(value) ?? hexAlpha(value);

  return alpha === null ? true : alpha >= 1;
}

/** Why a background was refused, or `null` when it is acceptable. */
export type PageBackgroundRejection = 'unsafe' | 'unparseable' | 'translucent';

/**
 * The ONE predicate. Both the settings boundary and the draw path consult it,
 * which is what stops them disagreeing.
 */
export function rejectPageBackground(value: string): PageBackgroundRejection | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (INJECTION_RE.test(trimmed)) return 'unsafe';

  const lower = trimmed.toLowerCase();

  if (!VAR_RE.test(lower)) {
    // Ask the platform first: it knows every colour function, including the
    // ones that do not exist yet. The DOM lib types `CSS` as always present, so
    // the type system thinks these checks are dead — they are not. Node has no
    // `CSS` at all, and an older engine can expose it without `supports`.
    const hasCssSupports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function';

    if (hasCssSupports) {
      if (!CSS.supports('color', trimmed)) return 'unparseable';
    } else if (!COLOUR_SHAPE_RE.test(trimmed)) {
      return 'unparseable';
    }
  }

  if (!isOpaquePageBackground(trimmed)) return 'translucent';

  return null;
}

const REJECTION_TEXT: Record<PageBackgroundRejection, string> = {
  unsafe:
    'a colour with no declaration syntax in it (this value is written into a style attribute)',
  unparseable: 'a valid CSS colour',
  translucent: 'an opaque colour (a see-through fold lets the page underneath read through)',
};

export const describePageBackgroundRejection = (reason: PageBackgroundRejection): string =>
  REJECTION_TEXT[reason];

/**
 * Draw-time guard for every leaf.
 *
 * `Settings.resolve` already ran exactly this check, so for any value that came
 * through the boundary this is an identity function — which is the point. It
 * survives only for the untyped path: `getSettings()` hands back the LIVE
 * settings object, and assigning to it skips validation and puts the value
 * straight in front of the fold. An untyped consumer writing
 * `settings.pageBackground = 0` used to reach `.trim()` and throw a bare
 * TypeError out of the render loop — the book stops mid-turn, not at the
 * assignment.
 */
function normalizePageBackground(pageBackground?: string): string {
  if (typeof pageBackground !== 'string') return DEFAULT_PAGE_BACKGROUND;

  const value = pageBackground.trim();
  if (value.length === 0) return DEFAULT_PAGE_BACKGROUND;

  return rejectPageBackground(value) === null ? value : DEFAULT_PAGE_BACKGROUND;
}

/**
 * Full validation for the settings boundary. Kept as a named export because it
 * is the shape a non-throwing caller wants; `Settings.resolve` throws instead.
 */
export function safePageBackground(pageBackground?: string): string {
  return normalizePageBackground(pageBackground);
}

export const foldFill = normalizePageBackground;
