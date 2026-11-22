import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeFile, LanguageId } from "../fact-types.js";
import { projectIdForRoot, sha256 } from "../producers/hash.js";
import { analyzeFileWithRegistry } from "../producers/analyzers/registry.js";
import { gateFreshness, resolveFreshnessModeFromEnv, type FreshnessCheck } from "./freshness.js";
import { factStoreIgnoreReason } from "./ignore.js";
import { closeAllFactStores, FactStore, factStorePathFor, openFactStore } from "./store.js";

const PY_FIXTURE = `import json
from pathlib import Path

def load_settings(path):
    return json.loads(Path(path).read_text())

class Settings:
    def refresh(self):
        return load_settings(self.path)
`;

const TS_FIXTURE = `import { readFile } from "node:fs/promises";

export function loadConfig(path: string): Promise<string> {
  return readFile(path, "utf8");
}
`;

function makeFile(
  projectId: string,
  repoRoot: string,
  filePath: string,
  language: LanguageId,
  content: string,
): CodeFile {
  return {
    projectId,
    path: filePath,
    absolutePath: path.join(repoRoot, filePath),
    language,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    contentHash: sha256(content),
    modifiedAtMs: 0,
  };
}

function analyzePython(projectId: string, repoRoot: string, filePath = "src/settings.py") {
  const file = makeFile(projectId, repoRoot, filePath, "python", PY_FIXTURE);
  const analysis = analyzeFileWithRegistry({ repoRoot, file, content: PY_FIXTURE });
  return { file, analysis };
}

