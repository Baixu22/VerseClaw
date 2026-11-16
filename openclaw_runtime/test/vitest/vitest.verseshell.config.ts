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
      "src/agents/verseshell/concurrent-acquisition.integration.test.ts",
      "src/agents/verseshell/governed-exec.test.ts",
      "src/agents/verseshell/governed-process.test.ts",
      "src/agents/verseshell/governed-process.real-limits.test.ts",
      "src/agents/verseshell/governed-exec.real-limits.test.ts",
      "src/agents/verseshell/managed-process-capacity.test.ts",
      "src/agents/verseshell/single-plane-canary.test.ts",
      "src/agents/verseshell/real-canary-evidence.test.ts",
      "src/agents/verseshell/governed-exec-runtime.test.ts",
      "src/agents/verseshell/governed-exec.real.test.ts",
      "src/agents/verseshell/result-tool.test.ts",
      "src/agents/verseshell/readonly-facade.test.ts",
      "src/agents/verseshell/patch-preview.test.ts",
      "src/agents/verseshell/patch-preview.real.test.ts",
      "src/agents/verseshell/patch-preview-baseline.test.ts",
      "src/agents/verseshell/patch-preview-artifacts.test.ts",
      "src/agents/verseshell/command-profiles.test.ts",
      "src/agents/verseshell/external-write-policy.test.ts",
      "src/agents/verseshell/external-write-policy.identity.test.ts",
      "src/agents/bash-tools.exec.external-write.test.ts",
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
