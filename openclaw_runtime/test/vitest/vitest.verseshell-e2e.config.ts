/**
 * Standalone vitest config for VerseShell e2e integration tests.
 * These tests start a real `ae --serve` process and test the full JSON-RPC
 * communication path that agents use in production.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verseshell-e2e",
    include: ["src/agents/verseshell-runtime.e2e.test.ts"],
    environment: "node",
    globals: false,
    pool: "forks",  // forks for process isolation with real subprocess
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    setupFiles: [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
