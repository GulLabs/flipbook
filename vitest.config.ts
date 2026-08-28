import path from 'node:path';
import { defineConfig } from 'vitest/config';

const coreSrc = path.resolve(import.meta.dirname, 'packages/core/src/index.ts');
const reactSrc = path.resolve(import.meta.dirname, 'packages/react/src/index.ts');

/**
 * Vitest workspace projects + v8 coverage.
 * Pattern mirrors ai-studio vitest.config.base + any-llm thresholds style.
 * Thresholds start pragmatic for a fork modernization; ratchet up as tests grow.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@gullabs/flipbook-core': coreSrc,
      '@gullabs/react-flipbook': reactSrc,
    },
  },
  test: {
    globals: false,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/index.ts',
        '**/*.d.ts',
        '**/dist/**',
        '**/node_modules/**',
      ],
      // Floor for CI — Phase D4 ratchet. Do not lower.
      // Measured ~60.9% lines / ~70.1% functions / ~45.0% branches / ~59.6% statements.
      thresholds: {
        lines: 58,
        functions: 66,
        branches: 42,
        statements: 57,
      },
    },
    projects: [
      {
        resolve: {
          alias: {
            '@gullabs/flipbook-core': coreSrc,
          },
        },
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/tests/**/*.{test,spec}.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@gullabs/flipbook-core': coreSrc,
            '@gullabs/react-flipbook': reactSrc,
          },
        },
        test: {
          name: 'react',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['packages/react/tests/**/*.{test,spec}.{ts,tsx}'],
        },
      },
    ],
  },
});
