import { PageFlip, type CanvasLeaf, type ImageFit } from '@gullabs/flipbook-core';

/**
 * Public canvas/images showcase (defect F3).
 *
 * Written against ADR 0001 (`docs/adr/0001-image-page-api.md`). The book below
 * is arranged so every Phase 2 capability is visible on a spread of its own:
 *
 *   spread 1  blank leaf            | title page
 *   spread 2  fit: 'contain'        | fit: 'cover'      (same 1:2 bitmap)
 *   spread 3  fit: 'fill'           | inset: 0.04
 *   spread 4  deliberately-404 src  | back page
 *
 * The `imageFit` / `imageInset` selects drive the BOOK-level default through
 * `updateSettings`, which is the live-settings contract; the four leaves that
 * carry their own `fit` / `inset` deliberately ignore it, and the status panel
 * says so. A control whose effect you cannot see is worse than no control.
 */

const root = document.getElementById('book');
const statusEl = document.getElementById('status');
const fitEl = document.getElementById('fit');
const insetEl = document.getElementById('inset');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

if (!(root instanceof HTMLElement)) throw new Error('canvas-demo: #book missing');
if (!(statusEl instanceof HTMLElement)) throw new Error('canvas-demo: #status missing');
if (!(fitEl instanceof HTMLSelectElement)) throw new Error('canvas-demo: #fit missing');
if (!(insetEl instanceof HTMLSelectElement)) throw new Error('canvas-demo: #inset missing');
if (!(prevBtn instanceof HTMLButtonElement)) throw new Error('canvas-demo: #prev missing');
if (!(nextBtn instanceof HTMLButtonElement)) throw new Error('canvas-demo: #next missing');

// Narrowed above; keep local consts so TS remembers.
const status = statusEl;
const fitSelect = fitEl;
const insetSelect = insetEl;

/** Identity fixtures from `scripts/gen-canvas-fixtures.mjs`. */
const LEAVES: readonly CanvasLeaf[] = [
  // A blank leaf: no bitmap, no alt. `blank: true` IS the decorative assertion.
  { blank: true },
  { src: '/fixtures/canvas/page-0.png', alt: 'Title page: a red leaf numbered one' },

  // Same 1:2 bitmap, three fits, so the difference is the only variable.
  {
    src: '/fixtures/canvas/tall.png',
    alt: 'Four coloured quadrants, tall, shown whole with paper bands either side',
    fit: 'contain',
  },
  {
    src: '/fixtures/canvas/tall.png',
    alt: 'The same four quadrants, filling the leaf, left and right edges cropped away',
    fit: 'cover',
  },
  {
    src: '/fixtures/canvas/tall.png',
    alt: 'The same four quadrants, stretched sideways to the shape of the leaf',
    fit: 'fill',
  },
  {
    src: '/fixtures/canvas/wide.png',
    alt: 'Three wide colour bands, held inside a paper frame four per cent of the page width',
    inset: 0.04,
  },

  // The URL is wrong on purpose: this is the broken-image glyph, not a spinner.
  {
    src: '/fixtures/canvas/no-such-image.png',
    alt: 'Deliberately missing artwork, to show how a failed image is drawn',
  },
  { src: '/fixtures/canvas/page-3.png', alt: 'Back page: a yellow leaf numbered eight' },
];

/** Leaves whose own `fit` / `inset` outrank the book-level default. */
const OVERRIDDEN = LEAVES.reduce<number[]>((acc, leaf, i) => {
  if (!('blank' in leaf) && (leaf.fit !== undefined || leaf.inset !== undefined)) acc.push(i);
  return acc;
}, []);

function setStatus(lines: string[]): void {
  status.textContent = lines.join('\n');
}

function readFit(): ImageFit {
  const v = fitSelect.value;
  return v === 'cover' || v === 'fill' || v === 'contain' ? v : 'contain';
}

function readInset(): number {
  const n = Number(insetSelect.value);
  return Number.isFinite(n) ? n : 0;
}

const book = new PageFlip(root, {
  width: 400,
  height: 300,
  size: 'stretch',
  minWidth: 240,
  maxWidth: 720,
  minHeight: 180,
  maxHeight: 540,
  usePortrait: false,
  showCover: false,
  pageBackground: '#f4ecd8',
  drawShadow: true,
  flippingTime: 600,
  respectReducedMotion: true,
  imageFit: 'contain',
  imageInset: 0,
});

(window as unknown as { flipbook: PageFlip }).flipbook = book;

function refreshStatus(extra?: string): void {
  const settings = book.getSettings();
  const lines = [
    `page ${String(book.getCurrentPageIndex())} / ${String(book.getPageCount() - 1)}`,
    `state ${book.getState()}`,
    `orientation ${book.getOrientation()}`,
    `imageFit ${settings.imageFit}`,
    `imageInset ${String(settings.imageInset)}`,
    `per-leaf overrides on pages ${OVERRIDDEN.map((i) => String(i + 1)).join(', ')}`,
  ];
  if (extra !== undefined && extra !== '') lines.push(extra);
  setStatus(lines);
}

book.on('flip', () => refreshStatus());
book.on('changeState', () => refreshStatus());
book.on('changeOrientation', () => refreshStatus());
book.on('turnRejected', (e) => {
  refreshStatus(`turnRejected: ${JSON.stringify(e.data)}`);
});

prevBtn.addEventListener('click', () => {
  book.flipPrev();
});
nextBtn.addEventListener('click', () => {
  book.flipNext();
});

function applyBookDefaults(): void {
  book.updateSettings({ imageFit: readFit(), imageInset: readInset() });
  book.update();
  refreshStatus('book default applied live via updateSettings');
}

fitSelect.addEventListener('change', applyBookDefaults);
insetSelect.addEventListener('change', applyBookDefaults);

book
  .loadFromImages(LEAVES)
  .then(() => {
    refreshStatus();
  })
  .catch((err: unknown) => {
    setStatus([`load failed: ${err instanceof Error ? err.message : String(err)}`]);
  });
