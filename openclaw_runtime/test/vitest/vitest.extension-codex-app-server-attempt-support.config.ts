// Vitest extension codex app server attempt support config wires the extension codex app server attempt support test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createExtensionCodexAppServerAttemptSupportVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig([], {
    dir: "extensions",
    env,
    fileParallelism: false,
    name: "extension-codex-app-server-attempt-support",
    setupFiles: ["test/setup.extensions.ts"],
  });
}

export default createExtensionCodexAppServerAttemptSupportVitestConfig();
