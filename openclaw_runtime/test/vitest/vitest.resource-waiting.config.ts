import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: [
      "src/agents/resource-leases.test.ts",
      "src/agents/sessions/tools/bash-workspace-lease.test.ts",
      "src/agents/sessions/tools/bounded-waiting-lease.test.ts",
      "src/agents/sessions/tools/write.test.ts",
      "src/agents/sessions/tools/edit.test.ts",
    ],
    environment: "node",
    setupFiles: [],
    isolate: true,
  },
});
