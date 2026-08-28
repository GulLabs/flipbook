export const DEFAULT_PAGE_BACKGROUND = '#fff';

/**
 * Opaque fill for the turning leaf and its temporary copy so underlying
 * content cannot bleed through the fold.
 */
export function foldFill(pageBackground?: string): string {
  const value = pageBackground && pageBackground.trim().length > 0 ? pageBackground : DEFAULT_PAGE_BACKGROUND;
  return value;
}

export function foldFillCss(pageBackground?: string): string {
  return `background-color: ${foldFill(pageBackground)};`;
}

export function isOpaquePageBackground(pageBackground?: string): boolean {
  const value = foldFill(pageBackground).trim().toLowerCase();
  if (value === 'transparent' || value === 'inherit' || value === 'none') {
    return false;
  }
  if (value.startsWith('rgba')) {
    const parts = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(',');
    const alpha = Number(parts[3]);
    return Number.isFinite(alpha) ? alpha >= 1 : true;
  }
  return true;
}
