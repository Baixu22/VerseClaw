import { createHash } from "node:crypto";
import type {
  OfflineRetrievalEvaluationV1,
  RetrievalPolicyV1,
} from "../../../../shared/knowledge/observability.js";
import type { RetrievalProfile } from "../../../../shared/knowledge/retrieval.js";

export const RETRIEVAL_PROFILES = Object.freeze({
  local: Object.freeze({
    candidateK: 40,
    rerankK: 0,
    finalK: 4,
    maxTokens: 1200,
    maxChars: 3200,
    deadlineMs: 900,
    maxQueries: 1,
    maxModelCalls: 0,
  }),
  quality: Object.freeze({
    candidateK: 80,
    rerankK: 30,
    finalK: 6,
    maxTokens: 2200,
    maxChars: 6000,
    deadlineMs: 2500,
    maxQueries: 1,
    maxModelCalls: 0,
  }),
  research: Object.freeze({
    candidateK: 120,
    rerankK: 60,
    finalK: 12,
    maxTokens: 5000,
    maxChars: 15000,
    deadlineMs: 30000,
    maxQueries: 8,
    maxModelCalls: 2,
  }),
} as const);

const limits = RETRIEVAL_PROFILES;

export function defaultRetrievalPolicy(profile: RetrievalProfile): RetrievalPolicyV1 {
  if (!Object.hasOwn(limits, profile)) throw new Error("Invalid retrieval policy profile");
  return {
    schema: "RetrievalPolicy/v1",
    version: "project-rag-rrf/v2",
    profile,
    rrfK: 60,
    candidateK: limits[profile].candidateK,
    rerankK: limits[profile].rerankK,
    finalK: limits[profile].finalK,
    maxPerParent: 2,
  };
}

export function normalizeRetrievalPolicy(input: unknown): RetrievalPolicyV1 {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid retrieval policy");
  const value = input as Record<string, unknown>;
  const keys = [
    "schema",
    "version",
    "profile",
    "rrfK",
    "candidateK",
    "rerankK",
    "finalK",
    "maxPerParent",
  ];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schema !== "RetrievalPolicy/v1" ||
    typeof value.version !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value.version) ||
    typeof value.profile !== "string" ||
    !Object.hasOwn(limits, value.profile)
  )
    throw new Error("Invalid retrieval policy identity");
  const profile = value.profile as RetrievalProfile;
  const cap = limits[profile];
  for (const [key, min, max] of [
    ["rrfK", 1, 1000],
    ["candidateK", 1, cap.candidateK],
    ["rerankK", 0, cap.rerankK],
    ["finalK", 1, cap.finalK],
    ["maxPerParent", 1, 2],
  ] as const) {
    const amount = value[key];
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < min || amount > max)
      throw new Error(`Retrieval policy exceeds the frozen ${key} budget`);
  }
  if (
    (value.finalK as number) > (value.candidateK as number) ||
    (value.rerankK as number) > (value.candidateK as number)
  )
    throw new Error("Inconsistent retrieval policy budgets");
  return {
    schema: "RetrievalPolicy/v1",
    version: value.version,
    profile,
    rrfK: value.rrfK as number,
    candidateK: value.candidateK as number,
    rerankK: value.rerankK as number,
    finalK: value.finalK as number,
    maxPerParent: value.maxPerParent as number,
  };
}

export function retrievalPolicyDigest(policy: RetrievalPolicyV1): string {
  return (
    "sha256:" +
    createHash("sha256")
      .update(JSON.stringify(normalizeRetrievalPolicy(policy)))
      .digest("hex")
  );
}

/** Frozen RAG evaluation thresholds; missing measurements cannot authorize promotion. */
export function evaluateOfflineRetrievalPromotion(
  candidate: RetrievalPolicyV1,
  previous: RetrievalPolicyV1,
  input: OfflineRetrievalEvaluationV1,
): string[] {
  const reasons: string[] = [];
  const digest = (value: unknown) =>
    typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const positiveInterval = (value: unknown, mean: unknown) =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(finite) &&
    finite(mean) &&
    value[0] > 0 &&
    value[0] <= mean &&
    mean <= value[1];
  if (!input || input.schema !== "OfflineRetrievalEvaluation/v1" || input.driven_by !== "agent")
    return ["invalid-evaluation-schema"];
  if (
    candidate.profile !== previous.profile ||
    input.profile !== candidate.profile ||
    input.candidateDigest !== retrievalPolicyDigest(candidate) ||
    input.baselineDigest !== retrievalPolicyDigest(previous)
  )
    reasons.push("policy-binding-mismatch");
  if (
    ![input.corpusDigest, input.reportDigest, input.calibrationDigest].every(digest) ||
    !/^[a-f0-9]{40}$/.test(input.candidateCommit) ||
    !Number.isSafeInteger(input.sealedAt) ||
    input.sealedAt <= 0
  )
    reasons.push("unsealed-evaluation");
  if (
    input.queryCount !== 240 ||
    input.taskCount < 60 ||
    input.taskCount % 60 !== 0 ||
    input.repeats !== 3 ||
    JSON.stringify(input.arms) !== '["off","page","full"]' ||
    input.taskSlots !== input.taskCount * 9 ||
    input.missingSlots !== 0
  )
    reasons.push("incomplete-frozen-cohort");
  if (input.unknownUsageSlots !== 0) reasons.push("unknown-usage");
  if (input.safetyViolations !== 0 || input.exactRefPrecision !== 1)
    reasons.push("safety-or-source-precision-regression");
  if (
    !finite(input.ndcg5Gain) ||
    input.ndcg5Gain < 0.05 ||
    !positiveInterval(input.ndcg5Ci95, input.ndcg5Gain) ||
    !finite(input.recallAt20Delta) ||
    input.recallAt20Delta < 0
  )
    reasons.push("retrieval-gain-unproven");
  const research = candidate.profile === "research";
  if (
    !finite(input.successGain) ||
    input.successGain < (research ? 0.1 : 0.05) ||
    !positiveInterval(input.successCi95, input.successGain)
  )
    reasons.push("task-gain-unproven");
  if (!finite(input.baselineCostUsd) || input.baselineCostUsd < 0)
    reasons.push("unknown-baseline-cost");
  else if (input.baselineCostUsd === 0) {
    const ceiling = research ? 0.25 : candidate.profile === "quality" ? 0.05 : 0.02;
    if (!finite(input.absoluteCostIncreaseUsd) || input.absoluteCostIncreaseUsd > ceiling)
      reasons.push("cost-ceiling-exceeded");
  } else if (
    !finite(input.relativeCostIncrease) ||
    input.relativeCostIncrease < -1 ||
    input.relativeCostIncrease > (research ? 0.25 : 0.1)
  )
    reasons.push("cost-ceiling-exceeded");
  return reasons;
}
