// Gate G parity harness: the vendored codegraph extension is run LIVE on a fixture of
// real repo files (golden queries per SEAM_MAP §C reproduction params: callers depth 2,
// impact depth 3, search top-1) and the new FactStore impact view must recall a
// SUPERSET of its callers and impacted files. Extra recall is reported, missing recall
// fails the gate. Diff report prints for the rebuild ledger (gate G-3).
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImpactContextProvider } from "../../impact-provider.js";
import { createMaterializer } from "../../factstore/materialize.js";
import { FactStore } from "../../factstore/store.js";
import { analyzeImpact } from "./impact-view.js";

const RUNTIME_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const CONTEXT_ENGINE_SRC = path.join(RUNTIME_ROOT, "src", "context-engine");
const CODEGRAPH_EXT = path.join(RUNTIME_ROOT, "extensions", "codegraph");

// Real repo files (gate G-1: goldens come from this repository's actual code).
const FIXTURE_FILES: Array<[string, string]> = [
  ["factstore/store.ts", "src/store.ts"],
  ["factstore/ignore.ts", "src/ignore.ts"],
  ["factstore/freshness.ts", "src/freshness.ts"],
  ["factstore/statements.ts", "src/statements.ts"],
  ["factstore/materialize.ts", "src/materialize.ts"],
  ["producers/hash.ts", "src/hash.ts"],
  ["producers/ripgrep-producer.ts", "src/ripgrep-producer.ts"],
];

// 13 golden queries (gate G-1), all real symbols with real cross-file relationships.
const GOLDEN_QUERIES = [
  "openFactStore",
  "factStorePathFor",
  "closeAllFactStores",
  "upsertFileFacts",
  "normalizeFactPath",
  "factStoreIgnoreReason",
  "sha256",
  "stableId",
  "projectIdForRoot",
  "checkFileFreshness",
  "gateFreshness",
  "migrateFactStoreSchema",
  "createMaterializer",
] as const;

interface BaselineEntry {
  found: boolean;
  callers: Array<{ name: string; filePath: string; startLine: number }>;
  impactFiles: string[];
}

let fixtureRoot: string;
let store: FactStore;
let baseline: Map<string, BaselineEntry>;
const diffReport: string[] = [];

beforeAll(async () => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "impact-parity-"));
  mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
  for (const [from, to] of FIXTURE_FILES) {
    cpSync(path.join(CONTEXT_ENGINE_SRC, from), path.join(fixtureRoot, to));
  }

  // Live parity baseline from the vendored codegraph extension (ALIGNMENT 校正2).
  const req = createRequire(path.join(CODEGRAPH_EXT, "index.ts"));
  const mod = req("./dist/index.js") as { CodeGraph: { init: (root: string, opts: unknown) => Promise<CodegraphApi> } };
  const cg = await mod.CodeGraph.init(fixtureRoot, { index: true });
  baseline = new Map();
  for (const query of GOLDEN_QUERIES) {
    const results = cg.searchNodes(query, { limit: 1 });
    if (!results.length) {
      baseline.set(query, { found: false, callers: [], impactFiles: [] });
      continue;
    }
    const node = results[0]!.node;
    const chain = cg.getCallers(node.id, 2);
    const impact = cg.getImpactRadius(node.id, 3);
    const impactFiles = new Set<string>([normalize(node.filePath)]);
    for (const impactNode of impact?.nodes?.values() ?? []) {
      if (typeof impactNode?.filePath === "string") impactFiles.add(normalize(impactNode.filePath));
    }
    baseline.set(query, {
      found: true,
      callers: chain
        .filter((entry) => typeof entry?.node?.name === "string")
        .map((entry) => ({
          name: entry.node.name,
          filePath: normalize(entry.node.filePath),
          startLine: Number(entry.node.startLine ?? 0),
        })),
      impactFiles: [...impactFiles],
    });
  }

  // Same fixture through the rebuild pipeline: materialize into a FactStore.
  store = new FactStore(path.join(fixtureRoot, "factstore.sqlite"));
  const materializer = createMaterializer(store, fixtureRoot);
  const ensure = materializer.ensureFacts({ paths: FIXTURE_FILES.map(([, to]) => to) });
  expect(ensure.parsed).toHaveLength(FIXTURE_FILES.length);
}, 120_000);

afterAll(() => {
  if (diffReport.length > 0) {
    console.log(`[gate G-3] recall diff (new impact view minus codegraph baseline):\n${diffReport.join("\n")}`);
  }
  store?.close();
  // Best-effort: the vendored codegraph keeps a workspace watcher + sqlite handle
  // open on Windows, so deletion can hit EPERM. The OS temp cleaner owns leftovers.
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // leave the temp fixture behind
  }
});

