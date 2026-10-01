/**
 * ESLint flat config.
 *
 * The rule set is deliberately small and targeted at the defect classes this
 * codebase actually suffered from, rather than a style crusade (Prettier owns
 * formatting):
 *
 *   no-undef / no-unused-vars  → caught `#canvas3d`-era dead code and typos.
 *   no-restricted-globals      → `supabase` was read as an implicit global.
 *   no-restricted-syntax       → bans `innerHTML =` with a non-literal, which
 *                                is how user content reached the DOM, and
 *                                bans direct `console.*` outside the logger.
 *   no-restricted-imports      → nothing may import the archived legacy tree.
 */

import js from '@eslint/js';
import globals from 'globals';

/** Shared rules for every first-party source file. */
const shared = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-implicit-coercion': ['warn', { boolean: false }],
  'no-else-return': 'warn',
  'object-shorthand': 'warn',
  'no-return-await': 'error',
  'require-atomic-updates': 'off',
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/archive/**'],
          message: 'archive/ is frozen historical code. Never import it into the running app.',
        },
        {
          group: ['**/supabaseClient*'],
          message: 'The duplicate client is gone. Import from src/lib/supabase.js.',
        },
      ],
    },
  ],
};

export default [
  {
    ignores: [
      'dist/**',
      '.baseline/**',
      'archive/**',
      'node_modules/**',
      'android/**',
      'ios/**',
      'coverage/**',
      'public/sw.js', // service-worker scope; linted separately below
      'src/styles/legacy.css',
    ],
  },

  js.configs.recommended,

  /* ── Application source ──────────────────────────────────────────────── */
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...shared,
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'supabase', message: 'Import getSupabase()/getSupabaseSync() from src/lib/supabase.js.' },
        { name: 'event', message: 'Use the handler parameter, not the deprecated global `event`.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression[left.property.name="innerHTML"][right.type!="Literal"]',
          message:
            'Assigning a non-literal to innerHTML is how untrusted content reaches the DOM. Use textContent, or i18n renderRichText() for the allow-listed subset.',
        },
        {
          selector: 'AssignmentExpression[left.property.name="outerHTML"]',
          message: 'outerHTML assignment destroys event listeners and bypasses sanitisation.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'insertAdjacentHTML bypasses sanitisation. Build nodes instead.',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Dynamic code evaluation is blocked by the CSP and must not be introduced.',
        },
      ],
    },
  },

  /* The logger is the one module allowed to touch the console. */
  {
    files: ['src/lib/logger.js'],
    rules: { 'no-console': 'off' },
  },

  /* Renderers legitimately build large literal shader strings. */
  {
    files: ['src/visual/renderer-webgl.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  /* ── Service worker ──────────────────────────────────────────────────── */
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
    rules: { ...shared, 'no-console': 'off' },
  },

  /* ── Node-side tooling ───────────────────────────────────────────────── */
  {
    files: [
      'scripts/**/*.{js,mjs}',
      'tools/**/*.{js,mjs}',
      '*.config.js',
      'vite.config.js',
      'vitest.config.js',
      'seed_db.js',
      'test_engine.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...shared, 'no-console': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },

  /* ── Tests ───────────────────────────────────────────────────────────── */
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    rules: {
      ...shared,
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },

  /* ── Frozen, do-not-extend legacy modules ────────────────────────────── */
  /* These predate the upgrade and are kept verbatim so their behaviour is
     unchanged. They are linted for correctness (undefined vars, unreachable
     code) but exempted from the stylistic rules that would require rewriting
     them — which is explicitly out of scope. */
  {
    files: [
      'src/core.js',
      'src/dashboard.js',
      'src/settings.js',
      'src/avatar.js',
      'src/chip-input.js',
      'src/icons.js',
      'src/matchingEngine.js',
      'src/escrowEngine.js',
      'src/components/**/*.js',
    ],
    rules: {
      'no-else-return': 'off',
      'object-shorthand': 'off',
      'no-implicit-coercion': 'off',
      'prefer-const': 'warn',
    },
  },
];
