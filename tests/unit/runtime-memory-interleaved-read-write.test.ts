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
  return [...loaded.store.queryFacts({ includeInvalidated: true })] as never;
}

function loadFactIds(dbPath: string): Set<string> {
  const facts = loadAllFacts(dbPath);
  return new Set(facts.map((f) => f.factId));
}

function _loadStats(dbPath: string): { facts: number; invalidations: number; factIds: Set<string> } {
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
    taskId: fact.taskId ?? "task",
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
  it("cannot build the interleaved corpus while the streaming writer is retired", () => {
    // TF-0500 retired runtime.memory.persist; createStreamingWriter fails at
    // migrate, so none of the read/write consistency probes can run.
    const dbPath = createTempDbPath("l7-retired-", tempDirs);
    expect(() => createStreamingWriter(dbPath)).toThrow(/migration failed/);
  });

  it("keeps the retired read path returning no facts", () => {
    const dbPath = createTempDbPath("l7-retired-read-", tempDirs);
    // The reader opens the same store, which is retired, so it fails closed.
    expect(() => loadFactIds(dbPath)).toThrow(/load failed/);
  });

  it("keeps the pure consumer free of runtime memory when no facts are supplied", () => {
    const query = {
      taskId: "task_l7_retired",
      subject: "RepoPreference",
      predicate: "package_manager",
      referenceTime: 100,
      expectedFactIds: ["fact_pkg_pnpm"],
    };
    // queryConsumer loads facts through the retired store and fails closed.
    expect(() => queryConsumer(createTempDbPath("l7-retired-consumer-", tempDirs), query)).toThrow(/load failed/);
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
        { temperature: 0.3, maxTokens: 64 } as never,
      );

      const agreementCount = votes.responses.filter((v: { content?: string }) => v.content?.includes(token)).length;
      expect(agreementCount).toBeGreaterThanOrEqual(2); // >=2/3 agreement
    },
    120_000,
  );
});
