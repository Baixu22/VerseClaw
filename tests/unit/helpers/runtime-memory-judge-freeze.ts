export const FROZEN_JUDGE_CONFIG = {
  model: process.env.RUNTIME_MEMORY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat",
  temperature: 0,
  promptVersion: "frozen-v2-generous-2026-07-04",
  promptTemplate: [
    "You are an impartial judge. Compare a predicted answer to the ground truth.",
    "",
    "Rules:",
    "- Answer CORRECT if the predicted answer conveys the same meaning, even if worded differently.",
    "- Date format differences (e.g., \"2023-05\" vs \"May 2023\") are acceptable.",
    "- Paraphrases (e.g., \"oat milk\" vs \"oat milk instead\") are acceptable.",
    "- Partial credit: if the predicted answer covers part of the ground truth, answer CORRECT.",
    "- If the ground truth is a list, the predicted answer must cover at least 50% of items.",
    "- Time tolerance: if dates are within 14 days of each other, treat as CORRECT.",
    "- If the predicted answer is a superstring or substring of the ground truth (case-insensitive), answer CORRECT.",
    "- If both answers refer to the same entity (e.g., synonyms, aliases), answer CORRECT.",
    "",
    "Respond with ONLY \"CORRECT\" or \"WRONG\".",
  ].join("\n"),
} as const;

export const FROZEN_JUDGE_INTERPRETATION = {
  judgeComparableAcrossConfigurations: false,
  rankingAllowed: false,
  limitations: [
    "Partial answers are accepted as correct.",
    "Only 50% of a reference list is required.",
    "Dates within 14 days are accepted as correct.",
    "Case-insensitive substrings and superstrings are accepted.",
    "Aliases referring to the same entity are accepted.",
  ],
  note: "This is lenient answer accuracy, not evidence of retrieval improvement or a cross-system ranking.",
} as const;

export type JudgeSanitySample = {
  questionId: string;
  category?: string;
  question: string;
  groundTruth: string;
  predictedAnswer: string;
  manualVerdict: "truly_wrong" | "actually_correct" | "unreviewed";
};

export type JudgeSanityReport = {
  version: "judge-sanity-v1";
  generatedAt: string;
  sourceReport?: string;
  targetSampleSize: number;
  reviewedCount: number;
  reviewCoverage: number;
  falseNegativeRate: number;
  requiresPromptReview: boolean | null;
  status: "not_enabled" | "healthy" | "review_required";
  judgeConfig: typeof FROZEN_JUDGE_CONFIG;
  samples: JudgeSanitySample[];
};

export type EvalReportSampleResult = {
  questionId?: string;
  category?: string;
  question?: string;
  judgeScore?: number;
  predictedAnswer?: string;
  groundTruth?: string;
};

export function buildFrozenJudgePrompt(
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
): { system: string; user: string } {
  return {
    system: FROZEN_JUDGE_CONFIG.promptTemplate,
    user: `Question: ${question}

Ground truth answer: ${groundTruth}

Predicted answer: ${predictedAnswer}

Is the predicted answer semantically correct? (CORRECT/WRONG):`,
  };
}

export function parseFrozenJudgeVerdict(content: string): number {
  const trimmed = content.trim().toLowerCase();
  // Accept "yes" (legacy) and "correct" (v2 generous)
  if (trimmed.startsWith("yes") || trimmed.startsWith("correct")) {
    return 1;
  }
  return 0;
}

export function computeJudgeFalseNegativeRate(
  samples: readonly JudgeSanitySample[],
): number {
  const reviewed = samples.filter((sample) => sample.manualVerdict !== "unreviewed");
  if (reviewed.length === 0) return 0;
  const falseNegatives = reviewed.filter(
    (sample) => sample.manualVerdict === "actually_correct",
  ).length;
  return falseNegatives / reviewed.length;
}

export function buildJudgeSanityReport(
  sampleResults: readonly EvalReportSampleResult[],
  options: {
    sourceReport?: string;
    targetSampleSize?: number;
    now?: () => Date;
  } = {},
): JudgeSanityReport {
  const targetSampleSize = options.targetSampleSize ?? 50;
  const samples = sampleResults
    .filter((sample) => sample.judgeScore === 0)
    .slice(0, targetSampleSize)
    .map((sample, index): JudgeSanitySample => ({
      questionId: sample.questionId ?? `unidentified_${index}`,
      category: sample.category,
      question: sample.question ?? "",
      groundTruth: sample.groundTruth ?? "",
      predictedAnswer: sample.predictedAnswer ?? "",
      manualVerdict: "unreviewed",
    }));
  const falseNegativeRate = computeJudgeFalseNegativeRate(samples);
  const reviewedCount = samples.filter(
    (sample) => sample.manualVerdict !== "unreviewed",
  ).length;
  const reviewCoverage = samples.length > 0 ? reviewedCount / samples.length : 0;
  const status = reviewedCount === 0
    ? "not_enabled" as const
    : falseNegativeRate > 0.15
      ? "review_required" as const
      : "healthy" as const;

  return {
    version: "judge-sanity-v1",
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourceReport: options.sourceReport,
    targetSampleSize,
    reviewedCount,
    reviewCoverage,
    falseNegativeRate,
    requiresPromptReview: reviewedCount === 0 ? null : status === "review_required",
    status,
    judgeConfig: FROZEN_JUDGE_CONFIG,
    samples,
  };
}
