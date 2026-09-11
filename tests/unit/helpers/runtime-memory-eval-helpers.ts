// Shared helpers for runtime-memory evaluation tests.
// Pure functions only — no vitest imports. Threshold assertions accept
// an assert callback so the helper stays test-framework agnostic.

import { mkdtempSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvidenceRefFixture,
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  consumeRuntimeMemoryHydrationFacts,
  type RuntimeMemoryHydrationConsumerQuery,
  type RuntimeMemoryHydrationShadowFactProjection,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryVerificationStatus,
} from "../../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../../openclaw_runtime/src/runtime-core/memory-persistence";

export const RUNTIME_MEMORY_EVAL_FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/runtime-memory-benefit-eval", import.meta.url),
);

export const RUNTIME_MEMORY_EVAL_CONFIG = {
  runtime: { memory: { persist: true } },
} as const;

// === Types ===

export type FactLabel =
  | "useful"
  | "stale"
  | "invalid"
  | "future"
  | "candidate"
  | "rejected"
  | "conflict"
  | "prompt_injection"
  | "raw_leak"
  | "distractor";

export type LoadedFact = {
  factId: string;
  taskId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  recordKind: "fact" | "candidate";
  verificationStatus: string;
  valid_at: number;
  invalid_at?: number;
  expired_at?: number;
  reference_time: number;
  confidence: number;
  source: string;
  sourceEpisodeRefs: ReadonlyArray<Record<string, unknown>>;
  evidenceRefs: ReadonlyArray<Record<string, unknown>>;
  labels: FactLabel[];
  scenarioId: string;
  category: string;
  groupId: string;
  memoryRelevant: boolean;
};

export type LoadedQuery = RuntimeMemoryHydrationConsumerQuery & {
  queryId: string;
  expectedFactIds: string[];
  mustRejectFactIds: string[];
  scenarioId: string;
  category: string;
  memoryRelevant: boolean;
};

export type Arm = "baseline" | "naiveMemory" | "guardedMemory";

export type ExpectedMetrics = {
  thresholds: Record<string, { min?: number; max?: number }>;
  expected: Record<string, number>;
  corpus: {
    provenance: string;
    sanitized: boolean;
    noUserRealData: boolean;
    reproducible: boolean;
    referenceTime: number;
    memoryDependentGroups: number;
    memoryIrrelevantGroups: number;
    auditRefs: string[];
  };
};

export const HAZARD_LABELS: ReadonlySet<FactLabel> = new Set([
  "prompt_injection",
  "raw_leak",
]);

export const UNSAFE_LABELS: ReadonlySet<FactLabel> = new Set([
  "stale",
  "invalid",
  "future",
  "candidate",
  "rejected",
  "conflict",
  "prompt_injection",
  "raw_leak",
  "distractor",
]);

// === Fixture loading ===

export function readJson<T>(name: string): T {
  const raw = readFileSync(path.join(RUNTIME_MEMORY_EVAL_FIXTURE_DIR, name), "utf8");
  return JSON.parse(raw) as T;
}

export function loadEvalFixtures(): {
  facts: LoadedFact[];
  queries: LoadedQuery[];
  scenarios: Array<{ arm: Arm; description: string; usesMemory: boolean; guarded: boolean }>;
  expectedMetrics: ExpectedMetrics;
  corpus: RuntimeMemoryHydrationShadowFactProjection[];
  labelByFactId: Map<string, FactLabel>;
  factById: Map<string, LoadedFact>;
} {
  const facts = readJson<LoadedFact[]>("facts.json");
  const queries = readJson<LoadedQuery[]>("queries.json");
  const scenarios = readJson<
    Array<{ arm: Arm; description: string; usesMemory: boolean; guarded: boolean }>
  >("scenarios.json");
  const expectedMetrics = readJson<ExpectedMetrics>("expected-metrics.json");

  const corpus = facts.map(toProjection);
  const labelByFactId = new Map<string, FactLabel>(
    facts.map((fact) => [fact.factId, fact.labels[0]]),
  );
  const factById = new Map<string, LoadedFact>(facts.map((fact) => [fact.factId, fact]));

  return { facts, queries, scenarios, expectedMetrics, corpus, labelByFactId, factById };
}

