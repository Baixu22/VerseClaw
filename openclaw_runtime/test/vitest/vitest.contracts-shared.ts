// Vitest contract shared helpers build contract test project configuration.
import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadPatternListFromEnv, narrowIncludePatternsForCli } from "./vitest.pattern-file.ts";
import { nonIsolatedRunnerPath, sharedVitestConfig } from "./vitest.shared.config.ts";

const base = sharedVitestConfig as Record<string, unknown>;
const baseTest = sharedVitestConfig.test ?? {};

export const channelSurfaceContractPatterns = [
  "src/channels/plugins/contracts/*-shard-a.contract.test.ts",
  "src/channels/plugins/contracts/*-shard-e.contract.test.ts",
];

export const channelConfigContractPatterns = [
  "src/channels/plugins/contracts/*-shard-b.contract.test.ts",
  "src/channels/plugins/contracts/*-shard-f.contract.test.ts",
];

export const channelRegistryContractPatterns = [
  "src/channels/plugins/contracts/*-shard-c.contract.test.ts",
  "src/channels/plugins/contracts/*-shard-g.contract.test.ts",
];

export const channelSessionContractPatterns = [
  "src/channels/plugins/contracts/*-shard-d.contract.test.ts",
  "src/channels/plugins/contracts/*-shard-h.contract.test.ts",
];

export const pluginContractPatterns = ["src/plugins/contracts/**/*.test.ts"];

export function loadContractsIncludePatternsFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  return loadPatternListFromEnv("OPENCLAW_VITEST_INCLUDE_FILE", env);
}

function narrowContractIncludePatterns(
  includePatterns: string[],
  candidatePatterns: string[] | null,
): string[] | null {
  if (!candidatePatterns) {
    return null;
  }

  return [
    ...new Set(
      candidatePatterns.filter((candidate) =>
        includePatterns.some(
          (pattern) => path.matchesGlob(candidate, pattern) || path.matchesGlob(pattern, candidate),
        ),
      ),
    ),
  ];
}

export function createContractsVitestConfig(
  includePatterns: string[],
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
  options: { name?: string } = {},
) {
  const cliIncludePatterns = narrowIncludePatternsForCli(includePatterns, argv);
  const envIncludePatterns = narrowContractIncludePatterns(
    includePatterns,
    loadContractsIncludePatternsFromEnv(env),
  );
  return defineConfig({
    ...base,
    test: {
      ...baseTest,
      name: options.name ?? "contracts",
      isolate: false,
      runner: nonIsolatedRunnerPath,
      setupFiles: baseTest.setupFiles ?? [],
      include: envIncludePatterns ?? cliIncludePatterns ?? includePatterns,
    },
  });
}

