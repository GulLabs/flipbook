import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MPL-2.0 §3.2 asks that recipients of the Executable Form be told where the
 * Source Code Form lives. The npm tarball already ships LICENSE and a
 * `repository` field, which satisfies that on its own — this banner is the
 * courtesy copy that survives into a consumer's own bundle, where the tarball
 * does not follow.
 *
 * It runs *after* `pack-html-engine.mjs` on purpose: the drift alarm measures
 * engine code, and a legal comment is not engine code. Bundlers preserve it
 * because of the `/*!` marker, so consumers do pay these bytes — keep it to one
 * line if it ever needs editing.
 */
const banner =
  '/*! @gullabs/flipbook-core | MPL-2.0 | source: https://github.com/GulLabs/flipbook */\n';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/core/dist');

for (const file of readdirSync(dist)) {
  if (!file.endsWith('.js') && !file.endsWith('.cjs')) continue;
  const path = join(dist, file);
  const src = readFileSync(path, 'utf8');
  if (src.startsWith(banner)) continue;
  writeFileSync(path, banner + src);
}
console.log('MPL banner applied to packages/core/dist');
