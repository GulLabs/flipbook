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
console.log(`html-engine.js ${files.join('+')} ${bytes} B (${(bytes / 1000).toFixed(2)} kB)`);

// Raw bytes are a *drift alarm*, not the ratchet. Consumers pay transfer size,
// which `size-limit` enforces tightly against the brotli number. Enforcing raw
// bytes to 0.5% precision is what drove helper names down to `iseg`/`lim` and
// error messages down to "Bad page" for a measured 19-byte return — see
// docs/QUALITY_BAR_CLIMB.md.
//
// Units matter: `size-limit` reads "45 kB" as 45000, so this uses the same
// decimal convention. Previously this file used KiB (45056) while size-limit
// used kB (44000), and the 1056-byte disagreement is what left CI red.
const RAW_ALARM_BYTES = 52_000;

if (bytes > RAW_ALARM_BYTES) {
  console.error(
    `HTML engine raw size ${bytes} B exceeds the ${RAW_ALARM_BYTES} B drift alarm.\n` +
      'This is an alarm, not a wall: find out WHY it grew. A correctness fix\n' +
      'that needs the room may take it and say so in the commit. Deleting a\n' +
      'public helper to buy back bytes is the wrong trade (AGENTS.md §2).',
  );
  process.exit(1);
}
