import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: [
      "src/process/command-queue.test.ts",
      "src/agents/model-fallback.loop-termination.test.ts",
      "src/agents/resource-leases.test.ts",
      "src/agents/sessions/tools/bash-workspace-lease.test.ts",
      "src/agents/sessions/tools/bounded-waiting-lease.test.ts",
      "src/agents/subagent-registry-queries.quota.test.ts",
      "src/agents/worktree-service.test.ts",
      "src/agents/checkpoint-rollback-executor.test.ts",
      "src/agents/orchestration-token-budget.test.ts",
      "src/agents/provider-outbound-budget.test.ts",
      "src/agents/verseshell/managed-process-capacity.test.ts",
      "src/agents/verseshell/managed-process-pressure.test.ts",
      "src/context-engine/factstore/symbol-lease.test.ts",
      "src/agents/symbol-lease-guard.test.ts",
    ],
    environment: "node",
    setupFiles: [],
    isolate: true,
  },
});
