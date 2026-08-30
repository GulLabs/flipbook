import path from 'node:path';
import { defineConfig } from 'vitest/config';

const coreSrc = path.resolve(import.meta.dirname, 'packages/core/src/index.ts');
const reactSrc = path.resolve(import.meta.dirname, 'packages/react/src/index.ts');

/**
 * Vitest workspace projects + v8 coverage.
 *
 * Global floors are the coarse net; `scripts/check-coverage-areas.mjs` holds the
 * per-file floors that stop the average from hiding an untested renderer.
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
        '**/types.ts',
      ],
      // Ratcheted 2026-08-28 to just under measured suite
      // (stmts ~90.2 / branches ~75.1 / fns ~95.1 / lines ~92.2).
      // Floors only move UP (AGENTS.md §2). Per-file floors live in
      // scripts/check-coverage-areas.mjs (also run from quality:ci).
      // Ratcheted 2026-08-29 after the audit push: measured 96.13 / 97.76 /
      // 87.24 / 94.71. Set a couple of points below each so an unrelated change
      // does not fail on noise, but close enough that deleting a tested path is
      // caught. Do not lower these to make a change pass — the floors exist to
      // stop the average hiding a newly untested renderer, which is exactly how
      // canvas mode reached 0% once already.
      thresholds: {
        lines: 94,
        functions: 96,
        branches: 85,
        statements: 92,
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
