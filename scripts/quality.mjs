#!/usr/bin/env node
/**
 * Local quality entry that documents the gate order.
 * Prefer `pnpm quality` / `pnpm quality:ci` package scripts — this script is a
 * thin structural preflight (OSS files + package repository URLs + core invariants).
 */
import { createRequire } from 'node:module';
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
