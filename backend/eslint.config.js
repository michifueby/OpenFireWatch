// @ts-check
/**
 * Lint rules for the API.
 *
 * `npm run lint` has been in package.json since the first commit with no
 * linter installed behind it — a script that has never once run. What it
 * enforces now is the handful of things this codebase can actually be hurt
 * by, not a style opinion.
 */

const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'jest.config.js'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      // A promise nobody awaits is how a failed database write becomes
      // silence. This is the single most valuable rule here.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Deliberate empty catches are load-bearing in this codebase — a failed
      // notification must not abort an evaluation — but they have to say so.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Decorator metadata means unused-looking constructor parameters are
      // normal; underscore-prefixed names opt out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Rows come back from `pg` as `any` until they are typed at the query
      // site, which the services do. Warn rather than error so the boundary
      // stays visible without blocking on generated types.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },
  {
    // Tests say what they mean with non-null assertions and fixtures.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
