// Unit test routing globs and boundary/bundled-plugin exclusions.
import path from "node:path";
import { BUNDLED_PLUGIN_ROOT_DIR } from "../../scripts/lib/bundled-plugin-paths.mjs";

export const unitTestIncludePatterns = [
  "src/**/*.test.ts",
  "packages/**/*.test.ts",
  "test/**/*.test.ts",
  // TF-0116: experiments moved out of src keep their colocated tests here.
  "experiments/**/*.test.ts",
];

export const boundaryTestFiles = [
  "test/extension-import-boundaries.test.ts",
  "test/web-provider-boundary.test.ts",
];

export const bundledPluginDependentUnitTestFiles = [];

export const unitTestAdditionalExcludePatterns = [
  "src/gateway/**",
  "src/hooks/**",
  "src/infra/**",
  `${BUNDLED_PLUGIN_ROOT_DIR}/**`,
  "src/browser/**",
  "src/line/**",
  "src/agents/**",
  "src/auto-reply/**",
  "src/channels/**",
  "src/cli/**",
  "src/commands/**",
  "src/config/**",
  "src/cron/**",
  "src/daemon/**",
  "src/media/**",
  "src/plugin-sdk/**",
  "src/plugins/**",
  "src/process/**",
  "src/secrets/**",
  "src/shared/**",
  "src/tasks/**",
  "src/media-understanding/**",
  "src/logging/**",
  "src/tui/**",
  "src/utils/**",
  "src/wizard/**",
  "src/plugins/contracts/**",
  "src/scripts/**",
  "test/**",
];

const sharedBaseExcludePatterns = [
  "dist/**",
  "apps/macos/**",
  "apps/macos/.build/**",
  "**/node_modules/**",
  "**/vendor/**",
  "dist/OpenClaw.app/**",
  "**/*.live.test.ts",
  "**/*.e2e.test.ts",
];

const normalizeRepoPath = (value) => value.split(path.sep).join("/");

const matchesAny = (file, patterns) => patterns.some((pattern) => path.matchesGlob(file, pattern));

export function isUnitConfigTestFile(file) {
  const normalizedFile = normalizeRepoPath(file);
  return (
    matchesAny(normalizedFile, unitTestIncludePatterns) &&
    !matchesAny(normalizedFile, sharedBaseExcludePatterns) &&
    !matchesAny(normalizedFile, unitTestAdditionalExcludePatterns)
  );
}

export function isBundledPluginDependentUnitTestFile(file) {
  return bundledPluginDependentUnitTestFiles.includes(normalizeRepoPath(file));
}

export function isBoundaryTestFile(file) {
  return boundaryTestFiles.includes(normalizeRepoPath(file));
}
