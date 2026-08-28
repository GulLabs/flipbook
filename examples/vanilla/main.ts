import { PageFlip } from '@gullabs/flipbook-core';

const root = document.getElementById('book');
if (!(root instanceof HTMLElement)) {
  throw new Error('#book root element is required');
}

// `stretch` is what a real reader uses: the book follows its container and
// drops to a single page below `minWidth * 2`, which is where the portrait
// back-curl this fork exists to fix actually happens.
const params = new URLSearchParams(window.location.search);

const book = new PageFlip(root, {
  width: 400,
  height: 300,
  size: 'stretch',
  minWidth: 260,
  maxWidth: 800,
  minHeight: 200,
  maxHeight: 600,
  usePortrait: true,
  showCover: params.get('cover') === '1',
  direction: params.get('rtl') === '1' ? 'rtl' : 'ltr',
  flippingTime: Number(params.get('flippingTime') ?? 600),
  // Deterministic gestures in the e2e run: the animation must not race the
  // assertions that read the fold mid-drag.
  respectReducedMotion: params.get('reducedMotion') !== '0',
});

book.loadFromHTML([...root.querySelectorAll<HTMLElement>('.page')]);

// Handy for the e2e suite and for poking at the engine in devtools.
(window as unknown as { flipbook: PageFlip }).flipbook = book;

book.on('flip', (event) => {
  document.body.dataset['page'] = String(event.data);
});
book.on('changeOrientation', (event) => {
  document.body.dataset['orientation'] = String(event.data);
});
book.on('init', (event) => {
  document.body.dataset['orientation'] = String(event.data.mode);
  document.body.dataset['ready'] = '1';
});
