import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Typed package + example sources — type-aware rules run here. */
const typedFiles = ['packages/*/src/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}'];

const nonTypedTsFiles = [
  '**/*.{test,spec}.{ts,tsx}',
  'packages/*/tests/**/*.{ts,tsx}',
  'e2e/**/*.{ts,tsx}',
  'fixtures/**/*.{ts,tsx}',
  'scripts/**/*.{ts,mjs,js}',
  'vitest.config.ts',
  'playwright.config.ts',
  'eslint.config.mjs',
  'examples/**/vite.config.ts',
  'examples/**/next.config.mjs',
];

const nonTypedJsFiles = ['**/*.{js,mjs,cjs}'];

/** Block focused tests from landing (Veloir / ai-studio / any-llm). */
const focusGuards = [
  'error',
  {
    object: 'describe',
    property: 'only',
    message: 'Do not commit describe.only — it skips the rest of the suite.',
  },
  {
    object: 'it',
    property: 'only',
    message: 'Do not commit it.only — it skips the rest of the suite.',
  },
  {
    object: 'test',
    property: 'only',
    message: 'Do not commit test.only — it skips the rest of the suite.',
  },
];

/** Shared non-type-aware hygiene (ai-studio baseSecurity + baseGeneral, slimmed for a library). */
const hygieneRules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-debugger': 'error',
  'no-alert': 'error',
  'prefer-const': 'error',
  'no-var': 'error',
  'object-shorthand': 'error',
  'prefer-template': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-properties': focusGuards,
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
};

function scopeTypedConfigs(configs) {
  return configs.map((config) => ({
    ...config,
    files: typedFiles,
    ignores: nonTypedTsFiles,
  }));
}

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.craftsman/**',
      '.remember/**',
      '.claude/**',
      'fixtures/**',
      'examples/**/dist/**',
      'examples/**/.next/**',
      'packages/**/size-check/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: nonTypedJsFiles,
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  ...scopeTypedConfigs(tseslint.configs.recommendedTypeChecked),
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...hygieneRules,
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      // Off until `noUncheckedIndexedAccess` is on monorepo-wide — defensive
      // pre-init / OOB guards trip false positives against definite-assignment `!`.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/require-await': 'warn',
      // Phase A (docs/QUALITY_BAR_CLIMB.md): block any-leakage at error.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: nonTypedTsFiles,
    extends: [tseslint.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: false },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...hygieneRules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  {
    files: ['scripts/**/*.{mjs,js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
);
