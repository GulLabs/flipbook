import { PageFlip } from '@gullabs/flipbook-core';

/**
 * Public canvas/images showcase (defect F3).
 *
 * Written against ADR 0001 (`docs/adr/0001-image-page-api.md`). Today the engine
 * still accepts `string[]` for `loadFromImages`; descriptors are attempted first
 * and we fall back to bare URLs so the demo runs on both sides of the Phase 2
 * cut. If calling the ADR shape feels awkward once descriptors land, that is a
 * product finding — say so rather than papering over it.
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

type ImagePageSource = {
  src: string;
  alt: string;
  fit?: 'contain' | 'cover' | 'fill';
  inset?: number;
};

/** Identity fixtures from `scripts/gen-canvas-fixtures.mjs`. */
const IMAGES: ImagePageSource[] = [
  { src: '/fixtures/canvas/page-0.png', alt: 'Page 1 — red leaf' },
  { src: '/fixtures/canvas/page-1.png', alt: 'Page 2 — blue leaf' },
  { src: '/fixtures/canvas/tall.png', alt: 'Tall quadrants (1:2) — fit demo' },
  { src: '/fixtures/canvas/wide.png', alt: 'Wide quadrants (3:1) — fit demo' },
  { src: '/fixtures/canvas/page-2.png', alt: 'Page 5 — green leaf' },
  { src: '/fixtures/canvas/page-3.png', alt: 'Page 6 — yellow leaf' },
];

function setStatus(lines: string[]): void {
  status.textContent = lines.join('\n');
}

function readFit(): 'contain' | 'cover' | 'fill' {
  const v = fitSelect.value;
  return v === 'cover' || v === 'fill' || v === 'contain' ? v : 'contain';
}

function readInset(): number {
  const n = Number(insetSelect.value);
  return Number.isFinite(n) ? n : 0;
}

function settingsBag(): Record<string, unknown> {
  return book.getSettings() as unknown as Record<string, unknown>;
}

const book = new PageFlip(root, {
  width: 400,
  height: 300,
  size: 'stretch',
  minWidth: 240,
  maxWidth: 720,
  minHeight: 180,
  maxHeight: 540,
  usePortrait: true,
  showCover: false,
  pageBackground: '#f4ecd8',
  drawShadow: true,
  flippingTime: 600,
  respectReducedMotion: true,
});

(window as unknown as { flipbook: PageFlip }).flipbook = book;

let usedDescriptors = false;
let fitSupported = false;

function refreshStatus(extra?: string): void {
  const settings = settingsBag();
  const fitVal = settings['imageFit'];
  const fitLabel = typeof fitVal === 'string' ? fitVal : '—';
  const lines = [
    `page ${String(book.getCurrentPageIndex())} / ${String(book.getPageCount() - 1)}`,
    `state ${book.getState()}`,
    `orientation ${book.getOrientation()}`,
    `descriptors ${usedDescriptors ? 'yes' : 'no (string[] fallback)'}`,
    `imageFit setting ${fitSupported ? fitLabel : 'not in engine yet'}`,
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

async function loadBook(): Promise<void> {
  const fit = readFit();
  const inset = readInset();
  const settings = settingsBag();
  // Do not try descriptors and catch: pre-Phase-2 coerces objects to
  // "[object Object]" and resolves. Gate on settings the ADR adds.
  fitSupported =
    Object.prototype.hasOwnProperty.call(settings, 'imageFit') ||
    Object.prototype.hasOwnProperty.call(settings, 'imageInset') ||
    Object.prototype.hasOwnProperty.call(settings, 'imageLoadRadius');

  if (fitSupported) {
    const descriptors = IMAGES.map((img) => ({ ...img, fit, inset }));
    await book.loadFromImages(descriptors as unknown as string[]);
    usedDescriptors = true;
    try {
      book.updateSettings({
        imageFit: fit,
        imageInset: inset,
      } as Parameters<PageFlip['updateSettings']>[0]);
    } catch {
      fitSupported = false;
    }
  } else {
    await book.loadFromImages(IMAGES.map((img) => img.src));
    usedDescriptors = false;
  }

  refreshStatus(
    fitSupported
      ? undefined
      : 'Fit/inset controls are wired; engine does not expose imageFit yet (Phase 2).',
  );
}

prevBtn.addEventListener('click', () => {
  book.flipPrev();
});
nextBtn.addEventListener('click', () => {
  book.flipNext();
});

fitSelect.addEventListener('change', () => {
  reloadForFit();
});
insetSelect.addEventListener('change', () => {
  reloadForFit();
});

function reloadForFit(): void {
  const fit = readFit();
  const inset = readInset();
  const settings = settingsBag();

  if ('imageFit' in settings || 'imageInset' in settings) {
    try {
      book.updateSettings({
        imageFit: fit,
        imageInset: inset,
      } as Parameters<PageFlip['updateSettings']>[0]);
      book.update();
      fitSupported = true;
      refreshStatus('fit applied via updateSettings');
      return;
    } catch {
      // fall through
    }
  }

  refreshStatus(
    `fit=${fit} inset=${String(inset)} — engine still stretches (A3). Phase 2 imageFit will honour this.`,
  );
}

void loadBook().catch((err: unknown) => {
  setStatus([`load failed: ${err instanceof Error ? err.message : String(err)}`]);
});
