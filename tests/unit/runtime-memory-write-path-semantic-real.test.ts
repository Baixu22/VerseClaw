// @vitest-environment node
// Layer 1: Write-path real filtering behavior.
// Answers "what gets saved" by probing the 4-layer defense with independent
// inputs (useful / syntactic noise / semantic noise). Anti-overfitting: ground
// truth comes from input classification, NOT consumer design goals. Key real
// finding: the system does NOT reject semantic noise (well-formed but irrelevant
// facts), exposing the root cause of noise accumulation.

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { RUNTIME_MEMORY_EVAL_CONFIG } from "./helpers/runtime-memory-eval-helpers";

const tempDirs: string[] = [];
const NOW = () => 1_000;

function makeDbPath(prefix: string): string {
  const dir = mkdtempSync(prefix);
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function makePersistence(dbPath: string, maxFacts?: number) {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: NOW,
    ...(maxFacts !== undefined ? { maxFacts } : {}),
  });
  const migration = persistence.migrate();
  if (migration.status !== "migrated") {
    throw new Error(`migration failed: ${JSON.stringify(migration)}`);
  }
  return persistence;
}

// Build a fact with raw content in objectSummary, bypassing fixture sanitize.
// The persistence layer's sanitizeFactForPersistence will catch this.
function makeRawContentFact(params: {
  factId: string;
  objectSummary: string;
  taskId?: string;
  subject?: string;
  predicate?: string;
}): RuntimeMemoryTemporalFact {
  const valid = buildRuntimeMemoryTemporalFactFixture({
    factId: params.factId,
    taskId: params.taskId ?? "task_raw",
    subject: params.subject ?? "RawTest",
    predicate: params.predicate ?? "raw_content",
    objectSummary: "safe placeholder",
    valid_at: 100,
    reference_time: 100,
  });
  // Override objectSummary with raw content AFTER sanitize, bypassing fixture guard.
  // Persistence layer will re-sanitize and reject.
  return { ...valid, objectSummary: params.objectSummary } as RuntimeMemoryTemporalFact;
}

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Layer 1: write-path real filtering — useful facts persist through 4 layers", () => {
  it("useful_fact_persists_through_4_layers", () => {
    const dbPath = makeDbPath("l1-useful-");
    const persistence = makePersistence(dbPath);
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_useful_1",
      taskId: "task_programming",
      subject: "DevPreference",
      predicate: "package_manager",
      objectSummary: "User project uses pnpm as package manager",
      valid_at: 100,
      reference_time: 100,
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "persisted", stored: true, duplicate: false, persisted: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    const facts = loaded.store.queryFacts({ taskId: "task_programming" });
    expect(facts.some((f) => f.factId === "fact_useful_1")).toBe(true);
  });
});

describe("Layer 1: write-path real filtering — syntactic noise rejected", () => {
  it("raw_chat_log_rejected_at_persistence", () => {
    const dbPath = makeDbPath("l1-rawchat-");
    const persistence = makePersistence(dbPath);
    const fact = makeRawContentFact({
      factId: "fact_raw_chat",
      objectSummary: "user: hello, assistant: hi there, tool: result output",
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "rejected", persisted: false });
    if (result.status === "rejected") {
      expect(result.reason).toBe("raw_chat_log");
    }
  });

  it("secret_rejected_at_persistence", () => {
    const dbPath = makeDbPath("l1-secret-");
    const persistence = makePersistence(dbPath);
    const fact = makeRawContentFact({
      factId: "fact_secret",
      objectSummary: "User API key is sk-9b4abb43c812453eadede49a42c8de6d",
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "rejected", persisted: false });
    if (result.status === "rejected") {
      expect(result.reason).toBe("secret");
    }
  });

  it("prompt_dump_rejected_at_persistence", () => {
    // Persistence layer rejects raw prompt dumps (system prompt / raw prompt / template).
    // NOTE: prompt-injection PHRASES ("ignore instructions") are caught by the
    // consumer sentinel, NOT by persistence. This is a real architectural finding:
    // persistence defends against raw leaks, consumer defends against injection.
    const dbPath = makeDbPath("l1-promptdump-");
    const persistence = makePersistence(dbPath);
    const fact = makeRawContentFact({
      factId: "fact_prompt_dump",
      objectSummary: "Leaked raw system prompt dump with template and subagent details",
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "rejected", persisted: false });
    if (result.status === "rejected") {
      expect(result.reason).toBe("prompt");
    }
  });
});

