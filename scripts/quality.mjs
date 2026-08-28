#!/usr/bin/env node
/**
 * Local quality entry that documents the gate order.
 * Prefer `pnpm quality` / `pnpm quality:ci` package scripts — this script is a
 * thin structural preflight (OSS files + package repository URLs + core invariants).
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const required = [
  'LICENSE',
  'NOTICE',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
  'CODEOWNERS',
  '.github/CODEOWNERS',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/dependabot.yml',
  'AGENTS.md',
  'eslint.config.mjs',
  'vitest.config.ts',
  'packages/core/package.json',
  'packages/react/package.json',
  'examples/vanilla/package.json',
  'examples/vite-react/package.json',
  'examples/nextjs/package.json',
];

const missing = required.filter((f) => !existsSync(join(root, f)));
if (missing.length > 0) {
  console.error(`Missing required files:\n${missing.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}

const expected = 'GulLabs/flipbook';
for (const dir of ['packages/core', 'packages/react']) {
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  const url = String(pkg.repository?.url ?? pkg.repository ?? '');
  if (!url.includes(expected)) {
    console.error(
      `${dir}: repository.url must point at GulLabs/flipbook (got ${url || 'missing'})`,
    );
    process.exit(1);
  }
}

const core = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'));
if (core.dependencies && Object.keys(core.dependencies).length > 0) {
  console.error(
    'packages/core must stay zero runtime dependencies; found:',
    Object.keys(core.dependencies).join(', '),
  );
  process.exit(1);
}
for (const dir of ['packages/core', 'packages/react']) {
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  const files = pkg.files ?? [];
  if (!Array.isArray(files) || !files.includes('dist') || files.includes('src')) {
    console.error(`${dir}: package.json "files" must be dist-only (got ${JSON.stringify(files)})`);
    process.exit(1);
  }
}

// pnpm >= 10 blocks dependency install scripts unless allowlisted, and reads
// the allowlist from pnpm-workspace.yaml (not package.json, as in pnpm 9).
const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
if (!/^onlyBuiltDependencies:\s*$/m.test(workspace)) {
  console.error('pnpm-workspace.yaml must define an onlyBuiltDependencies allowlist');
  process.exit(1);
}

// TypeScript must stay inside typescript-eslint's supported range. Outside it,
// `pnpm install` still succeeds and every type-aware rule quietly degrades —
// which is most of the quality bar. This is why the workspace is pinned to
// TypeScript 6 rather than the newest release; make it a loud failure, not a
// comment someone reads later.
const require_ = createRequire(import.meta.url);

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) return null;

  for (const comparator of range.trim().split(/\s+/)) {
    const match = /^(>=|<=|>|<)(\d+\.\d+\.\d+)$/.exec(comparator);
    // Only the simple comparator form is understood; anything else and the
    // check abstains rather than guessing.
    if (!match) return null;

    const bound = parseVersion(match[2]);
    if (!bound) return null;

    const order = compare(parsed, bound);
    const ok =
      (match[1] === '>=' && order >= 0) ||
      (match[1] === '>' && order > 0) ||
      (match[1] === '<=' && order <= 0) ||
      (match[1] === '<' && order < 0);

    if (!ok) return false;
  }

  return true;
}

const tsVersion = require_('typescript/package.json').version;
const tsRange = require_('typescript-eslint/package.json').peerDependencies?.typescript;
const supported = tsRange ? satisfies(tsVersion, tsRange) : null;

if (supported === false) {
  console.error(
    `TypeScript ${tsVersion} is outside typescript-eslint's supported range (${tsRange}).\n` +
      'Type-aware lint rules degrade silently outside it. Pin TypeScript back, or\n' +
      'upgrade typescript-eslint first and re-run.',
  );
  process.exit(1);
}

if (supported === null) {
  console.warn(
    `Could not check TypeScript ${tsVersion} against typescript-eslint range ${String(tsRange)}.`,
  );
}

console.log('quality preflight: ok');

// Licensing is an owner decision, not an implementation detail — and not a
// tool's. The owner relicensed the engine to MPL-2.0 on 2026-08-28 so that
// forks of the engine cannot be taken closed, while keeping the React binding
// MIT and leaving consuming applications entirely unencumbered (MPL-2.0 is
// file-level copyleft: it reaches the engine's own files, nothing else).
// Upstream Nodlik MIT notices stay preserved in LICENSE and NOTICE.
// If you are changing this, the repository owner has decided to.
const EXPECTED_LICENSES = {
  'package.json': 'MIT AND MPL-2.0',
  'packages/core/package.json': 'MPL-2.0',
  'packages/react/package.json': 'MIT',
};

for (const [manifest, expected] of Object.entries(EXPECTED_LICENSES)) {
  const pkg = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  if (pkg.license !== expected) {
    console.error(
      `${manifest}: license is ${JSON.stringify(pkg.license)}, expected ${JSON.stringify(expected)}.\n` +
        'Relicensing is an owner decision. Revert, or get explicit sign-off first.',
    );
    process.exit(1);
  }
}

// Byte-exact, not substring. A marker list accepts a file that keeps every
// heading while §3.2 is quietly rewritten, which is precisely the edit that
// would matter. The digest below is SHA-256 of the canonical MPL-2.0 text as
// published at https://www.mozilla.org/media/MPL/2.0/index.txt (16726 bytes).
// It is a constant of the license, not of this repo: it changes only if Mozilla
// publishes a new version, in which case that is a deliberate relicense.
const MPL_2_0_SHA256 = '3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04';
const MPL_TAIL_MARKER =
  '\n-------------------------------------------------------------------------------\n\n@gullabs/flipbook-core is Copyright';

const coreLicense = readFileSync(join(root, 'packages/core/LICENSE'), 'utf8');
const tailAt = coreLicense.indexOf(MPL_TAIL_MARKER);
if (tailAt === -1) {
  console.error(
    'packages/core/LICENSE: the MPL-2.0 text and the GulLabs/upstream notice block are no longer separated as expected.',
  );
  process.exit(1);
}
const mplBody = `${coreLicense.slice(0, tailAt).replace(/\n+$/, '')}\n`;
const mplDigest = createHash('sha256').update(mplBody).digest('hex');
if (mplDigest !== MPL_2_0_SHA256) {
  console.error(
    `packages/core/LICENSE: the MPL-2.0 text is not byte-identical to the canonical license.\n` +
      `  expected sha256 ${MPL_2_0_SHA256}\n` +
      `  actual   sha256 ${mplDigest}\n` +
      'Restore it from https://www.mozilla.org/media/MPL/2.0/index.txt.',
  );
  process.exit(1);
}

// Both upstream notices, not just one. Checking a single Nodlik substring let a
// rewrite that drops react-pageflip's notice through.
// `fullText` marks the files that must reproduce the MIT grant verbatim. NOTICE
// only summarises and points at LICENSE, so it is attribution-only.
const UPSTREAM_NOTICES = [
  {
    file: 'LICENSE',
    needles: ['Copyright (c) 2020 Nodlik', 'Copyright (c) 2020 oleg.litovski9@gmail.com'],
    fullText: true,
  },
  {
    file: 'NOTICE',
    needles: ['Copyright (c) 2020 Nodlik', 'Copyright (c) 2020 oleg.litovski9@gmail.com'],
    fullText: false,
  },
  { file: 'packages/core/LICENSE', needles: ['Copyright (c) 2020 Nodlik'], fullText: true },
  { file: 'packages/react/LICENSE', needles: ['Copyright (c) 2026 GulLabs'], fullText: true },
];

for (const { file, needles, fullText } of UPSTREAM_NOTICES) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const needle of needles) {
    if (!text.includes(needle)) {
      console.error(`${file}: required notice is missing — ${JSON.stringify(needle)}.`);
      process.exit(1);
    }
  }
  if (fullText && !text.includes('THE SOFTWARE IS PROVIDED "AS IS"')) {
    console.error(`${file}: the MIT warranty disclaimer is missing.`);
    process.exit(1);
  }
}
