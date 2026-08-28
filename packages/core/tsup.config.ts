import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  sourcemap: true,
  clean: true,
  minify: 'terser',
  treeshake: true,
  target: 'es2020',
  splitting: true,
  dts: true,
  esbuildOptions(options) {
    options.legalComments = 'none';
  },
  external: [],
});
