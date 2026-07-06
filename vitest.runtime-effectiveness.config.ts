import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['openclaw_runtime/extensions/codegraph/runtime.e2e.test.ts'],
  },
});
