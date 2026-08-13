/**
 * Web-only Playwright project: pure render semantics against `?mock=1`.
 *
 * Deliberately separate from playwright.config.ts — the Electron suite needs
 * a full build + single-instance lock and runs serially; this one boots the
 * plain Vite web server (vite.web.config.ts, port 5273) and runs in parallel.
 * Anything touching real host capabilities (files, git, terminals) stays in
 * the Electron suite; these specs only lock what the mock scenarios in
 * docs/dev/mock-render-scenarios.md exercise.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-web',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  /* Dev-mode vite transforms the big chat chunk per fresh tab; under 4 local
   * workers the first full-scenario specs spend 20s+ just booting. */
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev:web',
    port: 5273,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
