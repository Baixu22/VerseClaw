// Vitest extension codex app server attempt extra config wires the extension codex app server attempt extra test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createExtensionCodexAppServerAttemptExtraVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig([], {
    dir: "extensions",
    env,
    fileParallelism: false,
    name: "extension-codex-app-server-attempt-extra",
    setupFiles: ["test/setup.extensions.ts"],
  });
}

export default createExtensionCodexAppServerAttemptExtraVitestConfig();
