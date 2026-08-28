/**
 * Closed interactive selector for clickEventForward (UX-003).
 */
export const FLIPBOOK_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  'label',
  "[contenteditable='']",
  "[contenteditable='true']",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
].join(',');

export function isInteractivePointerTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return target.closest(FLIPBOOK_INTERACTIVE_SELECTOR) !== null;
}
