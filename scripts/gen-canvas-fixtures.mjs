/**
 * Generate the deterministic PNG fixtures the canvas e2e harness samples.
 *
 * These are written by a script rather than committed as opaque blobs so the
 * exact pixel at every probe point is derivable from source. The e2e assertions
 * name the same constants, so a fixture and its test cannot drift apart
 * silently.
 *
 * No image library: a PNG is a header, one zlib-deflated block of filtered
 * scanlines, and a trailer. Doing it by hand keeps the repo's zero-dependency
 * posture and is about 40 lines.
 *
 *   node ./scripts/gen-canvas-fixtures.mjs
 *
 * Phase 2 fixtures (ADR 0001) are included so pixel tests can land ahead of
 * the engine implementation: known solids, known aspect ratios for
 * contain/cover/fill, a deliberately broken URL target, and a blank-leaf
 * probe colour.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Written where the harness AND the React demo serve them from. A symlink out
// of `e2e/` was the first attempt and is fragile across checkouts and
// `vite build`'s asset copy. Two out dirs keep each example self-contained.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDirs = [
  join(root, 'examples', 'vanilla', 'public', 'fixtures', 'canvas'),
  join(root, 'examples', 'vite-react', 'public', 'fixtures', 'canvas'),
];

// ---------------------------------------------------------------------------
// Minimal PNG writer (RGBA, 8-bit, no interlace)
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 = compression, filter, interlace — all zero.

  // Filter byte 0 (None) per scanline. Deterministic and trivially verifiable.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

function surface(width, height, fill) {
  const buf = Buffer.alloc(width * height * 4);
  if (fill) {
    const [r, g, b, a = 255] = fill;
    for (let i = 0; i < width * height; i++) {
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = a;
    }
  }
  return buf;
}

function rect(buf, width, x0, y0, x1, y1, [r, g, b, a = 255]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
}

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

const W = 400;
const H = 300;

/** Identity colour per page. Sampled at the leaf centre to say WHICH page. */
export const PAGE_COLORS = [
  '#e5484d', // 0 red
  '#3b82f6', // 1 blue
  '#22c55e', // 2 green
  '#facc15', // 3 yellow
  '#a855f7', // 4 purple
  '#f97316', // 5 orange
];

/**
 * Solid paper colours used as `pageBackground` / blank-leaf probes.
 * Distinct from PAGE_COLORS so a blank leaf cannot pass a "page painted" test.
 */
export const PAPER = {
  cream: '#f4ecd8',
  // Deliberately loud so letterbox / blank / error-fallback probes cannot
  // confuse paper with a missing sample (transparent black reads near 0,0,0).
  magenta: '#ff00aa',
  // Error-fallback paper when a glyph is drawn on top (ADR Decision 2 + glyph).
  errorPaper: '#e8e0d0',
};

/** Corner markers identify orientation and catch mirroring. */
const CORNERS = {
  tl: '#ffffff',
  tr: '#000000',
  bl: '#00ffff',
  br: '#ff00ff',
};

/**
 * The far-edge band sits at CENTRE HEIGHT across 80–90% of the width, so the
 * `rect.left + 1.85 * pageWidth` probe lands inside it. Corner markers are at
 * the extreme edge where resampling is least trustworthy, so they are
 * deliberately not used for that probe.
 */
const FAR_EDGE = { x0: 320, y0: 130, x1: 360, y1: 170 };

/** 60% luminance of the identity colour — same hue, unambiguously darker. */
const dim = ([r, g, b]) => [Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6)];

function page(index) {
  const base = hex(PAGE_COLORS[index]);
  const buf = surface(W, H, base);

  rect(buf, W, 0, 0, 40, 40, hex(CORNERS.tl));
  rect(buf, W, W - 40, 0, W, 40, hex(CORNERS.tr));
  rect(buf, W, 0, H - 40, 40, H, hex(CORNERS.bl));
  rect(buf, W, W - 40, H - 40, W, H, hex(CORNERS.br));
  rect(buf, W, FAR_EDGE.x0, FAR_EDGE.y0, FAR_EDGE.x1, FAR_EDGE.y1, dim(base));

  return encodePng(W, H, buf);
}

