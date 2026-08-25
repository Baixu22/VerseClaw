import { describe, expect, it } from "vitest";
import {
  COMPACTION_PROMOTION_ORDER,
  evaluateCompactionPromotionGate,
  normalizeCompactionPromotionStage,
  resolveCompactionPromotionEnforcement,
  type CompactionPromotionEvidence,
} from "./compaction-promotion.js";
import type { CompactionValidatedDecision } from "./compaction-validated-pipeline.js";

const CURRENT_P6_EVIDENCE: CompactionPromotionEvidence = {
  fixedProductionPairedSamples: 30,
  criticalDroppedSamples: 103,
  schemaFreeMajorOmissionRate: 0.1667,
  realContinuationCriticalActionRate: 0.4333,
  staleLeakageSamples: 0,
  completionDelta: 0.5,
  modelIndependenceOk: false,
};

const PASSING_P6_EVIDENCE: CompactionPromotionEvidence = {
  fixedProductionPairedSamples: 30,
  criticalDroppedSamples: 0,
  schemaFreeMajorOmissionRate: 0.08,
  realContinuationCriticalActionRate: 0.96,
  staleLeakageSamples: 0,
  completionDelta: 0.06,
  noFabricationRate: 0.99,
  modelIndependenceOk: true,
};

function decision(overrides: Partial<CompactionValidatedDecision> = {}): CompactionValidatedDecision {
  return {
    schema: "compaction-validated-pipeline/v1",
    mode: "shadow",
    source: "llm",
    wouldRetry: false,
    wouldFallback: false,
    wouldPreserveTurns: false,
    reasons: [],
    quality: { ok: true, reasons: [] },
    damage: { mode: "shadow", verdict: "clean", damages: [] },
    criticalLedger: { compared: 0, missingAtomIds: [], missingExactIdentifiers: [] },
    repairAttempts: 0,
    ...overrides,
  };
}

describe("compaction promotion gate", () => {
  it("locks the promotion order", () => {
    expect(COMPACTION_PROMOTION_ORDER).toEqual([
      "shadow",
      "would-retry",
      "provider-pressure-pilot",
      "critical-only",
      "limited",
    ]);
  });

  it("normalizes unknown or absent stages to shadow", () => {
    expect(normalizeCompactionPromotionStage(undefined)).toBe("shadow");
    expect(normalizeCompactionPromotionStage("critical-only")).toBe("critical-only");
    expect(normalizeCompactionPromotionStage("not-a-stage")).toBe("shadow");
  });

  it("keeps would-retry development eligible with 30 fixed production samples and model independence", () => {
    const result = evaluateCompactionPromotionGate({
      requested: "would-retry",
      evidence: { fixedProductionPairedSamples: 30, modelIndependenceOk: true },
    });
    expect(result.allowedStage).toBe("would-retry");
    expect(result.eligible).toBe(true);
  });

  it("fails closed to shadow when the 30-sample fixed-pair requirement or model independence is absent", () => {
    const noModelIndependence = evaluateCompactionPromotionGate({
      requested: "would-retry",
      evidence: { fixedProductionPairedSamples: 30 },
    });
    expect(noModelIndependence.allowedStage).toBe("shadow");
    expect(noModelIndependence.missing).toEqual(expect.arrayContaining(["modelIndependenceOk!=true"]));

    const sharedModel = evaluateCompactionPromotionGate({
      requested: "would-retry",
      evidence: { fixedProductionPairedSamples: 30, modelIndependenceOk: false },
    });
    expect(sharedModel.allowedStage).toBe("shadow");
    expect(sharedModel.missing).toEqual(expect.arrayContaining(["modelIndependenceOk!=true"]));
  });

  it("fails closed to shadow for current live evidence and reports only automated failing gates", () => {
    const result = evaluateCompactionPromotionGate({
      requested: "critical-only",
      evidence: CURRENT_P6_EVIDENCE,
    });
    expect(result.allowedStage).toBe("shadow");
    expect(result.eligible).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      "modelIndependenceOk!=true",
      "criticalDroppedSamples!=0",
      "schemaFreeMajorOmissionRate>0.1",
      "realContinuationCriticalActionRate<0.95",
      "completionDelta>0.08",
      "noFabricationRate<0.98",
    ]));
    expect(result.missing).not.toContain("humanScoredSamples<20");
    expect(result.missing).not.toContain("humanRaters<2");
  });

  it("requires the full automated P6-A evidence including no-fabrication for critical-only", () => {
    const almostPassing = evaluateCompactionPromotionGate({
      requested: "critical-only",
      evidence: { ...PASSING_P6_EVIDENCE, noFabricationRate: 0.97 },
    });
    expect(almostPassing.allowedStage).toBe("provider-pressure-pilot");
    expect(almostPassing.missing).toContain("noFabricationRate<0.98");

    const missingNoFabrication = evaluateCompactionPromotionGate({
      requested: "critical-only",
      evidence: { ...PASSING_P6_EVIDENCE, noFabricationRate: undefined },
    });
    expect(missingNoFabrication.allowedStage).toBe("provider-pressure-pilot");
    expect(missingNoFabrication.missing).toContain("noFabricationRate<0.98");
  });

  it("allows critical-only and limited only with the full promotion evidence", () => {
    expect(evaluateCompactionPromotionGate({
      requested: "critical-only",
      evidence: PASSING_P6_EVIDENCE,
    }).allowedStage).toBe("critical-only");
    expect(evaluateCompactionPromotionGate({
      requested: "limited",
      evidence: PASSING_P6_EVIDENCE,
    }).allowedStage).toBe("limited");
  });
});

describe("compaction promotion enforcement", () => {
  it("never enforces shadow or boundary exits", () => {
    expect(resolveCompactionPromotionEnforcement({
      stage: "shadow",
      decision: decision({ wouldRetry: true, wouldPreserveTurns: true }),
    }).action).toBe("allow");
    expect(resolveCompactionPromotionEnforcement({
      stage: "critical-only",
      decision: decision({ wouldPreserveTurns: true }),
      isBoundary: true,
    }).action).toBe("allow");
  });

  it("would-retry requests one bounded retry for provider exits", () => {
    expect(resolveCompactionPromotionEnforcement({
      stage: "would-retry",
      decision: decision({ wouldRetry: true }),
      repairAttempts: 0,
      maxRetries: 1,
    }).action).toBe("retry");
    expect(resolveCompactionPromotionEnforcement({
      stage: "would-retry",
      decision: decision({ wouldRetry: true }),
      repairAttempts: 1,
      maxRetries: 1,
    }).action).toBe("allow");
  });

  it("critical-only cancels when the pipeline would preserve turns", () => {
    expect(resolveCompactionPromotionEnforcement({
      stage: "critical-only",
      decision: decision({ wouldPreserveTurns: true, wouldRetry: true }),
    }).action).toBe("cancel");
  });

  it("critical-only retries when only wouldRetry is true and budget remains", () => {
    expect(resolveCompactionPromotionEnforcement({
      stage: "critical-only",
      decision: decision({ wouldRetry: true }),
      repairAttempts: 0,
      maxRetries: 2,
    }).action).toBe("retry");
  });
});
