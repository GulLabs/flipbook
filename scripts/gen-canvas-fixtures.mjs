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
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Written where the harness serves them from. A symlink out of `e2e/` was the
// first attempt and is fragile across checkouts and `vite build`'s asset copy.
const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'examples',
  'vanilla',
  'public',
  'fixtures',
  'canvas',
);

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

/** Four solid quadrants — makes contain/cover/fill cropping unambiguous. */
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

console.log(`canvas fixtures -> ${outDir}`);
console.log(written.join(', '));
