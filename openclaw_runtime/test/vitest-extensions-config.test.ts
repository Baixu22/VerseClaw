// R1-2: guard that extension test routing manifests reference existing roots.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mediaExtensionTestRoots } from "./vitest/vitest.extension-media-paths.mjs";
import { memoryExtensionTestRoots } from "./vitest/vitest.extension-memory-paths.mjs";
import { messagingExtensionTestRoots } from "./vitest/vitest.extension-messaging-paths.mjs";
import { miscExtensionTestRoots } from "./vitest/vitest.extension-misc-paths.mjs";
import { providerExtensionTestRoots } from "./vitest/vitest.extension-provider-paths.mjs";
import { qaExtensionTestRoots } from "./vitest/vitest.extension-qa-paths.mjs";
import { zaloExtensionTestRoots } from "./vitest/vitest.extension-zalo-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const roots = [
  ...mediaExtensionTestRoots,
  ...memoryExtensionTestRoots,
  ...messagingExtensionTestRoots,
  ...miscExtensionTestRoots,
  ...providerExtensionTestRoots,
  ...qaExtensionTestRoots,
  ...zaloExtensionTestRoots,
];

describe("extension test routing roots resolve to real directories", () => {
  it("has no dangling extension roots", () => {
    for (const root of roots) {
      const abs = path.join(repoRoot, ...root.split("/"));
      expect(fs.existsSync(abs), `missing extension root: ${root}`).toBe(true);
    }
  });
});