// === Temp DB ===

export function createTempDbPath(prefix: string, tracker: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tracker.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

export function seedTempDb(
  dbPath: string,
  groups: ReadonlyArray<{ groupId: string; facts: LoadedFact[] }>,
): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => 1_000,
  });
  if (persistence.migrate().status !== "migrated") {
    throw new Error(`seedTempDb: migration failed for ${dbPath}`);
  }
  for (const group of groups) {
    const firstFact = group.facts[0];
    persistence.appendEpisode(
      buildRuntimeMemoryEpisodeFixture({
        episodeId: `episode_${group.groupId}`,
        taskId: firstFact.taskId,
        kind: "verifier_summary",
        reference_time: firstFact.reference_time,
        idempotencyKey: `${group.groupId}:verifier:summary`,
        boundedSummary: `Sanitized Phase 35 benefit evaluation fixture evidence for ${group.groupId}.`,
        sourceRefs: [
          {
            type: "test",
            ref: "tests/fixtures/runtime-memory-benefit-eval/facts.json",
          },
        ],
        evidenceRefs: [
          {
            type: "test",
            ref: "tests/fixtures/runtime-memory-benefit-eval/facts.json",
          },
        ],
      }),
    );
  }
  for (const group of groups) {
    for (const fact of group.facts) {
      if (fact.labels.includes("raw_leak") || fact.labels.includes("prompt_injection")) {
        continue;
      }
      const record = toPersistenceRecord(fact);
      const result = persistence.appendFact(record);
      if (result.status !== "persisted") {
        throw new Error(`seedTempDb: appendFact failed for ${fact.factId}`);
      }
    }
  }
}

export function toPersistenceRecord(
  fact: LoadedFact,
): RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate {
  const common = {
    factId: fact.factId,
    taskId: fact.taskId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: fact.confidence,
    source: fact.source,
    valid_at: fact.valid_at,
    reference_time: fact.reference_time,
    sourceEpisodeRefs: [...fact.sourceEpisodeRefs],
    evidenceRefs: [...fact.evidenceRefs],
    ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
    ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
  };
  const acceptedStatuses: ReadonlySet<string> = new Set([
    "verified",
    "human_approved",
    "deterministic_rule",
  ]);
  if (fact.recordKind === "fact" && acceptedStatuses.has(fact.verificationStatus)) {
    return buildRuntimeMemoryTemporalFactFixture(common as never);
  }
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    ...common,
    verificationStatus: fact.verificationStatus as RuntimeMemoryVerificationStatus,
  } as never);
}

export function toProjection(
  fact: LoadedFact,
): RuntimeMemoryHydrationShadowFactProjection {
  return {
    factId: fact.factId,
    recordKind: fact.recordKind,
    taskId: fact.taskId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: fact.confidence,
    source: fact.source,
    verificationStatus: fact.verificationStatus,
    valid_at: fact.valid_at,
    ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
    ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
    reference_time: fact.reference_time,
    sourceEpisodeRefs: fact.sourceEpisodeRefs,
    evidenceRefs: fact.evidenceRefs,
  };
}

export function pickMemoryDependentGroups(
  count: number,
  facts: readonly LoadedFact[],
): Array<{ groupId: string; facts: LoadedFact[] }> {
  const groups: Array<{ groupId: string; facts: LoadedFact[] }> = [];
  for (const fact of facts) {
    if (!fact.memoryRelevant) continue;
    if (groups.some((group) => group.groupId === fact.groupId)) continue;
    const groupFacts = facts.filter((entry) => entry.groupId === fact.groupId);
    groups.push({ groupId: fact.groupId, facts: groupFacts });
    if (groups.length >= count) break;
  }
  return groups;
}

