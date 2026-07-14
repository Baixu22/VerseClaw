import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FactStore } from "./store.js";
import { createMaterializer, DEFAULT_MAX_PARSE_PER_QUERY } from "./materialize.js";

function writeRepoFile(repoRoot: string, relPath: string, content: string): void {
  const absolutePath = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function pythonModule(index: number, extraFunction = ""): string {
  const body = Array.from(
    { length: 40 },
    (_, line) => `def handler_${index}_${line}(payload):\n    return payload.get("key_${line}")\n`,
  ).join("\n");
  return `${body}\n${extraFunction}`;
}

describe("on-demand materialization (gate D)", () => {
  let repoRoot: string;
  let store: FactStore;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "materialize-test-"));
    store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("parses on the cold first query and serves the second from cache (gate D-1)", () => {
    writeRepoFile(repoRoot, "src/service.py", pythonModule(0));
    const materializer = createMaterializer(store, repoRoot);

    const first = materializer.ensureFacts({ paths: ["src/service.py"] });
    expect(first.parsed).toEqual(["src/service.py"]);
    expect(first.fresh).toEqual([]);
    expect(first.timings.parseMs).toBeGreaterThan(0);
    expect(first.timings.parseMsByPath["src/service.py"]).toBeGreaterThan(0);
    expect(store.getSymbolsByFile(repoRoot, "src/service.py").length).toBeGreaterThan(1);

    const second = materializer.ensureFacts({ paths: ["src/service.py"] });
    expect(second.parsed).toEqual([]);
    expect(second.fresh).toEqual(["src/service.py"]);
    // Cache hit does zero parsing — the deterministic form of "second query is fast":
    // no parse attempts at all; the loop's wall time is sub-millisecond noise.
    expect(second.timings.parseMs).toBeLessThan(1);
    expect(Object.keys(second.timings.parseMsByPath)).toEqual([]);

    // Timing beacon for the rebuild ledger (gate D-1 打点计时).
    console.log(
      `[gate D-1] cold first query: parse=${first.timings.parseMs.toFixed(2)}ms total=${first.timings.totalMs.toFixed(2)}ms | ` +
        `warm second query: parse=${second.timings.parseMs.toFixed(2)}ms total=${second.timings.totalMs.toFixed(2)}ms`,
    );
    expect(second.timings.totalMs).toBeLessThan(first.timings.totalMs);
  });

  it("stops at the parse budget and declares the rest as missing evidence (gate D-2)", () => {
    const paths = Array.from({ length: 20 }, (_, index) => `src/mod_${String(index).padStart(2, "0")}.py`);
    for (const [index, relPath] of paths.entries()) {
      writeRepoFile(repoRoot, relPath, pythonModule(index));
    }
    const materializer = createMaterializer(store, repoRoot);

    const result = materializer.ensureFacts({ paths });
    expect(DEFAULT_MAX_PARSE_PER_QUERY).toBe(12);
    expect(result.parsed).toHaveLength(12);
    expect(result.deferred).toHaveLength(8);
    expect(result.missingEvidence).toHaveLength(8);
    for (const line of result.missingEvidence) {
      expect(line).toContain("parse_budget_exhausted (maxParsePerQuery=12)");
    }
    // The 8 deferred files must not have entered the store.
    for (const deferredPath of result.deferred) {
      expect(store.getFileRecord(repoRoot, deferredPath)).toBeUndefined();
    }
    // A follow-up query picks up exactly the deferred remainder.
    const followUp = materializer.ensureFacts({ paths });
    expect(followUp.fresh).toHaveLength(12);
    expect(followUp.parsed).toHaveLength(8);
    expect(followUp.deferred).toEqual([]);
  });

  it("re-parses automatically after an edit invalidates provenance (gate D-3)", () => {
    const relPath = "src/editable.py";
    writeRepoFile(repoRoot, relPath, pythonModule(1));
    const materializer = createMaterializer(store, repoRoot);

    const first = materializer.ensureFacts({ paths: [relPath] });
    expect(first.parsed).toEqual([relPath]);
    const producedHashBefore = store.getFileRecord(repoRoot, relPath)?.provenance.producedHash;
    expect(producedHashBefore).toBeTruthy();

    const cached = materializer.ensureFacts({ paths: [relPath] });
    expect(cached.fresh).toEqual([relPath]);
    expect(cached.parsed).toEqual([]);

    writeRepoFile(repoRoot, relPath, pythonModule(1, "def freshly_added_function(x):\n    return x\n"));
    const afterEdit = materializer.ensureFacts({ paths: [relPath] });
    expect(afterEdit.parsed).toEqual([relPath]);
    expect(afterEdit.fresh).toEqual([]);

    const record = store.getFileRecord(repoRoot, relPath);
    expect(record?.provenance.producedHash).not.toBe(producedHashBefore);
    const names = store.getSymbolsByFile(repoRoot, relPath).map((symbol) => symbol.name);
    expect(names).toContain("freshly_added_function");
  });

  it("routes languages to the right producer provenance", () => {
    writeRepoFile(repoRoot, "src/api.ts", "export function ping(): string {\n  return \"pong\";\n}\n");
    writeRepoFile(repoRoot, "src/tool.py", "def run():\n    return 1\n");
    writeRepoFile(repoRoot, "notes/readme.md", "# notes\n");
    const materializer = createMaterializer(store, repoRoot);

    const result = materializer.ensureFacts({ paths: ["src/api.ts", "src/tool.py", "notes/readme.md"] });
    expect(result.parsed).toEqual(["src/api.ts", "src/tool.py", "notes/readme.md"]);
    expect(store.getFileRecord(repoRoot, "src/api.ts")?.provenance.producer).toBe("ts-compiler");
    expect(store.getFileRecord(repoRoot, "src/tool.py")?.provenance.producer).toBe("treesitter");
    expect(store.getFileRecord(repoRoot, "notes/readme.md")?.provenance.producer).toBe("fallback");
  });

  it("skips ignore-listed and oversized files without parsing", () => {
    writeRepoFile(repoRoot, "node_modules/pkg/index.js", "module.exports = 1;\n");
    writeRepoFile(repoRoot, "src/huge.py", "x = 1\n");
    const materializer = createMaterializer(store, repoRoot, {
      budget: { maxFileBytes: 4 },
    });

    const result = materializer.ensureFacts({ paths: ["node_modules/pkg/index.js", "src/huge.py"] });
    expect(result.parsed).toEqual([]);
    expect(result.skipped).toEqual([
      { path: "node_modules/pkg/index.js", reason: "ignored_directory:node_modules" },
      { path: "src/huge.py", reason: expect.stringContaining("max_file_bytes_exceeded") },
    ]);
  });

  it("reports unreadable files as failed instead of throwing", () => {
    const materializer = createMaterializer(store, repoRoot);
    const result = materializer.ensureFacts({ paths: ["src/does-not-exist.py"] });
    expect(result.parsed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toBe("src/does-not-exist.py");
  });

  it("bumps heat for fresh hits and parsed files", () => {
    const relPath = "src/heat.py";
    writeRepoFile(repoRoot, relPath, "def warm():\n    return True\n");
    const materializer = createMaterializer(store, repoRoot);

    materializer.ensureFacts({ paths: [relPath], nowMs: 1000 });
    materializer.ensureFacts({ paths: [relPath], nowMs: 2000 });
    const record = store.getFileRecord(repoRoot, relPath);
    expect(record?.heat.touchCount).toBe(2);
    expect(record?.heat.lastTouchMs).toBe(2000);
  });

  it("queues touched files and drains them through the same closure (parse-on-touch)", () => {
    writeRepoFile(repoRoot, "src/a.py", "def a():\n    return 1\n");
    writeRepoFile(repoRoot, "src/b.py", "def b():\n    return 2\n");
    const materializer = createMaterializer(store, repoRoot);

    materializer.onFileTouched("src/a.py");
    materializer.onFileTouched("./src/a.py");
    materializer.onFileTouched("src\\b.py");
    expect(materializer.pendingTouchedCount()).toBe(2);

    const result = materializer.flushTouched();
    expect(result.parsed.sort()).toEqual(["src/a.py", "src/b.py"]);
    expect(materializer.pendingTouchedCount()).toBe(0);
    expect(store.getSymbolsByFile(repoRoot, "src/a.py").map((symbol) => symbol.name)).toContain("a");
  });
});
