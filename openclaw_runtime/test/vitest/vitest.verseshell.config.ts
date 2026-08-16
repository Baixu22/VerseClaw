/**
 * Focused P0 VerseShell foundation tests.
 *
 * These execute the process manager's strict startup contract and the
 * default-off rollout/evidence behavior without starting a real runtime.
 */
import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    name: "verseshell-foundation",
    include: [
      "src/agents/verseshell/process-manager.test.ts",
      "src/agents/verseshell/governed-exec.test.ts",
      "src/agents/verseshell/governed-process.test.ts",
      "src/agents/verseshell/single-plane-canary.test.ts",
      "src/agents/verseshell/real-canary-evidence.test.ts",
      "src/agents/verseshell/governed-exec-runtime.test.ts",
      "src/agents/verseshell/governed-exec.real.test.ts",
      "src/agents/verseshell/result-tool.test.ts",
      "src/agents/verseshell/readonly-facade.test.ts",
      "src/agents/verseshell/command-profiles.test.ts",
      "src/agents/verseshell/shell-command.test.ts",
      "src/agents/verseshell/normalizer.test.ts",
      "src/agents/verseshell-foundation-evidence.test.ts",
      "src/config/runtime-verseshell-foundation.test.ts",
      "src/logging/diagnostic-stability.exec.test.ts",
    ],
    environment: "node",
    globals: false,
    setupFiles: [],
    testTimeout: 10_000,
  },
});
