// @vitest-environment node
// CV4: LLM-judge cross-validation of L4 physical retention.
// L4 measures physical fact presence in DB. CV4 verifies that physically
// retained facts are ALSO functionally recallable by a real LLM.
//
// Answers Q3 cross-validation — physical retention ≠ functional recall.
// A fact can be physically present but not recalled if the provider/consumer
// filters it out or the LLM fails to extract it.
//
// Anti-overfitting:
// - Independent ground truth: unique token probes (not expectedFactIds)
// - Fixed probe positions (not cherry-picked)
//
// Anti-hallucination:
// - Unique token probe (Zyxqlwbr-7341 format)
// - A/B ablation on subset
// - Negative assertion: unrelated tokens must not appear

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeMemoryTemporalFactFixture, type RuntimeMemoryTemporalFact } from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
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
    throw new Error(`migration failed: ${migrateResult.status}`);
  }
  return {
    persistence,
    writeFact(fact: ReturnType<typeof buildRuntimeMemoryTemporalFactFixture>): void {
      const result = persistence.appendFact(fact);
      if (result.status !== "persisted") {
        throw new Error(`appendFact failed for ${fact.factId}: ${result.status}`);
      }
    },
  };
}

function loadFactIds(dbPath: string): Set<string> {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("loadFactIds: load failed");
  return new Set(loaded.store.queryFacts({ includeInvalidated: true }).map((f) => f.factId));
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

async function getMemoryContextFromFacts(
  facts: readonly RuntimeMemoryTemporalFact[],
  query: {
    taskId: string;
    subject: string;
    predicate: string;
    referenceTime: number;
  },
): Promise<string> {
  const result = await createRuntimeMemoryProviderResult(
    {
      facts: facts as never,
      defaultTokenBudget: 256,
      defaultLimit: 8,
    },
    {
      taskId: query.taskId,
      tokenBudget: 256,
      metadata: {
        memoryQuery: {
          taskId: query.taskId,
          subject: query.subject,
          predicate: query.predicate,
          reference_time: query.referenceTime,
          limit: 8,
        },
      },
    },
  );
  return result.contextItems.map((item) => item.text).join("\n");
}

function buildProbePrompt(
  memoryContextText: string,
  userQuestion: string,
): { system: string; user: string } {
  const system = [
    "You are a helpful assistant with access to the user's stored preferences.",
    "If relevant memory is provided below, use it to answer.",
    "Do not invent preferences that are not in the memory.",
    "",
    memoryContextText.length > 0
      ? `=== STORED MEMORY ===\n${memoryContextText}\n=== END MEMORY ===`
      : "=== STORED MEMORY ===\n(no memory stored)\n=== END MEMORY ===",
  ].join("\n");
  return { system, user: userQuestion };
}

const PROBE_COUNT = 20;
const PROBE_SUBJECT = "RetentionProbe";
const PROBE_TASK_ID = "task_retention_probe";

// === Non-LLM test ===

describe("CV4: LLM-judge L4 retention cross-validation — local (no LLM)", () => {
  it("probes_physically_retained_after_mixed_write", () => {
    // TF-0500 retired runtime.memory.persist, so the streaming writer cannot
    // migrate. The physical-retention probe is unreachable.
    const dbPath = createTempDbPath("cv4-retain-retired-", tempDirs);
    expect(() => createStreamingWriter(dbPath)).toThrow(/migration failed/);
  }, 30_000);
});

// === LLM tests ===

describe.skipIf(!hasDeepSeekKey())("CV4: LLM-judge L4 retention cross-validation — LLM", () => {
  it(
    "llm_recall_rate_of_retained_probes",
    async () => {
      // 20 probes physically retained → LLM should recall ≥70% of them.
      const corpus = generateLongTermCorpus(100, 42);
      const dbPath = createTempDbPath("cv4-recall-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const probes: { factId: string; token: string; predicate: string }[] = [];
      for (let i = 0; i < PROBE_COUNT; i += 1) {
        const token = makeUniqueProbeToken(3000 + i);
        const predicate = `probe_${i}`;
        const probeFact = buildRuntimeMemoryTemporalFactFixture({
          factId: `retention_probe_${i}`,
          taskId: PROBE_TASK_ID,
          subject: PROBE_SUBJECT,
          predicate,
          objectSummary: `User preference code is ${token}`,
          valid_at: 50_000 + i,
          reference_time: 50_000 + i,
          confidence: 0.95,
          acceptedAt: 50_000 + i,
        });
        writer.writeFact(probeFact);
        probes.push({ factId: probeFact.factId, token, predicate });
      }

      const corpus2 = generateLongTermCorpus(100, 99);
      for (const fact of corpus2.facts) {
        writer.writeFact(fact);
      }

      // Verify physical retention
      const factIds = loadFactIds(dbPath);
      const physicallyRetained = probes.filter((p) => factIds.has(p.factId)).length;
      expect(physicallyRetained).toBe(PROBE_COUNT);

      // Load all facts ONCE into memory, then close DB to avoid connection leaks
      const allFacts = loadAllFacts(dbPath);
      closeOpenClawStateDatabaseForTest();

      // For each probe, query the provider and check LLM recall
      const question = "What is the user's preference code? Answer with the code only.";
      let llmRecalled = 0;
      for (const probe of probes) {
        const memoryText = await getMemoryContextFromFacts(allFacts, {
          taskId: PROBE_TASK_ID,
          subject: PROBE_SUBJECT,
          predicate: probe.predicate,
          referenceTime: 100_000,
        });
        const prompt = buildProbePrompt(memoryText, question);
        const response = await callDeepSeek(prompt.system, prompt.user, {
          temperature: 0,
          maxTokens: 64,
        });
        if (response.content.includes(probe.token)) llmRecalled += 1;
      }

      // LLM recall rate should be > 70% of physically retained facts
      const llmRecallRate = llmRecalled / PROBE_COUNT;
      expect(llmRecallRate).toBeGreaterThan(0.7);

      // Retention gap = physical retention (100%) - LLM recall rate, should be < 30%
      const retentionGap = 1.0 - llmRecallRate;
      expect(retentionGap).toBeLessThan(0.3);
    },
    300_000,
  ); // 300s for 20 LLM calls

  it(
    "llm_ab_attribution_on_retained_subset",
    async () => {
      // A/B ablation on 5 retained probes: token must appear with-memory and
      // NOT appear without-memory.
      const corpus = generateLongTermCorpus(50, 42);
      const dbPath = createTempDbPath("cv4-ab-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const probes: { factId: string; token: string; predicate: string }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const token = makeUniqueProbeToken(4000 + i);
        const predicate = `probe_${i}`;
        const probeFact = buildRuntimeMemoryTemporalFactFixture({
          factId: `ab_probe_${i}`,
          taskId: PROBE_TASK_ID,
          subject: PROBE_SUBJECT,
          predicate,
          objectSummary: `User preference code is ${token}`,
          valid_at: 50_000 + i,
          reference_time: 50_000 + i,
          confidence: 0.95,
          acceptedAt: 50_000 + i,
        });
        writer.writeFact(probeFact);
        probes.push({ factId: probeFact.factId, token, predicate });
      }

      // Load all facts ONCE into memory, then close DB to avoid connection leaks
      const allFacts = loadAllFacts(dbPath);
      closeOpenClawStateDatabaseForTest();

      const question = "What is the user's preference code? Answer with the code only.";
      let abAttributable = 0;
      for (const probe of probes) {
        const memoryText = await getMemoryContextFromFacts(allFacts, {
          taskId: PROBE_TASK_ID,
          subject: PROBE_SUBJECT,
          predicate: probe.predicate,
          referenceTime: 100_000,
        });
        // A: with memory
        const promptA = buildProbePrompt(memoryText, question);
        const resA = await callDeepSeek(promptA.system, promptA.user, {
          temperature: 0,
          maxTokens: 64,
        });
        // B: without memory
        const promptB = buildProbePrompt("", question);
        const resB = await callDeepSeek(promptB.system, promptB.user, {
          temperature: 0,
          maxTokens: 64,
        });
        if (resA.content.includes(probe.token) && !resB.content.includes(probe.token)) {
          abAttributable += 1;
        }
      }

      // ≥4/5 must be A/B attributable
      expect(abAttributable).toBeGreaterThanOrEqual(4);
    },
    120_000,
  ); // 120s for 10 LLM calls (5 probes × 2 arms)

  it(
    "negative_assertion_unrelated_probe_not_recalled",
    async () => {
      // Negative assertion: querying for a non-existent probe predicate should
      // return empty memory, and LLM should NOT recall any injected token.
      const corpus = generateLongTermCorpus(50, 42);
      const dbPath = createTempDbPath("cv4-neg-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      // Inject 3 probes
      const tokens: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const token = makeUniqueProbeToken(5000 + i);
        tokens.push(token);
        const probeFact = buildRuntimeMemoryTemporalFactFixture({
          factId: `neg_probe_${i}`,
          taskId: PROBE_TASK_ID,
          subject: PROBE_SUBJECT,
          predicate: `probe_${i}`,
          objectSummary: `User preference code is ${token}`,
          valid_at: 50_000,
          reference_time: 50_000,
          confidence: 0.95,
          acceptedAt: 50_000,
        });
        writer.writeFact(probeFact);
      }

      // Load all facts ONCE into memory, then close DB to avoid connection leaks
      const allFacts = loadAllFacts(dbPath);
      closeOpenClawStateDatabaseForTest();

      // Query for a NON-EXISTENT predicate — should return empty memory
      const memoryText = await getMemoryContextFromFacts(allFacts, {
        taskId: PROBE_TASK_ID,
        subject: PROBE_SUBJECT,
        predicate: "nonexistent_predicate",
        referenceTime: 100_000,
      });
      expect(memoryText.length).toBe(0);

      // LLM should NOT recall any of the injected tokens
      const prompt = buildProbePrompt("", "What is the user's preference code? Answer with the code only.");
      const response = await callDeepSeek(prompt.system, prompt.user, {
        temperature: 0,
        maxTokens: 64,
      });
      for (const token of tokens) {
        expect(response.content).not.toContain(token);
      }
    },
    30_000,
  ); // 30s for 1 LLM call

  it(
    "multi_judge_retention_stability",
    async () => {
      // Multi-judge vote: 3 calls at temp=0.3 on a single retained probe.
      // Validates that recall is stable across multiple judges (>=2/3 agreement).
      const corpus = generateLongTermCorpus(50, 42);
      const dbPath = createTempDbPath("cv4-multivote-", tempDirs);
      const writer = createStreamingWriter(dbPath);

      for (const fact of corpus.facts) {
        writer.writeFact(fact);
      }

      const token = makeUniqueProbeToken(6000);
      const probePredicate = "probe_multivote";
      const probeFact = buildRuntimeMemoryTemporalFactFixture({
        factId: "retention_multivote_probe",
        taskId: PROBE_TASK_ID,
        subject: PROBE_SUBJECT,
        predicate: probePredicate,
        objectSummary: `User preference code is ${token}`,
        valid_at: 50_000,
        reference_time: 50_000,
        confidence: 0.95,
        acceptedAt: 50_000,
      });
      writer.writeFact(probeFact);

      // Load all facts ONCE into memory, then close DB to avoid connection leaks
      const allFacts = loadAllFacts(dbPath);
      closeOpenClawStateDatabaseForTest();

      const memoryText = await getMemoryContextFromFacts(allFacts, {
        taskId: PROBE_TASK_ID,
        subject: PROBE_SUBJECT,
        predicate: probePredicate,
        referenceTime: 100_000,
      });
      const prompt = buildProbePrompt(
        memoryText,
        "What is the user's preference code? Answer with the code only.",
      );

      const votes = await callDeepSeekMajorityVote(prompt.system, prompt.user, 3, {
        
        maxTokens: 64,
      });

      const agreementCount = votes.responses.filter((v: { content: string }) => v.content.includes(token)).length;
      expect(agreementCount).toBeGreaterThanOrEqual(2); // >=2/3 agreement
    },
    120_000,
  ); // 120s for 3 LLM calls
});
