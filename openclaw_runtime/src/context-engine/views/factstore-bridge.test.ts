import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAgentMapResult } from "../../runtime-core/index.js";
import { createAgentMapContextProvider } from "../agent-map-context-provider.js";
import { createSymbolContextProvider } from "../symbol-context-provider.js";
import { createMaterializer, type Materializer } from "../factstore/materialize.js";
import { FactStore } from "../factstore/store.js";
import { createFactStoreBridge, type FactStoreBridge } from "./factstore-bridge.js";

const FIXTURES: Record<string, string> = {
  "src/config.ts": `export function loadConfig(path: string): string {
  return path;
}

export class ConfigService {
  get(path: string): string {
    return loadConfig(path);
  }
}
`,
  "src/settings.py": `import json

def load_settings(path):
    return json.loads(path)

class Settings:
    def refresh(self):
        return load_settings(self.path)
`,
  "src/greeter.go": `package main

import "fmt"

type Greeter struct{}

func Hello(name string) string {
	return fmt.Sprintf("hello %s", name)
}
`,
  "src/registry.rs": `pub struct Registry {
    entries: Vec<String>,
}

pub fn lookup(registry: &Registry, key: &str) -> Option<&String> {
    registry.entries.first()
}
`,
  "src/Cache.java": `public class Cache {
    public String get(String key) {
        return key;
    }
}
`,
};

const ALL_FILES = Object.keys(FIXTURES);