/** Opaque 40px magenta border around a fully transparent centre (G2). */
function transparencyFixture() {
  const buf = surface(W, H, null); // alpha 0 everywhere
  rect(buf, W, 0, 0, W, 40, hex('#ff00ff'));
  rect(buf, W, 0, H - 40, W, H, hex('#ff00ff'));
  rect(buf, W, 0, 0, 40, H, hex('#ff00ff'));
  rect(buf, W, W - 40, 0, W, H, hex('#ff00ff'));
  return encodePng(W, H, buf);
}

/**
 * Four solid quadrants — makes contain/cover/fill cropping unambiguous.
 *
 * Leaf geometry in the harness is 400×300 (4:3). Against that:
 *   tall  200×400 (1:2) — contain letterboxes left/right; cover crops top/bottom
 *   wide  600×200 (3:1) — contain letterboxes top/bottom; cover crops left/right
 *   square 300×300 (1:1) — contain letterboxes left/right
 *
 * Centre of a contain-fitted tall image lands on the red/blue vertical split
 * (x = half of image width after scale). Cover of the same image crops the
 * top and bottom so the leaf centre is still on that split, but the top edge
 * of the leaf is green/yellow rather than paper.
 */
function quadrants(width, height) {
  const buf = surface(width, height, hex('#111111'));
  const mx = Math.floor(width / 2);
  const my = Math.floor(height / 2);
  rect(buf, width, 0, 0, mx, my, hex('#e5484d'));
  rect(buf, width, mx, 0, width, my, hex('#3b82f6'));
  rect(buf, width, 0, my, mx, height, hex('#22c55e'));
  rect(buf, width, mx, my, width, height, hex('#facc15'));
  return encodePng(width, height, buf);
}

/**
 * Extreme aspect for fractional-inset probes: a 100×500 stripe so a 2.8%
 * inset of page width is a measurable band of paper around a thin centre.
 */
function stripe() {
  const width = 100;
  const height = 500;
  const buf = surface(width, height, hex('#0ea5e9'));
  // Centre crosshair so a cover crop still has a known centre colour.
  rect(buf, width, 40, 240, 60, 260, hex('#111111'));
  return encodePng(width, height, buf);
}

/**
 * Deliberately invalid PNG bytes under a `.png` extension.
 *
 * A 404 is one failure mode; a 200 with undecodable body is another. The
 * harness can point at either. This file is served (so the network succeeds)
 * and must fail decode — proving the engine's error path is not only the
 * missing-URL case.
 */
function corruptPng() {
  // Valid PNG signature, then garbage — decoders reject after the header.
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0xde, 0xad, 0xbe, 0xef,
  ]);
}

function writeAll(outDir) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (let i = 0; i < PAGE_COLORS.length; i++) {
    const name = `page-${String(i)}.png`;
    writeFileSync(join(outDir, name), page(i));
    written.push(name);
  }
  writeFileSync(join(outDir, 'transparent.png'), transparencyFixture());
  written.push('transparent.png');
  writeFileSync(join(outDir, 'tall.png'), quadrants(200, 400));
  written.push('tall.png');
  writeFileSync(join(outDir, 'wide.png'), quadrants(600, 200));
  written.push('wide.png');
  writeFileSync(join(outDir, 'square.png'), quadrants(300, 300));
  written.push('square.png');
  writeFileSync(join(outDir, 'stripe.png'), stripe());
  written.push('stripe.png');
  writeFileSync(join(outDir, 'corrupt.png'), corruptPng());
  written.push('corrupt.png');

  // A 1×1 fully-transparent pixel — used only as a negative-control companion
  // when asserting "this leaf is blank paper", never as a page the book should
  // paint as content.
  writeFileSync(join(outDir, 'empty.png'), encodePng(1, 1, surface(1, 1, null)));
  written.push('empty.png');
  return written;
}

for (const outDir of outDirs) {
  const written = writeAll(outDir);
  console.log(`canvas fixtures -> ${outDir}`);
  console.log(written.join(', '));
}
