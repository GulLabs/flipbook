import { defineConfig } from 'tsup';
import type { MinifyOptions } from 'terser';

/**
 * Terser knobs measured 2026-08-28 (see docs/QUALITY_BAR_CLIMB.md).
 *
 * `mangle.properties` is intentionally off. Even an internal-only regex broke
 * cross-chunk class fields under tsup `splitting: true` (e.g. `leftPage` /
 * `setOrientation` mangled differently in index vs chunk →
 * `Cannot read properties of undefined (reading 'setOrientation')` on
 * loadFromHTML). Do not re-enable without a single-bundle property pass or a
 * generated reserved set proven against the packed CJS entry in plain Node.
 *
 * Ruled out earlier: `target: es2022` (+780 B vs es2020).
 */
const terserOptions: MinifyOptions = {
  ecma: 2020,
  module: true,
  compress: {
    ecma: 2020,
    module: true,
    passes: 3,
    pure_getters: true,
    toplevel: true,
    unsafe_arrows: true,
    unsafe_math: true,
    unsafe_methods: true,
    drop_console: true,
    drop_debugger: true,
    dead_code: true,
  },
  mangle: {
    toplevel: true,
    module: true,
  },
  format: {
    comments: false,
    ecma: 2020,
    wrap_func_args: false,
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  sourcemap: true,
  clean: true,
  minify: 'terser',
  terserOptions,
  treeshake: true,
  target: 'es2020',
  splitting: true,
  dts: true,
  esbuildOptions(options) {
    options.legalComments = 'none';
  },
  external: [],
});
