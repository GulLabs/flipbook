#!/usr/bin/env node
/**
 * Per-area coverage floors (lines / branches). Coverage is a byproduct of real
 * tests — this script only fails when a key file drops under its target.
 *
 * Run after `pnpm test:coverage` (needs coverage/coverage-final.json).
 *
 * Usage: node ./scripts/check-coverage-areas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const COVERAGE_FILE = path.join(ROOT, 'coverage', 'coverage-final.json');

/** @type {Array<{ label: string, match: RegExp, lines: number, branches: number }>} */
const AREAS = [
  {
    label: 'FlipCalculation.ts',
    match: /[/\\]Flip[/\\]FlipCalculation\.ts$/,
    lines: 93,
    branches: 85,
  },
  { label: 'UI.ts', match: /[/\\]UI[/\\]UI\.ts$/, lines: 86, branches: 66 },
  { label: 'HTMLRender.ts', match: /[/\\]Render[/\\]HTMLRender\.ts$/, lines: 89, branches: 63 },
  { label: 'HTMLPage.ts', match: /[/\\]Page[/\\]HTMLPage\.ts$/, lines: 98, branches: 73 },
  { label: 'Flip.ts', match: /[/\\]Flip[/\\]Flip\.ts$/, lines: 86, branches: 78 },
  { label: 'CanvasRender.ts', match: /[/\\]Render[/\\]CanvasRender\.ts$/, lines: 87, branches: 70 },
  { label: 'ImagePage.ts', match: /[/\\]Page[/\\]ImagePage\.ts$/, lines: 86, branches: 64 },
  // Lines eased 92 -> 91 for the `instanceof PageFlipError` rethrows added
  // when explicit navigation stopped swallowing non-engine errors: those
  // lines only execute when something else is already broken, and React's
  // synthetic event boundary absorbs the rethrow so they cannot be asserted
  // from this layer (the engine-level equivalent is covered in
  // packages/core/tests/lifecycle.test.ts). Branches ratchet up 77 -> 78.
  { label: 'HTMLFlipBook.tsx', match: /[/\\]HTMLFlipBook\.tsx$/, lines: 91, branches: 78 },
  { label: 'usePageFlip.ts', match: /[/\\]usePageFlip\.ts$/, lines: 98, branches: 98 },
];

function pct(hit, total) {
  if (total === 0) return 100;
  return (100 * hit) / total;
}

function summarize(fileCoverage) {
  const s = fileCoverage.s ?? {};
  const b = fileCoverage.b ?? {};
  const statementHits = Object.values(s);
  const branchHits = Object.values(b).flat();
  const lines = pct(statementHits.filter((n) => n > 0).length, statementHits.length);
  const branches = pct(branchHits.filter((n) => n > 0).length, branchHits.length);
  return { lines, branches };
}

if (!fs.existsSync(COVERAGE_FILE)) {
  console.error(`Missing ${COVERAGE_FILE}. Run \`pnpm test:coverage\` first.`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
const files = Object.keys(data);

let failed = 0;
const rows = [];

for (const area of AREAS) {
  const key = files.find((f) => area.match.test(f));
  if (!key) {
    console.error(`✗ ${area.label}: not found in coverage-final.json`);
    failed += 1;
    continue;
  }
  const { lines, branches } = summarize(data[key]);
  const okLines = lines + 1e-9 >= area.lines;
  const okBranches = branches + 1e-9 >= area.branches;
  const mark = okLines && okBranches ? '✓' : '✗';
  rows.push({
    mark,
    label: area.label,
    lines: lines.toFixed(1),
    branches: branches.toFixed(1),
    target: `${area.lines}/${area.branches}`,
  });
  if (!okLines || !okBranches) {
    failed += 1;
    console.error(
      `✗ ${area.label}: lines ${lines.toFixed(1)}% (need ≥${area.lines}), ` +
        `branches ${branches.toFixed(1)}% (need ≥${area.branches})`,
    );
  }
}

console.log('\nPer-area coverage (lines% / branches% vs target):');
for (const r of rows) {
  console.log(`  ${r.mark} ${r.label.padEnd(20)} ${r.lines}/${r.branches}  (target ${r.target})`);
}

if (failed > 0) {
  console.error(`\n${failed} area(s) under target.`);
  process.exit(1);
}

console.log('\nAll coverage areas meet their floors.');
