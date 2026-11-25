// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { clearNativeRequireJavaScriptModuleCache, tryNativeRequireJavaScriptModule } from "../../openclaw_runtime/src/plugins/native-module-require";

const roots: string[] = [];
const entries: string[] = [];
afterEach(() => {
  for (const file of entries.splice(0)) clearNativeRequireJavaScriptModuleCache(file);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(name: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), "native-plugin-"));
  roots.push(root);
  const file = join(root, name);
  writeFileSync(file, content);
  entries.push(file);
  return file;
}

it.each(["compiled.cjs", "编码 # percent%.cjs"])("loads compiled file URLs natively: %s", (name) => {
  const file = fixture(name, "module.exports = { loaded: 42 };");
  expect(tryNativeRequireJavaScriptModule(pathToFileURL(file).href, { allowWindows: true }))
    .toEqual({ ok: true, moduleExport: { loaded: 42 } });
});

it("invalidates a native module loaded through a file URL", () => {
  const file = fixture("plugin.cjs", "module.exports = 1;");
  const url = pathToFileURL(file).href;
  expect(tryNativeRequireJavaScriptModule(url, { allowWindows: true })).toEqual({ ok: true, moduleExport: 1 });
  writeFileSync(file, "module.exports = 2;");
  clearNativeRequireJavaScriptModuleCache(url);
  expect(tryNativeRequireJavaScriptModule(url, { allowWindows: true })).toEqual({ ok: true, moduleExport: 2 });
});

it("loads compiled ESM and its relative dependencies through a file URL", () => {
  const file = fixture("entry.mjs", "export { value } from './dependency.mjs';");
  writeFileSync(join(dirname(file), "dependency.mjs"), "export const value = 42;");
  expect(tryNativeRequireJavaScriptModule(pathToFileURL(file).href, { allowWindows: true }))
    .toMatchObject({ ok: true, moduleExport: { value: 42 } });
});

it("retains source fallback and explicit dependency-error policy", () => {
  const source = fixture("plugin.ts", "export const value: number = 1;");
  expect(tryNativeRequireJavaScriptModule(pathToFileURL(source).href, { allowWindows: true })).toEqual({ ok: false });
  const broken = fixture("broken.cjs", "require('./missing-dependency.cjs');");
  expect(() => tryNativeRequireJavaScriptModule(pathToFileURL(broken).href, { allowWindows: true })).toThrow("missing-dependency");
  expect(tryNativeRequireJavaScriptModule(pathToFileURL(broken).href, { allowWindows: true, fallbackOnMissingDependency: true })).toEqual({ ok: false });
});
