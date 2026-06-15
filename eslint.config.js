import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // dist/ is build output; coverage/ is generated. Lint src/, test/, scripts/.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // Generated Playwright E2E artifacts (the HTML report bundles its own JS).
      '**/taqwright-report/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Turn off any ESLint rules that conflict with Prettier — Prettier owns
  // formatting, ESLint owns correctness. Keep this last so it wins.
  prettier,
  {
    // Node runtime for everything in this repo (CLI, server, build scripts, tests).
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Allow intentionally-unused args/vars prefixed with `_` (common for
      // signature-shape params and ignored catch bindings).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Playwright fixtures destructure an empty `{}` to opt out of fixture
      // injection — that's idiomatic, not a mistake.
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
);
