import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerRebuildShadowProviders } from "../register-rebuild-providers.js";
import { closeAllFactStores, FactStore } from "../factstore/store.js";
import { createMaterializer } from "../factstore/materialize.js";
import { ripgrepSearch } from "../producers/ripgrep-producer.js";
import { buildContextPack } from "./pack/context-pack-view.js";

const AUTH_TS = `export function loadAuthConfig(env: Record<string, string | undefined>): string {
  return env.AUTH_PROVIDER_URL ?? "https://auth.example.com";
}

export function refreshAuthToken(seed: string): string {
  return loadAuthConfig({ AUTH_PROVIDER_URL: seed });
}
`;

const AUTH_TEST_TS = `import { loadAuthConfig } from "../src/auth.js";

export function testLoadAuthConfig(): boolean {
  return loadAuthConfig({}).length > 0;
}
`;

// The fallback marker lives ONLY in this file, which is never materialized up front.
const HIDDEN_TS = `export const ZEBRA_FALLBACK_MARKER_9000 = "only findable by text search";
`;

function writeRepo(repoRoot: string): void {
  for (const [relPath, content] of [
    ["src/auth.ts", AUTH_TS],
    ["tests/auth.test.ts", AUTH_TEST_TS],
    ["src/hidden-corner.ts", HIDDEN_TS],
  ] as const) {
    const absolutePath = path.join(repoRoot, relPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
}

describe("capability routing across the six intent verbs (gate H-1)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "capability-routing-"));
    writeRepo(repoRoot);
  });

  afterEach(() => {
    closeAllFactStores();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("registers all rebuild providers shadow-only", () => {
    const { registry, registered } = registerRebuildShadowProviders();
    expect(registered).toHaveLength(7);
    for (const manifest of registry.listManifests()) {
      if (manifest.id === "runtime-memory") continue; // existing system, its own flags
      expect(manifest.shadowOnly, `${manifest.id} must be shadowOnly`).toBe(true);
      expect(manifest.enabledByDefault).toBe(false);
    }
  });

  const verbCases: Array<{ verb: string; capability: string; expectEvidence?: RegExp }> = [
    { verb: "understand", capability: "context.understand", expectEvidence: /## Brief/ },
    { verb: "locate", capability: "context.symbol", expectEvidence: /loadAuthConfig/ },
    { verb: "impact", capability: "context.impact", expectEvidence: /Impact of loadAuthConfig/ },
    { verb: "reuse", capability: "context.reuse", expectEvidence: /Reuse decision/ },
    { verb: "verify", capability: "context.verify", expectEvidence: /Diff review/ },
    { verb: "remember", capability: "context.memory" },
  ];

  for (const { verb, capability, expectEvidence } of verbCases) {
    it(`routes ${verb} → ${capability} end to end`, async () => {
      const { registry } = registerRebuildShadowProviders();
      const manifests = registry.listByCapability(capability);
      expect(manifests.length, `no provider serves ${capability}`).toBeGreaterThan(0);

      const query = {
        goal: "loadAuthConfig",
        workspace: repoRoot,
        activeFiles: ["src/auth.ts", "tests/auth.test.ts"],
        metadata: verb === "verify" ? { changedFiles: ["src/auth.ts"] } : undefined,
      };

      // Routing semantics: candidates in manifest order; first success wins,
      // fallback statuses hand off to the next candidate.
      let winner: Awaited<ReturnType<NonNullable<ReturnType<typeof registry.resolve>>["getContext"]>> | undefined;
      for (const manifest of manifests) {
        const provider = registry.resolve(manifest.id);
        expect(provider).toBeDefined();
        const result = await provider!.getContext(query);
        if (Array.isArray(result)) throw new Error("expected full provider result");
        if (result.status === "success") {
          winner = result;
          break;
        }
        if (verb === "remember") winner = result;
      }
      if (verb === "remember") {
        // Existing memory system: routing resolves; without a memory store the
        // provider degrades gracefully instead of erroring.
        expect(winner).toBeDefined();
        if (!winner || Array.isArray(winner)) return;
        expect(["success", "fallback"]).toContain(winner.status);
        return;
      }
      expect(winner, `${verb} capability produced no successful provider`).toBeDefined();
      if (!winner || Array.isArray(winner)) return;
      expect(winner.metadata?.shadowOnly).toBe(true);
      if (expectEvidence) {
        const text = winner.contextItems.map((item) => item.text).join("\n");
        expect(text).toMatch(expectEvidence);
      }
    });
  }
});

describe("grep degradation chain (gate H-2)", () => {
  let repoRoot: string;
  let store: FactStore;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "grep-fallback-"));
    writeRepo(repoRoot);
    store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("backfills an index miss from ripgrep and marks producer=ripgrep", async () => {
    const materializer = createMaterializer(store, repoRoot);
    // Materialize only auth files; hidden-corner.ts is unknown to the index.
    materializer.ensureFacts({ paths: ["src/auth.ts", "tests/auth.test.ts"] });
    expect(store.getFileRecord(repoRoot, "src/hidden-corner.ts")).toBeUndefined();

    const pack = await buildContextPack(store, materializer, {
      query: "ZEBRA_FALLBACK_MARKER_9000",
    });

    expect(pack.answerable).toBe(true);
    const hit = pack.snippets.find((snippet) => snippet.filePath === "src/hidden-corner.ts");
    expect(hit).toBeDefined();
    expect(hit?.reason).toContain("producer=ripgrep");
    expect(pack.missingEvidence.some((entry) => entry.includes("producer=ripgrep"))).toBe(true);

    // Backfill memoized: the store now owns the text facts with ripgrep provenance
    // and an empty produced_hash (structurally stale by definition).
    const record = store.getFileRecord(repoRoot, "src/hidden-corner.ts");
    expect(record?.provenance.producer).toBe("ripgrep");
    expect(record?.provenance.producedHash).toBe("");
    const chunks = store.getChunksByFile(repoRoot, "src/hidden-corner.ts");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toContain("ZEBRA_FALLBACK_MARKER_9000");
  });
});

describe("day-1 zero tax (gate H-3)", () => {
  it("keeps the cold-store first query within 200ms of a bare rg run", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "day1-zero-tax-"));
    writeRepo(repoRoot);
    const store = new FactStore(path.join(repoRoot, "factstore.sqlite"));
    try {
      const materializer = createMaterializer(store, repoRoot);

      const rgStart = performance.now();
      const rg = await ripgrepSearch("ZEBRA_FALLBACK_MARKER_9000", repoRoot, {
        projectId: materializer.projectId,
      });
      const rgMs = performance.now() - rgStart;
      expect(rg.chunks.length).toBeGreaterThan(0);

      // Empty store, zero prior materialization: the very first query.
      const pipelineStart = performance.now();
      const pack = await buildContextPack(store, materializer, {
        query: "ZEBRA_FALLBACK_MARKER_9000",
      });
      const pipelineMs = performance.now() - pipelineStart;

      expect(pack.answerable).toBe(true);
      const overheadMs = pipelineMs - rgMs;
      console.log(
        `[gate H-3] bare rg=${rgMs.toFixed(1)}ms | cold pipeline first query=${pipelineMs.toFixed(1)}ms | overhead=${overheadMs.toFixed(1)}ms (must be <200ms)`,
      );
      expect(overheadMs).toBeLessThan(200);
    } finally {
      store.close();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
