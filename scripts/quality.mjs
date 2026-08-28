#!/usr/bin/env node
/**
 * Local quality entry that documents the gate order.
 * Prefer `pnpm quality` / `pnpm quality:ci` package scripts — this script is a
 * thin structural preflight (OSS files + package repository URLs + core invariants).
 */
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

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!rootPkg.pnpm?.onlyBuiltDependencies?.length) {
  console.error('root package.json must define pnpm.onlyBuiltDependencies allowlist');
  process.exit(1);
}

console.log('quality preflight: ok');
