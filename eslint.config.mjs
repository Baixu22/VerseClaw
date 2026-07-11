import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: [
      '.tmp/**',
      'artifacts/**',
      'coverage/**',
      '**/dist/**',
      'dist-electron/**',
      'openclaw/**',
      'openclaw_runtime/**',
      'prototypes/**',
      'release/**',
      'build/**',
      'resources/verseshell-mcp/**',
      'tests/fixtures/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript handles these checks natively, disable ESLint duplicates
      'no-undef': 'off',
      // Keep dependency-added hygiene rules visible without turning existing
      // non-contract cleanup into a release blocker.
      'no-empty': 'warn',
      'no-unassigned-vars': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'preserve-caught-error': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='invoke'][callee.object.type='MemberExpression'][callee.object.property.name='ipcRenderer'][callee.object.object.type='MemberExpression'][callee.object.object.property.name='electron'][callee.object.object.object.name='window']",
          message: 'Use invokeIpc from @/lib/api-client instead of window.electron.ipcRenderer.invoke.',
        },
        {
          selector: "CallExpression[callee.name='fetch'] Literal[value=/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)(:\\d+)?\\//]",
          message: 'Do not call local endpoints directly from renderer. Route through host-api/api-client proxies.',
        },
      ],
    },
  },
  {
    files: ['src/lib/api-client.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
