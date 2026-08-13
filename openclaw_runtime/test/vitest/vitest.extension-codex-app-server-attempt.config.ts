// Vitest extension codex app server attempt config wires the extension codex app server attempt test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createExtensionCodexAppServerAttemptVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig([], {
    dir: "extensions",
    env,
    fileParallelism: false,
    name: "extension-codex-app-server-attempt",
    setupFiles: ["test/setup.extensions.ts"],
  });
}

export default createExtensionCodexAppServerAttemptVitestConfig();
