import { PageFlip } from '@gullabs/flipbook-core';

const root = document.getElementById('book');
const pages = [...root.querySelectorAll('.page')];
const book = new PageFlip(root, {
  width: 400,
  height: 300,
  flippingTime: 600,
  usePortrait: true,
});
book.loadFromHTML(pages);
console.log('vanilla page', book.getCurrentPageIndex(), book.getSettings().flippingTime);