// Filter queries to only include those whose expectedFactIds are all present
// in the seeded groups. Without this, queries referencing unseeded facts
// produce recall=0, diluting meanUtility and weakening Cohen's d.
export function filterQueriesBySeededGroups(
  queries: readonly LoadedQuery[],
  groups: ReadonlyArray<{ groupId: string; facts: LoadedFact[] }>,
): LoadedQuery[] {
  const seededFactIds = new Set<string>();
  for (const group of groups) {
    for (const fact of group.facts) {
      seededFactIds.add(fact.factId);
    }
  }
  return queries.filter(
    (q) =>
      q.memoryRelevant &&
      q.expectedFactIds.length > 0 &&
      q.expectedFactIds.every((id) => seededFactIds.has(id)),
  );
}

// === 3-arm evaluation ===

export type EvaluationReport = {
  baselineRecallAtK: number;
  naiveRecallAtK: number;
  guardedRecallAtK: number;
  naivePrecision: number;
  guardedPrecision: number;
  staleInvalidSuppressionRate: number;
  candidateRejectedSuppressionRate: number;
  conflictSuppressionRate: number;
  taskSubjectPredicateIsolationRate: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
  wrongConflictWinnerRate: number;
  emptyNoOpSafetyRate: number;
  baselineTaskSuccessRate: number;
  naiveMemoryTaskSuccessRate: number;
  guardedMemoryTaskSuccessRate: number;
  baselineMemoryIrrelevantSuccessRate: number;
  guardedMemoryIrrelevantSuccessRate: number;
  baselineMemoryDependentSuccessRate: number;
  guardedMemoryDependentSuccessRate: number;
  guardedVsBaselineLiftMemoryDependent: number;
  guardedMemoryIrrelevantReductionVsBaseline: number;
  guardedVsNaiveHazardReduction: number;
  tokenOverheadP50: number;
  tokenOverheadP95: number;
  pureConsumerLatencyP50Ms: number;
  pureConsumerLatencyP95Ms: number;
  guardedReturnedUnsafeLabelCount: number;
  guardedReturnedHazardCount: number;
  guardedReturnedMustRejectCount: number;
  guardedReturnedDistractorCount: number;
  naiveReturnedUnsafeLabelCount: number;
  naiveReturnedHazardCount: number;
  naiveReturnedMustRejectCount: number;
};

export type QueryEvaluation = {
  query: LoadedQuery;
  baseline: ArmResult;
  naive: ArmResult;
  guarded: ArmResult;
  staleInvalidCandidateCount: number;
  candidateRejectedCandidateCount: number;
  conflictCandidateCount: number;
  distractorCandidateCount: number;
  guardedStaleInvalidReturned: number;
  guardedCandidateRejectedReturned: number;
  guardedConflictReturned: number;
  guardedDistractorReturned: number;
  guardedHazardReturned: number;
  naiveHazardReturned: number;
  guardedUnsafeReturned: number;
  naiveUnsafeReturned: number;
  guardedMustRejectReturned: number;
  naiveMustRejectReturned: number;
  wrongConflictWinner: number;
  guardedTokenOverhead: number;
  guardedLatencyMs: number;
};

export type ArmResult = {
  returned: RuntimeMemoryHydrationShadowFactProjection[];
  returnedCount: number;
  truePositiveCount: number;
  violationCount: number;
  success: number;
};