describe("factstore bridge for the two shadow providers (gate F)", () => {
  let repoRoot: string;
  let store: FactStore;
  let materializer: Materializer;
  let bridge: FactStoreBridge;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "factstore-bridge-"));
    for (const [relPath, content] of Object.entries(FIXTURES)) {
      const absolutePath = path.join(repoRoot, relPath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content);
    }
    store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
    materializer = createMaterializer(store, repoRoot);
    bridge = createFactStoreBridge(store, materializer);
  });

  afterEach(() => {
    store.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("produces a contract-valid AgentMapResult from FactStore facts", () => {
    const result = bridge.agentMapResult({ activeFiles: ALL_FILES });
    expect(result).toBeDefined();
    // The provider's own runtime guard is the interface-compat oracle (gate F-1 companion).
    expect(isAgentMapResult(result)).toBe(true);
    expect(result?.status).toBe("success");
    expect(result?.readonly).toBe(true);
    expect(result?.includedFiles.map((file) => file.file).sort()).toEqual([...ALL_FILES].sort());
    expect(result?.content).toContain("## src/settings.py");
  });

  it("upgrades beyond JS/TS: five languages yield symbols (gate F-2)", () => {
    const result = bridge.agentMapResult({ activeFiles: ALL_FILES });
    const names = new Set(result?.includedSymbols.map((ranked) => ranked.tag.name));
    // Old agent-map (AGENT_MAP_SUPPORTED_EXTENSIONS) could only ever tag the .ts file.
    expect(names).toContain("loadConfig");
    expect(names).toContain("load_settings");
    expect(names).toContain("Hello");
    expect(names).toContain("lookup");
    expect(names).toContain("Cache");

    const byFactLanguage = new Map<string, number>();
    for (const ranked of result?.includedSymbols ?? []) {
      const factLanguage = String(ranked.tag.metadata?.factLanguage);
      byFactLanguage.set(factLanguage, (byFactLanguage.get(factLanguage) ?? 0) + 1);
      // The agent-map language enum stays intact (interface compatibility):
      expect(["typescript", "tsx", "javascript", "jsx", "unknown"]).toContain(ranked.tag.language);
    }
    for (const language of ["typescript", "python", "go", "rust", "java"]) {
      expect(byFactLanguage.get(language) ?? 0).toBeGreaterThan(0);
    }
  });

  it("agent-map and symbol views agree on the same file's symbol set (gate F-3)", () => {
    const agentMap = bridge.agentMapResult({ activeFiles: ALL_FILES });
    const overviews = bridge.symbolOverviews({ activeFiles: ALL_FILES });

    for (const filePath of ALL_FILES) {
      const key = (name: string, startLine: number) => `${name}@${startLine}`;
      const fromAgentMap = new Set(
        (agentMap?.includedSymbols ?? [])
          .filter((ranked) => ranked.tag.file === filePath)
          .map((ranked) => key(ranked.tag.name, ranked.tag.range.startLine)),
      );
      const fromOverview = new Set(
        (overviews.find((overview) => overview.file === filePath)?.symbols ?? []).map((symbol) =>
          key(symbol.name, symbol.range.start.line),
        ),
      );
      const fromStore = new Set(
        store
          .getSymbolsByFile(repoRoot, filePath)
          .filter((symbol) => symbol.kind !== "file")
          .map((symbol) => key(symbol.name, symbol.startLine)),
      );
      expect(fromAgentMap).toEqual(fromStore);
      expect(fromOverview).toEqual(fromStore);
      expect(fromStore.size).toBeGreaterThan(0);
    }
  });

  it("feeds the agent-map shadow provider end to end through getResult", async () => {
    const provider = createAgentMapContextProvider({
      getResult: (query) => bridge.agentMapResult({ activeFiles: query.activeFiles, tokenBudget: query.tokenBudget }),
    });
    expect(provider.manifest.shadowOnly).toBe(true);

    const result = await provider.getContext({
      goal: "map the workspace",
      workspace: repoRoot,
      activeFiles: ALL_FILES,
      metadata: { config: { runtime: { agentMap: { provider: true } } } },
    });
    if (Array.isArray(result)) throw new Error("expected full provider result");
    expect(result.status).toBe("success");
    expect(result.metadata?.shadowOnly).toBe(true);
    const symbolItems = result.contextItems.filter((item) => item.kind === "symbol");
    expect(symbolItems.length).toBeGreaterThanOrEqual(5);
    const texts = symbolItems.map((item) => String(item.metadata?.name));
    expect(texts).toContain("load_settings");
  });

  it("feeds the symbol shadow provider end to end through getOverviews", async () => {
    const provider = createSymbolContextProvider({
      getOverviews: (query) => bridge.symbolOverviews({ activeFiles: query.activeFiles }),
    });
    expect(provider.manifest.shadowOnly).toBe(true);

    const result = await provider.getContext({
      goal: "symbol overview",
      workspace: repoRoot,
      activeFiles: ["src/settings.py"],
    });
    if (Array.isArray(result)) throw new Error("expected full provider result");
    expect(result.status).toBe("success");
    expect(result.metadata?.shadowOnly).toBe(true);
    const flattened = JSON.stringify(result.contextItems);
    expect(flattened).toContain("load_settings");
  });

  it("returns undefined/empty when no active files are given", () => {
    expect(bridge.agentMapResult({})).toBeUndefined();
    expect(bridge.symbolOverviews({})).toEqual([]);
  });

  it("declares budget-deferred files as excluded instead of dropping them", () => {
    const result = bridge.agentMapResult({ activeFiles: ALL_FILES.slice(0, 3) });
    expect(result?.excludedFiles ?? []).toEqual([]);

    const limited = createMaterializer(store, repoRoot, { budget: { maxParsePerQuery: 2 } });
    const freshRepoBridge = createFactStoreBridge(store, limited);
    // Force re-analysis pressure with a fresh store on unseen files: use new temp files.
    const extraFiles = ["src/extra1.py", "src/extra2.py", "src/extra3.py", "src/extra4.py"];
    for (const relPath of extraFiles) {
      writeFileSync(path.join(repoRoot, relPath), `def fn_${relPath.replace(/\W/g, "_")}():\n    return 1\n`);
    }
    const limitedResult = freshRepoBridge.agentMapResult({ activeFiles: extraFiles });
    expect(limitedResult?.excludedFiles.filter((file) => file.reason === "budget")).toHaveLength(2);
  });
});
