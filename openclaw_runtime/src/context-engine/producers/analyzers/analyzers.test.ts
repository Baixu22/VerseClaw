import { describe, expect, it } from "vitest";
import type { CodeFile, LanguageId } from "../../fact-types.js";
import { projectIdForRoot, sha256 } from "../hash.js";
import { fallbackAnalyzer } from "./fallback-analyzer.js";
import { goTreeSitterAnalyzer } from "./go-treesitter-analyzer.js";
import { javaTreeSitterAnalyzer } from "./java-treesitter-analyzer.js";
import { pythonTreeSitterAnalyzer } from "./python-treesitter-analyzer.js";
import { analyzeFileWithRegistry, analyzerFor, listAnalyzers } from "./registry.js";
import { rustTreeSitterAnalyzer } from "./rust-treesitter-analyzer.js";
import { javascriptAnalyzer, typescriptAnalyzer } from "./typescript-analyzer.js";

const REPO_ROOT = "/fixtures/repo";
const PROJECT_ID = projectIdForRoot(REPO_ROOT);

function makeFile(filePath: string, language: LanguageId, content: string): CodeFile {
  return {
    projectId: PROJECT_ID,
    path: filePath,
    absolutePath: `${REPO_ROOT}/${filePath}`,
    language,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: sha256(content),
    modifiedAtMs: 0,
  };
}

const TS_FIXTURE = `import { readFile } from "node:fs/promises";

export function loadConfig(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export class ConfigService {
  cache = new Map<string, string>();

  async get(path: string): Promise<string> {
    const cached = this.cache.get(path);
    if (cached) return cached;
    const value = await loadConfig(path);
    this.cache.set(path, value);
    return value;
  }
}
`;

describe("typescript analyzer via registry (gate B-2)", () => {
  const file = makeFile("src/config.ts", "typescript", TS_FIXTURE);
  const analysis = analyzeFileWithRegistry({ repoRoot: REPO_ROOT, file, content: TS_FIXTURE });

  it("returns the expected symbols", () => {
    const names = analysis.symbols.map((symbol) => symbol.name);
    expect(names).toContain("loadConfig");
    expect(names).toContain("ConfigService");
    expect(names).toContain("get");
    const loadConfig = analysis.symbols.find((symbol) => symbol.name === "loadConfig");
    expect(loadConfig?.kind).toBe("function");
    expect(loadConfig?.exported).toBe(true);
    const service = analysis.symbols.find((symbol) => symbol.name === "ConfigService");
    expect(service?.kind).toBe("class");
  });

  it("returns the import edge for node:fs/promises", () => {
    const importEdge = analysis.edges.find(
      (edge) => edge.kind === "imports" && edge.metadata?.source === "node:fs/promises",
    );
    expect(importEdge).toBeDefined();
    expect(importEdge?.metadata?.bindings).toEqual([{ imported: "readFile", local: "readFile" }]);
  });

  it("returns call and containment edges", () => {
    const callTargets = analysis.edges
      .filter((edge) => edge.kind === "calls")
      .map((edge) => edge.metadata?.targetName);
    expect(callTargets).toContain("loadConfig");
    expect(analysis.edges.some((edge) => edge.kind === "contains")).toBe(true);
    expect(analysis.edges.some((edge) => edge.kind === "exports")).toBe(true);
  });

  it("produces chunks with content hashes", () => {
    expect(analysis.chunks.length).toBeGreaterThan(0);
    for (const chunk of analysis.chunks) {
      expect(chunk.contentHash).toBe(sha256(chunk.content));
      expect(chunk.projectId).toBe(PROJECT_ID);
    }
  });
});

const PY_FIXTURE = `import json
from pathlib import Path

def load_settings(path):
    return json.loads(Path(path).read_text())

class Settings:
    def refresh(self):
        return load_settings(self.path)
`;

const GO_FIXTURE = `package main

import "fmt"

type Greeter struct{}

func Hello(name string) string {
	return fmt.Sprintf("hello %s", name)
}
`;

const RUST_FIXTURE = `use std::collections::HashMap;

pub struct Registry {
    entries: HashMap<String, String>,
}

pub fn lookup(registry: &Registry, key: &str) -> Option<&String> {
    registry.entries.get(key)
}
`;

const JAVA_FIXTURE = `import java.util.HashMap;

public class Cache {
    private HashMap<String, String> entries = new HashMap<>();

    public String get(String key) {
        return entries.get(key);
    }
}
`;

interface LanguageFixture {
  language: LanguageId;
  filePath: string;
  content: string;
  expectedSymbols: string[];
  expectedImportSource: string;
  expectedCallTarget: string;
}

