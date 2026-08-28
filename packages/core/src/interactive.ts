/** Interactive targets that should not start a page fold (UX-003). */
export const FLIPBOOK_INTERACTIVE_SELECTOR =
  'a[href],button,input,textarea,select,summary,label,[contenteditable],[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=textbox]';

export function isInteractivePointerTarget(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(FLIPBOOK_INTERACTIVE_SELECTOR) != null;
}
