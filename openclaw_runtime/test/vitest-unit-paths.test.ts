// R1-2: guard that unit test routing manifests only reference real files.
// If a path manifest lists a deleted test/source file, the unit shard silently
// runs fewer tests than intended. Fail fast on any dangling reference.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandsLightSourceFiles, commandsLightTestFiles } from "./vitest/vitest.commands-light-paths.mjs";
import { pluginSdkLightSourceFiles, pluginSdkLightTestFiles } from "./vitest/vitest.plugin-sdk-paths.mjs";
import { forcedUnitFastTestFiles } from "./vitest/vitest.unit-fast-paths.mjs";
import {
  boundaryTestFiles,
  bundledPluginDependentUnitTestFiles,
} from "./vitest/vitest.unit-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const refs = [
  ...commandsLightSourceFiles,
  ...commandsLightTestFiles,
  ...pluginSdkLightSourceFiles,
  ...pluginSdkLightTestFiles,
  ...forcedUnitFastTestFiles,
  ...boundaryTestFiles,
  ...bundledPluginDependentUnitTestFiles,
];

describe("unit test routing manifests resolve to real files", () => {
  it("has no dangling references", () => {
    for (const ref of refs) {
      const abs = path.join(repoRoot, ...ref.split("/"));
      expect(fs.existsSync(abs), `missing manifest path: ${ref}`).toBe(true);
    }
  });
});