interface CodegraphApi {
  searchNodes: (query: string, opts: { limit?: number }) => Array<{ node: { id: string; name: string; filePath: string; startLine?: number } }>;
  getCallers: (id: string, depth: number) => Array<{ node: { name: string; filePath: string; startLine?: number } }>;
  getImpactRadius: (id: string, depth: number) => { nodes?: Map<string, { filePath?: string }> };
}

describe("impact view parity vs vendored codegraph (gate G)", () => {
  it("resolves every golden query in the baseline graph", () => {
    const missing = GOLDEN_QUERIES.filter((query) => !baseline.get(query)?.found);
    expect(missing).toEqual([]);
  });

  for (const query of GOLDEN_QUERIES) {
    it(`recalls a superset for "${query}" (gate G-2)`, () => {
      const base = baseline.get(query)!;
      const analysis = analyzeImpact(store, fixtureRoot, query);
      expect(analysis.matchedSymbols.length).toBeGreaterThan(0);

      // Direct-caller superset: every baseline caller must be covered by a new caller
      // at the same file with the same name, or by an enclosing symbol whose line
      // range contains the baseline caller (coarser granularity is allowed; absence is not).
      // codegraph attributes module-level call sites to the FILE node itself
      // (name === file basename, line 1); those are covered when we recall any
      // caller symbol or incoming call reference from that same file.
      const uncovered = base.callers.filter((baselineCaller) => {
        const isModuleNode = baselineCaller.name === path.posix.basename(baselineCaller.filePath);
        if (isModuleNode) {
          return !(
            analysis.callers.some((caller) => caller.filePath === baselineCaller.filePath) ||
            analysis.references.some(
              (reference) => reference.edge === "calls" && reference.sourceFile === baselineCaller.filePath,
            )
          );
        }
        return !analysis.callers.some(
          (caller) =>
            caller.filePath === baselineCaller.filePath &&
            (caller.name === baselineCaller.name ||
              (baselineCaller.startLine >= caller.startLine && baselineCaller.startLine <= caller.endLine)),
        );
      });
      expect(uncovered, `baseline callers not recalled: ${JSON.stringify(uncovered)}`).toEqual([]);

      // Impacted-file superset.
      const newFiles = new Set(analysis.impactedFiles);
      const missingFiles = base.impactFiles.filter((filePath) => !newFiles.has(filePath));
      expect(missingFiles, `baseline impact files not recalled: ${missingFiles.join(", ")}`).toEqual([]);

      // Gate G-3 evidence: record the extra recall for human review.
      const baseCallerKeys = new Set(base.callers.map((caller) => `${caller.name}@${caller.filePath}`));
      const extraCallers = analysis.callers
        .map((caller) => `${caller.name}@${caller.filePath}`)
        .filter((key) => !baseCallerKeys.has(key));
      const extraFiles = analysis.impactedFiles.filter((filePath) => !base.impactFiles.includes(filePath));
      diffReport.push(
        `${query}: baseline callers=${base.callers.length} impactFiles=${base.impactFiles.length} | ` +
          `new callers=${analysis.callers.length} impactFiles=${analysis.impactedFiles.length} | ` +
          `extraCallers=[${extraCallers.join(", ") || "none"}] extraFiles=[${extraFiles.join(", ") || "none"}]`,
      );
    });
  }

  it("supports qualified file:symbol targets", () => {
    const analysis = analyzeImpact(store, fixtureRoot, "src/hash.ts:sha256");
    expect(analysis.matchedSymbols).toHaveLength(1);
    expect(analysis.matchedSymbols[0]?.name).toBe("sha256");
    expect(analysis.callers.length).toBeGreaterThan(0);
  });

  it("exposes the analysis through the shadow impact provider", async () => {
    const provider = createImpactContextProvider({
      analyze: () => analyzeImpact(store, fixtureRoot, "sha256"),
    });
    expect(provider.manifest.shadowOnly).toBe(true);
    expect(provider.manifest.capabilities).toContain("context.impact");
    const result = await provider.getContext({ goal: "sha256", workspace: fixtureRoot });
    if (Array.isArray(result)) throw new Error("expected full provider result");
    expect(result.status).toBe("success");
    expect(result.metadata?.shadowOnly).toBe(true);
    expect(String(result.contextItems[0]?.text)).toContain("Impact of sha256");
  });
});

function normalize(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}
