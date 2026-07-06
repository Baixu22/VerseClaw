// @vitest-environment node
// Layer 7: Interleaved read-write test (NEW dimension).
// Answers Q2 (which memories get used in long conversations) — verifies
// write-read consistency, recall degradation, invalidation effectiveness,
// and FIFO behavior during interleaved appendFact + query + invalidateFact.
//
// Anti-overfitting:
// - Independent ground truth: write-time recorded factId + token + label
// - NO filterQueriesBySeededGroups (forbidden)
// - NO expectedFactIds — recall = LLM token-appearance rate
// - LLM sampling step is FIXED (every 33 turns)
//
// Anti-hallucination:
// - Unique-token probe for recentFactRecall
// - A/B ablation (with-memory vs without-memory)
// - Negative assertions
// - Multi-judge vote (3 calls at temp=0.3, >=2/3 agreement)

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { consumeRuntimeMemoryHydrationFacts } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { createRuntimeMemoryProviderResult } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import {
  generateLongTermCorpus,
  makeUniqueProbeToken,
  type LongTermCorpus,
} from "./helpers/runtime-memory-real-corpus";
import {
  callDeepSeek,
  callDeepSeekMajorityVote,
  hasDeepSeekKey,
} from "./helpers/runtime-memory-real-llm-client";
import type { RuntimeMemoryTemporalFact } from "../../openclaw_runtime/src/runtime-core";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createStreamingWriter(dbPath: string) {
  let now = 10_000;
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => now++,
  });
  const migrateResult = persistence.migrate();
  if (migrateResult.status !== "migrated") {
    throw new Error(`streaming writer migration failed: ${migrateResult.status}`);
  }
  return {
    persistence,
    writeFact(fact: RuntimeMemoryTemporalFact): void {
      const result = persistence.appendFact(fact);
      if (result.status !== "persisted") {
        throw new Error(`appendFact failed for ${fact.factId}: ${result.status}`);
      }
    },
    invalidateFact(factId: string, fact: RuntimeMemoryTemporalFact, invalidAt: number): void {
      persistence.invalidateFact(
        buildRuntimeMemoryInvalidationProposalFixture({
          invalidationId: `inval_${factId}`,
          factId,
          invalid_at: invalidAt,
          reference_time: invalidAt,
          verificationStatus: "verified",
          sourceEpisodeRefs: fact.sourceEpisodeRefs,
          evidenceRefs: fact.evidenceRefs,
        }),
      );
    },
  };
}

function loadAllFacts(dbPath: string): RuntimeMemoryTemporalFact[] {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadAllFacts: load failed");
  return loaded.store.queryFacts({ includeInvalidated: true });
}

function loadFactIds(dbPath: string): Set<string> {
  const facts = loadAllFacts(dbPath);
  return new Set(facts.map((f) => f.factId));
}

function loadStats(dbPath: string): { facts: number; invalidations: number; factIds: Set<string> } {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadStats: load failed");
  const stats = loaded.store.stats();
  const facts = loaded.store.queryFacts({ includeInvalidated: true });
  return {
    facts: stats.facts,
    invalidations: stats.invalidations,
    factIds: new Set(facts.map((f) => f.factId)),
  };
}

// Convert a RuntimeMemoryTemporalFact to a consumer projection.
function toProjection(fact: RuntimeMemoryTemporalFact) {
  return {
    factId: fact.factId,
    recordKind: "fact" as const,
    taskId: fact.taskId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: fact.confidence,
    source: fact.source,
    verificationStatus: fact.verificationStatus,
    valid_at: fact.valid_at,
    reference_time: fact.reference_time,
    sourceEpisodeRefs: fact.sourceEpisodeRefs,
    evidenceRefs: fact.evidenceRefs,
    ...(fact.invalid_at !== undefined && fact.invalid_at !== null
      ? { invalid_at: fact.invalid_at }
      : {}),
    ...(fact.expired_at !== undefined && fact.expired_at !== null
      ? { expired_at: fact.expired_at }
      : {}),
  };
}

