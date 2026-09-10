/**
 * C6-H: assembler flip-gate decision package (advisory only).
 * Metrics may be green; readyToConsiderAssemblerFlip stays hard-false unless
 * productReviewApproved is explicitly true AND metric gates pass.
 * Never auto-applies assembler / context-ladder production defaults.
 */
import type { LongChatCurveReport } from "./coding-long-chat-curve.js";
import type { C6hCorpusKind, C6hCorpusRunResult } from "./coding-c6h-corpus.js";

export type AssemblerFlipRecommendation =
  | "keep-off"
  | "metrics-green-review-required"
  | "product-review-may-consider";

export type AssemblerFlipDecision = {
  ok: true;
  card: "B1";
  wave: "C6-H";
  completionClass: string;
  live64k: boolean;
  recorded64k: boolean;
  synthetic64k: boolean;
  corpusKind: C6hCorpusKind;
  metricGates: {
    promptNotLinearExploding: boolean;
    compactionLayersHit: boolean;
    passRateFloor: boolean;
    cumulativeRawGe64k: boolean;
    allMetricGatesGreen: boolean;
  };
  /**
   * Hard red-line: false unless productReviewApproved && allMetricGatesGreen.
   * Even when true, no auto-flip occurs; recommendation only.
   */
  readyToConsiderAssemblerFlip: boolean;
  /**
   * Always false from this package — production flip is out of band.
   */
  autoAppliedAssemblerFlip: false;
  recommendation: AssemblerFlipRecommendation;
  productReviewApproved: boolean;
  defaultsUnchanged: true;
  checklist: Array<{ id: string; ok: boolean; note: string }>;
  notes: string[];
  howToOptInLadder: string;
  residual: string[];
};

export type BuildAssemblerFlipDecisionParams = {
  corpus: C6hCorpusRunResult;
  /** Explicit product review field. Default false — never inferred from metrics alone. */
  productReviewApproved?: boolean;
  /** Optional extra notes from packaging. */
  extraNotes?: string[];
};

function completionClassFor(corpus: C6hCorpusRunResult, allGreen: boolean): string {
  if (corpus.live64k && allGreen) return "done (hard-gates+live)";
  if (corpus.recorded64k && allGreen) return "done (hard-gates+recorded)";
  if (corpus.synthetic64k && allGreen) return "done (hard-gates+synthetic)";
  if (allGreen) return "done (hard-gates)";
  return "done (sim+gates-partial)";
}

export function evaluateAssemblerFlipGates(report: LongChatCurveReport): {
  promptNotLinearExploding: boolean;
  compactionLayersHit: boolean;
  passRateFloor: boolean;
  cumulativeRawGe64k: boolean;
  allMetricGatesGreen: boolean;
} {
  const promptNotLinearExploding = report.flipGates.promptNotLinearExploding;
  const compactionLayersHit = report.flipGates.compactionLayersHit;
  const passRateFloor = report.flipGates.passRateFloor;
  const cumulativeRawGe64k = report.cumulativeRawChars >= 64_000;
  return {
    promptNotLinearExploding,
    compactionLayersHit,
    passRateFloor,
    cumulativeRawGe64k,
    allMetricGatesGreen:
      promptNotLinearExploding &&
      compactionLayersHit &&
      passRateFloor &&
      cumulativeRawGe64k,
  };
}

/**
 * Build honest flip decision pack. Hard rules:
 * - readyToConsiderAssemblerFlip = productReviewApproved && allMetricGatesGreen
 * - autoAppliedAssemblerFlip always false
 * - curve report's readyToConsiderAssemblerFlip is never trusted as auto-ready
 */
export function buildAssemblerFlipDecision(
  params: BuildAssemblerFlipDecisionParams,
): AssemblerFlipDecision {
  const productReviewApproved = params.productReviewApproved === true;
  const metricGates = evaluateAssemblerFlipGates(params.corpus.report);
  const readyToConsiderAssemblerFlip =
    productReviewApproved && metricGates.allMetricGatesGreen;

  let recommendation: AssemblerFlipRecommendation = "keep-off";
  if (readyToConsiderAssemblerFlip) {
    recommendation = "product-review-may-consider";
  } else if (metricGates.allMetricGatesGreen) {
    recommendation = "metrics-green-review-required";
  }

  const notes: string[] = [
    ...params.corpus.notes,
    ...(params.extraNotes ?? []),
    "readyToConsiderAssemblerFlip is never auto-true from metrics alone",
    "applyContextLadder remains opt-in; assembler production flags unflipped",
    params.corpus.report.flipGates.readyToConsiderAssemblerFlip === false
      ? "curve hard-gate readyToConsiderAssemblerFlip=false respected"
      : "WARNING: curve reported ready true — decision still hard-gated by product review",
  ];

  const residual: string[] = [];
  if (!params.corpus.live64k) {
    residual.push(
      "Live 64K production corpus still residual (supply DCS_C6H_CORPUS_PATH + DCS_C6H_CORPUS_KIND=live)",
    );
  }
  if (!productReviewApproved) {
    residual.push("Product review approval not set; assembler flip stays consider-only/keep-off");
  }
  residual.push("No automatic assembler production default flip from this package");

  return {
    ok: true,
    card: "B1",
    wave: "C6-H",
    completionClass: completionClassFor(params.corpus, metricGates.allMetricGatesGreen),
    live64k: params.corpus.live64k,
    recorded64k: params.corpus.recorded64k,
    synthetic64k: params.corpus.synthetic64k,
    corpusKind: params.corpus.kind,
    metricGates,
    readyToConsiderAssemblerFlip,
    autoAppliedAssemblerFlip: false,
    recommendation,
    productReviewApproved,
    defaultsUnchanged: true,
    checklist: [
      {
        id: "metric-prompt-not-linear",
        ok: metricGates.promptNotLinearExploding,
        note: "final prompt estimate << cumulative raw",
      },
      {
        id: "metric-compaction-layers",
        ok: metricGates.compactionLayersHit,
        note: "tool compress / archive / pressure layers observed",
      },
      {
        id: "metric-pass-rate-floor",
        ok: metricGates.passRateFloor,
        note: "simulated pass-rate within baseline floor",
      },
      {
        id: "metric-64k-cumulative",
        ok: metricGates.cumulativeRawGe64k,
        note: "cumulative raw chars >= 64K",
      },
      {
        id: "product-review-approved",
        ok: productReviewApproved,
        note: "explicit product review field (never inferred)",
      },
      {
        id: "no-auto-flip",
        ok: true,
        note: "autoAppliedAssemblerFlip always false",
      },
      {
        id: "live-corpus-optional",
        ok: params.corpus.live64k || params.corpus.recorded64k || params.corpus.synthetic64k,
        note: params.corpus.live64k
          ? "live 64K present"
          : params.corpus.recorded64k
            ? "recorded 64K fixture (not live)"
            : "synthetic 64K only",
      },
    ],
    notes,
    howToOptInLadder:
      "Call applyContextLadder({ blocks, tokenBudget }) opt-in from host code; do not flip assembler production defaults. Kill switch: stop calling ladder / leave defaults.",
    residual,
  };
}
