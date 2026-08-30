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

// The `updateSettings` refusal warning has to survive minification. It is the
// only signal a consumer gets that a construction-time setting was ignored —
// the value is refused, `getSettings()` honestly reports the old one, and
// without this line nothing says why. Terser's `drop_console: true` removed it
// from every published build, so the diagnostic existed in development only.
//
// Asserted on the packed output rather than trusted to the config, because the
// config LOOKED correct while being wrong: `drop_console: { exclude: ['warn'] }`
// is esbuild's option shape, and terser coerces the object to truthy and drops
// everything. Nothing failed; the warning simply was not there.
// Matched on the DIAGNOSTIC TEXT, not on `console.warn`. Any future eager
// `console.warn` anywhere in the engine would satisfy a bare method check while
// this exact warning had silently disappeared — the assertion would then be
// guarding the presence of console calls in general, which is not the property
// anyone cares about.
const REFUSAL_WARNING = 'updateSettings ignored construction-time setting';

if (!body.includes(REFUSAL_WARNING)) {
  console.error(
    'The updateSettings refusal warning did not survive minification.\n' +
      "Terser's `drop_console` takes a LIST of console methods to REMOVE;\n" +
      "`true`, or esbuild's `{ exclude: [...] }` object, strips every one of\n" +
      'them — including the only diagnostic a consumer gets for a setting the\n' +
      `engine refused. Looked for: ${JSON.stringify(REFUSAL_WARNING)}.\n` +
      'See packages/core/tsup.config.ts.',
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
// Raised 58_000 → 62_000 on 2026-08-29 for Phase 2, and this comment is the
// "say what was added" AGENTS.md §2 requires of a ceiling raise. Measured
// growth: 59_549 B raw / 14.93 kB brotli, against 58_000 / 14 kB.
//
// What bought it: canvas leaf descriptors with required `alt`, blank leaves as
// a first-class variant, fit modes (`contain`/`cover`/`fill`) with fractional
// insets, per-leaf backgrounds, the broken-image glyph, and the public
// `getPageAltText` accessors that make canvas accessibility implementable at
// all. Roughly 460 B of it is `validateCanvasLeaves` being EAGER in the
// HTML-only graph — forced, because validation must run before the canvas chunk
// is fetched or an invalid list either builds a canvas or cancels a good load
// already in flight. The renderer itself stays lazy: `ImagePageCollection`,
// `ImagePage` and `imageFit` are all absent from this file (verified by grep,
// not assumed).
//
// This is headroom spent on a feature, which is what headroom is for. It is NOT
// the ratcheting AGENTS.md §2 warns about — that was 35→45→47→48 with no reason
// attached, to turn a red gate green.
const RAW_ALARM_BYTES = 62_000;

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
