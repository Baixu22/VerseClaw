// @vitest-environment node
// Phase 36 enhanced evaluation — Dimension 2: LLM Utility Scoring.
// Verifies the deterministic utility proxy: geometric mean of fact coverage
// and answer completeness.

import { describe, expect, it } from "vitest";
import {
  aggregateUtility,
  scoreUtility,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/utility-scorer";

describe("runtime memory utility scorer", () => {
  it("returns utilityScore=1 for complete match with no extraneous facts", () => {
    const result = scoreUtility({
      recalledFactIds: ["f1", "f2", "f3"],
      referenceFactIds: ["f1", "f2", "f3"],
    });
    expect(result.factCoverage).toBe(1);
    expect(result.answerCompleteness).toBe(1);
    expect(result.utilityScore).toBe(1);
    expect(result.matchedFactIds).toEqual(["f1", "f2", "f3"]);
    expect(result.missingFactIds).toEqual([]);
    expect(result.extraneousFactIds).toEqual([]);
  });

  it("returns utilityScore=0 for empty recall", () => {
    const result = scoreUtility({
      recalledFactIds: [],
      referenceFactIds: ["f1", "f2"],
    });
    expect(result.factCoverage).toBe(0);
    expect(result.answerCompleteness).toBe(0);
    expect(result.utilityScore).toBe(0);
    expect(result.matchedFactIds).toEqual([]);
    expect(result.missingFactIds).toEqual(["f1", "f2"]);
  });

  it("returns utilityScore=0.5 for partial match (half recalled, half missing)", () => {
    const result = scoreUtility({
      recalledFactIds: ["f1", "f2"],
      referenceFactIds: ["f1", "f2", "f3", "f4"],
    });
    expect(result.factCoverage).toBe(1);
    expect(result.answerCompleteness).toBe(0.5);
    expect(result.utilityScore).toBeCloseTo(Math.sqrt(0.5), 5);
  });

  it("penalizes extraneous recalls via reduced factCoverage", () => {
    // 2 correct + 2 extraneous out of 4 recalled; reference has 4 facts.
    const result = scoreUtility({
      recalledFactIds: ["f1", "f2", "e1", "e2"],
      referenceFactIds: ["f1", "f2", "f3", "f4"],
    });
    expect(result.factCoverage).toBe(0.5);
    expect(result.answerCompleteness).toBe(0.5);
    expect(result.utilityScore).toBeCloseTo(Math.sqrt(0.25), 5);
    expect(result.extraneousFactIds).toEqual(["e1", "e2"]);
  });

  it("penalizes incomplete recall via reduced answerCompleteness", () => {
    // All 4 recalled are correct, but only 4 of 8 reference facts covered.
    const result = scoreUtility({
      recalledFactIds: ["f1", "f2", "f3", "f4"],
      referenceFactIds: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"],
    });
    expect(result.factCoverage).toBe(1);
    expect(result.answerCompleteness).toBe(0.5);
    expect(result.utilityScore).toBeCloseTo(Math.sqrt(0.5), 5);
    expect(result.missingFactIds).toHaveLength(4);
  });

  it("uses geometric mean (sqrt) not arithmetic mean", () => {
    // coverage=0.5, completeness=1.0
    // geometric mean = sqrt(0.5) ≈ 0.7071
    // arithmetic mean = 0.75
    const result = scoreUtility({
      recalledFactIds: ["f1", "f2", "e1", "e2"],
      referenceFactIds: ["f1", "f2"],
    });
    expect(result.utilityScore).toBeCloseTo(Math.sqrt(0.5), 5);
    expect(result.utilityScore).not.toBeCloseTo(0.75, 2);
  });

  it("aggregateUtility computes mean/p50/p95 across queries", () => {
    const results = [
      scoreUtility({ recalledFactIds: ["a"], referenceFactIds: ["a"] }),
      scoreUtility({ recalledFactIds: [], referenceFactIds: ["b"] }),
      scoreUtility({ recalledFactIds: ["c", "d"], referenceFactIds: ["c", "d"] }),
      scoreUtility({ recalledFactIds: ["e"], referenceFactIds: ["e", "f"] }),
    ];
    const agg = aggregateUtility(results);
    expect(agg.perQuery).toHaveLength(4);
    // utilities: [1, 0, 1, sqrt(0.5)]
    expect(agg.meanUtility).toBeCloseTo((1 + 0 + 1 + Math.sqrt(0.5)) / 4, 5);
    expect(agg.meanCoverage).toBeCloseTo((1 + 0 + 1 + 1) / 4, 5);
    expect(agg.meanCompleteness).toBeCloseTo((1 + 0 + 1 + 0.5) / 4, 5);
    expect(agg.p50Utility).toBeGreaterThanOrEqual(0);
    expect(agg.p95Utility).toBeLessThanOrEqual(1);
  });
});
