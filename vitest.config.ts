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

        // STILL NOT SHIPPED. Removed on 2026-08-29 when Phase 2 landed and the
        // component was exported, then RESTORED the same day: the owner held
        // `ImageFlipBook` back again, because the Phase 2 owner API-approval
        // gate in `docs/CANVAS_FIRST_CLASS.md` names it explicitly and was
        // never opened. An implementation landing does not open a §5 gate.
        //
        // So the condition below is unchanged and still the right one — this
        // exclusion goes when the component is genuinely exported, not when it
        // merely compiles. Its tests exist and run either way.
        //
        // NOT SHIPPED IN 3.0.0, so not measured. `ImageFlipBook` is written to
        // the Phase 2 descriptor API that the engine does not implement yet —
        // it flattens every descriptor back to a bare URL and drops blank
        // leaves with a warning — so it is deliberately not exported from
        // `packages/react/src/index.ts` and tree-shakes out of the published
        // bundle (verified: zero occurrences in `dist/index.js`).
        //
        // Coverage is a claim about the code consumers actually run. Measuring
        // an unshipped file drags the floor down and, worse, invites someone to
        // lower the threshold to compensate — which is how this repo's
        // thresholds got ratcheted to green a red gate once before. This
        // exclusion is REMOVED when Phase 2 lands and the export goes public;
        // its tests already exist and run.
        'packages/react/src/ImageFlipBook.tsx',
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
      // Re-measured 2026-08-29, after excluding the unshipped `ImageFlipBook`
      // above. The old floors (94/96/85/92) were set against a measurement that
      // INCLUDED it, so they understated the shipped code by several points and
      // the gate was red anyway — lines 93.93 against a 94 floor. Shipped
      // coverage is actually 97.53 lines / 99.47 functions / 90.10 branches /
      // 96.37 statements.
      //
      // Set ~1.5 points under measured, which is the practice this file already
      // documents: enough headroom that an honest refactor does not trip it,
      // tight enough that a genuinely untested addition does. Raised because the
      // measurement moved, not to make anything go green.
      thresholds: {
        lines: 96,
        functions: 98,
        branches: 88,
        statements: 95,
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
