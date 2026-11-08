import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({ plugins: base.plugins, resolve: base.resolve,
  test: { environment: 'node', maxWorkers: 1, fileParallelism: false, testTimeout: 30_000,
    include: ['tests/unit/unified-effect-admission.test.ts','tests/unit/unified-task-authority.test.ts','tests/unit/durable-task-authority-access.test.ts'],
  },
});