const FIXTURES: LanguageFixture[] = [
  {
    language: "typescript",
    filePath: "src/config.ts",
    content: TS_FIXTURE,
    expectedSymbols: ["loadConfig", "ConfigService"],
    expectedImportSource: "node:fs/promises",
    expectedCallTarget: "loadConfig",
  },
  {
    language: "python",
    filePath: "src/settings.py",
    content: PY_FIXTURE,
    expectedSymbols: ["load_settings", "Settings"],
    expectedImportSource: "json",
    expectedCallTarget: "load_settings",
  },
  {
    language: "go",
    filePath: "src/greeter.go",
    content: GO_FIXTURE,
    expectedSymbols: ["Hello", "Greeter"],
    expectedImportSource: "fmt",
    expectedCallTarget: "Sprintf",
  },
  {
    language: "rust",
    filePath: "src/registry.rs",
    content: RUST_FIXTURE,
    expectedSymbols: ["lookup", "Registry"],
    expectedImportSource: "std::collections::HashMap",
    expectedCallTarget: "get",
  },
  {
    language: "java",
    filePath: "src/Cache.java",
    content: JAVA_FIXTURE,
    expectedSymbols: ["Cache", "get"],
    expectedImportSource: "java.util.HashMap",
    expectedCallTarget: "get",
  },
];

describe("five-language fixtures via registry (gate B-3)", () => {
  for (const fixture of FIXTURES) {
    it(`analyzes a ${fixture.language} fixture`, () => {
      const file = makeFile(fixture.filePath, fixture.language, fixture.content);
      const analysis = analyzeFileWithRegistry({
        repoRoot: REPO_ROOT,
        file,
        content: fixture.content,
      });

      expect(analysis.warnings ?? []).toEqual([]);
      const names = analysis.symbols.map((symbol) => symbol.name);
      for (const expected of fixture.expectedSymbols) {
        expect(names).toContain(expected);
      }
      const importSources = analysis.edges
        .filter((edge) => edge.kind === "imports")
        .map((edge) => edge.metadata?.source);
      expect(importSources).toContain(fixture.expectedImportSource);
      const callTargets = analysis.edges
        .filter((edge) => edge.kind === "calls")
        .map((edge) => edge.metadata?.targetName);
      expect(callTargets).toContain(fixture.expectedCallTarget);
    });
  }
});

describe("analyzer registry capability declarations (gate B-3)", () => {
  const expectedCapabilities: Record<string, string[]> = {
    typescript: ["symbols", "imports", "exports", "calls", "definitions", "framework_routes", "tests"],
    javascript: ["symbols", "imports", "exports", "calls", "definitions", "framework_routes", "tests"],
    python: ["symbols", "imports", "exports", "calls"],
    go: ["symbols", "imports", "exports", "calls", "tests"],
    rust: ["symbols", "imports", "exports", "calls"],
    java: ["symbols", "imports", "exports", "calls"],
    unknown: [],
  };

  it("routes each language to the declared analyzer", () => {
    expect(analyzerFor("typescript")).toBe(typescriptAnalyzer);
    expect(analyzerFor("javascript")).toBe(javascriptAnalyzer);
    expect(analyzerFor("python")).toBe(pythonTreeSitterAnalyzer);
    expect(analyzerFor("go")).toBe(goTreeSitterAnalyzer);
    expect(analyzerFor("rust")).toBe(rustTreeSitterAnalyzer);
    expect(analyzerFor("java")).toBe(javaTreeSitterAnalyzer);
    expect(analyzerFor("markdown")).toBe(fallbackAnalyzer);
  });

  it("declares capabilities consistent with the registry", () => {
    for (const analyzer of listAnalyzers()) {
      expect(analyzer.capabilities).toEqual(expectedCapabilities[analyzer.language]);
    }
  });

  it("keeps exported flags grounded in each language's visibility rules", () => {
    const py = analyzeFileWithRegistry({
      repoRoot: REPO_ROOT,
      file: makeFile("src/settings.py", "python", PY_FIXTURE),
      content: PY_FIXTURE,
    });
    expect(py.symbols.find((symbol) => symbol.name === "load_settings")?.exported).toBe(true);

    const rust = analyzeFileWithRegistry({
      repoRoot: REPO_ROOT,
      file: makeFile("src/registry.rs", "rust", RUST_FIXTURE),
      content: RUST_FIXTURE,
    });
    expect(rust.symbols.find((symbol) => symbol.name === "lookup")?.exported).toBe(true);

    const java = analyzeFileWithRegistry({
      repoRoot: REPO_ROOT,
      file: makeFile("src/Cache.java", "java", JAVA_FIXTURE),
      content: JAVA_FIXTURE,
    });
    expect(java.symbols.find((symbol) => symbol.name === "Cache")?.exported).toBe(true);
  });
});
