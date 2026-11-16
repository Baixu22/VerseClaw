import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({
  plugins: base.plugins, resolve: base.resolve,
  test: { environment: 'node', maxWorkers: 1, testTimeout: 30_000, hookTimeout: 30_000,
    include: ['tests/unit/terminal-resource-ownership.test.ts','tests/unit/terminal-resource-native.test.ts','tests/unit/terminal-session-manager.test.ts','tests/unit/terminal-api.test.ts','tests/unit/web-preview-startup-recovery.test.ts','tests/unit/web-preview-owner-api.test.ts',
      'openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts','openclaw_runtime/src/agents/verseshell/governed-process.test.ts'],
  },
});
