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
// Two budgets, both enforced by size-limit as well: raw bytes here, and the
// brotli number consumers actually pay for. The spec's §5 target is 35 KiB raw
// and the engine is over it — see docs/QUALITY_BAR_CLIMB.md. This ceiling
// exists to stop the number drifting further, not to bless it.
const RAW_BUDGET_KIB = 48;

if (bytes > RAW_BUDGET_KIB * 1024) {
  console.error(`HTML engine exceeds ${RAW_BUDGET_KIB} KiB uncompressed`);
  process.exit(1);
}
