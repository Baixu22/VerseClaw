import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({
  root: resolve(__dirname, 'openclaw_runtime'), plugins: base.plugins, resolve: base.resolve,
  test: { environment: 'node', maxWorkers: 1, testTimeout: 60_000, hookTimeout: 30_000,
    include: ['src/agents/verseshell/governed-process.real-limits.test.ts','src/agents/verseshell/control-backpressure.native.test.ts','src/agents/verseshell/process-manager.test.ts'],
  },
});
