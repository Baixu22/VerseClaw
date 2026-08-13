// R1-2: guard that production src/** never imports bundled plugin internals.
import { describe, expect, it } from "vitest";
import { createExtensionImportBoundaryChecker } from "../scripts/lib/extension-import-boundary-checker.mjs";

const ALLOWED_EXTENSION_PUBLIC_SURFACE_RE = /^extensions\/[^/]+\/(?:api|runtime-api)\.js$/;

const checker = createExtensionImportBoundaryChecker({
  roots: ["src"],
  boundaryLabel: "src",
  rule: "Rule: production src/** must not import bundled plugin files",
  cleanMessage: "No src import boundary violations found.",
  inventoryTitle: "Src extension import boundary inventory:",
  skipSourcesWithoutBundledPluginPrefix: true,
  allowResolvedPath(resolvedPath) {
    return ALLOWED_EXTENSION_PUBLIC_SURFACE_RE.test(resolvedPath);
  },
  shouldSkipFile(relativeFile) {
    return (
      relativeFile.endsWith(".test.ts") ||
      relativeFile.endsWith(".test.tsx") ||
      relativeFile.endsWith(".e2e.test.ts") ||
      relativeFile.endsWith(".e2e.test.tsx")
    );
  },
});

describe("src extension import boundary", () => {
  it("is clean (no src -> bundled-plugin imports)", async () => {
    const inventory = await checker.collectInventory();
    expect(inventory, JSON.stringify(inventory, null, 2)).toEqual([]);
  });
});