describe("factstore (gate C)", () => {
  let repoRoot: string;
  let projectId: string;
  let store: FactStore;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "factstore-test-"));
    projectId = projectIdForRoot(repoRoot);
    store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("round-trips one file's facts: write then read back identical (gate C-1)", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    const result = store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    expect(result.stored).toBe(true);
    if (!result.stored) return;
    expect(result.counts).toEqual({
      symbols: analysis.symbols.length,
      edges: analysis.edges.length,
      chunks: analysis.chunks.length,
    });

    const byId = <T extends { id: string }>(items: T[]) =>
      [...items].sort((a, b) => a.id.localeCompare(b.id));
    // The store canonicalizes exported to a boolean (ragcode semantics: exported ? 1 : 0).
    const expectedSymbols = analysis.symbols.map((symbol) => ({
      ...symbol,
      exported: symbol.exported ?? false,
    }));
    expect(byId(store.getSymbolsByFile(repoRoot, file.path))).toEqual(byId(expectedSymbols));
    expect(store.getEdgesByFile(repoRoot, file.path)).toEqual(analysis.edges);
    expect(byId(store.getChunksByFile(repoRoot, file.path))).toEqual(byId(analysis.chunks));

    const record = store.getFileRecord(repoRoot, file.path);
    expect(record?.file.contentHash).toBe(file.contentHash);
    expect(record?.status).toBe("fresh");
  });

  it("replaces rows on re-upsert instead of duplicating", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    const input = {
      repoRoot,
      file,
      producer: "treesitter" as const,
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    };
    store.upsertFileFacts(input);
    store.upsertFileFacts(input);
    expect(store.getSymbolsByFile(repoRoot, file.path)).toHaveLength(analysis.symbols.length);
    expect(store.getEdgesByFile(repoRoot, file.path)).toHaveLength(analysis.edges.length);
    expect(store.getChunksByFile(repoRoot, file.path)).toHaveLength(analysis.chunks.length);
  });

  it("bounds edge reads while preserving the full-query default", () => {
    const file = makeFile(projectId, repoRoot, "src/config.ts", "typescript", TS_FIXTURE);
    const analysis = analyzeFileWithRegistry({ repoRoot, file, content: TS_FIXTURE });
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "ts-compiler",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    const all = store.getEdgesByFile(repoRoot, file.path);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(store.getEdgesByFile(repoRoot, file.path, 1)).toEqual(all.slice(0, 1));
    expect(store.getEdgesByFile(repoRoot, file.path, 0)).toEqual([]);
    const imports = store.getEdgesByKind(repoRoot, "imports");
    expect(imports.length).toBeGreaterThan(0);
    expect(store.getEdgesByKind(repoRoot, "imports", 1)).toEqual(imports.slice(0, 1));
    expect(store.getEdgesByKind(repoRoot, "imports", 0)).toEqual([]);
    expect(store.getEdgesByFile(repoRoot, file.path)).toEqual(all);
  });

  it("reports stale when the file content hash diverges from produced_hash (gate C-2)", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });

    const unchanged = store.freshness(repoRoot, new Map([[file.path, file.contentHash]]), {
      mode: "fast",
    });
    expect(unchanged.fresh).toEqual([file.path]);
    expect(unchanged.stale).toEqual([]);

    const editedHash = sha256(`${PY_FIXTURE}\n# edited\n`);
    const afterEdit = store.freshness(repoRoot, new Map([[file.path, editedHash]]), {
      mode: "fast",
    });
    expect(afterEdit.stale).toEqual([file.path]);
    expect(afterEdit.fresh).toEqual([]);

    store.observeContentHash(repoRoot, file.path, editedHash);
    const record = store.getFileRecord(repoRoot, file.path);
    expect(record?.status).toBe("stale");
    expect(record?.file.contentHash).toBe(editedHash);
    expect(record?.provenance.producedHash).toBe(file.contentHash);
  });

  it("reports missing for paths that were never stored", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    const report = store.freshness(repoRoot, new Map([["src/other.py", "deadbeef"]]), {
      mode: "fast",
    });
    expect(report.missing).toEqual(["src/other.py"]);
  });

  it("answers provenance: symbol produced by treesitter at hash H (gate C-3)", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    const symbol = analysis.symbols.find((candidate) => candidate.name === "load_settings");
    expect(symbol).toBeDefined();
    const provenance = store.provenanceOfSymbol(repoRoot, symbol!.id);
    expect(provenance).toMatchObject({
      symbolId: symbol!.id,
      symbolName: "load_settings",
      filePath: file.path,
      producer: "treesitter",
      producedHash: file.contentHash,
    });
  });

  it("refuses ignored paths and records them in skipped_files (gate C-4)", () => {
    const ignored = makeFile(
      projectId,
      repoRoot,
      "node_modules/foo.js",
      "javascript",
      "module.exports = 1;",
    );
    const result = store.upsertFileFacts({
      repoRoot,
      file: ignored,
      producer: "fallback",
      symbols: [
        {
          id: "should-not-land",
          projectId,
          filePath: ignored.path,
          name: "foo",
          kind: "variable",
          language: "javascript",
          startLine: 1,
          endLine: 1,
        },
      ],
      edges: [],
      chunks: [],
    });
    expect(result).toMatchObject({ stored: false, reason: "ignored_directory:node_modules" });
    expect(store.getFileRecord(repoRoot, ignored.path)).toBeUndefined();
    expect(store.getSymbolsByFile(repoRoot, ignored.path)).toEqual([]);
    expect(store.countSymbols(repoRoot)).toBe(0);
    expect(store.getSkippedFiles(repoRoot)).toEqual([
      { filePath: "node_modules/foo.js", reason: "ignored_directory:node_modules" },
    ]);

    const generated = makeFile(
      projectId,
      repoRoot,
      "src/api.gen.ts",
      "typescript",
      "export const x = 1;",
    );
    const generatedResult = store.upsertFileFacts({
      repoRoot,
      file: generated,
      producer: "ts-compiler",
      symbols: [],
      edges: [],
      chunks: [],
    });
    expect(generatedResult).toMatchObject({ stored: false, reason: "generated_suffix:.gen.ts" });
  });

  it("accounts heat on touch and preserves it across re-upsert", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    const input = {
      repoRoot,
      file,
      producer: "treesitter" as const,
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    };
    store.upsertFileFacts(input);
    store.recordTouch(repoRoot, [file.path], 1111);
    store.recordTouch(repoRoot, [file.path], 2222);
    let record = store.getFileRecord(repoRoot, file.path);
    expect(record?.heat).toEqual({ touchCount: 2, lastTouchMs: 2222 });

    store.upsertFileFacts(input);
    record = store.getFileRecord(repoRoot, file.path);
    expect(record?.heat).toEqual({ touchCount: 2, lastTouchMs: 2222 });
  });

  it("finds symbols by name substring", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    const names = store.findSymbolByNameLike(repoRoot, "settings").map((symbol) => symbol.name);
    expect(names).toContain("load_settings");
    expect(names).toContain("Settings");
  });

  it("serves FTS chunk search from chunks_fts", () => {
    const { file, analysis } = analyzePython(projectId, repoRoot);
    store.upsertFileFacts({
      repoRoot,
      file,
      producer: "treesitter",
      symbols: analysis.symbols,
      edges: analysis.edges,
      chunks: analysis.chunks,
    });
    const hits = store.searchChunks(repoRoot, ["load_settings"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.chunk.filePath).toBe(file.path);
  });
});

