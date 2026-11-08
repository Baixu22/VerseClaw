import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  closeRuntimeMemoryHydrationShadowDatabasesForTest,
  readRuntimeMemoryHydrationShadow,
  type RuntimeMemoryHydrationShadowFactProjection,
} from "../../openclaw_runtime/src/runtime-core";

import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];
const EVALUATION_TIME = 100;

afterEach(() => {
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("runtime memory read hydration shadow opt-in quality evaluation", () => {
  it("keeps the retired shadow read on the skipped path and still evaluates a baseline", () => {
    // The fixture helper writes through the retired store, so it cannot be used
    // here; a fresh temp path still exercises the earlier flag gate.
    const dbPath = createTempDbPath();

    // TF-0500 retired runtime.memory.persist, which readRuntimeMemoryHydrationShadow
    // checks first; an explicit readShadow request cannot reach "loaded" anymore.
    const hydration = readRuntimeMemoryHydrationShadow({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
      limit: 16,
      maxFacts: 16,
      now: () => EVALUATION_TIME,
    });
    expect(hydration.status).toBe("skipped");
    expect(hydration.facts).toHaveLength(0);

    // The pure effect evaluator stays covered: no facts means no memory effect.
    const baseline = evaluateMemoryEffect({
      mode: "baseline",
      facts: [],
      latencyMs: 0,
    });
    expect(baseline).toMatchObject({
      mode: "baseline",
      assessment: "negative_no_memory_effect",
      recallAtK: 0,
      precision: 0,
      staleInvalidFactSuppressionRate: 1,
      promptInjectionRate: 0,
      rawLeakRate: 0,
      failureNoOpRate: 1,
      tokenOverhead: 0,
    });
  });
});

type EvaluationMode = "baseline" | "naive" | "guarded";

type EvaluationResult = {
  mode: EvaluationMode;
  assessment:
    | "negative_no_memory_effect"
    | "negative_without_consumer_guards"
    | "positive_in_mock_corpus_with_required_guards";
  recallAtK: number;
  precision: number;
  staleInvalidFactSuppressionRate: number;
  promptInjectionRate: number;
  rawLeakRate: number;
  latencyOverheadMs: number;
  tokenOverhead: number;
  failureNoOpRate: number;
};

type EvaluationQuery = {
  subject: string;
  predicate: string;
  expectedFactIds: readonly string[];
};

const EVALUATION_QUERIES: readonly EvaluationQuery[] = [
  {
    subject: "RepoPreference",
    predicate: "package_manager",
    expectedFactIds: ["fact_pkg_pnpm"],
  },
  {
    subject: "UserLocale",
    predicate: "reply_language",
    expectedFactIds: ["fact_locale_zh"],
  },
  {
    subject: "BoundaryPolicy",
    predicate: "backend_entrypoint",
    expectedFactIds: ["fact_host_api"],
  },
];

function evaluateMemoryEffect(params: {
  mode: EvaluationMode;
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[];
  latencyMs: number;
}): EvaluationResult {
  const perQuery = EVALUATION_QUERIES.map((query) => {
    const candidates = params.facts.filter(
      (fact) => fact.subject === query.subject && fact.predicate === query.predicate,
    );
    const staleCandidates = candidates.filter(isStaleOrInvalidFact);
    const returned = params.mode === "guarded"
      ? candidates.filter(isGuardedConsumerFact).slice(0, 3)
      : candidates.slice(0, 3);
    const returnedIds = new Set(returned.map((fact) => fact.factId));
    const expected = query.expectedFactIds.filter((factId) => returnedIds.has(factId));
    return {
      returned,
      truePositiveCount: expected.length,
      recall: expected.length / query.expectedFactIds.length,
      staleCandidateCount: staleCandidates.length,
      staleReturnedCount: returned.filter(isStaleOrInvalidFact).length,
    };
  });

  const returnedFacts = perQuery.flatMap((item) => item.returned);
  const truePositiveCount = perQuery.reduce(
    (sum, item) => sum + item.truePositiveCount,
    0,
  );
  const staleCandidateCount = perQuery.reduce(
    (sum, item) => sum + item.staleCandidateCount,
    0,
  );
  const staleReturnedCount = perQuery.reduce(
    (sum, item) => sum + item.staleReturnedCount,
    0,
  );
  const recallAtK =
    perQuery.reduce((sum, item) => sum + item.recall, 0) / perQuery.length;
  const precision =
    returnedFacts.length === 0 ? 0 : truePositiveCount / returnedFacts.length;
  const staleInvalidFactSuppressionRate = staleCandidateCount === 0
    ? 1
    : 1 - staleReturnedCount / staleCandidateCount;
  const promptInjectionRate = returnedFacts.length === 0
    ? 0
    : returnedFacts.filter(hasPromptInjectionText).length / returnedFacts.length;
  const rawLeakRate = returnedFacts.length === 0
    ? 0
    : returnedFacts.filter(hasRawLeakText).length / returnedFacts.length;
  const failureNoOpRate =
    perQuery.filter((item) => item.returned.length === 0).length / perQuery.length;
  const tokenOverhead = returnedFacts.length === 0
    ? 0
    : Math.ceil(JSON.stringify(returnedFacts).length / 4);

  return {
    mode: params.mode,
    assessment: assessmentFor({
      mode: params.mode,
      recallAtK,
      precision,
      staleInvalidFactSuppressionRate,
      promptInjectionRate,
    }),
    recallAtK,
    precision,
    staleInvalidFactSuppressionRate,
    promptInjectionRate,
    rawLeakRate,
    latencyOverheadMs: params.latencyMs,
    tokenOverhead,
    failureNoOpRate,
  };
}

function assessmentFor(params: {
  mode: EvaluationMode;
  recallAtK: number;
  precision: number;
  staleInvalidFactSuppressionRate: number;
  promptInjectionRate: number;
}): EvaluationResult["assessment"] {
  if (params.mode === "baseline") {
    return "negative_no_memory_effect";
  }
  if (
    params.recallAtK === 1 &&
    params.precision === 1 &&
    params.staleInvalidFactSuppressionRate === 1 &&
    params.promptInjectionRate === 0
  ) {
    return "positive_in_mock_corpus_with_required_guards";
  }
  return "negative_without_consumer_guards";
}

function isGuardedConsumerFact(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return (
    fact.recordKind === "fact" &&
    fact.verificationStatus === "verified" &&
    !isStaleOrInvalidFact(fact) &&
    !hasPromptInjectionText(fact) &&
    !hasRawLeakText(fact)
  );
}

function isStaleOrInvalidFact(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return (
    fact.valid_at > EVALUATION_TIME ||
    (fact.invalid_at !== undefined && fact.invalid_at <= EVALUATION_TIME) ||
    (fact.expired_at !== undefined && fact.expired_at <= EVALUATION_TIME)
  );
}

function hasPromptInjectionText(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return /\b(ignore|override|bypass)\b.*\b(instructions?|rules?|policy)\b/iu.test(
    fact.objectSummary,
  );
}

function hasRawLeakText(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return /record_json|raw transcript|traceparent|tracestate|baggage|tool args|tool output|process\.env|secret/iu.test(
    JSON.stringify(fact),
  );
}

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-opt-in-eval-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}
