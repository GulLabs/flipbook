/**
 * lint-staged — monorepo-aware (ai-studio pattern).
 * Root eslint.config.mjs uses packages/* globs, so paths can stay repo-relative.
 */
export default {
  'packages/**/*.{ts,tsx}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write --ignore-unknown',
  ],
  'examples/**/*.{ts,tsx,js,jsx,mjs}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write --ignore-unknown',
  ],
  'scripts/**/*.{mjs,js,ts}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write --ignore-unknown',
  ],
  '*.{mjs,js,ts,tsx}': [
    'eslint --fix --max-warnings=0 --no-warn-ignored',
    'prettier --write --ignore-unknown',
  ],
  '*.{json,md,yml,yaml,css,html}': ['prettier --write --ignore-unknown'],
};
