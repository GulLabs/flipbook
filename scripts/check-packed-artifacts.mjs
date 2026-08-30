#!/usr/bin/env node
/**
 * Verify what npm will actually publish.
 *
 * `fixtures/isolated-consumer` links the workspace with `workspace:*`, so it
 * type-checks against `src/` through a symlink and validates NEITHER the
 * `files` allow-list NOR the `exports` map. Every packaging defect this file
 * exists to catch is invisible there:
 *
 *   - `exports["."].types` pointing at a single `.d.ts` in a `"type":"module"`
 *     package, so a CommonJS TypeScript consumer under `moduleResolution:
 *     "node16"` gets TS1479 and cannot import the package at all — even though
 *     `dist/index.d.cts` is built and shipped, just never referenced.
 *   - a path in `exports` / `main` / `module` / `types` that is not inside the
 *     `files` allow-list, so it resolves in the repo and 404s from the tarball.
 *   - `workspace:*` surviving into a published manifest, which makes the
 *     package uninstallable for everyone.
 *   - source, tests or build config leaking into the tarball.
 *   - the LICENSE (and the upstream notices it must reproduce) not shipping.
 *
 * This packs both packages for real, unpacks the tarballs into a throwaway
 * consumer, and exercises them the way a consumer does: Node ESM, Node CJS,
 * and `tsc` under both `moduleResolution: "bundler"` and `"node16"`.
 *
 * It is deliberately offline: react / react-dom / @types are symlinked from the
 * workspace store rather than installed, so the gate cannot fail on the network.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(join(root, 'package.json'));

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  return false;
};
const ok = (msg) => console.log(`  ok  ${msg}`);
/**
 * Print the `ok` line only when nothing in this group failed. Printing it
 * unconditionally after a `fail()` is how a red check reads green.
 */
