import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages/core/src/Style/stPageFlip.css');
const dest = join(root, 'packages/core/dist/style.css');
if (!existsSync(src)) {
  console.warn('copy-css: source CSS missing, skip');
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('copied', dest);