export function evaluate(
  evalCorpus: readonly RuntimeMemoryHydrationShadowFactProjection[],
  evalQueries: readonly LoadedQuery[],
  labelByFactId: Map<string, FactLabel>,
): EvaluationReport {
  const perQuery = evalQueries.map((query) => evaluateQuery(evalCorpus, query, labelByFactId));

  const memoryDependent = perQuery.filter((entry) => entry.query.memoryRelevant);
  const memoryIrrelevant = perQuery.filter((entry) => !entry.query.memoryRelevant);

  const baselineTruePositives = sum(perQuery.map((entry) => entry.baseline.truePositiveCount));
  const naiveTruePositives = sum(perQuery.map((entry) => entry.naive.truePositiveCount));
  const guardedTruePositives = sum(perQuery.map((entry) => entry.guarded.truePositiveCount));
  const expectedTotal = sum(perQuery.map((entry) => entry.query.expectedFactIds.length));
  const baselineReturned = sum(perQuery.map((entry) => entry.baseline.returnedCount));
  void baselineReturned;
  const naiveReturned = sum(perQuery.map((entry) => entry.naive.returnedCount));
  const guardedReturned = sum(perQuery.map((entry) => entry.guarded.returnedCount));

  const staleInvalidCandidates = sum(perQuery.map((entry) => entry.staleInvalidCandidateCount));
  const staleInvalidReturned = sum(perQuery.map((entry) => entry.guardedStaleInvalidReturned));
  const candidateRejectedCandidates = sum(
    perQuery.map((entry) => entry.candidateRejectedCandidateCount),
  );
  const candidateRejectedReturned = sum(
    perQuery.map((entry) => entry.guardedCandidateRejectedReturned),
  );
  const conflictCandidates = sum(perQuery.map((entry) => entry.conflictCandidateCount));
  const conflictReturned = sum(perQuery.map((entry) => entry.guardedConflictReturned));
  const distractorCandidates = sum(perQuery.map((entry) => entry.distractorCandidateCount));
  void distractorCandidates;
  const distractorReturned = sum(perQuery.map((entry) => entry.guardedDistractorReturned));

  const guardedHazardReturned = sum(perQuery.map((entry) => entry.guardedHazardReturned));
  const naiveHazardReturned = sum(perQuery.map((entry) => entry.naiveHazardReturned));
  const guardedUnsafeReturned = sum(perQuery.map((entry) => entry.guardedUnsafeReturned));
  const naiveUnsafeReturned = sum(perQuery.map((entry) => entry.naiveUnsafeReturned));
  const guardedMustRejectReturned = sum(
    perQuery.map((entry) => entry.guardedMustRejectReturned),
  );
  const naiveMustRejectReturned = sum(perQuery.map((entry) => entry.naiveMustRejectReturned));

  const wrongConflictWinners = sum(perQuery.map((entry) => entry.wrongConflictWinner));

  const emptySafe = memoryIrrelevant.filter((entry) =>
    entry.guarded.returnedCount === 0 && entry.guarded.violationCount === 0
  ).length;

  const baselineSuccesses = sum(perQuery.map((entry) => entry.baseline.success));
  const naiveSuccesses = sum(perQuery.map((entry) => entry.naive.success));
  const guardedSuccesses = sum(perQuery.map((entry) => entry.guarded.success));
  const baselineIrrelevantSuccesses = sum(
    memoryIrrelevant.map((entry) => entry.baseline.success),
  );
  const guardedIrrelevantSuccesses = sum(
    memoryIrrelevant.map((entry) => entry.guarded.success),
  );
  const baselineDependentSuccesses = sum(
    memoryDependent.map((entry) => entry.baseline.success),
  );
  const guardedDependentSuccesses = sum(
    memoryDependent.map((entry) => entry.guarded.success),
  );

  const tokenSamples = perQuery.map((entry) => entry.guardedTokenOverhead);
  const latencySamples = perQuery.map((entry) => entry.guardedLatencyMs);

  const naiveHazardRate = naiveReturned === 0 ? 0 : naiveUnsafeReturned / naiveReturned;
  const guardedHazardRate = guardedReturned === 0 ? 0 : guardedUnsafeReturned / guardedReturned;
  const hazardReduction = naiveHazardRate === 0
    ? 1
    : 1 - guardedHazardRate / naiveHazardRate;

  const baselineDependentRate = memoryDependent.length === 0
    ? 0
    : baselineDependentSuccesses / memoryDependent.length;
  const guardedDependentRate = memoryDependent.length === 0
    ? 0
    : guardedDependentSuccesses / memoryDependent.length;

  return {
    baselineRecallAtK: expectedTotal === 0 ? 1 : baselineTruePositives / expectedTotal,
    naiveRecallAtK: expectedTotal === 0 ? 1 : naiveTruePositives / expectedTotal,
    guardedRecallAtK: expectedTotal === 0 ? 1 : guardedTruePositives / expectedTotal,
    naivePrecision: naiveReturned === 0 ? 0 : naiveTruePositives / naiveReturned,
    guardedPrecision: guardedReturned === 0 ? 0 : guardedTruePositives / guardedReturned,
    staleInvalidSuppressionRate: suppressionRate(staleInvalidCandidates, staleInvalidReturned),
    candidateRejectedSuppressionRate: suppressionRate(
      candidateRejectedCandidates,
      candidateRejectedReturned,
    ),
    conflictSuppressionRate: suppressionRate(conflictCandidates, conflictReturned),
    taskSubjectPredicateIsolationRate: guardedReturned === 0
      ? 1
      : 1 - distractorReturned / guardedReturned,
    rawLeakRate: guardedReturned === 0 ? 0 : guardedHazardReturned / guardedReturned,
    promptInjectionReturnRate: guardedReturned === 0
      ? 0
      : guardedHazardReturned / guardedReturned,
    wrongConflictWinnerRate: conflictCandidates === 0
      ? 0
      : wrongConflictWinners / conflictCandidates,
    emptyNoOpSafetyRate: memoryIrrelevant.length === 0
      ? 1
      : emptySafe / memoryIrrelevant.length,
    baselineTaskSuccessRate: rate(baselineSuccesses, perQuery.length),
    naiveMemoryTaskSuccessRate: rate(naiveSuccesses, perQuery.length),
    guardedMemoryTaskSuccessRate: rate(guardedSuccesses, perQuery.length),
    baselineMemoryIrrelevantSuccessRate: rate(baselineIrrelevantSuccesses, memoryIrrelevant.length),
    guardedMemoryIrrelevantSuccessRate: rate(guardedIrrelevantSuccesses, memoryIrrelevant.length),
    baselineMemoryDependentSuccessRate: baselineDependentRate,
    guardedMemoryDependentSuccessRate: guardedDependentRate,
    guardedVsBaselineLiftMemoryDependent: guardedDependentRate - baselineDependentRate,
    guardedMemoryIrrelevantReductionVsBaseline:
      baselineIrrelevantSuccesses / Math.max(memoryIrrelevant.length, 1) -
      guardedIrrelevantSuccesses / Math.max(memoryIrrelevant.length, 1),
    guardedVsNaiveHazardReduction: hazardReduction,
    tokenOverheadP50: percentile(tokenSamples, 0.5),
    tokenOverheadP95: percentile(tokenSamples, 0.95),
    pureConsumerLatencyP50Ms: percentile(latencySamples, 0.5),
    pureConsumerLatencyP95Ms: percentile(latencySamples, 0.95),
    guardedReturnedUnsafeLabelCount: guardedUnsafeReturned,
    guardedReturnedHazardCount: guardedHazardReturned,
    guardedReturnedMustRejectCount: guardedMustRejectReturned,
    guardedReturnedDistractorCount: distractorReturned,
    naiveReturnedUnsafeLabelCount: naiveUnsafeReturned,
    naiveReturnedHazardCount: naiveHazardReturned,
    naiveReturnedMustRejectCount: naiveMustRejectReturned,
  };
}

