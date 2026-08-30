import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Same source alias as the vanilla e2e host: exercise live packages, not a
  // mid-flight minified dist while the monorepo is iterating.
  resolve: {
    alias: {
      '@gullabs/react-flipbook': path.resolve(root, '../../packages/react/src'),
      '@gullabs/flipbook-core': path.resolve(root, '../../packages/core/src'),
    },
  },
  server: { port: 5174 },
});
