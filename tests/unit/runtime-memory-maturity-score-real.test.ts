// @vitest-environment node
// Layer 9: Maturity score aggregator — META-evaluation of the entire runtime
// memory evaluation system. Aggregates results from all 14 layers (L1-L9 + CV1-CV5)
// into a single maturity score with 6 dimensions and 4 hard disqualifiers.
//
// This test does NOT run LLM calls. It tests the scoring logic itself:
// - Happy path: all layers pass → score >= 0.7, level = "mature"
// - Each disqualifier triggers → overall = 0, level = "immature"
// - Skipped layers don't count as passed
// - Dimension weights sum to 1.0

import { describe, expect, it } from "vitest";
import {
  computeMaturityScore,
  buildAllPassScenario,
  DIMENSION_WEIGHTS,
  EXPECTED_LAYERS,
  CV_LAYERS,
  MATURITY_THRESHOLD,
  type LayerResult,
  type MaturityDimension,
} from "./helpers/runtime-memory-maturity-score";

describe("Layer 9: maturity score aggregator", () => {
  it("all_layers_pass_no_disqualifier", () => {
    // Happy path: all 14 layers pass, no disqualifiers.
    // Score should be >= 0.7 (mature), no disqualifiers triggered.
    const layers = buildAllPassScenario(true);
    const score = computeMaturityScore({ layers, llmKeyAvailable: true });

    expect(score.disqualifiers).toHaveLength(0);
    expect(score.overall).toBeGreaterThanOrEqual(MATURITY_THRESHOLD);
    expect(score.level).toBe("mature");
    expect(score.passed).toBe(true);

    // All dimensions should be > 0
    for (const dim of Object.keys(score.dimensions) as MaturityDimension[]) {
      expect(score.dimensions[dim]).toBeGreaterThan(0);
    }

    // Coverage should be 1.0 (all 14 layers present)
    expect(score.dimensions.coverage).toBe(1.0);

    // Correctness should be 1.0 (all layers passed, none skipped)
    expect(score.dimensions.correctness).toBe(1.0);
  });

  it("circular_validation_disqualifier", () => {
    // One layer uses filterQueriesBySeededGroups → disqualifier triggered.
    const layers = buildAllPassScenario(true);
    // L6 is a legacy layer that might use filterQueriesBySeededGroups
    const l6Index = layers.findIndex((l) => l.layerId === "L6");
    const modifiedLayers: LayerResult[] = layers.map((l, i) =>
      i === l6Index ? { ...l, usesFilterQueriesBySeededGroups: true } : l,
    );

    const score = computeMaturityScore({
      layers: modifiedLayers,
      llmKeyAvailable: true,
    });

    expect(score.disqualifiers).toContain("circular_validation_disqualifier");
    expect(score.overall).toBe(0);
    expect(score.level).toBe("immature");
    expect(score.passed).toBe(false);
  });

  it("metric_manipulation_disqualifier", () => {
    // One layer excludes recall=0 from denominator → disqualifier triggered.
    const layers = buildAllPassScenario(true);
    const l4Index = layers.findIndex((l) => l.layerId === "L4");
    const modifiedLayers: LayerResult[] = layers.map((l, i) =>
      i === l4Index ? { ...l, excludesZeroRecallFromDenominator: true } : l,
    );

    const score = computeMaturityScore({
      layers: modifiedLayers,
      llmKeyAvailable: true,
    });

    expect(score.disqualifiers).toContain("metric_manipulation_disqualifier");
    expect(score.overall).toBe(0);
    expect(score.level).toBe("immature");
    expect(score.passed).toBe(false);
  });

  it("hollow_llm_disqualifier", () => {
    // All LLM tests skipped when key IS available → disqualifier triggered.
    const layers = buildAllPassScenario(true);
    // Mark all LLM layers as skipped
    const modifiedLayers: LayerResult[] = layers.map((l) =>
      l.hasLlm ? { ...l, skipped: true, passed: false } : l,
    );

    const score = computeMaturityScore({
      layers: modifiedLayers,
      llmKeyAvailable: true, // Key IS available, but all LLM tests skipped
    });

    expect(score.disqualifiers).toContain("hollow_llm_disqualifier");
    expect(score.overall).toBe(0);
    expect(score.level).toBe("immature");
    expect(score.passed).toBe(false);
  });

  it("cohen_d_infinity_disqualifier", () => {
    // One layer has Cohen's d = Infinity (zero variance) → disqualifier triggered.
    const layers = buildAllPassScenario(true);
    const l5Index = layers.findIndex((l) => l.layerId === "L5");
    const modifiedLayers: LayerResult[] = layers.map((l, i) =>
      i === l5Index ? { ...l, cohenDIsInfinity: true, hasRealVariance: false } : l,
    );

    const score = computeMaturityScore({
      layers: modifiedLayers,
      llmKeyAvailable: true,
    });

    expect(score.disqualifiers).toContain("cohen_d_infinity_disqualifier");
    expect(score.overall).toBe(0);
    expect(score.level).toBe("immature");
    expect(score.passed).toBe(false);
  });

  it("skipped_layer_not_counted", () => {
    // A skipped layer should NOT count as passed in the correctness dimension.
    const layers = buildAllPassScenario(true);
    // Mark L3 as skipped (but still "passed" to test the skipped check)
    const modifiedLayers: LayerResult[] = layers.map((l) =>
      l.layerId === "L3" ? { ...l, skipped: true, passed: true } : l,
    );

    const score = computeMaturityScore({
      layers: modifiedLayers,
      llmKeyAvailable: false, // Key not available, so L3 skip is legitimate
    });

    // Correctness should be < 1.0 because L3 is skipped (not counted as passed)
    expect(score.dimensions.correctness).toBeLessThan(1.0);
    // But the system can still be "mature" if enough other layers pass
    expect(score.disqualifiers).not.toContain("hollow_llm_disqualifier");
  });

  it("weight_distribution_correct", () => {
    // Verify dimension weights sum to 1.0 and each is positive.
    const weights = DIMENSION_WEIGHTS;
    const weightValues = Object.values(weights);
    const sum = weightValues.reduce((a, b) => a + b, 0);

    expect(sum).toBeCloseTo(1.0, 10);
    for (const w of weightValues) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1.0);
    }

    // Verify all 8 dimensions have weights (v3 added externalBenchmark)
    expect(Object.keys(weights)).toHaveLength(8);
    expect(Object.keys(weights)).toEqual(
      expect.arrayContaining([
        "correctness",
        "statisticalRigor",
        "antiOverfitting",
        "antiHallucination",
        "coverage",
        "crossValidation",
        "retrievalQuality",
        "externalBenchmark",
      ]),
    );

    // Verify expected layers (v3 added L11) and CV layers
    expect(EXPECTED_LAYERS).toHaveLength(16);
    expect(CV_LAYERS).toHaveLength(5);

    // Verify the maturity threshold
    expect(MATURITY_THRESHOLD).toBe(0.7);

    // Verify the scoring function returns weights in the result
    const layers = buildAllPassScenario(true);
    const score = computeMaturityScore({ layers, llmKeyAvailable: true });
    expect(score.weights).toEqual(weights);
  });

  it("retrieval_quality_dimension_tracks_l10_pass_rate", () => {
    // v2: the retrievalQuality dimension mirrors L10's passRate.
    // All-pass scenario → retrievalQuality = 1.0.
    const layers = buildAllPassScenario(true);
    const score = computeMaturityScore({ layers, llmKeyAvailable: true });
    expect(score.dimensions.retrievalQuality).toBe(1.0);

    // L10 with partial passRate (3/4 tests) → retrievalQuality = 0.75.
    const partialLayers: LayerResult[] = layers.map((l) =>
      l.layerId === "L10" ? { ...l, passRate: 0.75 } : l,
    );
    const partialScore = computeMaturityScore({
      layers: partialLayers,
      llmKeyAvailable: true,
    });
    expect(partialScore.dimensions.retrievalQuality).toBe(0.75);

    // L10 absent → retrievalQuality = 0 (system must implement L10 to earn it).
    const noL10 = layers.filter((l) => l.layerId !== "L10");
    const noL10Score = computeMaturityScore({
      layers: noL10,
      llmKeyAvailable: true,
    });
    expect(noL10Score.dimensions.retrievalQuality).toBe(0);
    expect(noL10Score.dimensions.coverage).toBeLessThan(1.0);
  });

  it("external_benchmark_dimension_thresholds", () => {
    // v3: externalBenchmark dimension maps L11 Recall@5 via thresholds.
    //   >= 0.70 → 1.0, 0.50..0.70 → 0.5, < 0.50 → 0.0.
    const baseLayers = buildAllPassScenario(true);

    // Recall@5 = 0.75 (≥ 0.70) → externalBenchmark = 1.0 (pass)
    const passLayers: LayerResult[] = baseLayers.map((l) =>
      l.layerId === "L11" ? { ...l, externalBenchmarkRecallAt5: 0.75 } : l,
    );
    const passScore = computeMaturityScore({ layers: passLayers, llmKeyAvailable: true });
    expect(passScore.dimensions.externalBenchmark).toBe(1.0);

    // Recall@5 = 0.60 (0.50..0.70) → externalBenchmark = 0.5 (partial)
    const partialLayers: LayerResult[] = baseLayers.map((l) =>
      l.layerId === "L11" ? { ...l, externalBenchmarkRecallAt5: 0.60 } : l,
    );
    const partialScore = computeMaturityScore({ layers: partialLayers, llmKeyAvailable: true });
    expect(partialScore.dimensions.externalBenchmark).toBe(0.5);

    // Recall@5 = 0.40 (< 0.50) → externalBenchmark = 0.0 (fail)
    const failLayers: LayerResult[] = baseLayers.map((l) =>
      l.layerId === "L11" ? { ...l, externalBenchmarkRecallAt5: 0.40 } : l,
    );
    const failScore = computeMaturityScore({ layers: failLayers, llmKeyAvailable: true });
    expect(failScore.dimensions.externalBenchmark).toBe(0);
  });

  it("external_benchmark_skipped_renormalizes_overall", () => {
    // v3: when L11 is skipped (no LLM key), externalBenchmark is excluded
    // from the overall weighted sum and remaining weights are renormalized.
    // This does NOT trigger the hollow_llm disqualifier.
    const layers = buildAllPassScenario(false); // L11 skipped when no key
    const score = computeMaturityScore({ layers, llmKeyAvailable: false });

    // externalBenchmark dimension is 0 (skipped), but overall is renormalized
    expect(score.dimensions.externalBenchmark).toBe(0);
    expect(score.disqualifiers).not.toContain("hollow_llm_disqualifier");

    // With all other dimensions = 1.0 and externalBenchmark excluded,
    // overall should be 1.0 (renormalized) — still mature.
    expect(score.overall).toBeGreaterThanOrEqual(MATURITY_THRESHOLD);
    expect(score.level).toBe("mature");
  });

  it("external_benchmark_absent_scores_zero", () => {
    // v3: L11 absent → externalBenchmark = 0 (system must implement L11).
    const layers = buildAllPassScenario(true);
    const noL11 = layers.filter((l) => l.layerId !== "L11");
    const score = computeMaturityScore({ layers: noL11, llmKeyAvailable: true });
    expect(score.dimensions.externalBenchmark).toBe(0);
    expect(score.dimensions.coverage).toBeLessThan(1.0);
  });
});
