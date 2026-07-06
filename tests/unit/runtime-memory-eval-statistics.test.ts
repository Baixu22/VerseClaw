// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bootstrapConfidenceInterval,
  cohensD,
  mean,
  minimumSampleSize,
  mulberry32,
  pairedTTest,
  percentile,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/statistics";

describe("runtime memory eval statistics", () => {
  it("mulberry32 returns deterministic sequence for same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 10; i += 1) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("mulberry32 produces values in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("bootstrap CI contains the sample mean within [lower, upper]", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ci = bootstrapConfidenceInterval(samples);
    expect(ci.lower).toBeLessThanOrEqual(ci.mean);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.mean);
    expect(ci.mean).toBeCloseTo(5.5, 5);
    expect(ci.iterations).toBe(1000);
    expect(ci.confidence).toBe(0.95);
  });

  it("bootstrap CI is deterministic for same seed", () => {
    const samples = Array.from({ length: 20 }, (_, i) => i * 2 + 1);
    const ci1 = bootstrapConfidenceInterval(samples, { seed: 123 });
    const ci2 = bootstrapConfidenceInterval(samples, { seed: 123 });
    expect(ci1.lower).toBe(ci2.lower);
    expect(ci1.upper).toBe(ci2.upper);
  });

  it("paired t-test detects significant positive difference", () => {
    const baseline = [10, 11, 9, 10, 12, 11, 10, 9, 11, 10];
    const treatment = baseline.map((v) => v + 2);
    const result = pairedTTest(baseline, treatment);
    expect(result.meanDiff).toBeCloseTo(2, 5);
    expect(result.df).toBe(9);
    expect(result.t).toBeGreaterThan(0);
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("paired t-test reports non-significant for identical samples", () => {
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [1, 2, 3, 4, 5];
    const result = pairedTTest(baseline, treatment);
    expect(result.meanDiff).toBe(0);
    expect(result.significant).toBe(false);
  });

  it("paired t-test throws on length mismatch", () => {
    expect(() => pairedTTest([1, 2, 3], [1, 2])).toThrow();
  });

  it("paired t-test throws on empty samples", () => {
    expect(() => pairedTTest([], [])).toThrow();
  });

  it("minimum sample size for d=0.2, alpha=0.05, power=0.8 is 197", () => {
    expect(minimumSampleSize(0.2, 0.05, 0.8)).toBe(197);
  });

  it("minimum sample size decreases as effect size increases", () => {
    const small = minimumSampleSize(0.2);
    const medium = minimumSampleSize(0.5);
    const large = minimumSampleSize(0.8);
    expect(small).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(large);
  });

  it("cohensD returns positive value when treatment exceeds baseline", () => {
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [4, 5, 6, 7, 8];
    const d = cohensD(baseline, treatment);
    expect(d).toBeGreaterThan(0);
    // mean diff = 3, pooled variance = 2.5, pooled std = sqrt(2.5) ≈ 1.5811
    // d = 3 / 1.5811 ≈ 1.8974
    expect(d).toBeCloseTo(1.8974, 3);
  });

  it("cohensD returns zero for identical samples", () => {
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [1, 2, 3, 4, 5];
    expect(cohensD(baseline, treatment)).toBe(0);
  });

  it("cohensD returns Infinity for zero-variance samples with non-zero mean diff", () => {
    // Zero variance in both arms + non-zero mean diff → consistent with pairedTTest
    // (both should indicate strong significance).
    const baseline = [0, 0, 0, 0];
    const treatment = [1, 1, 1, 1];
    expect(cohensD(baseline, treatment)).toBe(Number.POSITIVE_INFINITY);
  });

  it("minimumSampleSize returns 1 for infinite effect size", () => {
    // When cohensD = Infinity (zero variance, non-zero mean diff), the minimum
    // sample size required to detect the effect is the smallest possible: 1.
    expect(minimumSampleSize(Number.POSITIVE_INFINITY, 0.05, 0.8)).toBe(1);
  });

  it("percentile and mean compute expected values", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
    expect(mean([])).toBe(0);
  });
});
