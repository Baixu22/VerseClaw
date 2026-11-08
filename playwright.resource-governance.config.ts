import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// The driver is fixed; cwd selects the independently built product checkout.
export default defineConfig({
  testDir: resolve(__dirname, 'tests/e2e'),
  testMatch: 'resource-mixed-load.spec.ts',
  globalSetup: resolve(__dirname, 'tests/e2e/fixtures/electron-process-cleanup.ts'),
  tsconfig: resolve(__dirname, 'tsconfig.test.json'),
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
