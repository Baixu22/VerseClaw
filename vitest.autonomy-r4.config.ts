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
      'tests/unit/autonomy-worktree-integration.test.ts',
      'tests/unit/autonomy-orchestration-waves.test.ts',
      'tests/unit/worktree-reclamation-preservation.test.ts',
      'tests/unit/task-worktree-retention.test.ts',
      'tests/unit/task-artifact-retention.test.ts',
      'openclaw_runtime/src/agents/worktree-service.test.ts',
      'tests/unit/orchestration-worktree-merge.test.ts',
      'tests/unit/worktree-registry-restart.test.ts',
      'tests/unit/checkout-writer-ownership.test.ts',
      'tests/unit/versegit-host-apply.test.ts',
      'tests/unit/versegit-candidate-freeze.test.ts',
    ],
  },
});