function evaluateQuery(
  evalCorpus: readonly RuntimeMemoryHydrationShadowFactProjection[],
  query: LoadedQuery,
  labelByFactId: Map<string, FactLabel>,
): QueryEvaluation {
  const baselineReturned: RuntimeMemoryHydrationShadowFactProjection[] = [];
  const naiveReturned = naiveArm(evalCorpus, query);
  const guardedStartedAt = performance.now();
  const guardedResult = consumeRuntimeMemoryHydrationFacts(evalCorpus, query);
  const guardedLatencyMs = performance.now() - guardedStartedAt;
  const guardedReturned = guardedResult.acceptedFacts;

  const matching = evalCorpus.filter((fact) => matchesKey(fact, query));
  const staleInvalidCandidateCount = matching.filter((fact) =>
    isStaleInvalidFuture(fact, query.referenceTime)
  ).length;
  const candidateRejectedCandidateCount = matching.filter((fact) =>
    isCandidateRejected(fact)
  ).length;
  const conflictCandidateCount = matching.filter((fact) =>
    isConflictCandidate(fact, query.referenceTime, labelByFactId)
  ).length;
  const distractorCandidateCount = evalCorpus.filter((fact) =>
    isDistractor(fact, query)
  ).length;

  return {
    query,
    baseline: armResult(baselineReturned, query, labelByFactId),
    naive: armResult(naiveReturned, query, labelByFactId),
    guarded: armResult(guardedReturned, query, labelByFactId),
    staleInvalidCandidateCount,
    candidateRejectedCandidateCount,
    conflictCandidateCount,
    distractorCandidateCount,
    guardedStaleInvalidReturned: guardedReturned.filter((fact) =>
      isStaleInvalidFuture(fact, query.referenceTime)
    ).length,
    guardedCandidateRejectedReturned: guardedReturned.filter(isCandidateRejected).length,
    guardedConflictReturned: guardedReturned.filter((fact) =>
      isConflictCandidate(fact, query.referenceTime, labelByFactId)
    ).length,
    guardedDistractorReturned: guardedReturned.filter((fact) => isDistractor(fact, query))
      .length,
    guardedHazardReturned: guardedReturned.filter((fact) => hasHazardLabel(fact, labelByFactId)).length,
    naiveHazardReturned: naiveReturned.filter((fact) => hasHazardLabel(fact, labelByFactId)).length,
    guardedUnsafeReturned: guardedReturned.filter((fact) => hasUnsafeLabel(fact, labelByFactId)).length,
    naiveUnsafeReturned: naiveReturned.filter((fact) => hasUnsafeLabel(fact, labelByFactId)).length,
    guardedMustRejectReturned: guardedReturned.filter((fact) =>
      query.mustRejectFactIds.includes(fact.factId)
    ).length,
    naiveMustRejectReturned: naiveReturned.filter((fact) =>
      query.mustRejectFactIds.includes(fact.factId)
    ).length,
    wrongConflictWinner: wrongConflictWinner(query, guardedReturned),
    guardedTokenOverhead: guardedResult.metrics.estimatedTokens,
    guardedLatencyMs,
  };
}

