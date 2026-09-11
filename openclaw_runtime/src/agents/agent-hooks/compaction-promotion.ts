/**
 * P6 controlled promotion gate.
 *
 * The promotion order is fixed. Evidence gaps only reduce the allowed stage;
 * they never throw and never fabricate an eligible stage.
 */
import type { CompactionValidatedDecision } from "./compaction-validated-pipeline.js";

export const COMPACTION_PROMOTION_ORDER = [
  "shadow",
  "would-retry",
  "provider-pressure-pilot",
  "critical-only",
  "limited",
] as const;

export type CompactionPromotionStage = (typeof COMPACTION_PROMOTION_ORDER)[number];

export type CompactionPromotionEvidence = {
  fixedProductionPairedSamples?: number;
  criticalDroppedSamples?: number;
  schemaFreeMajorOmissionRate?: number;
  realContinuationCriticalActionRate?: number;
  staleLeakageSamples?: number;
  completionDelta?: number;
  noFabricationRate?: number;
  modelIndependenceOk?: boolean;
};

export type CompactionPromotionGateResult = {
  requested: CompactionPromotionStage;
  allowedStage: CompactionPromotionStage;
  eligible: boolean;
  missing: string[];
  reasons: string[];
};

export type CompactionPromotionEnforcement = {
  action: "allow" | "retry" | "cancel";
  reason: string;
};

const STAGE_INDEX = new Map<CompactionPromotionStage, number>(
  COMPACTION_PROMOTION_ORDER.map((stage, index) => [stage, index]),
);

export function compactionPromotionStageIndex(stage: CompactionPromotionStage): number {
  return STAGE_INDEX.get(stage) ?? 0;
}

export function isCompactionPromotionStage(value: unknown): value is CompactionPromotionStage {
  return typeof value === "string" && STAGE_INDEX.has(value as CompactionPromotionStage);
}

/** Unknown or absent stage values fail closed to shadow. */
export function normalizeCompactionPromotionStage(value: unknown): CompactionPromotionStage {
  return isCompactionPromotionStage(value) ? value : "shadow";
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function missingForCriticalOnly(evidence: CompactionPromotionEvidence): string[] {
  const missing: string[] = [];
  if ((evidence.fixedProductionPairedSamples ?? 0) < 30) {
    missing.push("fixedProductionPairedSamples<30");
  }
  if (evidence.modelIndependenceOk !== true) {
    missing.push("modelIndependenceOk!=true");
  }
  if ((evidence.criticalDroppedSamples ?? 1) !== 0) {
    missing.push("criticalDroppedSamples!=0");
  }
  if ((evidence.schemaFreeMajorOmissionRate ?? 1) > 0.1) {
    missing.push("schemaFreeMajorOmissionRate>0.1");
  }
  if ((evidence.realContinuationCriticalActionRate ?? 0) < 0.95) {
    missing.push("realContinuationCriticalActionRate<0.95");
  }
  if ((evidence.staleLeakageSamples ?? 1) !== 0) {
    missing.push("staleLeakageSamples!=0");
  }
  if ((evidence.completionDelta ?? 1) > 0.08) {
    missing.push("completionDelta>0.08");
  }
  if ((evidence.noFabricationRate ?? 0) < 0.98) {
    missing.push("noFabricationRate<0.98");
  }
  return missing;
}

function criticalOnlyAllowed(evidence: CompactionPromotionEvidence): boolean {
  return missingForCriticalOnly(evidence).length === 0;
}

function limitedAllowed(evidence: CompactionPromotionEvidence): boolean {
  return criticalOnlyAllowed(evidence);
}

function highestAllowedStage(evidence: CompactionPromotionEvidence): CompactionPromotionStage {
  if (limitedAllowed(evidence)) return "limited";
  if (criticalOnlyAllowed(evidence)) return "critical-only";
  if (
    (evidence.fixedProductionPairedSamples ?? 0) >= 30 &&
    evidence.modelIndependenceOk === true
  ) {
    return "provider-pressure-pilot";
  }
  return "shadow";
}

/**
 * Pure fail-closed promotion evaluator. Missing evidence becomes a reason,
 * never a fabricated pass.
 */
export function evaluateCompactionPromotionGate(input: {
  requested: CompactionPromotionStage;
  evidence: CompactionPromotionEvidence;
}): CompactionPromotionGateResult {
  const requested = normalizeCompactionPromotionStage(input.requested);
  const evidence = input.evidence ?? {};
  const highest = highestAllowedStage(evidence);
  const requestedIndex = compactionPromotionStageIndex(requested);
  const highestIndex = compactionPromotionStageIndex(highest);
  const allowedStage =
    highestIndex >= requestedIndex
      ? requested
      : COMPACTION_PROMOTION_ORDER[highestIndex] ?? "shadow";

  const reasons: string[] = [];
  if ((evidence.fixedProductionPairedSamples ?? 0) < 1) {
    reasons.push("no_fixed_production_paired_samples");
  }
  if (requestedIndex >= 1 && (evidence.fixedProductionPairedSamples ?? 0) < 30) {
    reasons.push("fixedProductionPairedSamples<30_for_would_retry");
  }
  if (requestedIndex >= 1 && evidence.modelIndependenceOk !== true) {
    reasons.push("modelIndependenceOk!=true");
  }
  if (requestedIndex >= 2 && (evidence.fixedProductionPairedSamples ?? 0) < 30) {
    reasons.push("fixedProductionPairedSamples<30_for_provider_pressure_pilot");
  }
  if (requestedIndex >= 3) {
    reasons.push(...missingForCriticalOnly(evidence));
  }

  const missing = [...new Set(reasons)].sort();
  return {
    requested,
    allowedStage,
    eligible: allowedStage === requested,
    missing,
    reasons: [...missing],
  };
}

/**
 * P6 enforcement policy. shadow and boundary never enforce; would-retry may
 * request one bounded retry; critical-only/limited fail closed by cancelling
 * when the validated pipeline would preserve turns.
 */
export function resolveCompactionPromotionEnforcement(input: {
  stage: CompactionPromotionStage;
  decision: Pick<CompactionValidatedDecision, "wouldRetry" | "wouldPreserveTurns">;
  repairAttempts?: number;
  maxRetries?: number;
  isBoundary?: boolean;
}): CompactionPromotionEnforcement {
  const stage = normalizeCompactionPromotionStage(input.stage);
  const repairAttempts = nonNegative(input.repairAttempts) ?? 0;
  const maxRetries = nonNegative(input.maxRetries) ?? 1;
  if (stage === "shadow" || input.isBoundary === true) {
    return { action: "allow", reason: stage === "shadow" ? "shadow" : "boundary_never_enforces" };
  }
  if (stage === "would-retry" || stage === "provider-pressure-pilot") {
    if (input.decision.wouldRetry && repairAttempts < maxRetries) {
      return { action: "retry", reason: `would_retry:${repairAttempts + 1}/${maxRetries}` };
    }
    return { action: "allow", reason: "retry_budget_exhausted_or_not_needed" };
  }
  if (stage === "critical-only" || stage === "limited") {
    if (input.decision.wouldPreserveTurns) {
      return { action: "cancel", reason: "critical_preservation_required" };
    }
    if (input.decision.wouldRetry && repairAttempts < maxRetries) {
      return { action: "retry", reason: `critical_retry:${repairAttempts + 1}/${maxRetries}` };
    }
    return { action: "allow", reason: "critical_pipeline_ok" };
  }
  return { action: "allow", reason: "unknown_stage_fail_closed" };
}