const report = (passed, msg) => {
  if (passed) ok(msg);
};

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const work = mkdtempSync(join(tmpdir(), 'flipbook-packed-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

// --------------------------------------------------------------------------
// 1. Pack both packages for real.
// --------------------------------------------------------------------------
const PACKAGES = [
  {
    name: '@gullabs/flipbook-core',
    dir: 'packages/core',
    license: 'MPL-2.0',
    // The engine forks StPageFlip only.
    notices: ['Copyright (c) 2020 Nodlik'],
  },
  {
    name: '@gullabs/react-flipbook',
    dir: 'packages/react',
    license: 'MIT',
    // The binding forks react-pageflip, and its LICENSE reproduces both
    // upstream notices because it ships alongside the engine.
    notices: ['Copyright (c) 2020 oleg.litovski9@gmail.com', 'Copyright (c) 2020 Nodlik'],
  },
];

console.log(`packed-artifact check (${work})`);

const packDir = join(work, 'tarballs');
mkdirSync(packDir, { recursive: true });

for (const pkg of PACKAGES) {
  // `--ignore-scripts`: prepack rebuilds, and the gate already built. Packing
  // what is on disk is also the point — it is what `changeset publish` uploads.
  run('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', packDir], { cwd: root });
  const tarball = join(
    packDir,
    `${pkg.name.replace('@', '').replace('/', '-')}-${JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8')).version}.tgz`,
  );
  if (!existsSync(tarball)) {
    fail(`${pkg.name}: expected tarball at ${tarball}`);
    continue;
  }
  pkg.tarball = tarball;
  pkg.entries = run('tar', ['tzf', tarball])
    .split('\n')
    .filter(Boolean)
    .map((p) => p.replace(/^package\//, ''))
    .filter((p) => p && !p.endsWith('/'));
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}

// --------------------------------------------------------------------------
// 2. Assert the tarball contents.
// --------------------------------------------------------------------------
// Anything matching these must never ship: it is source, tests, or build
// config that the `files` allow-list is supposed to exclude.
const FORBIDDEN = [
  /^src\//,
  /^tests?\//,
  /^size-check\//,
  /^node_modules\//,
  /^tsconfig.*\.json$/,
  /^tsup\.config\./,
  /\.tsbuildinfo$/,
  /^\.env/,
  /^\.npmrc$/,
  /\.gif$/,
];

for (const pkg of PACKAGES) {
  console.log(`\n${pkg.name}`);
  const manifest = JSON.parse(run('tar', ['xzOf', pkg.tarball, 'package/package.json']));
  const has = (p) => pkg.entries.includes(p);

  let passed = true;
  for (const entry of pkg.entries) {
    if (FORBIDDEN.some((re) => re.test(entry)))
      passed = fail(`${pkg.name}: must not ship ${entry}`);
  }
  for (const required of ['LICENSE', 'README.md', 'package.json']) {
    if (!has(required)) passed = fail(`${pkg.name}: tarball is missing ${required}`);
  }
  report(
    passed,
    `${pkg.entries.length} files, LICENSE + README present, no source/tests/config leaked`,
  );

  // The upstream MIT notice must travel with the artifact, not only with the
  // git checkout — a consumer only ever sees the tarball. Which notice is
  // per-package: the engine forks StPageFlip (Nodlik), the binding forks
  // react-pageflip (oleg.litovski9@gmail.com). Requiring both of both would
  // make the engine's correct, narrower LICENSE look like a defect.
  passed = true;
  const license = run('tar', ['xzOf', pkg.tarball, 'package/LICENSE']);
  for (const notice of pkg.notices) {
    if (!license.includes(notice))
      passed = fail(`${pkg.name}: shipped LICENSE omits upstream notice ${JSON.stringify(notice)}`);
  }
  if (manifest.license !== pkg.license) {
    passed = fail(
      `${pkg.name}: license is ${JSON.stringify(manifest.license)}, expected ${JSON.stringify(pkg.license)}`,
    );
  }
  report(passed, `license ${manifest.license}, upstream notice(s) present in the shipped LICENSE`);

  // A scoped package defaults to restricted. Without this the very first
  // publish fails with E402 (payment required) rather than publishing at all.
  passed = true;
  if (manifest.publishConfig?.access !== 'public') {
    passed = fail(
      `${pkg.name}: publishConfig.access must be "public" — scoped packages default to restricted`,
    );
  }
  if (manifest.private) passed = fail(`${pkg.name}: "private": true would block publish`);
  report(passed, 'publishConfig.access = public');

  // `workspace:` in a published manifest makes the package uninstallable.
  passed = true;
  const rawManifest = run('tar', ['xzOf', pkg.tarball, 'package/package.json']);
  if (/"workspace:/.test(rawManifest)) {
    passed = fail(`${pkg.name}: packed manifest still contains a workspace: protocol range`);
  }
  // REQUIRED dependencies, not just well-formed ones. This loop validated the
  // SYNTAX of whatever happened to be declared, so deleting
  // `@gullabs/flipbook-core` from the react manifest left the gate green — and
  // the consumer step below could not catch it either, because it unpacks both
  // tarballs by hand regardless of what react asks for. A consumer running
  // `npm i @gullabs/react-flipbook` alone would then fail at runtime and in its
  // declarations, which is precisely the failure this script exists to prevent.
  if (pkg.name === '@gullabs/react-flipbook') {
    const core = manifest.dependencies?.['@gullabs/flipbook-core'];
    if (typeof core !== 'string' || core.length === 0) {
      passed = fail(
        `${pkg.name}: must declare @gullabs/flipbook-core in "dependencies" — ` +
          'installing it alone would resolve neither the runtime nor the types',
      );
    }
    const peers = manifest.peerDependencies ?? {};
    if (typeof peers['react'] !== 'string') {
      passed = fail(`${pkg.name}: react must stay a peerDependency`);
    }
    if (manifest.dependencies?.['react'] !== undefined) {
      passed = fail(`${pkg.name}: react must NOT be a hard dependency`);
    }
  }

  for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!/^[\^~]?\d/.test(range) && !/^(>=|<|>)/.test(range)) {
      passed = fail(
        `${pkg.name}: dependency ${dep} has non-registry range ${JSON.stringify(range)}`,
      );
    }
  }
  report(passed, `dependencies: ${JSON.stringify(manifest.dependencies ?? {})}`);

  // Every path the manifest advertises must be inside the tarball. This is the
  // `files`-vs-`exports` mismatch that only a packed check can see.
  const advertised = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./')) advertised.add(value.slice(2));
      return;
    }
    if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v);
  };
  collect(manifest.exports);
  for (const field of ['main', 'module', 'types', 'browser']) collect(manifest[field]);
  passed = true;
  for (const path of [...advertised].sort()) {
    if (!has(path))
      passed = fail(`${pkg.name}: manifest points at ${path}, which is not in the tarball`);
  }
  report(
    passed,
    `${advertised.size} advertised paths all present: ${[...advertised].sort().join(', ')}`,
  );

  // Dual-package types. In a `"type": "module"` package a bare `.d.ts` is an
  // ESM declaration file; a CJS consumer under node16 resolving to it gets
  // TS1479. The `require` condition must carry its own `.d.cts` types.
  passed = true;
  const dot = manifest.exports?.['.'];
  if (!dot || typeof dot !== 'object') {
    passed = fail(`${pkg.name}: exports["."] must be a conditions object`);
  } else {
    const requireTypes = dot.require?.types;
    const importTypes = dot.import?.types;
    if (manifest.type === 'module' && requireTypes !== './dist/index.d.cts') {
      passed = fail(
        `${pkg.name}: exports["."].require.types is ${JSON.stringify(requireTypes)}; ` +
          'a CJS consumer under moduleResolution:"node16" needs ./dist/index.d.cts, ' +
          'or it gets TS1479 and cannot import the package at all',
      );
    }
    if (importTypes !== './dist/index.d.ts') {
      passed = fail(
        `${pkg.name}: exports["."].import.types is ${JSON.stringify(importTypes)}, expected ./dist/index.d.ts`,
      );
    }
  }
  report(passed, 'exports["."] carries per-condition types (.d.ts for import, .d.cts for require)');

  // Tooling (Vite, Jest, resolve, bundler plugins) reads pkg/package.json.
  // With an `exports` map and no such subpath, that throws ERR_PACKAGE_PATH_NOT_EXPORTED.
  passed = true;
  if (manifest.exports && manifest.exports['./package.json'] !== './package.json') {
    passed = fail(
      `${pkg.name}: exports must expose "./package.json" — tooling resolves it and an exports map blocks it`,
    );
  }
  report(passed, 'exports exposes ./package.json');

  // Sourcemaps must not dangle: every emitted map referenced by a JS file has
  // to be in the tarball too, or consumers get 404s in devtools.
  passed = true;
  for (const entry of pkg.entries.filter((p) => /\.(js|cjs)$/.test(p))) {
    const body = run('tar', ['xzOf', pkg.tarball, `package/${entry}`]);
    const m = /[#@]\s*sourceMappingURL=(\S+)/.exec(body);
    if (m && !m[1].startsWith('data:')) {
      const mapPath = join(dirname(entry), m[1]);
      if (!has(mapPath))
        passed = fail(`${pkg.name}: ${entry} references ${m[1]}, which is not in the tarball`);
    }
  }
  report(passed, 'every sourceMappingURL resolves inside the tarball');
}