function armResult(
  returned: readonly RuntimeMemoryHydrationShadowFactProjection[],
  query: LoadedQuery,
  labelByFactId: Map<string, FactLabel>,
): ArmResult {
  const returnedIds = new Set(returned.map((fact) => fact.factId));
  const truePositiveCount = query.expectedFactIds.filter((factId) =>
    returnedIds.has(factId)
  ).length;
  const violationCount = returned.filter((fact) =>
    query.mustRejectFactIds.includes(fact.factId) || hasUnsafeLabel(fact, labelByFactId)
  ).length;
  const hasAllExpected = query.expectedFactIds.every((factId) =>
    returnedIds.has(factId)
  );
  const success = hasAllExpected && violationCount === 0 ? 1 : 0;
  return {
    returned: [...returned],
    returnedCount: returned.length,
    truePositiveCount,
    violationCount,
    success,
  };
}

function naiveArm(
  evalCorpus: readonly RuntimeMemoryHydrationShadowFactProjection[],
  query: LoadedQuery,
): RuntimeMemoryHydrationShadowFactProjection[] {
  return evalCorpus
    .filter((fact) => matchesKey(fact, query))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, query.limit ?? 8);
}

function wrongConflictWinner(
  query: LoadedQuery,
  guardedReturned: readonly RuntimeMemoryHydrationShadowFactProjection[],
): number {
  if (query.expectedFactIds.length === 0) return 0;
  const returnedIds = new Set(guardedReturned.map((fact) => fact.factId));
  const hasExpectedWinner = query.expectedFactIds.every((factId) =>
    returnedIds.has(factId)
  );
  const hasExtraWinners = guardedReturned.some((fact) =>
    !query.expectedFactIds.includes(fact.factId)
  );
  return hasExpectedWinner && !hasExtraWinners ? 0 : 1;
}

