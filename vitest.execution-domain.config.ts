import { defineConfig } from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
  plugins: base.plugins,
  resolve: base.resolve,
  test: {
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      'tests/unit/execution-domain-registry.test.ts',
      'tests/unit/worktree-registry-restart.test.ts',
      'tests/unit/autonomy-worktree-owner.test.ts',
      'tests/unit/autonomy-worktree-native.test.ts',
    ],
  },
});
