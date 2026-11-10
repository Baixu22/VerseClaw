import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';

export default defineConfig(base, {
  testDir: __dirname,
  testMatch: 'product-matrix.session.spec.ts',
  globalSetup: resolve(__dirname, '../e2e/fixtures/electron-process-cleanup.ts'),
  tsconfig: resolve(__dirname, '../../tsconfig.test.json'),
  workers: 1,
  retries: 0,
  timeout: 35 * 60_000,
  use: { trace: 'off', video: 'off', screenshot: 'only-on-failure' },
});