function matchesKey(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  query: LoadedQuery,
): boolean {
  return (
    fact.taskId === query.taskId &&
    fact.subject === query.subject &&
    fact.predicate === query.predicate
  );
}

function isStaleInvalidFuture(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  referenceTime: number,
): boolean {
  return (
    fact.valid_at > referenceTime ||
    (fact.invalid_at !== undefined && fact.invalid_at <= referenceTime) ||
    (fact.expired_at !== undefined && fact.expired_at <= referenceTime)
  );
}

function isCandidateRejected(fact: RuntimeMemoryHydrationShadowFactProjection): boolean {
  return fact.recordKind !== "fact" || fact.verificationStatus !== "verified";
}

function isConflictCandidate(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  referenceTime: number,
  labelByFactId: Map<string, FactLabel>,
): boolean {
  return (
    fact.recordKind === "fact" &&
    fact.verificationStatus === "verified" &&
    !isStaleInvalidFuture(fact, referenceTime) &&
    labelByFactId.get(fact.factId) === "conflict"
  );
}

function isDistractor(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  query: LoadedQuery,
): boolean {
  return (
    fact.taskId !== query.taskId ||
    fact.subject !== query.subject ||
    fact.predicate !== query.predicate
  );
}

function hasHazardLabel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  labelByFactId: Map<string, FactLabel>,
): boolean {
  const label = labelByFactId.get(fact.factId);
  return label !== undefined && HAZARD_LABELS.has(label);
}

function hasUnsafeLabel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  labelByFactId: Map<string, FactLabel>,
): boolean {
  const label = labelByFactId.get(fact.factId);
  return label !== undefined && UNSAFE_LABELS.has(label);
}

// === Threshold assertion (callback-based, framework agnostic) ===

export type ThresholdAssert = {
  ge: (value: number, min: number, message: string) => void;
  le: (value: number, max: number, message: string) => void;
};

export function expectThreshold(
  report: EvaluationReport,
  key: keyof EvaluationReport & string,
  expectedMetrics: ExpectedMetrics,
  assert: ThresholdAssert,
): void {
  const threshold = expectedMetrics.thresholds[key];
  const value = report[key] as number;
  if (!threshold) return;
  if (threshold.min !== undefined) {
    assert.ge(value, threshold.min, `${key} >= ${threshold.min}`);
  }
  if (threshold.max !== undefined) {
    assert.le(value, threshold.max, `${key} <= ${threshold.max}`);
  }
}

// === Utilities ===

export function suppressionRate(candidateCount: number, returnedCount: number): number {
  return candidateCount === 0 ? 1 : 1 - returnedCount / candidateCount;
}

export function rate(successes: number, total: number): number {
  return total === 0 ? 1 : successes / total;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[rank];
}

// === Phase 36 enhanced evaluation helpers ===

// Append a single fact to an existing SQLite DB at runtime.
// Used by temporal-evolution and chain-eval to write facts mid-run.
export function appendFactToDb(dbPath: string, fact: RuntimeMemoryTemporalFact): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => fact.acceptedAt,
  });
  const result = persistence.appendFact(fact);
  if (result.status !== "persisted") {
    throw new Error(`appendFactToDb: appendFact failed for ${fact.factId} (status=${result.status})`);
  }
}

