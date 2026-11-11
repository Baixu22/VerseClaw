import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";
import {
  closeRuntimeMemoryHydrationShadowDatabasesForTest,
  consumeRuntimeMemoryHydrationFacts,
  type RuntimeMemoryHydrationConsumerQuery,
  type RuntimeMemoryHydrationShadowFactProjection,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const TOP_K = 12;

const tempDirs: string[] = [];

afterEach(() => {
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

  it("keeps the retired controlled replay harness from seeding any database", () => {
    // TF-0500 retired runtime.memory.persist; every replay scenario seeds through
    // the persistence store and therefore cannot run.
    const dbPath = createTempDbPath("replay-retired-");
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });

  it("still evaluates a single all-rejected arm through the pure helpers", () => {
    const query = {
      queryId: "replay-pure-1",
      taskId: "task_replay_pure",
      subject: "ReplaySubject",
      predicate: "replayPredicate",
      referenceTime: 10,
      tokenBudget: 512,
      limit: 8,
      expectedFactIds: ["expected_fact_1"],
    };

    // evaluateArm is a pure reducer over supplied query results; with no facts
    // every expectation is a miss and nothing is returned.
    const arm = evaluateArm({
      arm: "guarded_opt_in_consumer",
      facts: [],
      queries: [query],
      latencyMs: 1,
    });
    expect(arm.returnedFactIds).toEqual([]);
    expect(arm.truePositiveCount).toBe(0);
    expect(arm.expectedFactCount).toBe(1);
    expect(arm.recallAtK).toBe(0);
    expect(arm.queryCount).toBe(1);
  });

type EvaluationArm =
  | "baseline_no_memory"
  | "naive_hydration"
  | "guarded_opt_in_consumer";

type EvaluationQuery = RuntimeMemoryHydrationConsumerQuery & {
  expectedFactIds: readonly string[];
};

type ArmEvaluation = {
  arm: EvaluationArm;
  recallAtK: number;
  precision: number;
  staleInvalidSuppressionRate: number;
  candidateRejectedSuppressionRate: number;
  conflictSuppressionRate: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
  latencyOverheadMs: number;
  maxLatencyOverheadMs: number;
  tokenOverhead: number;
  failureNoOpRate: number;
  queryCount: number;
  expectedFactCount: number;
  truePositiveCount: number;
  returnedFactCount: number;
  returnedFactIds: string[];
  staleInvalidCandidateCount: number;
  staleInvalidReturnedCount: number;
  candidateRejectedCandidateCount: number;
  candidateRejectedReturnedCount: number;
  conflictCandidateCount: number;
  conflictReturnedCount: number;
  rawLeakReturnedCount: number;
  promptInjectionReturnedCount: number;
  noOpCount: number;
  rejectionCounts: Record<string, number>;
};

function evaluateArm(params: {
  arm: EvaluationArm;
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[];
  queries: readonly EvaluationQuery[];
  latencyMs: number;
}): ArmEvaluation {
  const perQuery = params.queries.map((queryItem) =>
    returnedFactsForArm(params.arm, params.facts, queryItem)
  );
  const returnedFacts = perQuery.flatMap((entry) => entry.returned);
  const truePositiveCount = sum(perQuery.map((entry) => entry.truePositiveCount));
  const expectedFactCount = sum(
    params.queries.map((queryItem) => queryItem.expectedFactIds.length),
  );
  const staleInvalidCandidateCount = sum(
    perQuery.map((entry) => entry.staleInvalidCandidateCount),
  );
  const staleInvalidReturnedCount = sum(
    perQuery.map((entry) => entry.staleInvalidReturnedCount),
  );
  const candidateRejectedCandidateCount = sum(
    perQuery.map((entry) => entry.candidateRejectedCandidateCount),
  );
  const candidateRejectedReturnedCount = sum(
    perQuery.map((entry) => entry.candidateRejectedReturnedCount),
  );
  const conflictCandidateCount = sum(
    perQuery.map((entry) => entry.conflictCandidateCount),
  );
  const conflictReturnedCount = sum(
    perQuery.map((entry) => entry.conflictReturnedCount),
  );
  const rawLeakReturnedCount = returnedFacts.filter(hasRawLeakSentinel).length;
  const promptInjectionReturnedCount = returnedFacts.filter(
    hasPromptInjectionSentinel,
  ).length;
  const noOpCount = perQuery.filter((entry) => entry.returned.length === 0)
    .length;
  const tokenOverhead = params.arm === "guarded_opt_in_consumer"
    ? sum(perQuery.map((entry) => entry.guardTokens))
    : estimateFactsTokens(returnedFacts);
  const rejectionCounts = mergeRejectionCounts(
    perQuery.map((entry) => entry.rejectionCounts),
  );

  return {
    arm: params.arm,
    recallAtK: expectedFactCount === 0
      ? 1
      : truePositiveCount / expectedFactCount,
    precision: returnedFacts.length === 0
      ? 0
      : truePositiveCount / returnedFacts.length,
    staleInvalidSuppressionRate: suppressionRate(
      staleInvalidCandidateCount,
      staleInvalidReturnedCount,
    ),
    candidateRejectedSuppressionRate: suppressionRate(
      candidateRejectedCandidateCount,
      candidateRejectedReturnedCount,
    ),
    conflictSuppressionRate: suppressionRate(
      conflictCandidateCount,
      conflictReturnedCount,
    ),
    rawLeakRate: returnedFacts.length === 0
      ? 0
      : rawLeakReturnedCount / returnedFacts.length,
    promptInjectionReturnRate: returnedFacts.length === 0
      ? 0
      : promptInjectionReturnedCount / returnedFacts.length,
    latencyOverheadMs: params.arm === "baseline_no_memory" ? 0 : params.latencyMs,
    maxLatencyOverheadMs: params.arm === "baseline_no_memory" ? 0 : params.latencyMs,
    tokenOverhead,
    failureNoOpRate: noOpCount / params.queries.length,
    queryCount: params.queries.length,
    expectedFactCount,
    truePositiveCount,
    returnedFactCount: returnedFacts.length,
    returnedFactIds: returnedFacts.map((fact) => fact.factId),
    staleInvalidCandidateCount,
    staleInvalidReturnedCount,
    candidateRejectedCandidateCount,
    candidateRejectedReturnedCount,
    conflictCandidateCount,
    conflictReturnedCount,
    rawLeakReturnedCount,
    promptInjectionReturnedCount,
    noOpCount,
    rejectionCounts,
  };
}

function returnedFactsForArm(
  arm: EvaluationArm,
  corpus: readonly RuntimeMemoryHydrationShadowFactProjection[],
  queryItem: EvaluationQuery,
): {
  returned: RuntimeMemoryHydrationShadowFactProjection[];
  truePositiveCount: number;
  staleInvalidCandidateCount: number;
  staleInvalidReturnedCount: number;
  candidateRejectedCandidateCount: number;
  candidateRejectedReturnedCount: number;
  conflictCandidateCount: number;
  conflictReturnedCount: number;
  guardTokens: number;
  rejectionCounts: Record<string, number>;
} {
  const matchingCandidates = corpus.filter((fact) => matchesQuery(fact, queryItem));
  const guardedResult = arm === "guarded_opt_in_consumer"
    ? consumeRuntimeMemoryHydrationFacts(corpus, queryItem)
    : undefined;
  const returned = arm === "baseline_no_memory"
    ? []
    : arm === "naive_hydration"
      ? matchingCandidates.slice(0, TOP_K)
      : guardedResult?.acceptedFacts ?? [];
  const returnedIds = new Set(returned.map((fact) => fact.factId));
  const truePositiveCount = queryItem.expectedFactIds.filter((factId) =>
    returnedIds.has(factId)
  ).length;

  return {
    returned,
    truePositiveCount,
    staleInvalidCandidateCount: matchingCandidates.filter((fact) =>
      isStaleOrInvalid(fact, queryItem.referenceTime)
    ).length,
    staleInvalidReturnedCount: returned.filter((fact) =>
      isStaleOrInvalid(fact, queryItem.referenceTime)
    ).length,
    candidateRejectedCandidateCount: matchingCandidates.filter(
      isCandidateRejectedOrVerificationMismatch,
    ).length,
    candidateRejectedReturnedCount: returned.filter(
      isCandidateRejectedOrVerificationMismatch,
    ).length,
    conflictCandidateCount: matchingCandidates.filter(isConflictFact).length,
    conflictReturnedCount: returned.filter(isConflictFact).length,
    guardTokens: guardedResult?.metrics.estimatedTokens ?? 0,
    rejectionCounts: guardedResult?.metrics.rejectionCounts ?? {},
  };
}

function matchesQuery(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
  queryItem: EvaluationQuery,
): boolean {
  return (
    factItem.taskId === queryItem.taskId &&
    factItem.subject === queryItem.subject &&
    factItem.predicate === queryItem.predicate
  );
}

function isStaleOrInvalid(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
  referenceTime: number,
): boolean {
  return (
    factItem.valid_at > referenceTime ||
    (factItem.invalid_at !== undefined && factItem.invalid_at <= referenceTime) ||
    (factItem.expired_at !== undefined && factItem.expired_at <= referenceTime)
  );
}

function isCandidateRejectedOrVerificationMismatch(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return factItem.recordKind !== "fact" ||
    factItem.verificationStatus !== "verified";
}

function isConflictFact(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return factItem.factId.endsWith("_conflict") ||
    factItem.factId === "fact_ref_conflict";
}

function hasPromptInjectionSentinel(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return /\b(ignore|override|bypass)\b[\s\S]{0,80}\b(instructions?|rules?|policy)\b/iu.test(
    JSON.stringify(factItem),
  );
}

function hasRawLeakSentinel(
  factItem: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return /record_json|raw transcript|traceparent|tracestate|baggage|tool args|tool output|process\.env|secret|api[-_ ]?key/iu.test(
    JSON.stringify(factItem),
  );
}

function estimateFactsTokens(
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[],
): number {
  return facts.reduce(
    (total, factItem) => total + Math.ceil(JSON.stringify(factItem).length / 4),
    0,
  );
}

function suppressionRate(candidateCount: number, returnedCount: number): number {
  return candidateCount === 0 ? 1 : 1 - returnedCount / candidateCount;
}

function mergeRejectionCounts(
  counts: readonly Record<string, number>[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const entry of counts) {
    for (const [reason, count] of Object.entries(entry)) {
      merged[reason] = (merged[reason] ?? 0) + count;
    }
  }
  return merged;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function createTempDbPath(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}
