/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const DEFAULT_PAGE_BACKGROUND = '#fff';

/**
 * WHY THIS MODULE HAS NO OPACITY CHECK (B3, docs/API-CONTRACT.md).
 *
 * It used to. Two generations of alpha parser tried to prove a value opaque —
 * the first did not understand modern slash syntax and reported `rgb(0 0 0 /
 * 50%)` opaque; the second understood the slash and was then defeated by
 * `calc(.5)` alphas, `color-mix(in srgb, transparent 50%, red)`, and
 * `var(--paper, transparent)` fallbacks. Every parser is one CSS release away
 * from a syntax it has not met, and a translucent colour passing an opacity
 * check is precisely the see-through fold the check exists to prevent.
 *
 * The guarantee is STRUCTURAL now. The consumer's value never becomes the only
 * paint: `.stf__item::before` composites `var(--stf-paper, #fff)` as an image
 * layer OVER an opaque `background-color: #fff` base (see `styles.ts`), so a
 * translucent value blends with white instead of revealing the page
 * underneath. Nothing to prove at validation time — which is why this module
 * now checks only the two things that must stay static:
 *
 *  1. INJECTION SAFETY. The value is interpolated into a style attribute, so
 *     `red;position:fixed` is an injection, not a colour, and is refused on
 *     syntax whatever it would paint.
 *  2. IS IT A COLOUR AT ALL. Ask the platform (`CSS.supports`) rather than
 *     enumerating the colour functions CSS will keep adding; fall back to a
 *     shape pattern only where there is no DOM.
 *
 * Anything that passes is DRAWN VERBATIM. The draw-time guard survives only
 * for the untyped path (assigning to the live settings object bypasses the
 * boundary entirely) and consults the same predicate, so the two ends cannot
 * disagree.
 */

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
 * `color-mix`, `color`, `hwb`, `var` and whatever comes next all take the same
 * shape — because the injection guard above is what provides the safety, and
 * guessing at the closed set of colour functions is how this module got it
 * wrong before.
 *
 * It is therefore MORE PERMISSIVE than a browser: `notacolour` matches the
 * named-colour shape and passes under SSR, where `CSS.supports` would refuse
 * it. Accepted knowingly, and the argument that actually closes it is not
 * "SSR does not paint" but that the value is RE-CHECKED in the browser by
 * `foldFill` before it reaches a pixel — so the permissive path cannot produce
 * a wrong colour, only a late rejection.
 *
 * Implemented as a linear scan, not a nested quantifier regex. The previous
 * shape regex (`\s*` + `[^()]*` + nested `(…)*`) was polynomial in runs of
 * spaces (CodeQL js/polynomial-redos on library input). Real colour strings
 * are short; anything longer than the cap is refused rather than scanned.
 */
const MAX_COLOUR_SHAPE_LEN = 256;
const HEX_COLOUR_RE = /^#[0-9a-f]{3,8}$/i;
const NAMED_COLOUR_RE = /^[a-z][a-z-]{1,30}$/i;
const COLOUR_FN_NAME_RE = /^[a-z-]{2,20}$/i;

/**
 * Linear-time colour-shape check for the no-`CSS` path.
 *
 * Accepts hex, named colours, and `name(…)` with at most one nesting level of
 * parentheses inside the outer call — the same grammar the old regex encoded,
 * without backtracking.
 */
function isColourShape(value: string): boolean {
  if (value.length === 0 || value.length > MAX_COLOUR_SHAPE_LEN) return false;
  if (HEX_COLOUR_RE.test(value) || NAMED_COLOUR_RE.test(value)) return true;

  if (value.charCodeAt(value.length - 1) !== 41 /* ) */) return false;
  const open = value.indexOf('(');
  // name is 2–20 chars; `indexOf` miss is -1.
  if (open < 2 || open > 20) return false;
  if (!COLOUR_FN_NAME_RE.test(value.slice(0, open))) return false;

  // Walk the interior once. Depth 0 = outer args; depth 1 = one nested call
  // (`var(--x, rgb(0 0 0))`). Deeper nesting is refused — same as the old
  // regex's single `(…)` group.
  let depth = 0;
  for (let i = open + 1; i < value.length - 1; i++) {
    const code = value.charCodeAt(i);
    if (code === 40 /* ( */) {
      depth += 1;
      if (depth > 1) return false;
    } else if (code === 41 /* ) */) {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Why a background was refused, or `null` when it is acceptable. */
export type PageBackgroundRejection = 'unsafe' | 'unparseable';

/**
 * The ONE predicate. Both the settings boundary and the draw path consult it,
 * which is what stops them disagreeing.
 */
export function rejectPageBackground(value: string): PageBackgroundRejection | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (INJECTION_RE.test(trimmed)) return 'unsafe';

  // Ask the platform first: it knows every colour function, including the
  // ones that do not exist yet. The DOM lib types `CSS` as always present, so
  // the type system thinks these checks are dead — they are not. Node has no
  // `CSS` at all, and an older engine can expose it without `supports`.
  const hasCssSupports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function';

  if (hasCssSupports) {
    if (!CSS.supports('color', trimmed)) return 'unparseable';
  } else if (!isColourShape(trimmed)) {
    return 'unparseable';
  }

  return null;
}

const REJECTION_TEXT: Record<PageBackgroundRejection, string> = {
  unsafe:
    'a colour with no declaration syntax in it (this value is written into a style attribute)',
  unparseable: 'a valid CSS colour',
};

export const describePageBackgroundRejection = (reason: PageBackgroundRejection): string =>
  REJECTION_TEXT[reason];

/**
 * Draw-time guard for every leaf.
 *
 * `Settings.resolve` already ran exactly this check, so for any value that came
 * through the boundary this is an identity function — which is the point. It
 * survives only for the untyped path: `getSettings()` hands back the live
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
