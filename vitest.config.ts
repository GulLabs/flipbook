import path from 'node:path';
import { defineConfig } from 'vitest/config';

const coreSrc = path.resolve(__dirname, 'packages/core/src/index.ts');
const reactSrc = path.resolve(__dirname, 'packages/react/src/index.ts');

/**
 * Vitest workspace projects + v8 coverage.
 * Pattern mirrors ai-studio vitest.config.base + any-llm thresholds style.
 * Thresholds start pragmatic for a fork modernization; ratchet up as tests grow.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
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
      // Floor for CI. Raise as the suite grows (any-llm sits ~90+%).
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 35,
        statements: 40,
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
        esbuild: {
          jsx: 'automatic',
        },
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
