// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const mocked = vi.hoisted(() => ({ aliases: vi.fn(), native: vi.fn() }));
vi.mock("../../openclaw_runtime/src/plugins/native-module-require.js", async (original) => ({
  ...await original<typeof import("../../openclaw_runtime/src/plugins/native-module-require")>(),
  tryNativeRequireJavaScriptModule: mocked.native,
}));
vi.mock("../../openclaw_runtime/src/plugins/sdk-alias.js", async (original) => ({
  ...await original<typeof import("../../openclaw_runtime/src/plugins/sdk-alias")>(),
  buildPluginLoaderAliasMap: mocked.aliases,
}));
import { loadBundledEntryExportSync } from "../../openclaw_runtime/src/plugin-sdk/channel-entry-contract";

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "channel-native-sidecar-"));
  mkdirSync(join(root, "dist/extensions/fixture"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "openclaw", version: "1.0.0" }));
  writeFileSync(join(root, "dist/extensions/fixture/sidecar.js"), "export const detector = () => [];");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const load = () => loadBundledEntryExportSync(pathToFileURL(join(root,"dist/extensions/fixture/setup-entry.js")).href,
  { specifier: "./sidecar.js", exportName: "detector" });

it("loads compiled sidecars without preparing the SDK alias graph", () => {
  const detector = () => [];
  mocked.native.mockReturnValue({ ok: true, moduleExport: { detector } });
  expect(load()).toBe(detector);
  expect(load()).toBe(detector);
  expect(mocked.native).toHaveBeenCalledTimes(1);
  expect(mocked.aliases).not.toHaveBeenCalled();
});

it("preserves alias resolution when native dependencies need the SDK mapping", () => {
  const detector = () => [];
  const aliasMap = { "openclaw/plugin-sdk/core": "fixture.js" };
  mocked.aliases.mockReturnValue(aliasMap);
  mocked.native.mockReturnValueOnce({ ok: false }).mockReturnValueOnce({ ok: true, moduleExport: { detector } });
  expect(load()).toBe(detector);
  expect(mocked.aliases).toHaveBeenCalledTimes(1);
  expect(mocked.native.mock.calls[0][1]).not.toHaveProperty("aliasMap");
  expect(mocked.native.mock.calls[1][1]).toMatchObject({ aliasMap });
});
