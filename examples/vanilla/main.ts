import { PageFlip } from '@gullabs/flipbook-core';

const root = document.getElementById('book');
if (!(root instanceof HTMLElement)) {
  throw new Error('#book root element is required');
}

// `stretch` is what a real reader uses: the book follows its container and
// drops to a single page below `minWidth * 2`, which is where the portrait
// back-curl this fork exists to fix actually happens.
const params = new URLSearchParams(window.location.search);

if (params.get('golden') === '1') {
  document.body.classList.add('golden');
}

const swipeDistanceParam = params.get('swipeDistance');
const swipeDistance =
  swipeDistanceParam !== null && swipeDistanceParam !== '' ? Number(swipeDistanceParam) : undefined;

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
  // Opaque default; goldens assert the fold does not show the leaf below.
  pageBackground: '#ffffff',
  // Deterministic gestures in the e2e run: the animation must not race the
  // assertions that read the fold mid-drag. Goldens force motion on so the
  // mid-flip frames actually exist (`reducedMotion=0`).
  respectReducedMotion: params.get('reducedMotion') !== '0',
  // Gesture e2e knobs — omitted params keep Settings defaults.
  ...(swipeDistance !== undefined && !Number.isNaN(swipeDistance) ? { swipeDistance } : {}),
  disableFlipByClick: params.get('disableFlipByClick') === '1',
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
