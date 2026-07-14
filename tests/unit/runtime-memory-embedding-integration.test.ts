import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHybridSearchIndex,
  clearHybridSearchIndexCache,
  hybridSearchFacts,
  hybridSearchFactsWithEmbedding,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  NO_EMBEDDING_PROVIDER,
  isEmbeddingProviderAvailable,
  type RuntimeEmbeddingProvider,
} from "../../openclaw_runtime/src/runtime-core/memory-embedding-provider";
import {
  adaptMemoryEmbeddingProvider,
  probeEmbeddingDimension,
} from "../../openclaw_runtime/src/context-engine/runtime-embedding-adapter";
import type { MemoryEmbeddingProvider } from "../../openclaw_runtime/src/plugins/memory-embedding-providers";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryQueryableFact,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryContextProvider } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";

const PERSIST_CONFIG = { runtime: { memory: { persist: true } } } as const;
const tempDirs: string[] = [];

function createTempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, "openclaw.sqlite");
}

const DIMENSION = 128;

function embedText(text: string, dimension: number = DIMENSION): number[] {
  const vec = new Array(dimension).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i + 3 <= lower.length; i++) {
    const gram = lower.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < gram.length; j++) {
      hash = ((hash << 5) - hash + gram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimension;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) vec[i] /= norm;
  }
  return vec;
}

function createMockRuntimeEmbeddingProvider(
  dimension: number = DIMENSION,
): RuntimeEmbeddingProvider {
  return {
    id: "mock",
    dimension,
    embedQuery: (text) => Promise.resolve(embedText(text, dimension)),
    embedBatch: (texts) =>
      Promise.resolve(texts.map((t) => embedText(t, dimension))),
  };
}

function createMockMemoryEmbeddingProvider(
  dimension: number = DIMENSION,
): MemoryEmbeddingProvider {
  return {
    id: "mock",
    model: "mock-model",
    embedQuery: (text) => Promise.resolve(embedText(text, dimension)),
    embedBatch: (texts) =>
      Promise.resolve(texts.map((t) => embedText(t, dimension))),
  };
}

