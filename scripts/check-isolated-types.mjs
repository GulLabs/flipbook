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
// missing-props.tsx uses @ts-expect-error: unused error if width/height stop being required.
console.log('isolated-consumer: types ok (width/height required)');
