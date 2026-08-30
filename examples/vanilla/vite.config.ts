import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Resolve the engine from source so e2e exercises live behavior, not a
  // mid-flight minified dist (property-mangling across tsup chunks has been
  // breaking loadFromHTML while the size pass iterates).
  resolve: {
    alias: {
      '@gullabs/flipbook-core': path.resolve(root, '../../packages/core/src'),
    },
  },
  build: {
    rollupOptions: {
      // The canvas e2e harness is a second entry point, not a route of the
      // showcase — `vite build` only emits HTML it is told about.
      input: {
        main: path.resolve(root, 'index.html'),
        canvas: path.resolve(root, 'canvas.html'),
        // Public canvas/images showcase (defect F3) — separate from the
        // pixel-probe harness at canvas.html.
        'canvas-demo': path.resolve(root, 'canvas-demo.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
