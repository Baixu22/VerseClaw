/**
 * Standalone vitest config for verseshell-runtime unit tests.
 * These tests are isolated from the main test suite (no global setup).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verseshell-runtime",
    include: ["src/agents/verseshell-runtime.test.ts"],
    environment: "node",
    globals: false,
    pool: "threads",
    setupFiles: [],
    testTimeout: 10_000,
  },
});