function makeFact(
  factId: string,
  subject: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryQueryableFact> = {},
): RuntimeMemoryQueryableFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId,
    subject,
    predicate: "knows",
    objectSummary,
    taskId: "emb_test",
    ...overrides,
  });
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  clearHybridSearchIndexCache();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory embedding integration", () => {
  it("falls back to 3-gram when no provider is available", async () => {
    const facts = [
      makeFact("f1", "User", "likes Python programming"),
      makeFact("f2", "User", "enjoys Rust programming"),
    ];
    const query = {
      queryText: "Python programming",
      taskId: "emb_test",
      topK: 5,
    };

    const syncHits = hybridSearchFacts(facts, query);
    const asyncHits = await hybridSearchFactsWithEmbedding(
      facts,
      query,
      NO_EMBEDDING_PROVIDER,
    );

    expect(asyncHits.length).toBe(syncHits.length);
    expect(asyncHits.map((h) => h.fact.factId)).toEqual(
      syncHits.map((h) => h.fact.factId),
    );
  });

  it("returns embedding-ranked results with a mock provider", async () => {
    const facts = [
      makeFact("f1", "User", "likes Python programming language"),
      makeFact("f2", "User", "owns a cat named Whiskers"),
      makeFact("f3", "User", "prefers Python over Rust for scripting"),
    ];
    // Keep this ranking assertion focused on the embedding path rather than
    // collisions in the intentionally simple n-gram hash fixture.
    const provider = createMockRuntimeEmbeddingProvider(4096);
    const hits = await hybridSearchFactsWithEmbedding(
      facts,
      { queryText: "Python programming", taskId: "emb_test", topK: 3 },
      provider,
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].fact.factId).toBe("f1");
    expect(hits[0].vectorRank).toBe(1);
  });

  it("buildHybridSearchIndex with NO_EMBEDDING_PROVIDER returns plain index", async () => {
    const facts = [makeFact("f1", "User", "likes Python")];
    const index = await buildHybridSearchIndex(facts, NO_EMBEDDING_PROVIDER);
    const hits = index.search("Python", 5);
    expect(hits.length).toBe(1);
    expect(hits[0].fact.factId).toBe("f1");
  });

  it("persists and retrieves embeddings through the persistence store", () => {
    const dbPath = createTempDbPath("emb-persist-", tempDirs);
    const store = createRuntimeMemoryPersistenceStore({
      config: PERSIST_CONFIG,
      database: { path: dbPath },
      now: () => 1000,
    });
    expect(store.migrate().status).toBe("migrated");

    const seedFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_emb_1",
      subject: "Embedding",
      predicate: "persisted",
      objectSummary: "seed fact for embedding roundtrip",
      taskId: "emb_test",
    });
    expect(store.appendFact(seedFact).status).toBe("persisted");

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    store.replaceEmbedding({
      factId: "fact_emb_1",
      providerId: "mock",
      model: "mock-model",
      dimension: 4,
      embedding,
    });

    const retrieved = store.getEmbedding("fact_emb_1", "mock", "mock-model");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(4);
    expect(Array.from(retrieved!)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
      expect.closeTo(0.4, 5),
    ]);

    store.deleteEmbedding("fact_emb_1");
    expect(store.getEmbedding("fact_emb_1", "mock", "mock-model")).toBeNull();
  });

  it("adaptMemoryEmbeddingProvider bridges interface and probes dimension", async () => {
    const mockProvider = createMockMemoryEmbeddingProvider(32);
    const dimension = await probeEmbeddingDimension(mockProvider);
    expect(dimension).toBe(32);

    const adapted = adaptMemoryEmbeddingProvider(mockProvider, dimension);
    expect(adapted.id).toBe("mock");
    expect(adapted.dimension).toBe(32);
    expect(isEmbeddingProviderAvailable(adapted)).toBe(true);

    const queryVec = await adapted.embedQuery("test query");
    expect(queryVec.length).toBe(32);

    const batchVecs = await adapted.embedBatch(["a", "b"]);
    expect(batchVecs.length).toBe(2);
    expect(batchVecs[0].length).toBe(32);
  });

  it("probeEmbeddingDimension throws on empty vector", async () => {
    const emptyProvider: MemoryEmbeddingProvider = {
      id: "empty",
      model: "empty-model",
      embedQuery: () => Promise.resolve([]),
      embedBatch: () => Promise.resolve([[]]),
    };
    await expect(probeEmbeddingDimension(emptyProvider)).rejects.toThrow(
      "returned empty vector",
    );
  });

  it("context provider uses embedding path when enabled", async () => {
    const facts = [
      makeFact("f1", "User", "likes Python programming language"),
      makeFact("f2", "User", "owns a cat named Whiskers"),
      makeFact("f3", "User", "prefers Python over Rust for scripting"),
    ];
    const provider = createMockRuntimeEmbeddingProvider();
    const memoryProvider = createRuntimeMemoryContextProvider({
      facts,
      embeddingProvider: provider,
      embeddingEnabled: true,
      config: { runtime: { memory: { provider: true } } },
    });

    const result = await memoryProvider.getContext({
      taskId: "emb_test",
      metadata: { memoryQuery: { subject: "User", predicate: "knows" } },
    });

    expect(result.status).toBe("success");
    expect(result.contextItems.length).toBeGreaterThan(0);
  });

  it("context provider falls back to 3-gram when embedding enabled but provider unavailable", async () => {
    const facts = [
      makeFact("f1", "User", "likes Python programming"),
      makeFact("f2", "User", "owns a cat"),
    ];
    const memoryProvider = createRuntimeMemoryContextProvider({
      facts,
      embeddingProvider: NO_EMBEDDING_PROVIDER,
      embeddingEnabled: true,
      config: { runtime: { memory: { provider: true } } },
    });

    const result = await memoryProvider.getContext({
      taskId: "emb_test",
      metadata: { memoryQuery: { subject: "User", predicate: "knows" } },
    });

    expect(result.status).toBe("success");
    expect(result.contextItems.length).toBeGreaterThan(0);
  });

  it("isEmbeddingProviderAvailable distinguishes provider from sentinel", () => {
    expect(isEmbeddingProviderAvailable(NO_EMBEDDING_PROVIDER)).toBe(false);
    expect(isEmbeddingProviderAvailable(createMockRuntimeEmbeddingProvider())).toBe(
      true,
    );
  });
});
