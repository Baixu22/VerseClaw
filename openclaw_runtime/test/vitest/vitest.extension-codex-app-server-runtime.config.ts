// Vitest extension codex app server runtime config wires the extension codex app server runtime test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createExtensionCodexAppServerRuntimeVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig(
    [
      "extensions/codex/src/app-server/thread-lifecycle*.test.ts",
      "extensions/codex/src/app-server/transport-*.test.ts",
    ],
    {
      dir: "extensions",
      env,
      fileParallelism: false,
      name: "extension-codex-app-server-runtime",
      setupFiles: ["test/setup.extensions.ts"],
    },
  );
}

export default createExtensionCodexAppServerRuntimeVitestConfig();
