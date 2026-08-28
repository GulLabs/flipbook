#!/usr/bin/env node
/**
 * CI quality gate for the monorepo bootstrap.
 * Expand this to build/lint/test once package toolchains are modernized.
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
  'packages/core/package.json',
  'packages/react/package.json',
];

const missing = required.filter((f) => !existsSync(join(root, f)));
if (missing.length > 0) {
  console.error('Missing required files:\n' + missing.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

// Soft check: warn if publishable packages still point at upstream, but do not
// fail while package modernization is in flight on another branch/agent.
const expected = 'GulLabs/flipbook';
for (const dir of ['packages/core', 'packages/react']) {
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  const url = String(pkg.repository?.url ?? pkg.repository ?? '');
  if (!url.includes(expected)) {
    console.warn(`${dir}: repository.url is not yet GulLabs/flipbook (${url || 'missing'})`);
  }
}

console.log('quality: ok');
