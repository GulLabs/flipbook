export const DEFAULT_PAGE_BACKGROUND = '#fff';

/**
 * Safe CSS color subset for `pageBackground` (SEC-003).
 * Rejects `url()`, `expression()`, `var()`, and other non-color values that
 * would be pasted into element `style` / cssText.
 */
const SAFE_CSS_COLOR =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*[\d.]+\s*(?:,\s*[\d.%]+\s*){2,3}\)|hsla?\(\s*[\d.]+\s*(?:,\s*[\d.%]+\s*){2,3}\)|[a-z]{3,20})$/i;

/**
 * Normalize and validate a page background color. Invalid values fall back to
 * {@link DEFAULT_PAGE_BACKGROUND} so untrusted strings cannot inject CSS.
 */
export function safePageBackground(pageBackground?: string): string {
  if (pageBackground === undefined || pageBackground === null) {
    return DEFAULT_PAGE_BACKGROUND;
  }
  const value = String(pageBackground).trim();
  if (value.length === 0) return DEFAULT_PAGE_BACKGROUND;
  if (!SAFE_CSS_COLOR.test(value)) return DEFAULT_PAGE_BACKGROUND;
  const lower = value.toLowerCase();
  if (lower === 'transparent' || lower === 'inherit' || lower === 'none' || lower === 'initial') {
    return DEFAULT_PAGE_BACKGROUND;
  }
  return value;
}

/**
 * Opaque fill for the turning leaf and its temporary copy so underlying
 * content cannot bleed through the fold.
 */
export function foldFill(pageBackground?: string): string {
  return safePageBackground(pageBackground);
}

export function foldFillCss(pageBackground?: string): string {
  return `background-color: ${foldFill(pageBackground)};`;
}

export function isOpaquePageBackground(pageBackground?: string): boolean {
  // Inspect the raw request first — foldFill/safePageBackground maps
  // transparent/inherit/none to #fff for CSS safety, which would hide opacity.
  if (pageBackground !== undefined && pageBackground !== null) {
    const raw = String(pageBackground).trim().toLowerCase();
    if (raw === 'transparent' || raw === 'inherit' || raw === 'none' || raw === 'initial') {
      return false;
    }
  }
  const value = foldFill(pageBackground).trim().toLowerCase();
  if (value.startsWith('rgba')) {
    const parts = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(',');
    const alpha = Number(parts[3]);
    return Number.isFinite(alpha) ? alpha >= 1 : true;
  }
  return true;
}
