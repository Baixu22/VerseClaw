// Retrieval-only attribution for LoCoMo (#136).
//
// #136 asks a question the judge cannot answer: when temporal retrieval looks worse, is
// the gold evidence missing from memory, or is it in memory but not ranked into the
// top-5? The existing error taxonomy answers a different, judge-coupled question
// (not_retrieved / retrieved_not_used / used_but_misreasoned / judge_error) and needs a
// paid classifier call per failure, so it cannot say whether extraction or ranking lost
// the evidence, and it cannot run without a model.
//
// This module is deterministic and model-free. It takes the retrieval artifacts a run
// already produces -- the gold turn ids, the retrieved top-5 summaries, and the full
// fact set for the conversation -- and attributes each question to exactly one bucket.
// It is explicitly a diagnostic: it makes no judge or baseline claim, and
// assertRetrievalOnlyDisclosure fails closed if one is ever attached.

import { computeContextRecall } from "./runtime-memory-context-recall";

export const RETRIEVAL_ATTRIBUTION_BUCKETS = [
  /** The dataset row has no resolvable gold turn, so it cannot evidence retrieval. */
  "no_gold_evidence",
  /** The gold turn is not represented anywhere in the conversation's extracted memory. */
  "absent_from_memory",
  /** The gold turn is in memory but not in the retrieved top-5: a ranking loss. */
  "in_memory_but_not_top5",
  /** The gold turn is covered by the retrieved top-5. */
  "retrieved_in_top5",
] as const;

export type RetrievalAttributionBucket = (typeof RETRIEVAL_ATTRIBUTION_BUCKETS)[number];

/** A gold turn counts as covered by the retrieved top-5 at this coverage. */
const COVERED = 0.8;
/** Evidence counts as "in memory" when at least half the gold turns are covered. */
const MEMORY_PRESENT = 0.5;

export type RetrievalAttributionInput = {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  goldEvidence: readonly string[];
  /** The summaries this question actually retrieved (top-5 in a full run). */
  retrievedFactSummaries: readonly string[];
  /** Every fact summary extracted for this question's conversation. */
  memoryFactSummaries: readonly string[];
  evidenceTextById?: ReadonlyMap<string, string>;
};

export type RetrievalAttribution = {
  questionId: string;
  category: string;
  conversationId: string;
  bucket: RetrievalAttributionBucket;
  /** Fraction of gold turns covered by the conversation's extracted memory (0-1). */
  memoryCoverage: number;
  /** Fraction of gold turns covered by the retrieved summaries (0-1). */
  top5Coverage: number;
  goldTurnCount: number;
};

function coverageFor(
  summaries: readonly string[],
  goldEvidence: readonly string[],
  evidenceTextById?: ReadonlyMap<string, string>,
): number {
  if (summaries.length === 0) return 0;
  return computeContextRecall(summaries.join("\n"), goldEvidence, evidenceTextById);
}

export function attributeRetrieval(input: RetrievalAttributionInput): RetrievalAttribution {
  const memoryCoverage = coverageFor(
    input.memoryFactSummaries,
    input.goldEvidence,
    input.evidenceTextById,
  );
  const top5Coverage = coverageFor(
    input.retrievedFactSummaries,
    input.goldEvidence,
    input.evidenceTextById,
  );
  const goldTurnCount = input.goldEvidence.length;

  let bucket: RetrievalAttributionBucket;
  if (goldTurnCount === 0) bucket = "no_gold_evidence";
  else if (memoryCoverage < MEMORY_PRESENT) bucket = "absent_from_memory";
  else if (top5Coverage < COVERED) bucket = "in_memory_but_not_top5";
  else bucket = "retrieved_in_top5";

  return {
    questionId: input.questionId,
    category: input.category,
    conversationId: input.conversationId,
    bucket,
    memoryCoverage,
    top5Coverage,
    goldTurnCount,
  };
}

export type RetrievalAttributionSlice = {
  questions: number;
  memoryCoverage: number;
  top5Coverage: number;
  recall5Mean: number;
  bucketCounts: Record<RetrievalAttributionBucket, number>;
};

