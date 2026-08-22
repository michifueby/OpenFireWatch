// @ts-check
/**
 * Lint rules for the Angular application.
 *
 * The recommended sets do the bulk of the work; what is spelled out below is
 * the handful of rules this codebase has actually been bitten by, plus the
 * naming convention that keeps `ofw-` on every selector.
 */

const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ofw', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'ofw', style: 'kebab-case' },
      ],

      // Every component in this application renders from signals, so there is
      // no reason for any of them to run default change detection.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',

      // A promise nobody awaits is how a failed write becomes silence.
      '@typescript-eslint/no-floating-promises': 'error',

      // Deliberate `catch {}` blocks are load-bearing here — a failed poll
      // keeps the last known reading rather than blanking the panel — but
      // they have to say so.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // `reading != null` asks "is there a measurement?" and covers null and
      // undefined in one breath. Everything else stays strict — a template
      // comparing a number to a string by accident is a real bug.
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  },
);
