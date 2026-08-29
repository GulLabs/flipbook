import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/core/dist');
const outDir = join(root, 'packages/core/size-check');
mkdirSync(outDir, { recursive: true });

const allJs = readdirSync(dist)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.map') && f !== 'html-engine.js')
  .sort();

const canvasFiles = allJs.filter((f) => f.includes('canvas-loader'));
const files = allJs.filter((f) => !f.includes('canvas-loader'));

// The canvas renderer is the one genuinely separable unit in this package, and
// keeping it out of the eager graph is an *architectural* property — not
// something the byte ceiling can protect. A static `import { CanvasRender }`
// would pull ~5.8 kB into the main chunk and still land under the raw ceiling,
// so the size gate would go green on exactly the regression it looks like it
// guards. These assertions are what actually holds the boundary; the filename
// filter above only decides what gets counted.
if (canvasFiles.length !== 1) {
  const found = canvasFiles.length > 0 ? `: ${canvasFiles.join(', ')}` : '';
  console.error(
    `Expected exactly one lazily-imported canvas chunk in dist, found ${canvasFiles.length}${found}.\n` +
      `If tsup changed its chunk naming, this script has been silently\n` +
      `measuring the wrong set of files. Fix the boundary, not the filter.`,
  );
  process.exit(1);
}

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

// Canvas must be reachable only through a dynamic import, and its renderer must
// not have leaked into the eager graph. `getContext` is the marker: both
// `CanvasUI` and `CanvasRender` acquire a 2d context, and nothing on the HTML
// path touches one.
if (!/import\(\s*["']\.\/canvas-loader-/.test(body)) {
  console.error(
    'The HTML engine no longer dynamically imports the canvas loader.\n' +
      'Canvas mode must stay behind `import("./canvas-loader")` so HTML-only\n' +
      'consumers never download it.',
  );
  process.exit(1);
}

if (body.includes('getContext')) {
  console.error(
    'Canvas renderer code leaked into the eager HTML engine graph (found\n' +
      '`getContext`). Something now imports CanvasRender/CanvasUI statically.\n' +
      'This costs every HTML-only consumer the canvas renderer, and it fits\n' +
      'under the raw ceiling, so the size gate will NOT catch it.',
  );
  process.exit(1);
}

const out = join(outDir, 'html-engine.js');
writeFileSync(out, body);
const bytes = Buffer.byteLength(body);
console.log(`html-engine.js ${files.join('+')} ${bytes} B (${(bytes / 1000).toFixed(2)} kB)`);

// Raw bytes track parse/compile cost and catch gross drift — an accidental
// dependency, a broken tree-shake, a duplicated runtime. Transfer size is
// enforced separately by `size-limit` (brotli *and* gzip: not every consumer's
// CDN negotiates brotli). This is a wall — it exits non-zero — but it is set
// with headroom, because enforcing raw bytes to 0.5% precision is what drove
// helper names down to `iseg`/`lim` and error messages down to "Bad page" for a
// measured 19-byte return — see docs/QUALITY_BAR_CLIMB.md.
//
// Note this file is a concatenated envelope of the shipped chunks, not what a
// consumer's bundler emits for `import { PageFlip }`. It is a drift signal, not
// a per-consumer payload figure.
//
// Units matter: `size-limit` reads "45 kB" as 45000, so this uses the same
// decimal convention. Previously this file used KiB (45056) while size-limit
// used kB (44000), and the 1056-byte disagreement is what left CI red.
const RAW_ALARM_BYTES = 52_000;

if (bytes > RAW_ALARM_BYTES) {
  console.error(
    `HTML engine raw size ${bytes} B exceeds the ${RAW_ALARM_BYTES} B ceiling.\n` +
      'This fails the build. Find out WHY it grew before deciding what to do:\n' +
      'a correctness fix or a feature may take the room, with an owner-approved\n' +
      'ceiling raise that says what was added. Deleting a public helper or\n' +
      'golfing identifiers to buy back bytes is the wrong trade (AGENTS.md §2).',
  );
  process.exit(1);
}