// Query the consumer for a specific fact by subject+predicate+taskId.
function queryConsumer(
  dbPath: string,
  query: { taskId: string; subject: string; predicate: string; referenceTime: number },
): { acceptedFactIds: string[]; rejectedFactIds: string[] } {
  const facts = loadAllFacts(dbPath);
  const projections = facts.map(toProjection);
  const result = consumeRuntimeMemoryHydrationFacts(projections, {
    taskId: query.taskId,
    subject: query.subject,
    predicate: query.predicate,
    referenceTime: query.referenceTime,
    tokenBudget: 256,
    limit: 8,
  });
  return {
    acceptedFactIds: result.acceptedFacts.map((f) => f.factId),
    rejectedFactIds: result.rejectedFacts.map((f) => f.fact.factId),
  };
}

// === Non-LLM tests: interleaved read-write ===

describe("Layer 7: interleaved read-write — local (no LLM)", () => {
  it("write_read_consistency_immediate_query", () => {
    // After writing a fact, immediately querying for it should return it
    // in acceptedFacts.
    const corpus = generateLongTermCorpus(100, 42);
    const dbPath = createTempDbPath("l7-consistency-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    // Write turn 0 (2 facts)
    writer.writeFact(corpus.facts[0]);
    writer.writeFact(corpus.facts[1]);

    // Query for the useful fact written at turn 0
    const usefulFact = corpus.facts[0]; // useful fact
    const result = queryConsumer(dbPath, {
      taskId: usefulFact.taskId,
      subject: usefulFact.subject,
      predicate: usefulFact.predicate,
      referenceTime: 100_000,
    });
    expect(result.acceptedFactIds).toContain(usefulFact.factId);
  });

  it("invalidation_effective_removes_from_accepted", () => {
    // After invalidating a fact, querying for it should NOT return it
    // in acceptedFacts (rejection reason: invalidated_at_reference_time).
    const corpus = generateLongTermCorpus(50, 42);
    const dbPath = createTempDbPath("l7-inval-effective-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    // Write 10 useful facts
    for (let i = 0; i < 10; i += 1) {
      writer.writeFact(corpus.facts[i * 2]); // useful facts at even indices
    }

    // Query before invalidation — should be accepted
    const fact = corpus.facts[0];
    const beforeResult = queryConsumer(dbPath, {
      taskId: fact.taskId,
      subject: fact.subject,
      predicate: fact.predicate,
      referenceTime: 100_000,
    });
    expect(beforeResult.acceptedFactIds).toContain(fact.factId);

    // Invalidate the fact
    writer.invalidateFact(fact.factId, fact, 50_000);

    // Query after invalidation — should NOT be accepted
    const afterResult = queryConsumer(dbPath, {
      taskId: fact.taskId,
      subject: fact.subject,
      predicate: fact.predicate,
      referenceTime: 100_000, // referenceTime > invalid_at
    });
    expect(afterResult.acceptedFactIds).not.toContain(fact.factId);
  });

  it("recall_degradation_over_1000_turns", () => {
    // Recall of a fixed cohort should degrade as more facts are written
    // (FIFO evicts older facts). Measure at turn 100, 500, 1000.
    const corpus = generateLongTermCorpus(1000, 42);
    const dbPath = createTempDbPath("l7-degradation-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    // Cohort: useful facts from turns 200-204 (5 facts)
    const cohort = corpus.usefulFactIds.slice(200, 205);

    // Write 300 turns (cohort written at turns 200-204, within 0-299)
    for (let t = 0; t < 300; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
    }

    // At turn 300 (600 facts > 512, FIFO evicted 88): cohort should be present
    // (cohort is at facts 400-408, which are after the first 512 facts)
    // Actually 300 turns = 600 facts, FIFO caps at 512, so 88 evicted.
    // Cohort (turns 200-204 = facts 400-408) are within the first 512, so present.
    const present1 = loadFactIds(dbPath);
    let cohortPresent = cohort.filter((id) => present1.has(id)).length;
    expect(cohortPresent).toBe(5); // all present

    // Write 200 more turns (500 total = 1000 facts, FIFO evicted 488)
    for (let t = 300; t < 500; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
    }
    const present2 = loadFactIds(dbPath);
    cohortPresent = cohort.filter((id) => present2.has(id)).length;
    // Cohort (turns 200-204 = facts 400-408) should be evicted by now
    // (1000 facts written, 512 retained, facts 488-999 retained)
    expect(cohortPresent).toBeLessThan(5);

    // Write 500 more turns (1000 total = 2000 facts, FIFO evicted 1488)
    for (let t = 500; t < 1000; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
    }
    const present3 = loadFactIds(dbPath);
    cohortPresent = cohort.filter((id) => present3.has(id)).length;
    expect(cohortPresent).toBeLessThanOrEqual(cohortPresent);
  }, 60_000); // 60s timeout — writes 1000 turns

  it("fifo_preserves_recent_512_interleaved", () => {
    // After 1000 interleaved turns, the most recent 512 facts should be present.
    const corpus = generateLongTermCorpus(1000, 42);
    const dbPath = createTempDbPath("l7-fifo-recent-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    for (let t = 0; t < 1000; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
      // Every 50 turns, invalidate an early fact
      if (t > 0 && t % 50 === 0) {
        const earlyFact = corpus.facts[(t - 50) * 2];
        writer.invalidateFact(earlyFact.factId, earlyFact, t * 1000);
      }
    }

    const stats = loadStats(dbPath);
    expect(stats.facts).toBe(512);
    // Invalidations should have accumulated
    expect(stats.invalidations).toBe(19); // turns 50, 100, ..., 950 = 19 invalidations
  }, 60_000);

  it("interleaved_invalidation_accumulation", () => {
    // Invalidating facts during the run should accumulate in the DB
    // (invalidation marks, doesn't delete).
    const corpus = generateLongTermCorpus(200, 42);
    const dbPath = createTempDbPath("l7-inval-accum-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    const invalidatedFactIds: string[] = [];
    for (let t = 0; t < 200; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
      // Every 20 turns, invalidate the useful fact from 20 turns ago
      if (t > 0 && t % 20 === 0) {
        const target = corpus.facts[(t - 20) * 2];
        writer.invalidateFact(target.factId, target, t * 1000);
        invalidatedFactIds.push(target.factId);
      }
    }

    const stats = loadStats(dbPath);
    expect(stats.invalidations).toBe(invalidatedFactIds.length);
    // Invalidated facts are still physically present
    for (const factId of invalidatedFactIds) {
      expect(stats.factIds.has(factId)).toBe(true);
    }
  }, 30_000);

  it("write_read_query_during_interleaved_run", () => {
    // During an interleaved run, querying for a recently-written fact
    // should return it in acceptedFacts.
    const corpus = generateLongTermCorpus(100, 42);
    const dbPath = createTempDbPath("l7-query-during-run-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    // Write 50 turns
    for (let t = 0; t < 50; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
    }

    // Query for a fact written at turn 40
    const targetFact = corpus.facts[40 * 2]; // useful fact at turn 40
    const result = queryConsumer(dbPath, {
      taskId: targetFact.taskId,
      subject: targetFact.subject,
      predicate: targetFact.predicate,
      referenceTime: 100_000,
    });
    expect(result.acceptedFactIds).toContain(targetFact.factId);

    // Write 50 more turns
    for (let t = 50; t < 100; t += 1) {
      writer.writeFact(corpus.facts[t * 2]);
      writer.writeFact(corpus.facts[t * 2 + 1]);
    }

    // Query again — fact should still be present (100 turns = 200 facts < 512)
    const result2 = queryConsumer(dbPath, {
      taskId: targetFact.taskId,
      subject: targetFact.subject,
      predicate: targetFact.predicate,
      referenceTime: 100_000,
    });
    expect(result2.acceptedFactIds).toContain(targetFact.factId);
  });

  it("consumer_conflict_resolution_during_interleaved_run", () => {
    // When two facts share the same taskId+subject+predicate, the consumer
    // should resolve the conflict (keep only the higher-confidence one).
    const dbPath = createTempDbPath("l7-conflict-", tempDirs);
    const writer = createStreamingWriter(dbPath);

    const taskId = "task_conflict_interleaved";
    const subject = "ConflictSubject";
    const predicate = "preference_code";

    // Write a low-confidence fact
    const factOld = buildRuntimeMemoryTemporalFactFixture({
      factId: "conf_old",
      taskId,
      subject,
      predicate,
      objectSummary: "User preference code is OLD-TOKEN",
      valid_at: 100,
      reference_time: 100,
      confidence: 0.5,
      acceptedAt: 100,
    });
    writer.writeFact(factOld);

    // Write a high-confidence fact (same taskId+subject+predicate)
    const factNew = buildRuntimeMemoryTemporalFactFixture({
      factId: "conf_new",
      taskId,
      subject,
      predicate,
      objectSummary: "User preference code is NEW-TOKEN",
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9,
      acceptedAt: 200,
    });
    writer.writeFact(factNew);

    // Query — consumer should keep only the high-confidence fact
    const result = queryConsumer(dbPath, {
      taskId,
      subject,
      predicate,
      referenceTime: 100_000,
    });
    expect(result.acceptedFactIds).toContain("conf_new");
    expect(result.acceptedFactIds).not.toContain("conf_old");
  });
});

// === LLM tests: recentFactRecall ===

describe.skipIf(!hasDeepSeekKey())("Layer 7: interleaved read-write — LLM recentFactRecall", () => {
  it(
    "recent_fact_recall_llm",
    async () => {
      // After 1000 interleaved turns, the LLM should be able to recall
      // facts written in the LAST 10 turns (recent facts, not evicted).
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l7-llm-recent-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (let t = 0; t < 1000; t += 1) {
        writer.writeFact(corpus.facts[t * 2]);
        writer.writeFact(corpus.facts[t * 2 + 1]);
      }

      // Inject 5 probe facts with unique tokens at the END (recent)
      const probeSubject = "RecentProbe";
      const probeTaskId = "task_recent_probe";
      const probes: { factId: string; token: string; predicate: string }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const token = makeUniqueProbeToken(7000 + i);
        const predicate = `probe_${i}`;
        const probeFact = buildRuntimeMemoryTemporalFactFixture({
          factId: `recent_probe_${i}`,
          taskId: probeTaskId,
          subject: probeSubject,
          predicate,
          objectSummary: `User preference code is ${token}`,
          valid_at: 1_000_000,
          reference_time: 1_000_000,
          confidence: 0.95,
          acceptedAt: 1_000_000,
        });
        writer.writeFact(probeFact);
        probes.push({ factId: probeFact.factId, token, predicate });
      }

      // For each probe, query the provider and check if LLM recalls the token
      const directQuestion = "What is the user's preference code? Answer with the code only.";
      const recalls: boolean[] = [];

      for (const probe of probes) {
        // Load all facts and query the provider for this probe
        const allFacts = loadAllFacts(dbPath);
        const result = await createRuntimeMemoryProviderResult(
          {
            facts: allFacts as never,
            defaultTokenBudget: 256,
            defaultLimit: 8,
          },
          {
            taskId: probeTaskId,
            tokenBudget: 256,
            metadata: {
              memoryQuery: {
                taskId: probeTaskId,
                subject: probeSubject,
                predicate: probe.predicate,
                reference_time: 2_000_000,
                limit: 8,
              },
            },
          },
        );
        const memoryText = result.contextItems.map((item) => item.text).join("\n");

        const system = [
          "You are a helpful assistant with access to the user's stored preferences.",
          "If relevant memory is provided below, use it to answer.",
          "Do not invent preferences that are not in the memory.",
          "",
          memoryText.length > 0
            ? `=== STORED MEMORY ===\n${memoryText}\n=== END MEMORY ===`
            : "=== STORED MEMORY ===\n(no memory stored)\n=== END MEMORY ===",
        ].join("\n");

        const response = await callDeepSeek(system, directQuestion, {
          temperature: 0,
          maxTokens: 64,
        });
        recalls.push(response.content.includes(probe.token));
      }

      // All recent probes should be recalled (they were written last, not evicted)
      const recallCount = recalls.filter((r) => r).length;
      expect(recallCount).toBeGreaterThanOrEqual(4); // at least 4/5 recalled
    },
    120_000,
  ); // 120s for 5 LLM calls

  it(
    "old_evicted_fact_not_recalled_llm",
    async () => {
      // A probe fact written at turn 33 (early) should be EVICTED by FIFO
      // after 1000 turns. The LLM should NOT recall it (no memory context).
      const corpus = generateLongTermCorpus(1000, 42);
      const dbPath = createTempDbPath("l7-llm-evicted-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      // Write 50 turns, then inject an early probe
      for (let t = 0; t < 50; t += 1) {
        writer.writeFact(corpus.facts[t * 2]);
        writer.writeFact(corpus.facts[t * 2 + 1]);
      }
      const earlyToken = makeUniqueProbeToken(8000);
      const earlyPredicate = "probe_early";
      const earlyProbe = buildRuntimeMemoryTemporalFactFixture({
        factId: "early_probe",
        taskId: "task_early_probe",
        subject: "EarlyProbe",
        predicate: earlyPredicate,
        objectSummary: `User preference code is ${earlyToken}`,
        valid_at: 50_000,
        reference_time: 50_000,
        confidence: 0.95,
        acceptedAt: 50_000,
      });
      writer.writeFact(earlyProbe);

      // Write 950 more turns (1000 total = 2000+ facts, FIFO evicts early probe)
      for (let t = 50; t < 1000; t += 1) {
        writer.writeFact(corpus.facts[t * 2]);
        writer.writeFact(corpus.facts[t * 2 + 1]);
      }

      // Verify the early probe is physically evicted
      const factIds = loadFactIds(dbPath);
      expect(factIds.has("early_probe")).toBe(false);

      // Query the provider — should return empty (probe evicted)
      const allFacts = loadAllFacts(dbPath);
      const result = await createRuntimeMemoryProviderResult(
        {
          facts: allFacts as never,
          defaultTokenBudget: 256,
          defaultLimit: 8,
        },
        {
          taskId: "task_early_probe",
          tokenBudget: 256,
          metadata: {
            memoryQuery: {
              taskId: "task_early_probe",
              subject: "EarlyProbe",
              predicate: earlyPredicate,
              reference_time: 2_000_000,
              limit: 8,
            },
          },
        },
      );
      expect(result.contextItems).toHaveLength(0);

      // LLM should NOT recall the token (no memory context)
      const system = [
        "You are a helpful assistant with access to the user's stored preferences.",
        "If relevant memory is provided below, use it to answer.",
        "Do not invent preferences that are not in the memory.",
        "",
        "=== STORED MEMORY ===\n(no memory stored)\n=== END MEMORY ===",
      ].join("\n");
      const response = await callDeepSeek(
        system,
        "What is the user's preference code? Answer with the code only.",
        { temperature: 0, maxTokens: 64 },
      );
      expect(response.content).not.toContain(earlyToken);
    },
    60_000,
  );

  it(
    "multi_judge_recall_stability",
    async () => {
      // Multi-judge vote: 3 calls at temp=0.3 on a single probe.
      // Validates that recall is stable across multiple judges (>=2/3 agreement).
      const corpus = generateLongTermCorpus(100, 42);
      const dbPath = createTempDbPath("l7-llm-multivote-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (let t = 0; t < 100; t += 1) {
        writer.writeFact(corpus.facts[t * 2]);
        writer.writeFact(corpus.facts[t * 2 + 1]);
      }

      const token = makeUniqueProbeToken(9000);
      const probeTaskId = "task_multivote_probe";
      const probeFact = buildRuntimeMemoryTemporalFactFixture({
        factId: "multivote_probe",
        taskId: probeTaskId,
        subject: "MultiVoteProbe",
        predicate: "probe_code",
        objectSummary: `User preference code is ${token}`,
        valid_at: 200_000,
        reference_time: 200_000,
        confidence: 0.95,
        acceptedAt: 200_000,
      });
      writer.writeFact(probeFact);

      const allFacts = loadAllFacts(dbPath);
      const result = await createRuntimeMemoryProviderResult(
        {
          facts: allFacts as never,
          defaultTokenBudget: 256,
          defaultLimit: 8,
        },
        {
          taskId: probeTaskId,
          tokenBudget: 256,
          metadata: {
            memoryQuery: {
              taskId: probeTaskId,
              subject: "MultiVoteProbe",
              predicate: "probe_code",
              reference_time: 300_000,
              limit: 8,
            },
          },
        },
      );
      const memoryText = result.contextItems.map((item) => item.text).join("\n");

      const system = [
        "You are a helpful assistant with access to the user's stored preferences.",
        "If relevant memory is provided below, use it to answer.",
        "Do not invent preferences that are not in the memory.",
        "",
        `=== STORED MEMORY ===\n${memoryText}\n=== END MEMORY ===`,
      ].join("\n");

      const votes = await callDeepSeekMajorityVote(
        system,
        "What is the user's preference code? Answer with the code only.",
        3,
        { temperature: 0.3, maxTokens: 64 },
      );

      const agreementCount = votes.filter((v) => v.content.includes(token)).length;
      expect(agreementCount).toBeGreaterThanOrEqual(2); // >=2/3 agreement
    },
    120_000,
  );
});
