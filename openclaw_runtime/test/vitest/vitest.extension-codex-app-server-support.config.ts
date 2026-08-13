// Vitest extension codex app server support config wires the extension codex app server support test shard.
import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

const coveredAppServerPatterns = [
  "extensions/codex/src/app-server/attempt-*.test.ts",
  "extensions/codex/src/app-server/run-attempt*.test.ts",
  "extensions/codex/src/app-server/thread-lifecycle*.test.ts",
  "extensions/codex/src/app-server/transport-*.test.ts",
  "extensions/codex/src/app-server/dynamic-tool*.test.ts",
  "extensions/codex/src/app-server/sandbox-exec-server*.test.ts",
];

export function createExtensionCodexAppServerSupportVitestConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return createScopedVitestConfig(["extensions/codex/src/app-server/**/*.test.ts"], {
    dir: "extensions",
    env,
    exclude: coveredAppServerPatterns,
    fileParallelism: false,
    name: "extension-codex-app-server-support",
    setupFiles: ["test/setup.extensions.ts"],
  });
}

export default createExtensionCodexAppServerSupportVitestConfig();
