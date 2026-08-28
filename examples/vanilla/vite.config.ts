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
  server: { port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