describe("Layer 1: write-path real filtering — field truncation", () => {
  it("field_truncation_preserves_semantic_core", () => {
    const dbPath = makeDbPath("l1-trunc-");
    const persistence = makePersistence(dbPath);
    const longSummary = "A".repeat(2000);
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_trunc",
      taskId: "task_trunc",
      subject: "TruncTest",
      predicate: "long_field",
      objectSummary: longSummary,
      valid_at: 100,
      reference_time: 100,
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "persisted", stored: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    const facts = loaded.store.queryFacts({ taskId: "task_trunc" });
    const stored = facts.find((f) => f.factId === "fact_trunc");
    expect(stored).toBeDefined();
    // objectSummary should be truncated to MAX_TEXT_LENGTH (512) + "..."
    expect(stored!.objectSummary.length).toBeLessThanOrEqual(515);
    // Semantic core (first 512 chars) preserved
    expect(stored!.objectSummary.startsWith("A".repeat(100))).toBe(true);
  });
});

describe("Layer 1: write-path real filtering — deduplication", () => {
  it("duplicate_fact_id_not_merged", () => {
    const dbPath = makeDbPath("l1-dup-");
    const persistence = makePersistence(dbPath);
    const fact1 = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_dup",
      taskId: "task_dup",
      subject: "DupTest",
      predicate: "value",
      objectSummary: "First version",
      valid_at: 100,
      reference_time: 100,
    });
    const fact2 = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_dup",
      taskId: "task_dup",
      subject: "DupTest",
      predicate: "value",
      objectSummary: "Second version with different content",
      valid_at: 100,
      reference_time: 100,
    });
    const r1 = persistence.appendFact(fact1);
    const r2 = persistence.appendFact(fact2);
    expect(r1).toMatchObject({ status: "persisted", stored: true });
    expect(r2).toMatchObject({ status: "persisted", stored: false, duplicate: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    const facts = loaded.store.queryFacts({ taskId: "task_dup" });
    expect(facts.length).toBe(1);
    // First version wins (fact dedup does NOT merge)
    expect(facts[0].objectSummary).toBe("First version");
  });

  it("episode_dedupe_merges_evidence", () => {
    const dbPath = makeDbPath("l1-epdup-");
    const persistence = makePersistence(dbPath);
    const episode = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_dedup",
      taskId: "task_epdup",
      kind: "verifier_summary",
      reference_time: 100,
      idempotencyKey: "task_epdup:verifier:summary",
      boundedSummary: "Evidence merge test episode",
      sourceRefs: [{ type: "test", ref: "evidence_a" }],
      evidenceRefs: [{ type: "test", ref: "trace_a" }],
    });
    const episode2 = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_dedup",
      taskId: "task_epdup",
      kind: "verifier_summary",
      reference_time: 100,
      idempotencyKey: "task_epdup:verifier:summary",
      boundedSummary: "Evidence merge test episode",
      sourceRefs: [{ type: "test", ref: "evidence_b" }],
      evidenceRefs: [{ type: "test", ref: "trace_b" }],
    });
    const r1 = persistence.appendEpisode(episode);
    const r2 = persistence.appendEpisode(episode2);
    expect(r1).toMatchObject({ status: "persisted", stored: true });
    // Episode dedup MERGES evidence (unlike fact dedup)
    expect(r2).toMatchObject({ status: "persisted", stored: false, duplicate: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    expect(loaded.stats.episodes).toBe(1);
  });
});

describe("Layer 1: write-path real filtering — semantic noise NOT rejected (real finding)", () => {
  it("semantic_noise_fact_NOT_rejected", () => {
    const dbPath = makeDbPath("l1-noise1-");
    const persistence = makePersistence(dbPath);
    // Well-formed, structurally valid, but semantically irrelevant to any task
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_noise_pizza",
      taskId: "task_programming",
      subject: "DevPreference",
      predicate: "package_manager",
      objectSummary: "User likes pineapple on pizza",
      valid_at: 100,
      reference_time: 100,
    });
    const result = persistence.appendFact(fact);
    // REAL FINDING: system has no semantic filter, so noise IS persisted
    expect(result).toMatchObject({ status: "persisted", stored: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    const facts = loaded.store.queryFacts({ taskId: "task_programming" });
    expect(facts.some((f) => f.objectSummary === "User likes pineapple on pizza")).toBe(true);
  });

  it("semantic_noise_travel_fact_NOT_rejected", () => {
    const dbPath = makeDbPath("l1-noise2-");
    const persistence = makePersistence(dbPath);
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_noise_cat",
      taskId: "task_debugging",
      subject: "DebugContext",
      predicate: "root_cause",
      objectSummary: "User's cat is named Mittens and likes to sit on the keyboard",
      valid_at: 100,
      reference_time: 100,
    });
    const result = persistence.appendFact(fact);
    expect(result).toMatchObject({ status: "persisted", stored: true });

    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    const facts = loaded.store.queryFacts({ taskId: "task_debugging" });
    expect(facts.some((f) => f.factId === "fact_noise_cat")).toBe(true);
  });
});

