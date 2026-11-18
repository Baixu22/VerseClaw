// Gate G parity harness: the retired CodeGraph 1.0.1 measurement is frozen in a
// tracked fixture generated from real repo files (callers depth 2, impact depth 3,
// search top-1). The new FactStore impact view must recall a SUPERSET of its callers
// and impacted files. No loadable CodeGraph plugin is required.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImpactContextProvider } from "../../impact-provider.js";
import { createMaterializer } from "../../factstore/materialize.js";
import { FactStore } from "../../factstore/store.js";
import { analyzeImpact } from "./impact-view.js";

const RUNTIME_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const REPO_ROOT = path.resolve(RUNTIME_ROOT, "..");
const FROZEN_FIXTURE_PATH = path.join(
  REPO_ROOT,
  "harness/specs/fixtures/codegraph-retirement/impact-parity-v1.json",
);

type FrozenFixtureFile = { source: string; fixturePath: string; sha256: string; bytes: number };
type FrozenQuery = {
  query: string;
  found: boolean;
  callers: Array<{ name: string; filePath: string; startLine: number }>;
  impactFiles: string[];
};
type FrozenParityFixture = {
  provenance: {
    license: string;
    vendoredVersion: string;
    sourcePath: string;
    sourceSha256: string;
  };
  fixtureFiles: FrozenFixtureFile[];
  queryParams: { callersDepth: number; impactDepth: number; searchLimit: number };
  queries: FrozenQuery[];
};

const baselineText = readFileSync(FROZEN_FIXTURE_PATH, "utf8");
const frozen: FrozenParityFixture = JSON.parse(baselineText);
const inputs: {
  sourceCommit: string;
  baselineSha256: string;
  files: Array<FrozenFixtureFile & { contentBase64: string }>;
} = JSON.parse(
  readFileSync(
    path.join(
      REPO_ROOT,
      "harness/specs/fixtures/codegraph-retirement/impact-parity-inputs-v1.json",
    ),
    "utf8",
  ),
);
const GOLDEN_QUERIES = frozen.queries.map((entry) => entry.query);

let fixtureRoot: string;
let store: FactStore;
let baseline: Map<string, FrozenQuery>;
const diffReport: string[] = [];

beforeAll(async () => {
  expect(frozen.provenance.license).toBe("MIT");
  expect(frozen.provenance.vendoredVersion).toBe("1.0.1");
  expect(frozen.queryParams).toEqual({ callersDepth: 2, impactDepth: 3, searchLimit: 1 });
  expect(frozen.queries).toHaveLength(13);
  expect(frozen.fixtureFiles).toHaveLength(7);
  expect(inputs.sourceCommit).toBe("6118a355b3a3cfa2d6818a3035a3d79b99634c4f");
  expect(createHash("sha256").update(baselineText.replaceAll("\r\n", "\n")).digest("hex")).toBe(
    inputs.baselineSha256,
  );
  expect(inputs.files).toHaveLength(frozen.fixtureFiles.length);

  fixtureRoot = mkdtempSync(path.join(tmpdir(), "impact-parity-"));
  mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
  for (const file of frozen.fixtureFiles) {
    const snapshot = inputs.files.find((entry) => entry.fixturePath === file.fixturePath)!;
    expect(snapshot?.source).toBe(file.source);
    expect(snapshot.sha256).toBe(file.sha256);
    const bytes = Buffer.from(snapshot.contentBase64, "base64");
    expect(bytes.length).toBe(file.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    writeFileSync(path.join(fixtureRoot, file.fixturePath), bytes);
  }

  baseline = new Map(frozen.queries.map((entry) => [entry.query, entry]));
  store = new FactStore(path.join(fixtureRoot, "factstore.sqlite"));
  const materializer = createMaterializer(store, fixtureRoot);
  const ensure = materializer.ensureFacts({
    paths: frozen.fixtureFiles.map((file) => file.fixturePath),
  });
  expect(ensure.parsed).toHaveLength(frozen.fixtureFiles.length);
}, 120_000);

afterAll(() => {
  if (diffReport.length > 0) {
    console.log(
      `[gate G-3] recall diff (new impact view minus codegraph baseline):\n${diffReport.join("\n")}`,
    );
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
              (reference) =>
                reference.edge === "calls" && reference.sourceFile === baselineCaller.filePath,
            )
          );
        }
        return !analysis.callers.some(
          (caller) =>
            caller.filePath === baselineCaller.filePath &&
            (caller.name === baselineCaller.name ||
              (baselineCaller.startLine >= caller.startLine &&
                baselineCaller.startLine <= caller.endLine)),
        );
      });
      expect(uncovered, `baseline callers not recalled: ${JSON.stringify(uncovered)}`).toEqual([]);

      // Impacted-file superset.
      const newFiles = new Set(analysis.impactedFiles);
      const missingFiles = base.impactFiles.filter((filePath) => !newFiles.has(filePath));
      expect(
        missingFiles,
        `baseline impact files not recalled: ${missingFiles.join(", ")}`,
      ).toEqual([]);

      // Gate G-3 evidence: record the extra recall for human review.
      const baseCallerKeys = new Set(
        base.callers.map((caller) => `${caller.name}@${caller.filePath}`),
      );
      const extraCallers = analysis.callers
        .map((caller) => `${caller.name}@${caller.filePath}`)
        .filter((key) => !baseCallerKeys.has(key));
      const extraFiles = analysis.impactedFiles.filter(
        (filePath) => !base.impactFiles.includes(filePath),
      );
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