// The remaining phases run even with failures recorded: a manifest defect and a
// resolution defect are different findings, and reporting only the first costs
// a whole round trip.

// --------------------------------------------------------------------------
// 3. Unpack into a throwaway consumer and use the packages for real.
// --------------------------------------------------------------------------
const consumer = join(work, 'consumer');
const nm = join(consumer, 'node_modules');
mkdirSync(join(nm, '@gullabs'), { recursive: true });
mkdirSync(join(nm, '@types'), { recursive: true });

for (const pkg of PACKAGES) {
  const dest = join(nm, pkg.name);
  mkdirSync(dest, { recursive: true });
  run('tar', ['xzf', pkg.tarball, '-C', dest, '--strip-components=1']);
}

// Peer deps and the typechecker come from the workspace store — no network.
for (const dep of ['react', 'react-dom', '@types/react', '@types/react-dom']) {
  const from = dirname(require_.resolve(`${dep}/package.json`));
  symlinkSync(from, join(nm, dep), 'dir');
}

writeFileSync(
  join(consumer, 'package.json'),
  `${JSON.stringify({ name: 'packed-consumer', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
);

writeFileSync(
  join(consumer, 'esm.mjs'),
  [
    "import { PageFlip, PageFlipError, FLIPBOOK_CSS } from '@gullabs/flipbook-core';",
    "import HTMLFlipBook, { usePageFlip } from '@gullabs/react-flipbook';",
    "import { readFileSync } from 'node:fs';",
    "import { createRequire } from 'node:module';",
    'const req = createRequire(import.meta.url);',
    "const css = readFileSync(req.resolve('@gullabs/flipbook-core/style.css'), 'utf8');",
    "if (typeof PageFlip !== 'function') throw new Error('PageFlip is not a constructor');",
    "if (typeof PageFlipError !== 'function') throw new Error('PageFlipError missing');",
    "if (!css.includes('.stf__parent')) throw new Error('style.css subpath did not resolve to the stylesheet');",
    "if (typeof FLIPBOOK_CSS !== 'string' || !FLIPBOOK_CSS.includes('.stf__parent')) throw new Error('FLIPBOOK_CSS missing');",
    "if (!HTMLFlipBook) throw new Error('react default export missing');",
    "if (typeof usePageFlip !== 'function') throw new Error('usePageFlip missing');",
    "req.resolve('@gullabs/flipbook-core/package.json');",
    "req.resolve('@gullabs/react-flipbook/package.json');",
    "console.log('  ok  node ESM: both packages import, style.css + package.json subpaths resolve');",
  ].join('\n'),
);

writeFileSync(
  join(consumer, 'cjs.cjs'),
  [
    "const core = require('@gullabs/flipbook-core');",
    "const rf = require('@gullabs/react-flipbook');",
    "if (typeof core.PageFlip !== 'function') throw new Error('CJS: PageFlip missing');",
    "if (!rf.default) throw new Error('CJS: default export missing');",
    "if (typeof rf.usePageFlip !== 'function') throw new Error('CJS: usePageFlip missing');",
    "if (rf.__esModule !== true) throw new Error('CJS: __esModule interop marker missing');",
    "console.log('  ok  node CJS: require() works with __esModule interop');",
  ].join('\n'),
);

console.log('');
for (const script of ['esm.mjs', 'cjs.cjs']) {
  try {
    process.stdout.write(run('node', [script], { cwd: consumer }));
  } catch (error) {
    fail(
      `consumer ${script} failed against the packed tarballs:\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}`,
    );
  }
}

// --------------------------------------------------------------------------
// 4. Type-check the consumer under both resolution modes.
// --------------------------------------------------------------------------
mkdirSync(join(consumer, 'src'), { recursive: true });
writeFileSync(
  join(consumer, 'src/esm.ts'),
  [
    "import { PageFlip, PageFlipError } from '@gullabs/flipbook-core';",
    "import type { FlipSetting } from '@gullabs/flipbook-core';",
    "import HTMLFlipBook, { usePageFlip } from '@gullabs/react-flipbook';",
    "import type { HTMLFlipBookProps, FlipBookHandle } from '@gullabs/react-flipbook';",
    'export const engine: typeof PageFlip = PageFlip;',
    'export const err: typeof PageFlipError = PageFlipError;',
    'export const book: typeof HTMLFlipBook = HTMLFlipBook;',
    'export const hook: typeof usePageFlip = usePageFlip;',
    'export type Props = HTMLFlipBookProps;',
    'export type Handle = FlipBookHandle;',
    'export type Settings = Partial<FlipSetting>;',
    '',
  ].join('\n'),
);
// The CJS half is the whole point: this is the file that fails with TS1479
// when `exports["."].require.types` does not point at a `.d.cts`.
writeFileSync(
  join(consumer, 'src/cjs.cts'),
  [
    "import { PageFlip } from '@gullabs/flipbook-core';",
    "import HTMLFlipBook from '@gullabs/react-flipbook';",
    'export const engine: typeof PageFlip = PageFlip;',
    'export const book = HTMLFlipBook;',
    '',
  ].join('\n'),
);

const tsc = require_.resolve('typescript/bin/tsc');
const MODES = [
  {
    name: 'moduleResolution: "bundler"',
    module: 'esnext',
    moduleResolution: 'bundler',
    files: ['src/esm.ts'],
  },
  {
    name: 'moduleResolution: "node16"',
    module: 'node16',
    moduleResolution: 'node16',
    files: ['src/esm.ts', 'src/cjs.cts'],
  },
];

for (const mode of MODES) {
  const config = join(consumer, `tsconfig.${mode.moduleResolution}.json`);
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: mode.module,
          moduleResolution: mode.moduleResolution,
          target: 'es2022',
          jsx: 'react-jsx',
          lib: ['dom', 'es2022'],
          // Not skipped on purpose: skipLibCheck would hide a broken `.d.ts`,
          // which is exactly what is being checked.
          skipLibCheck: false,
          types: [],
        },
        files: mode.files,
      },
      null,
      2,
    )}\n`,
  );
  try {
    run('node', [tsc, '-p', config], { cwd: consumer });
    ok(`consumer typechecks under ${mode.name}`);
  } catch (error) {
    fail(
      `consumer fails to typecheck under ${mode.name}:\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}`,
    );
  }
}

console.log('');
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('packed artifacts: ok');