// Mark an existing fact as invalidated in the DB.
// Used by temporal-evolution to test invalidation semantics.
export function invalidateFactInDb(
  dbPath: string,
  factId: string,
  invalidAt: number,
): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: () => invalidAt,
  });
  const proposal = buildRuntimeMemoryInvalidationProposalFixture({
    invalidationId: `invalidation_${factId}_${invalidAt}`,
    factId,
    reason: "superseded",
    invalid_at: invalidAt,
    reference_time: invalidAt,
    proposedBy: "verifier_summary",
    verificationStatus: "invalidated",
    replacementFactId: undefined,
    evidenceRefs: [
      buildEvidenceRefFixture({
        type: "test",
        ref: "tests/unit/helpers/runtime-memory-eval-helpers.ts",
      }),
    ],
  });
  const result = persistence.invalidateFact(proposal);
  if (result.status !== "persisted") {
    throw new Error(`invalidateFactInDb: invalidateFact failed for ${factId} (status=${result.status})`);
  }
}

// Build a RuntimeMemoryTemporalFact from a concise spec.
// Centralizes valid_at/invalid_at/expired_at/reference_time handling for
// temporal-evolution, chain-eval, and budget-pressure scenarios.
export function buildTemporalFactFromSpec(spec: {
  factId: string;
  taskId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  validAt: number;
  invalidAt?: number;
  expiredAt?: number;
  referenceTime?: number;
  confidence?: number;
}): RuntimeMemoryTemporalFact {
  const referenceTime = spec.referenceTime ?? spec.validAt;
  return buildRuntimeMemoryTemporalFactFixture({
    factId: spec.factId,
    taskId: spec.taskId,
    subject: spec.subject,
    predicate: spec.predicate,
    objectSummary: spec.objectSummary,
    confidence: spec.confidence ?? 0.9,
    valid_at: spec.validAt,
    reference_time: referenceTime,
    ...(spec.invalidAt !== undefined ? { invalid_at: spec.invalidAt } : {}),
    ...(spec.expiredAt !== undefined ? { expired_at: spec.expiredAt } : {}),
  });
}

// Convert a RuntimeMemoryTemporalFact to a ShadowFactProjection.
// Used by chain-eval and budget-pressure to build expected projections
// for direct comparison against diagnostics output.
export function toProjectionFromLite(
  fact: RuntimeMemoryTemporalFact,
): RuntimeMemoryHydrationShadowFactProjection {
  return {
    factId: fact.factId,
    recordKind: "fact",
    taskId: fact.taskId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: fact.confidence,
    source: fact.source,
    verificationStatus: fact.verificationStatus,
    valid_at: fact.valid_at,
    ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
    ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
    reference_time: fact.reference_time,
    sourceEpisodeRefs: fact.sourceEpisodeRefs,
    evidenceRefs: fact.evidenceRefs,
  };
}

// === Phase 37 helpers ===

// Insert a raw fact row directly into the SQLite DB, bypassing persistence
// sanitization. Used by hazard-sentinel-eval to seed hazard text that the
// persistence layer would reject, testing the consumer's defense-in-depth
// sentinel paths.
export async function appendRawFactRowToDb(
  dbPath: string,
  fields: {
    factId: string;
    taskId: string;
    subject: string;
    predicate: string;
    objectSummary: string;
    confidence: number;
    source: string;
    verificationStatus: string;
    validAt: number;
    referenceTime: number;
  },
): Promise<void> {
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO runtime_memory_facts (
        fact_id, record_kind, task_id, subject, predicate, object_summary,
        confidence, source, verification_status, valid_at, invalid_at, expired_at,
        reference_time, source_episode_refs_json, evidence_refs_json, metadata_json,
        proposed_at, accepted_at, promotion_json, record_json, schema_version,
        created_at, updated_at
      ) VALUES (
        ?, 'fact', ?, ?, ?, ?,
        ?, ?, ?, ?, NULL, NULL,
        ?, '[]', '[]', NULL,
        NULL, ?, NULL, '{}', 1,
        ?, ?
      )
    `);
    stmt.run(
      fields.factId,
      fields.taskId,
      fields.subject,
      fields.predicate,
      fields.objectSummary,
      fields.confidence,
      fields.source,
      fields.verificationStatus,
      fields.validAt,
      fields.referenceTime,
      fields.referenceTime,
      now,
      now,
    );
  } finally {
    db.close();
  }
}
