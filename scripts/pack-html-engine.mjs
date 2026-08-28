import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/core/dist');
const outDir = join(root, 'packages/core/size-check');
mkdirSync(outDir, { recursive: true });

const files = readdirSync(dist)
  .filter(
    (f) =>
      f.endsWith('.js') &&
      !f.includes('canvas-loader') &&
      !f.endsWith('.map') &&
      f !== 'html-engine.js',
  )
  .sort();
const body = files.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
const out = join(outDir, 'html-engine.js');
writeFileSync(out, body);
const bytes = Buffer.byteLength(body);
console.log('html-engine.js', files.join('+'), bytes, 'bytes', (bytes / 1024).toFixed(2), 'KiB');
if (bytes > 45 * 1024) {
  console.error(
    'HTML engine exceeds 45 KiB uncompressed (upstream StPageFlip minifies to ~42 KiB ESM)',
  );
  process.exit(1);
}
