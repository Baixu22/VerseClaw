/**
 * Stage 5 L7 soak metrics. Pure projection/evaluation functions only:
 * no wall-clock, no randomness, no provider calls, no file writes.
 */
export const STAGE5_L7_SOAK_SCHEMA = "Stage5L7SoakEvidence/v1" as const;
export const STAGE5_L7_SOAK_RULE_ID = "stage5-l7-soak:v1:owner-baseline-2026-08-19" as const;

export const STAGE5_L7_SOAK_THRESHOLDS = {
  criticalRetention: 1,
  constraintRetention: 1,
  evidenceRetention: 1,
  p95TotalCompileLatencyMs: 100,
  p95TurnTokens: 4_000,
  p95TurnCostUsd: 0.02,
  minPairs: 10,
  minExperimentSamples: 10,
} as const;

export type Stage5L7SoakArm = "baseline" | "experiment";

export type Stage5L7SoakSample = {
  runId: string;
  pairId: string;
  arm: Stage5L7SoakArm;
  model: string;
  toolCallId?: string;
  effectReceiptId?: string;
  journalRef?: string;
  envelopeDigest?: string;
  prePlanDigest?: string;
  postPlanDigest?: string;
  preCompileLatencyMs?: number;
  postCompileLatencyMs?: number;
  totalCompileLatencyMs?: number;
  turnLatencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  packStatus?: "ok" | "degraded" | "failed";
  criticalPlanned?: number;
  criticalSelected?: number;
  constraintPlanned?: number;
  constraintSelected?: number;
  evidencePlanned?: number;
  evidenceSelected?: number;
  invalidReasons: string[];
};

export type Stage5L7SoakSummary = {
  samples: number;
  pairs: number;
  baselineSamples: number;
  experimentSamples: number;
  invalidSamples: number;
  criticalRetention: number | null;
  constraintRetention: number | null;
  evidenceRetention: number | null;
  p95TotalCompileLatencyMs: number | null;
  p95TurnTokens: number | null;
  p95TurnCostUsd: number | null;
  p95TurnLatencyMs: number | null;
};

export type Stage5L7SoakVerdict = {
  pass: boolean;
  summary: Stage5L7SoakSummary;
  failures: string[];
  thresholdRef: typeof STAGE5_L7_SOAK_THRESHOLDS;
};

function finiteNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid-${field}`);
  }
  return value;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function retention(planned: number, selected: number): number | null {
  if (planned <= 0) return null;
  return Math.max(0, Math.min(1, selected / planned));
}

export function projectStage5L7SoakMetrics(
  samples: readonly Stage5L7SoakSample[],
): Stage5L7SoakVerdict {
  const runIds = new Set<string>();
  const pairIds = new Set<string>();
  const normalized = samples.map((sample) => {
    if (!sample.runId || runIds.has(sample.runId)) throw new Error("duplicate-run-id");
    runIds.add(sample.runId);
    if (!sample.pairId) throw new Error("invalid-pair-id");
    pairIds.add(sample.pairId);
    finiteNonNegative(sample.turnLatencyMs, "turn-latency");
    if (sample.totalCompileLatencyMs !== undefined) finiteNonNegative(sample.totalCompileLatencyMs, "compile-latency");
    if (sample.totalTokens !== undefined) finiteNonNegative(sample.totalTokens, "tokens");
    if (sample.costUsd !== undefined) finiteNonNegative(sample.costUsd, "cost");
    return sample;
  });

  const experiment = normalized.filter((sample) => sample.arm === "experiment");
  const baseline = normalized.filter((sample) => sample.arm === "baseline");
  const invalid = normalized.filter((sample) => sample.invalidReasons.length > 0);
  const compileLatencies = normalized
    .filter((sample) => sample.totalCompileLatencyMs !== undefined)
    .map((sample) => sample.totalCompileLatencyMs as number);
  const turnTokens = normalized
    .filter((sample) => sample.totalTokens !== undefined)
    .map((sample) => sample.totalTokens as number);
  const costs = normalized
    .filter((sample) => sample.costUsd !== undefined)
    .map((sample) => sample.costUsd as number);
  const turnLatencies = normalized.map((sample) => sample.turnLatencyMs);

  const criticalPlanned = experiment.reduce((sum, sample) => sum + (sample.criticalPlanned ?? 0), 0);
  const criticalSelected = experiment.reduce((sum, sample) => sum + (sample.criticalSelected ?? 0), 0);
  const constraintPlanned = experiment.reduce((sum, sample) => sum + (sample.constraintPlanned ?? 0), 0);
  const constraintSelected = experiment.reduce((sum, sample) => sum + (sample.constraintSelected ?? 0), 0);
  const evidencePlanned = experiment.reduce((sum, sample) => sum + (sample.evidencePlanned ?? 0), 0);
  const evidenceSelected = experiment.reduce((sum, sample) => sum + (sample.evidenceSelected ?? 0), 0);

  const summary: Stage5L7SoakSummary = {
    samples: normalized.length,
    pairs: pairIds.size,
    baselineSamples: baseline.length,
    experimentSamples: experiment.length,
    invalidSamples: invalid.length,
    criticalRetention: retention(criticalPlanned, criticalSelected),
    constraintRetention: retention(constraintPlanned, constraintSelected),
    evidenceRetention: retention(evidencePlanned, evidenceSelected),
    p95TotalCompileLatencyMs: p95(compileLatencies),
    p95TurnTokens: p95(turnTokens),
    p95TurnCostUsd: p95(costs),
    p95TurnLatencyMs: p95(turnLatencies),
  };

  const failures: string[] = [];
  if (summary.pairs < STAGE5_L7_SOAK_THRESHOLDS.minPairs) failures.push(`min-pairs:${summary.pairs}<${STAGE5_L7_SOAK_THRESHOLDS.minPairs}`);
  if (summary.experimentSamples < STAGE5_L7_SOAK_THRESHOLDS.minExperimentSamples) failures.push(`min-experiment-samples:${summary.experimentSamples}<${STAGE5_L7_SOAK_THRESHOLDS.minExperimentSamples}`);
  if (summary.invalidSamples !== 0) failures.push(`invalid-samples:${summary.invalidSamples}`);
  if ((summary.criticalRetention ?? 0) < STAGE5_L7_SOAK_THRESHOLDS.criticalRetention) failures.push(`critical-retention:${summary.criticalRetention}`);
  if ((summary.constraintRetention ?? 0) < STAGE5_L7_SOAK_THRESHOLDS.constraintRetention) failures.push(`constraint-retention:${summary.constraintRetention}`);
  if ((summary.evidenceRetention ?? 0) < STAGE5_L7_SOAK_THRESHOLDS.evidenceRetention) failures.push(`evidence-retention:${summary.evidenceRetention}`);
  if (summary.p95TotalCompileLatencyMs === null || summary.p95TotalCompileLatencyMs > STAGE5_L7_SOAK_THRESHOLDS.p95TotalCompileLatencyMs) failures.push(`p95-compile-latency:${summary.p95TotalCompileLatencyMs}`);
  if (summary.p95TurnTokens === null || summary.p95TurnTokens > STAGE5_L7_SOAK_THRESHOLDS.p95TurnTokens) failures.push(`p95-turn-tokens:${summary.p95TurnTokens}`);
  if (summary.p95TurnCostUsd !== null && summary.p95TurnCostUsd > STAGE5_L7_SOAK_THRESHOLDS.p95TurnCostUsd) failures.push(`p95-turn-cost:${summary.p95TurnCostUsd}`);

  return { pass: failures.length === 0, summary, failures, thresholdRef: STAGE5_L7_SOAK_THRESHOLDS };
}