describe("freshness gate modes", () => {
  const checks: FreshnessCheck[] = [
    { path: "a.ts", status: "stale", producedHash: "h1", currentHash: "h2" },
    { path: "b.ts", status: "stale", producedHash: "h1", currentHash: "h3" },
    { path: "c.ts", status: "missing" },
    { path: "d.ts", status: "fresh", producedHash: "h1", currentHash: "h1" },
  ];

  it("fast mode never refreshes", () => {
    const report = gateFreshness(checks, { mode: "fast", refresh: (paths) => paths });
    expect(report.refreshed).toEqual([]);
    expect(report.stale).toEqual(["a.ts", "b.ts"]);
    expect(report.missing).toEqual(["c.ts"]);
  });

  it("balanced mode refreshes within the budget", () => {
    const report = gateFreshness(checks, {
      mode: "balanced",
      maxRefreshFiles: 2,
      refresh: (paths) => paths,
    });
    expect(report.refreshed).toEqual(["a.ts", "b.ts"]);
  });

  it("strict mode refreshes everything stale or missing", () => {
    const report = gateFreshness(checks, { mode: "strict", refresh: (paths) => paths });
    expect(report.refreshed).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("maps ragcode env values onto the codegraph tiers", () => {
    expect(resolveFreshnessModeFromEnv({ OPENCLAW_FACTSTORE_FRESHNESS: "stale-ok" })).toBe("fast");
    expect(resolveFreshnessModeFromEnv({ OPENCLAW_FACTSTORE_FRESHNESS: "force" })).toBe("strict");
    expect(resolveFreshnessModeFromEnv({})).toBe("balanced");
  });
});

describe("ignore policy", () => {
  it("flags ignored directories anywhere in the path", () => {
    expect(factStoreIgnoreReason("node_modules/foo.js")).toBe("ignored_directory:node_modules");
    expect(factStoreIgnoreReason("packages/a/node_modules/b.js")).toBe(
      "ignored_directory:node_modules",
    );
    expect(factStoreIgnoreReason(".openclaw/factstore.sqlite")).toBe("ignored_directory:.openclaw");
    expect(factStoreIgnoreReason("src/api.gen.ts")).toBe("generated_suffix:.gen.ts");
    expect(factStoreIgnoreReason("src/app.min.js")).toBe("generated_suffix:.min.js");
    expect(factStoreIgnoreReason("src/settings.py")).toBeUndefined();
    expect(factStoreIgnoreReason("distribution/settings.py")).toBeUndefined();
  });
});

describe("openFactStore lifecycle", () => {
  afterEach(() => {
    closeAllFactStores();
  });

  it("caches one store per workspace root (one .sqlite, one clock)", () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), "factstore-ws-"));
    try {
      const first = openFactStore(workspaceRoot);
      const second = openFactStore(workspaceRoot);
      expect(second).toBe(first);
      expect(first.dbPath).toBe(factStorePathFor(workspaceRoot));
      expect(existsSync(first.dbPath)).toBe(true);
    } finally {
      closeAllFactStores();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("neutral membrane artifact (gate C-5)", () => {
  const runtimeRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const artifactDir = path.join(runtimeRoot, ".artifacts");
  const dbPath = path.join(artifactDir, "factstore-neutral-membrane.sqlite");
  const expectedPath = path.join(artifactDir, "factstore-neutral-membrane.expected.json");

  it("writes a real store for verseshell db.sqlite_query to read", () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
    rmSync(expectedPath, { force: true });
    // The artifact directory is gitignored and absent from clean detached
    // acceptance worktrees; create it here instead of assuming a prior run.
    mkdirSync(artifactDir, { recursive: true });

    const repoRoot = mkdtempSync(path.join(tmpdir(), "factstore-membrane-"));
    const membraneProjectId = projectIdForRoot(repoRoot);
    const store = new FactStore(dbPath);
    try {
      const python = analyzePython(membraneProjectId, repoRoot);
      store.upsertFileFacts({
        repoRoot,
        file: python.file,
        producer: "treesitter",
        symbols: python.analysis.symbols,
        edges: python.analysis.edges,
        chunks: python.analysis.chunks,
      });
      const tsFile = makeFile(
        membraneProjectId,
        repoRoot,
        "src/config.ts",
        "typescript",
        TS_FIXTURE,
      );
      const tsAnalysis = analyzeFileWithRegistry({ repoRoot, file: tsFile, content: TS_FIXTURE });
      store.upsertFileFacts({
        repoRoot,
        file: tsFile,
        producer: "ts-compiler",
        symbols: tsAnalysis.symbols,
        edges: tsAnalysis.edges,
        chunks: tsAnalysis.chunks,
      });

      const symbolCount = store.countSymbols();
      expect(symbolCount).toBeGreaterThan(0);
      writeFileSync(expectedPath, `${JSON.stringify({ dbPath, symbolCount }, null, 2)}\n`);
    } finally {
      store.close();
      rmSync(repoRoot, { recursive: true, force: true });
    }
    expect(existsSync(dbPath)).toBe(true);
  });
});
