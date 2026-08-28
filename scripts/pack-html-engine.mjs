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

// Concatenate the already-terser'd ESM chunks (canvas stays out).
// A full esbuild re-bundle of minified ESM expands identifiers (`i`→`i2`)
// and is a net loss — measured 2026-08-28.
let body = files.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');

// Drop static cross-chunk import/re-export glue. After concatenation the
// bindings already live in the same text; consumers' bundlers erase this
// linkage, so counting it inflated the size-check. Keep dynamic
// `import("./canvas-loader-…")` — that is real runtime code.
body = body
  .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/chunk-[^"']+["'];?/g, '')
  .replace(/export\s*\{[^}]*\}\s*from\s*["']\.\/chunk-[^"']+["'];?/g, '')
  // Source-map comments are not shipped in the size budget payload.
  .replace(/\/\/# sourceMappingURL=[^\n]*/g, '');

const out = join(outDir, 'html-engine.js');
writeFileSync(out, body);
const bytes = Buffer.byteLength(body);
console.log('html-engine.js', files.join('+'), bytes, 'bytes', (bytes / 1024).toFixed(2), 'KiB');

// Two budgets, both enforced by size-limit as well: raw bytes here, and the
// brotli number consumers actually pay for. The spec's §5 target is 35 KiB raw
// and the engine is over it — see docs/QUALITY_BAR_CLIMB.md. This ceiling
// exists to stop the number drifting further, not to bless it.
// Honest floor after dropping broken cross-chunk mangle.properties (was 48,
// briefly claimed 42 with a broken build). Do not raise past 48 (AGENTS.md).
const RAW_BUDGET_KIB = 44;

if (bytes > RAW_BUDGET_KIB * 1024) {
  console.error(`HTML engine exceeds ${RAW_BUDGET_KIB} KiB uncompressed`);
  process.exit(1);
}
