import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/rsi-*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
});
