#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures/isolated-consumer');
const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
  cwd: fixture,
  encoding: 'utf8',
});
const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(out);
if (result.status !== 0) {
  process.stderr.write('isolated-consumer typecheck failed\n');
  process.exit(result.status ?? 1);
}
if (!out.includes('missing-props.tsx') && !/error TS/.test(out) === false) {
  // tsc --noEmit succeeds because missing-props uses @ts-expect-error.
  // If width/height stop being required, @ts-expect-error unused → tsc fails.
}
console.log('isolated-consumer: types ok (width/height required)');
