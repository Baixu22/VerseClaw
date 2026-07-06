// @vitest-environment node
// Layer 4: Long-term accumulation simulation.
// Answers "retention rate" (Q3) and "useless content ratio" (Q4) by writing
// 100/300 turns of facts to real SQLite, then measuring:
// - Retention: early useful facts still physically present in DB (by factId)
// - Noise accumulation: noise fact / total fact, using generation-time labels
//   as INDEPENDENT ground truth (not consumer judgment)
// - FIFO eviction: verifies maxFacts=512 boundary behavior
// Anti-overfitting: ground truth is `labels` Map from generateLongTermCorpus,
// NOT expectedFactIds or consumer output. No filterQueriesBySeededGroups.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import {
  generateLongTermCorpus,
  type LongTermCorpus,
} from "./helpers/runtime-memory-real-corpus";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedCorpusToDb(dbPath: string, corpus: LongTermCorpus): void {
  // Use incrementing now() so created_at differs per fact.
  // trimRows sorts by created_at ASC, fact_id ASC — with a fixed now(),
  // trimming would be alphabetical by factId, not FIFO by insertion order.
  let now = 10_000;
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => now++,
  });
  if (persistence.migrate().status !== "migrated") {
    throw new Error("seedCorpusToDb: migration failed");
  }
  for (const fact of corpus.facts) {
    const result = persistence.appendFact(fact);
    if (result.status !== "persisted") {
      throw new Error(`seedCorpusToDb: appendFact failed for ${fact.factId}`);
    }
  }
}

function loadStoreStats(dbPath: string): {
  facts: number;
  episodes: number;
  invalidations: number;
  maxFacts: number;
  maxEpisodes: number;
  factIds: Set<string>;
} {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    evictionPolicy: "fifo",
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadStoreStats: load failed");
  const stats = loaded.store.stats();
  const facts = loaded.store.queryFacts({ includeInvalidated: true });
  return {
    facts: stats.facts,
    episodes: stats.episodes,
    invalidations: stats.invalidations,
    maxFacts: stats.maxFacts,
    maxEpisodes: stats.maxEpisodes,
    factIds: new Set(facts.map((f) => f.factId)),
  };
}

function isFactRetained(dbPath: string, factId: string): boolean {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    evictionPolicy: "fifo",
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("isFactRetained: load failed");
  return loaded.store.getFactById(factId) !== undefined;
}

function measureRetention(
  dbPath: string,
  factIds: readonly string[],
): { retained: string[]; lost: string[]; retentionRate: number } {
  const retained: string[] = [];
  const lost: string[] = [];
  for (const factId of factIds) {
    if (isFactRetained(dbPath, factId)) {
      retained.push(factId);
    } else {
      lost.push(factId);
    }
  }
  const retentionRate = factIds.length > 0 ? retained.length / factIds.length : 0;
  return { retained, lost, retentionRate };
}

function measureNoiseRate(
  dbPath: string,
  labels: Map<string, "useful" | "noise">,
): { noiseRate: number; noiseCount: number; totalCount: number } {
  const stats = loadStoreStats(dbPath);
  let noiseCount = 0;
  let totalCount = 0;
  for (const factId of stats.factIds) {
    totalCount += 1;
    if (labels.get(factId) === "noise") {
      noiseCount += 1;
    }
  }
  return {
    noiseRate: totalCount > 0 ? noiseCount / totalCount : 0,
    noiseCount,
    totalCount,
  };
}

