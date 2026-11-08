import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({
  plugins: base.plugins, resolve: base.resolve,
  test: { environment: 'node', maxWorkers: 1, testTimeout: 30_000, hookTimeout: 30_000,
    include: ['tests/unit/checkout-writer-ownership.test.ts','tests/unit/orchestration-worktree-merge.test.ts','tests/unit/autonomy-worktree-owner.test.ts','tests/unit/autonomy-worktree-native.test.ts'],
  },
});
