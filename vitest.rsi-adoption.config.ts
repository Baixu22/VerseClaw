import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';
import { resolve } from 'node:path';

const baseAliases = baseConfig.resolve?.alias ?? {};
const aliases = Array.isArray(baseAliases) ? baseAliases
  : Object.entries(baseAliases).map(([find, replacement]) => ({ find, replacement }));

export default defineConfig({
  plugins: baseConfig.plugins,
  resolve: {
    alias: [
      { find: /^tree-sitter(?:-[a-z-]+)?$/, replacement: resolve(__dirname, 'tests/unit/rsi-adoption-native-test-support.ts') },
      ...aliases,
    ],
  },
  test: {
    environment: 'node',
    include: [
      'tests/unit/rsi-adoption-*.test.ts',
      'openclaw_runtime/src/knowledge/sekb/sekb.test.ts',
      'openclaw_runtime/src/knowledge/sekb/experience-closed-loop.test.ts',
      'openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts',
      'openclaw_runtime/src/knowledge/sekb/terminal-trajectory-gating.test.ts',
      'openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts',
      'tests/unit/tf0018-sekb-no-auto-writeback.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
});