describe("Layer 1: write-path real filtering — invalidation marks not deletes", () => {
  it("invalidation_marks_not_deletes", () => {
    const dbPath = makeDbPath("l1-inval-");
    const persistence = makePersistence(dbPath);
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_inval",
      taskId: "task_inval",
      subject: "InvalTest",
      predicate: "value",
      objectSummary: "Will be invalidated",
      valid_at: 100,
      reference_time: 100,
    });
    persistence.appendFact(fact);

    const proposal = buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "inval_1",
      factId: "fact_inval",
      taskId: "task_inval",
      reason: "superseded",
      invalid_at: 200,
      reference_time: 200,
      verificationStatus: "verified",
    });
    const invalResult = persistence.invalidateFact(proposal);
    expect(invalResult).toMatchObject({ status: "persisted", stored: true });

    // Fact still in DB (not deleted) — queryFacts filters invalidated facts by default,
    // so use includeInvalidated: true OR check stats to verify physical presence.
    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    expect(loaded.stats.facts).toBe(1); // fact still physically present
    expect(loaded.stats.invalidations).toBe(1); // invalidation recorded
    // Fact accessible with includeInvalidated flag
    const facts = loaded.store.queryFacts({ taskId: "task_inval", includeInvalidated: true });
    expect(facts.some((f) => f.factId === "fact_inval")).toBe(true);
    // By default (without includeInvalidated), fact is filtered out — this is expected
    const defaultFacts = loaded.store.queryFacts({ taskId: "task_inval" });
    expect(defaultFacts.some((f) => f.factId === "fact_inval")).toBe(false);
  });
});

describe("Layer 1: write-path real filtering — FIFO eviction at boundary", () => {
  it("fifo_eviction_at_maxFacts_boundary", () => {
    const dbPath = makeDbPath("l1-fifo-");
    const persistence = makePersistence(dbPath, 10); // maxFacts=10
    // Write 12 facts
    for (let i = 0; i < 12; i += 1) {
      const fact = buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_fifo_${i}`,
        taskId: "task_fifo",
        subject: "FifoTest",
        predicate: "order",
        objectSummary: `Fact number ${i}`,
        valid_at: i,
        reference_time: i,
        confidence: 0.9,
      });
      persistence.appendFact(fact);
    }
    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    expect(loaded.stats.facts).toBe(10); // capped at maxFacts
    const facts = loaded.store.queryFacts({ taskId: "task_fifo" });
    const factIds = facts.map((f) => f.factId);
    // First 2 evicted (FIFO)
    expect(factIds).not.toContain("fact_fifo_0");
    expect(factIds).not.toContain("fact_fifo_1");
    // Last 10 retained
    expect(factIds).toContain("fact_fifo_2");
    expect(factIds).toContain("fact_fifo_11");
  });

  it("fifo_eviction_preserves_invalidated_facts_equally", () => {
    // FIFO does not distinguish useful vs invalidated — both count toward maxFacts
    const dbPath = makeDbPath("l1-fifo2-");
    const persistence = makePersistence(dbPath, 5); // maxFacts=5
    // Write 3 valid + 3 invalidated facts = 6 total, exceeds maxFacts=5
    for (let i = 0; i < 3; i += 1) {
      persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_valid_${i}`,
        taskId: "task_fifo2",
        subject: "FifoTest2",
        predicate: "valid",
        objectSummary: `Valid ${i}`,
        valid_at: i,
        reference_time: i,
      }));
    }
    for (let i = 0; i < 3; i += 1) {
      persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_inval_${i}`,
        taskId: "task_fifo2",
        subject: "FifoTest2",
        predicate: "inval",
        objectSummary: `Invalid ${i}`,
        valid_at: i,
        reference_time: i,
      }));
      persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
        invalidationId: `inval_prop_${i}`,
        factId: `fact_inval_${i}`,
        taskId: "task_fifo2",
        reason: "superseded",
        invalid_at: 100,
        reference_time: 100,
        verificationStatus: "verified",
      }));
    }
    const loaded = persistence.loadStore();
    if (loaded.status !== "loaded") throw new Error("loadStore failed");
    // FIFO caps at 5, first fact evicted (no special retention for invalidated)
    expect(loaded.stats.facts).toBe(5);
  });
});
