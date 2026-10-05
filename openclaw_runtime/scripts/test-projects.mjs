// Use Vitest's canonical project matrix; retain the shared watchdog and cleanup.
import { main, hasExplicitVitestConfigArg, resolveExplicitVitestMode, resolveMissingExplicitTestFiles } from "./run-vitest.mjs";

export function testProjectsArgs(argv) {
  const mode = resolveExplicitVitestMode(argv);
  const config = hasExplicitVitestConfigArg(argv) ? [] : ["--config", "vitest.config.ts"];
  return [...(mode ? [] : ["run"]), ...config, ...argv];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const missing = resolveMissingExplicitTestFiles(argv);
  if (missing.length > 0) {
    console.error(`[vitest] explicit test/source file(s) not found:\n${missing.join("\n")}`);
    process.exit(1);
  }
  await main(testProjectsArgs(argv));
}
