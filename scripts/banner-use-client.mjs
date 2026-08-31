import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/react/dist');
const banner = '"use client";\n';
for (const name of ['index.js', 'index.cjs']) {
  const file = join(dist, name);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  if (src.startsWith('"use client"') || src.startsWith("'use client'")) continue;
  writeFileSync(file, banner + src);
  console.log('bannered', file);
}
