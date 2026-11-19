import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

const tsEslintRecommended =
  tsPlugin.configs['flat/eslint-recommended']?.rules
  ?? tsPlugin.configs['eslint-recommended']?.overrides?.[0]?.rules
  ?? {
    'no-redeclare': 'off',
    'no-undef': 'off',
    'no-unreachable': 'off',
  };

export default [
  {
    ignores: [
      '.tmp/**',
      '**/.tmp/**',
      '.local/**',
      'tmp/**',
      'packages/versebrowser/dist/**',
      '**/.artifacts/**',
      '.claude/worktrees/**',
      'artifacts/**',
      // Historical evidence and frozen evaluation programs retain their hash-verified bytes.
      'docs/dev/evidence/**',
      'harness/specs/fixtures/project-rag/**/programs/**',
      'dist/**',
      'dist-electron/**',
      'openclaw/**',
      'release/**',
      'build/**',
      'openclaw_runtime/dist/**',
      'openclaw_runtime/dist-runtime/**',
      'openclaw_runtime/**/dist/**',
      // Complete VerseConf deliveries are hash-locked; lint --fix must not rewrite them.
      'openclaw_runtime/extensions/verseconf-artifacts/vendor/verseconf/**',
      'openclaw_runtime/packages/agent-core/dist/**',
      // Fixture AST samples intentionally use synthetic use* identifiers.
      'tests/fixtures/ast-patch-planner/**',
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
      ...tsEslintRecommended,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript handles these checks natively; keep only TS-aware variants.
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unreachable': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Declaration-only namespace (type aliases only) and module-augmentation
      // empty interfaces are intentional type-safe shapes; keep the rules but
      // allow these documented forms so no inline disables are needed (oxlint
      // reports ESLint disables as unused directives).
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
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
    files: ['src/lib/host-api-client.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Harness rule `local-data-fail-closed-config`: new persistence code must go
    // through the unified entry point so every config store gets the same
    // durability contract (temp + fsync + rename, `.bak` recovery, file lock).
    // Existing bare call sites are grandfathered; new code is not.
    files: [
      'electron/utils/durable-store.ts',
      'electron/utils/atomic-write.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='writeFile']",
          message: 'Use writeFileAtomic/writeJsonAtomic from electron/utils/durable-store.ts instead of a bare writeFile.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='fs'][callee.property.name='writeFile']",
          message: 'Use writeFileAtomic/writeJsonAtomic from electron/utils/durable-store.ts instead of a bare writeFile.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='fs'][callee.property.name='writeFileSync']",
          message: 'Use writeFileAtomicSync from electron/utils/durable-store.ts instead of a bare writeFileSync.',
        },
      ],
    },
  },
  {
    // Secret-bearing stores must not import a raw fs writer directly: they are
    // required to seal credentials through the vault and persist atomically.
    files: [
      'electron/services/secrets/**/*.ts',
      'electron/services/providers/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='writeFile']",
          message: 'Secret/provider stores must persist via writeJsonAtomic (see electron/services/secrets/*-broker.ts).',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='fs'][callee.property.name='writeFile']",
          message: 'Secret/provider stores must persist via writeJsonAtomic (see electron/services/secrets/*-broker.ts).',
        },
      ],
    },
  },
  {
    // Non-React packages reuse use* names for non-hook helpers (Baileys auth, access-group resolvers).
    files: [
      'openclaw_runtime/extensions/whatsapp/src/session.ts',
      'openclaw_runtime/src/channels/message-access/runtime.ts',
      'openclaw_runtime/src/plugins/loader.test-fixtures.ts',
    ],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
];