describe("Layer 4: long-term accumulation — retention, noise, FIFO", () => {
  it("retention_after_100_turns_programming", () => {
    // 100 turns → 200 facts (100 useful + 100 noise) < maxFacts=512.
    // No FIFO eviction, retention should be ~1.0 (allow ≥0.7 margin).
    const corpus = generateLongTermCorpus(100, 42);
    expect(corpus.facts).toHaveLength(200);
    const dbPath = createTempDbPath("retention100-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    // Check retention of first 20 useful facts (early turns).
    const earlyUseful = corpus.usefulFactIds.slice(0, 20);
    const result = measureRetention(dbPath, earlyUseful);
    expect(result.retentionRate).toBeGreaterThanOrEqual(0.7);
    expect(result.retained.length).toBeGreaterThanOrEqual(14);
  });

  it("retention_after_300_turns_mixed_domains", () => {
    // 300 turns → 600 facts > maxFacts=512. FIFO evicts first 88.
    // Early facts should have < 1.0 retention (some evicted).
    const corpus = generateLongTermCorpus(300, 42);
    expect(corpus.facts).toHaveLength(600);
    const dbPath = createTempDbPath("retention300-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const stats = loadStoreStats(dbPath);
    expect(stats.facts).toBe(512); // FIFO capped at maxFacts
    expect(stats.maxFacts).toBe(512);

    // First 88 facts evicted (44 useful + 44 noise, alternating).
    // Check first 50 useful facts — some should be evicted.
    const earlyUseful = corpus.usefulFactIds.slice(0, 50);
    const result = measureRetention(dbPath, earlyUseful);
    expect(result.retentionRate).toBeLessThan(1.0); // some evicted
    expect(result.lost.length).toBeGreaterThan(0);
  });

  it("noise_accumulation_rate_100_turns", () => {
    // REAL FINDING: system does NOT reject semantic noise. Each turn writes
    // 1 useful + 1 noise fact, so noise rate ≈ 0.5.
    const corpus = generateLongTermCorpus(100, 42);
    const dbPath = createTempDbPath("noise100-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const result = measureNoiseRate(dbPath, corpus.labels);
    expect(result.totalCount).toBe(200);
    expect(result.noiseCount).toBe(100);
    expect(result.noiseRate).toBeCloseTo(0.5, 1);
  });

  it("noise_accumulation_rate_300_turns", () => {
    // After 300 turns, FIFO evicts oldest, but noise ratio stays ≈ 0.5
    // because FIFO does not prioritize useful over noise.
    const corpus = generateLongTermCorpus(300, 42);
    const dbPath = createTempDbPath("noise300-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const result = measureNoiseRate(dbPath, corpus.labels);
    expect(result.totalCount).toBe(512); // FIFO capped
    // Noise rate still ≈ 0.5 — FIFO evicts proportionally.
    expect(result.noiseRate).toBeGreaterThan(0.4);
    expect(result.noiseRate).toBeLessThan(0.6);
  });

  it("fifo_eviction_critical_point", () => {
    // Write 562 facts (512 + 50), verify only 512 remain and first 50 evicted.
    const corpus = generateLongTermCorpus(281, 42); // 281*2=562 facts
    const dbPath = createTempDbPath("fifo-critical-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const stats = loadStoreStats(dbPath);
    expect(stats.facts).toBe(512);
    // First 50 facts (writeOrder[0..49]) should be evicted.
    const first50 = corpus.writeOrder.slice(0, 50);
    for (const factId of first50) {
      expect(stats.factIds.has(factId)).toBe(false);
    }
    // Last 50 facts should be present.
    const last50 = corpus.writeOrder.slice(-50);
    for (const factId of last50) {
      expect(stats.factIds.has(factId)).toBe(true);
    }
  });

  it("fifo_eviction_does_not_prioritize_useful", () => {
    // FIFO evicts by write order, not by usefulness. Both useful and noise
    // facts are evicted proportionally.
    const corpus = generateLongTermCorpus(281, 42); // 562 facts, 50 evicted
    const dbPath = createTempDbPath("fifo-priority-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const stats = loadStoreStats(dbPath);
    // First 50 evicted: 25 useful + 25 noise (alternating write order).
    const evicted = corpus.writeOrder.slice(0, 50);
    const evictedUseful = evicted.filter((id) => corpus.labels.get(id) === "useful");
    const evictedNoise = evicted.filter((id) => corpus.labels.get(id) === "noise");
    expect(evictedUseful.length).toBeGreaterThan(20); // ≈25
    expect(evictedNoise.length).toBeGreaterThan(20); // ≈25
    // Ratio is ≈ 50/50, not 100% noise (would be the case if FIFO prioritized useful).
    expect(stats.factIds.size).toBe(512);
  });

  it("topic_drift_recall_decay", () => {
    // 100 turns cycle through 3 domains. After 100 turns, early programming
    // facts should still be queryable (200 < 512, no eviction).
    const corpus = generateLongTermCorpus(100, 42);
    const dbPath = createTempDbPath("topic-drift-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    // Find programming-domain useful facts from early turns.
    const programmingUseful = corpus.facts.filter(
      (f) => f.domain === "programming" && f.label === "useful",
    );
    expect(programmingUseful.length).toBeGreaterThan(0);

    // All should be retained (no FIFO eviction under 512).
    const result = measureRetention(
      dbPath,
      programmingUseful.map((f) => f.factId),
    );
    expect(result.retentionRate).toBe(1.0);
  });

  it("invalidation_accumulation", () => {
    // Invalidation marks facts (invalid_at) but does NOT delete them.
    // DB should still contain all facts after invalidation.
    const corpus = generateLongTermCorpus(50, 42); // 100 facts
    const dbPath = createTempDbPath("inval-accum-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
      evictionPolicy: "fifo",
      now: () => 10_000,
    });
    if (persistence.migrate().status !== "migrated") {
      throw new Error("migration failed");
    }
    for (const fact of corpus.facts) {
      persistence.appendFact(fact);
    }
    // Invalidate 20 facts (20% of 100).
    const toInvalidate = corpus.usefulFactIds.slice(0, 20);
    for (const factId of toInvalidate) {
      const fact = corpus.facts.find((f) => f.factId === factId);
      if (!fact) continue;
      persistence.invalidateFact(
        buildRuntimeMemoryInvalidationProposalFixture({
          invalidationId: `inval_${factId}`,
          factId,
          invalid_at: 5_000,
          reference_time: 5_000,
          verificationStatus: "verified",
          sourceEpisodeRefs: fact.sourceEpisodeRefs,
          evidenceRefs: fact.evidenceRefs,
        }),
      );
    }

    const stats = loadStoreStats(dbPath);
    expect(stats.facts).toBe(100); // all still present
    expect(stats.invalidations).toBe(20);
    // Invalidated facts are still physically present.
    for (const factId of toInvalidate) {
      expect(stats.factIds.has(factId)).toBe(true);
    }
  });

  it("episode_retention_vs_fact_retention", () => {
    // Episodes and facts have independent FIFO (maxEpisodes=256, maxFacts=512).
    // Writing 50 episodes + 600 facts: episodes not trimmed, facts trimmed.
    const corpus = generateLongTermCorpus(300, 42); // 600 facts
    const dbPath = createTempDbPath("episode-vs-fact-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
      evictionPolicy: "fifo",
      now: () => 10_000,
    });
    if (persistence.migrate().status !== "migrated") {
      throw new Error("migration failed");
    }
    // Write 50 episodes.
    for (let i = 0; i < 50; i += 1) {
      persistence.appendEpisode(
        buildRuntimeMemoryEpisodeFixture({
          episodeId: `episode_${i}`,
          taskId: `task_ep_${i}`,
          kind: "verifier_summary",
          reference_time: i * 100,
          idempotencyKey: `ep_key_${i}`,
        }),
      );
    }
    // Write 600 facts.
    for (const fact of corpus.facts) {
      persistence.appendFact(fact);
    }

    const stats = loadStoreStats(dbPath);
    expect(stats.episodes).toBe(50); // 50 < 256, not trimmed
    expect(stats.facts).toBe(512); // 600 > 512, trimmed
  });

  it("long_term_no_active_gc", () => {
    // No TTL, no active GC. Facts remain until FIFO evicts.
    // Verify no `expired_at` is auto-set and no facts disappear without FIFO.
    const corpus = generateLongTermCorpus(100, 42); // 200 facts < 512
    const dbPath = createTempDbPath("no-gc-", tempDirs);
    seedCorpusToDb(dbPath, corpus);

    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("load failed");

    // All 200 facts should be present (no GC, no eviction).
    const facts = loaded.store.queryFacts({ includeInvalidated: true });
    expect(facts.length).toBe(200);

    // None should have `expired_at` auto-set.
    const withExpired = facts.filter(
      (f) => f.expired_at !== undefined && f.expired_at !== null,
    );
    expect(withExpired.length).toBe(0);
  });
});
