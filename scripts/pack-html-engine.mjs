import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/core/dist');
const files = readdirSync(dist)
  .filter((f) => f.endsWith('.js') && !f.includes('canvas-loader') && !f.endsWith('.map'))
  .sort();
const parts = files.map((f) => readFileSync(join(dist, f), 'utf8'));
const out = join(dist, 'html-engine.js');
writeFileSync(out, parts.join('\n'));
const bytes = Buffer.byteLength(parts.join('\n'));
console.log('html-engine.js', files.join('+'), bytes, 'bytes', (bytes / 1024).toFixed(2), 'KiB');
if (bytes > 45 * 1024) {
  console.error(
    'html-engine.js exceeds 45 KiB uncompressed (upstream StPageFlip minifies to ~42 KiB)',
  );
  process.exit(1);
}
