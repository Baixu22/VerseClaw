// @vitest-environment node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const facade = "openclaw_runtime/src/context-engine/stage5-memory-facade.ts";
const golden = "openclaw_runtime/src/agents/stage5-golden-run.ts";
const read = (file: string) => readFileSync(join(root, file), "utf8");
function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mjs|mts)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}
const sources = ["openclaw_runtime/src", "openclaw_runtime/packages", "src", "electron", "shared", "packages"].flatMap(sourceFiles);
function consumers(entries: Array<{ file: string; text: string }>): string[] {
  return entries.filter(({ file, text }) => file !== facade && file !== golden &&
    /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*stage5-memory-facade(?:\.[cm]?[jt]s)?["']|\bcreateSemanticMemoryFacade\b|\bSemanticMemoryFacade\b/.test(text)).map(entry => entry.file);
}
const productionConsumers = consumers(sources.map(file => ({ file, text: read(file) })));

afterAll(() => {
  if (process.env.MEMORY_FACADE_TRACE_PATH) writeFileSync(process.env.MEMORY_FACADE_TRACE_PATH,
    JSON.stringify({ driven_by: "agent", actor: "codex/tf0744", decision: "retire", scannedFiles: sources.length,
      productionConsumers, permittedObservationImporter: golden, policy: "direct exports retained for historical tests/replay, no production barrel export" }, null, 2));
});

describe("TF-0744 Stage5 facade disposition", () => {
  it("has zero production consumers and exports beyond the historical observer", () => {
    expect(productionConsumers).toEqual([]);
    expect(read(golden)).toContain('from "../context-engine/stage5-memory-facade.js"');
  });
  it.each([
    'import { createSemanticMemoryFacade } from "./stage5-memory-facade.js";',
    'export * from "./stage5-memory-facade.js";',
    'const facade = await import("./stage5-memory-facade.js");',
  ])("rejects a production importer fixture: %s", text => {
    expect(consumers([{ file: "src/fixture.ts", text }])).toEqual(["src/fixture.ts"]);
  });
  it("marks the facade, observer and current guide with the same retirement decision", () => {
    expect(read(facade)).toContain("@deprecated Production adoption retired (TF-0744)");
    expect(read(golden)).toContain("TF-0744: historical observation only");
    expect(read("docs/dev/memory-control-plane.md")).toContain("Stage5 facade 决策：retire（TF-0744）");
    expect(read("harness/specs/tasks/context-control-plane-stage5.md")).toContain("Production disposition: retire (TF-0744)");
  });
  it("does not infer production registration from the direct self-edit test interface", () => {
    expect(read("openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts")).toContain("runtime.memory.persist remains retired");
    expect(read("openclaw_runtime/src/runtime-core/memory-self-edit-adapter.ts")).toContain('if (!runtimeMemoryFlagEnabled(cfg, "persist"))');
  });
});
