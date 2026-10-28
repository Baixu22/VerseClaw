import { defineConfig } from '@playwright/test';
import { assertWindowsTestNode } from './scripts/windows-test-node.mjs';

assertWindowsTestNode();

export default defineConfig({
  globalSetup: './tests/e2e/fixtures/electron-process-cleanup.ts',
  testDir: './tests/e2e',
  // Live acceptance uses private local resources and is selected explicitly by its runner.
  testIgnore: process.env.CLAWX_SPACE_BUNNY_ACCEPTANCE === '1' ? [] : ['**/product-acceptance-space-bunny.spec.ts'],
  tsconfig: './tsconfig.test.json',
  // Serial by design: many specs boot a real Electron + Gateway child, and
  // concurrent gateway boots contend for ports/runtime and flake
  // ("gateway never became ready", target-closed). Keep workers:1 —
  // do NOT pass --workers>1 for the full suite. Shard across processes if you
  // need speed, so each shard still boots one gateway at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