export type RetrievalAttributionSummary = {
  scope: "retrieval-only-diagnostic";
  claims: {
    judgeScoreClaimed: false;
    baselineClaimed: false;
    note: string;
  };
  overall: RetrievalAttributionSlice;
  byCategory: Record<string, RetrievalAttributionSlice>;
  /** Temporal questions paired against every other category in the same sample. */
  paired: {
    temporal: RetrievalAttributionSlice;
    nonTemporal: RetrievalAttributionSlice;
    temporalMinusNonTemporalTop5Coverage: number;
    /** False when either side is empty, so a delta is never invented from nothing. */
    comparable: boolean;
  };
};

export function createEmptyBucketCounts(): Record<RetrievalAttributionBucket, number> {
  return {
    no_gold_evidence: 0,
    absent_from_memory: 0,
    in_memory_but_not_top5: 0,
    retrieved_in_top5: 0,
  };
}

function sliceOf(
  rows: readonly RetrievalAttribution[],
  recall5ByQuestion: ReadonlyMap<string, number>,
): RetrievalAttributionSlice {
  const bucketCounts = createEmptyBucketCounts();
  let memoryCoverage = 0;
  let top5Coverage = 0;
  let recall5 = 0;
  for (const row of rows) {
    bucketCounts[row.bucket] += 1;
    memoryCoverage += row.memoryCoverage;
    top5Coverage += row.top5Coverage;
    recall5 += recall5ByQuestion.get(row.questionId) ?? 0;
  }
  const n = rows.length;
  return {
    questions: n,
    memoryCoverage: n ? memoryCoverage / n : 0,
    top5Coverage: n ? top5Coverage / n : 0,
    recall5Mean: n ? recall5 / n : 0,
    bucketCounts,
  };
}

/**
 * Aggregates attributed questions. recall5ByQuestion is the run's own recall@5, so the
 * diagnostic reports the run's retrieval metric instead of inventing a second one.
 */
export function summarizeRetrievalAttribution(
  rows: readonly RetrievalAttribution[],
  recall5ByQuestion: ReadonlyMap<string, number> = new Map(),
): RetrievalAttributionSummary {
  const grouped: Record<string, RetrievalAttribution[]> = {};
  for (const row of rows) {
    (grouped[row.category] ??= []).push(row);
  }
  const categorySlices: Record<string, RetrievalAttributionSlice> = {};
  for (const [category, categoryRows] of Object.entries(grouped)) {
    categorySlices[category] = sliceOf(categoryRows, recall5ByQuestion);
  }

  const temporal = sliceOf(rows.filter((row) => row.category === "temporal"), recall5ByQuestion);
  const nonTemporal = sliceOf(rows.filter((row) => row.category !== "temporal"), recall5ByQuestion);

  return {
    scope: "retrieval-only-diagnostic",
    claims: {
      judgeScoreClaimed: false,
      baselineClaimed: false,
      note:
        "Retrieval diagnosis only: no judge call, no judge score, and no product baseline. " +
        "It says where gold evidence was lost, not whether answers were right.",
    },
    overall: sliceOf(rows, recall5ByQuestion),
    byCategory: categorySlices,
    paired: {
      temporal,
      nonTemporal,
      temporalMinusNonTemporalTop5Coverage: temporal.top5Coverage - nonTemporal.top5Coverage,
      comparable: temporal.questions > 0 && nonTemporal.questions > 0,
    },
  };
}

/**
 * Fails closed if a judge or baseline claim is ever attached to this diagnostic. The
 * disclosure fields exist so the "no judge score" boundary is enforced, not just
 * documented in prose.
 */
export function assertRetrievalOnlyDisclosure(summary: RetrievalAttributionSummary): void {
  if (summary.scope !== "retrieval-only-diagnostic") {
    throw new Error("Retrieval diagnostic must declare its retrieval-only scope");
  }
  if (summary.claims.judgeScoreClaimed || summary.claims.baselineClaimed) {
    throw new Error("Retrieval diagnostic must not claim a judge score or a baseline");
  }
  const strayScoreKey = Object.keys(summary.overall).find((key) => /j_?score/i.test(key));
  if (strayScoreKey) {
    throw new Error("Retrieval diagnostic must not carry a judge score field: " + strayScoreKey);
  }
}
