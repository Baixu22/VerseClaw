import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";
export default defineConfig({
  ...sharedVitestConfig,
  // Native process/stdio tests need an OS-process environment, including Windows
  // variable casing and handles, instead of a shared worker-thread environment.
  test: { ...sharedVitestConfig.test, environment: "node", pool: "forks", setupFiles: [], isolate: true,
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
