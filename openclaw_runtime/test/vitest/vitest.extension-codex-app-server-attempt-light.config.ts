// Vitest extension codex app server attempt light config wires the extension codex app server attempt light test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createExtensionCodexAppServerAttemptLightVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig([], {
    dir: "extensions",
    env,
    fileParallelism: false,
    name: "extension-codex-app-server-attempt-light",
    setupFiles: ["test/setup.extensions.ts"],
  });
}

export default createExtensionCodexAppServerAttemptLightVitestConfig();
