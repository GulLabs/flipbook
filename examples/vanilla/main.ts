import { PageFlip } from '@gullabs/flipbook-core';

const root = document.getElementById('book');
if (!(root instanceof HTMLElement)) {
  throw new Error('#book root element is required');
}

const pages = [...root.querySelectorAll<HTMLElement>('.page')];
const book = new PageFlip(root, {
  width: 400,
  height: 300,
  flippingTime: 600,
  usePortrait: true,
});
book.loadFromHTML(pages);
// Demo only — keep console for local verification of settings wiring.
// eslint-disable-next-line no-console -- example demo output
console.log('vanilla page', book.getCurrentPageIndex(), book.getSettings().flippingTime);
