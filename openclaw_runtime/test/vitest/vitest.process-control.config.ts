import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";
export default defineConfig({
  ...sharedVitestConfig,
  test: { ...sharedVitestConfig.test, environment: "node", setupFiles: [], isolate: true,
    include: [
      "src/agents/verseshell/process-manager.test.ts",
      "src/agents/verseshell/governed-process.test.ts",
      "src/agents/verseshell/governed-exec.test.ts",
      "src/agents/verseshell/managed-process-capacity.test.ts",
      "src/agents/verseshell/concurrent-acquisition.integration.test.ts",
      "src/agents/verseshell/control-backpressure.integration.test.ts",
      "src/agents/verseshell/control-backpressure.native.test.ts",
      "src/agents/sessions/bash-executor.backpressure.test.ts",
    ],
  },
});
