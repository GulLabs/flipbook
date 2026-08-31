import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLIPBOOK_CSS } from '../packages/core/dist/index.js';

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/core/dist/style.css');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, FLIPBOOK_CSS);
console.log('copied', dest);
