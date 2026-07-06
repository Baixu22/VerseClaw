// @vitest-environment node
// Phase 37 enhanced evaluation — Enhanced Report Generator.
// Verifies that the enhanced report correctly aggregates 10 dimensions
// (6 original + 4 new: conflictResolution, hazardSuppression,
// crossAxisRejection, latencyBenchmark), computes overall score via
// geometric mean, applies 5 scoring defect fixes, and generates
// strengths/weaknesses/recommendations + rejection reason distribution.

import { describe, expect, it } from "vitest";
import {
  generateEnhancedReport,
  formatEnhancedReportAsMarkdown,
  type EnhancedEvalDimensions,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/enhanced-report-eval";

const FULL_PERFECT_DIMS: EnhancedEvalDimensions = {
  longConversation: { significant: true, cohensD: 1.5, achieved: true },
  chain: { aggregateChainRecall: 1.0, maxDepth: 3, meanGrowthRate: 1.0 },
  utility: { meanUtility: 1.0, meanCoverage: 1.0, meanCompleteness: 1.0, p95Utility: 1.0 },
  temporalEvolution: { writeEffect: 1.0, invalidateEffect: -1.0 },
  topicDrift: {
    perTopicRecall: [1, 1, 1],
    crossTopicInterference: 0,
    driftRecoveryTime: 1,
  },
  budgetPressure: {
    maxRecall: 1.0,
    minRecall: 0.2,
    kneePoint: 0,
    budgetElasticity: 0.001,
  },
  conflictResolution: {
    wrongConflictWinnerRate: 0,
    conflictSuppressionRate: 1.0,
  },
  hazardSuppression: {
    promptInjectionSuppressionRate: 1.0,
    rawLeakSuppressionRate: 1.0,
    hazardStringLeaked: [],
  },
  crossAxisRejection: {
    rejectionCoverage: 1.0,
    allReasonsFired: true,
    correctReasonRate: 1.0,
  },
  latencyBenchmark: {
    latencyMsP50: 0,
    latencyMsP95: 0,
    tokenOverheadP50: 0,
    tokenOverheadP95: 0,
  },
};

describe("enhanced report generator — existing dimensions", () => {
  it("overallScore = 1 when all dimensions are perfect", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, {
      now: () => 1_000,
    });

    expect(report.generatedAt).toBe(1_000);
    expect(report.summary.overallScore).toBeCloseTo(1, 5);
    expect(report.summary.strengths.length).toBeGreaterThan(0);
    expect(report.summary.weaknesses).toHaveLength(0);
    expect(report.summary.recommendations).toHaveLength(0);
  });

  it("single low-scoring dimension pulls down overallScore", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      chain: { aggregateChainRecall: 0.3, maxDepth: 1, meanGrowthRate: 0.3 },
    };

    const report = generateEnhancedReport(dims);

    expect(report.summary.overallScore).toBeLessThan(1);
    expect(report.summary.dimensionScores.chain).toBeCloseTo(0.3, 5);
    expect(report.summary.weaknesses.some((w) => w.includes("Chain recall"))).toBe(true);
  });

  it("missing dimensions are excluded from overallScore calculation", () => {
    const partialDims: EnhancedEvalDimensions = {
      longConversation: { significant: true, cohensD: 1.0, achieved: true },
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9 },
    };

    const report = generateEnhancedReport(partialDims);

    expect(Object.keys(report.summary.dimensionScores)).toHaveLength(2);
    // cohensD=1.0 → clamp01(1.0/0.8) = 1.0
    expect(report.summary.dimensionScores.longConversation).toBe(1);
    // meanUtility=0.9, p95=undefined → 0.9*0.7 + 0.9*0.3 = 0.9
    expect(report.summary.dimensionScores.utility).toBeCloseTo(0.9, 5);
    expect(report.summary.overallScore).toBeCloseTo(Math.sqrt(1 * 0.9), 5);
  });

  it("recommendations are generated for weak dimensions", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      chain: { aggregateChainRecall: 0.5, maxDepth: 1, meanGrowthRate: 0.5 },
      utility: { meanUtility: 0.4, meanCoverage: 0.4, meanCompleteness: 0.4 },
    };

    const report = generateEnhancedReport(dims);

    expect(report.summary.recommendations.some((r) => r.includes("链式召回"))).toBe(true);
    expect(report.summary.recommendations.some((r) => r.includes("效用分数"))).toBe(true);
  });

  it("Markdown output contains all dimension tables and sections", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, {
      now: () => 1_000,
    });
    const md = formatEnhancedReportAsMarkdown(report);

    expect(md).toContain("# Runtime Memory Enhanced Evaluation Report");
    expect(md).toContain("## Dimension Scores");
    expect(md).toContain("## Dimension Details");
    expect(md).toContain("### Long Conversation");
    expect(md).toContain("### Chain Eval");
    expect(md).toContain("### Utility");
    expect(md).toContain("### Temporal Evolution");
    expect(md).toContain("### Topic Drift");
    expect(md).toContain("### Budget Pressure");
    expect(md).toContain("### Conflict Resolution");
    expect(md).toContain("### Hazard Suppression");
    expect(md).toContain("### Cross-Axis Rejection");
    expect(md).toContain("### Latency Benchmark");
    expect(md).toContain("## Strengths");
    expect(md).toContain("## Weaknesses");
    expect(md).toContain("## Recommendations");
  });
});

describe("enhanced report generator — scoring defect fixes (B1)", () => {
  it("longConversation scoring uses Cohen's d magnitude (d=0.8 → score=1.0)", () => {
    const dims: EnhancedEvalDimensions = {
      longConversation: { significant: true, cohensD: 0.8, achieved: true },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.longConversation).toBeCloseTo(1.0, 5);
  });

  it("longConversation scoring uses Cohen's d magnitude (d=0.4 → score=0.5)", () => {
    const dims: EnhancedEvalDimensions = {
      longConversation: { significant: true, cohensD: 0.4, achieved: true },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.longConversation).toBeCloseTo(0.5, 5);
  });

  it("longConversation scoring returns 0.2 when not significant", () => {
    const dims: EnhancedEvalDimensions = {
      longConversation: { significant: false, cohensD: 0.0, achieved: false },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.longConversation).toBeCloseTo(0.2, 5);
  });

  it("temporalEvolution scoring halves when invalidateEffect >= 0", () => {
    const dimsGood: EnhancedEvalDimensions = {
      temporalEvolution: { writeEffect: 1.0, invalidateEffect: -1.0 },
    };
    const dimsBad: EnhancedEvalDimensions = {
      temporalEvolution: { writeEffect: 1.0, invalidateEffect: 0.0 },
    };
    const reportGood = generateEnhancedReport(dimsGood);
    const reportBad = generateEnhancedReport(dimsBad);
    // Good: 1.0 * 1.0 = 1.0; Bad: 1.0 * 0.5 = 0.5
    expect(reportGood.summary.dimensionScores.temporalEvolution).toBeCloseTo(1.0, 5);
    expect(reportBad.summary.dimensionScores.temporalEvolution).toBeCloseTo(0.5, 5);
  });

  it("topicDrift scoring is affected by perTopicRecall (low min recall → low score)", () => {
    const dimsHigh: EnhancedEvalDimensions = {
      topicDrift: {
        perTopicRecall: [1, 1, 1],
        crossTopicInterference: 0,
        driftRecoveryTime: 1,
      },
    };
    const dimsLow: EnhancedEvalDimensions = {
      topicDrift: {
        perTopicRecall: [1, 1, 0.3],
        crossTopicInterference: 0,
        driftRecoveryTime: 1,
      },
    };
    const reportHigh = generateEnhancedReport(dimsHigh);
    const reportLow = generateEnhancedReport(dimsLow);
    // High: (1-0) * min(1,1,1) = 1.0; Low: (1-0) * min(1,1,0.3) = 0.3
    expect(reportHigh.summary.dimensionScores.topicDrift).toBeCloseTo(1.0, 5);
    expect(reportLow.summary.dimensionScores.topicDrift).toBeCloseTo(0.3, 5);
  });

  it("budgetPressure scoring is affected by kneePoint (high kneePoint → lower score)", () => {
    const dimsLow: EnhancedEvalDimensions = {
      budgetPressure: {
        maxRecall: 1.0,
        minRecall: 0.2,
        kneePoint: 0,
        budgetElasticity: 0.001,
      },
    };
    const dimsHigh: EnhancedEvalDimensions = {
      budgetPressure: {
        maxRecall: 1.0,
        minRecall: 0.2,
        kneePoint: 256,
        budgetElasticity: 0.001,
      },
    };
    const reportLow = generateEnhancedReport(dimsLow);
    const reportHigh = generateEnhancedReport(dimsHigh);
    // Low kneePoint: 1.0 * (1 - 0/512) = 1.0
    // High kneePoint: 1.0 * (1 - 256/512) = 0.5
    expect(reportLow.summary.dimensionScores.budgetPressure).toBeCloseTo(1.0, 5);
    expect(reportHigh.summary.dimensionScores.budgetPressure).toBeCloseTo(0.5, 5);
  });

  it("utility scoring includes p95 weight (low p95 pulls score down)", () => {
    const dimsHigh: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9, p95Utility: 0.9 },
    };
    const dimsLow: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9, p95Utility: 0.3 },
    };
    const reportHigh = generateEnhancedReport(dimsHigh);
    const reportLow = generateEnhancedReport(dimsLow);
    // High: 0.9*0.7 + 0.9*0.3 = 0.9
    // Low: 0.9*0.7 + 0.3*0.3 = 0.63 + 0.09 = 0.72
    expect(reportHigh.summary.dimensionScores.utility).toBeCloseTo(0.9, 5);
    expect(reportLow.summary.dimensionScores.utility).toBeCloseTo(0.72, 5);
  });

  it("utility scoring falls back to meanUtility when p95 is undefined", () => {
    const dims: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.8, meanCoverage: 0.8, meanCompleteness: 0.8 },
    };
    const report = generateEnhancedReport(dims);
    // 0.8*0.7 + 0.8*0.3 = 0.8
    expect(report.summary.dimensionScores.utility).toBeCloseTo(0.8, 5);
  });
});

describe("enhanced report generator — new dimensions (B2)", () => {
  it("conflictResolution score = suppressionRate * (1 - wrongWinnerRate)", () => {
    const dims: EnhancedEvalDimensions = {
      conflictResolution: {
        wrongConflictWinnerRate: 0.1,
        conflictSuppressionRate: 0.9,
      },
    };
    const report = generateEnhancedReport(dims);
    // 0.9 * (1 - 0.1) = 0.9 * 0.9 = 0.81
    expect(report.summary.dimensionScores.conflictResolution).toBeCloseTo(0.81, 5);
  });

  it("conflictResolution score is 0 when suppressionRate is 0", () => {
    const dims: EnhancedEvalDimensions = {
      conflictResolution: {
        wrongConflictWinnerRate: 0,
        conflictSuppressionRate: 0,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.conflictResolution).toBe(0);
  });

  it("hazardSuppression score = piRate * rlRate", () => {
    const dims: EnhancedEvalDimensions = {
      hazardSuppression: {
        promptInjectionSuppressionRate: 0.9,
        rawLeakSuppressionRate: 0.8,
        hazardStringLeaked: [],
      },
    };
    const report = generateEnhancedReport(dims);
    // 0.9 * 0.8 = 0.72
    expect(report.summary.dimensionScores.hazardSuppression).toBeCloseTo(0.72, 5);
  });

  it("hazardSuppression score is 0 when either rate is 0", () => {
    const dims: EnhancedEvalDimensions = {
      hazardSuppression: {
        promptInjectionSuppressionRate: 0,
        rawLeakSuppressionRate: 1.0,
        hazardStringLeaked: [],
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.hazardSuppression).toBe(0);
  });

  it("crossAxisRejection score = coverage * correctReasonRate", () => {
    const dims: EnhancedEvalDimensions = {
      crossAxisRejection: {
        rejectionCoverage: 0.9,
        allReasonsFired: false,
        correctReasonRate: 0.8,
      },
    };
    const report = generateEnhancedReport(dims);
    // 0.9 * 0.8 = 0.72
    expect(report.summary.dimensionScores.crossAxisRejection).toBeCloseTo(0.72, 5);
  });

  it("crossAxisRejection score is 0 when coverage is 0", () => {
    const dims: EnhancedEvalDimensions = {
      crossAxisRejection: {
        rejectionCoverage: 0,
        allReasonsFired: false,
        correctReasonRate: 1.0,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.dimensionScores.crossAxisRejection).toBe(0);
  });

  it("latencyBenchmark score = (1 - p95/budget) * (1 - tokenP95/budget)", () => {
    const dims: EnhancedEvalDimensions = {
      latencyBenchmark: {
        latencyMsP50: 5,
        latencyMsP95: 25,
        tokenOverheadP50: 50,
        tokenOverheadP95: 100,
      },
    };
    const report = generateEnhancedReport(dims);
    // (1 - 25/50) * (1 - 100/200) = 0.5 * 0.5 = 0.25
    expect(report.summary.dimensionScores.latencyBenchmark).toBeCloseTo(0.25, 5);
  });

  it("latencyBenchmark score is 0 when p95 exceeds budget", () => {
    const dims: EnhancedEvalDimensions = {
      latencyBenchmark: {
        latencyMsP50: 40,
        latencyMsP95: 60,
        tokenOverheadP50: 100,
        tokenOverheadP95: 250,
      },
    };
    const report = generateEnhancedReport(dims);
    // (1 - 60/50) clamped to 0 → 0; so overall 0
    expect(report.summary.dimensionScores.latencyBenchmark).toBe(0);
  });
});

describe("enhanced report generator — rejection distribution (B3)", () => {
  it("rejectionReasonDistribution is undefined when rejectionCounts is not provided", () => {
    const dims: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9 },
    };
    const report = generateEnhancedReport(dims);
    expect(report.rejectionReasonDistribution).toBeUndefined();
  });

  it("rejectionReasonDistribution is empty when all counts are 0", () => {
    const dims: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9 },
    };
    const report = generateEnhancedReport(dims, {
      rejectionCounts: {
        record_kind_not_fact: 0,
        conflicting_fact: 0,
        token_budget_exceeded: 0,
      },
    });
    expect(report.rejectionReasonDistribution).toEqual([]);
  });

  it("rejectionReasonDistribution computes count and percentage correctly", () => {
    const dims: EnhancedEvalDimensions = {
      utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9 },
    };
    const report = generateEnhancedReport(dims, {
      rejectionCounts: {
        conflicting_fact: 6,
        task_mismatch: 3,
        subject_mismatch: 1,
      },
    });
    expect(report.rejectionReasonDistribution).toHaveLength(3);
    // Sorted by count descending
    expect(report.rejectionReasonDistribution![0].reason).toBe("conflicting_fact");
    expect(report.rejectionReasonDistribution![0].count).toBe(6);
    expect(report.rejectionReasonDistribution![0].percentage).toBeCloseTo(0.6, 5);
    expect(report.rejectionReasonDistribution![1].reason).toBe("task_mismatch");
    expect(report.rejectionReasonDistribution![1].percentage).toBeCloseTo(0.3, 5);
    expect(report.rejectionReasonDistribution![2].reason).toBe("subject_mismatch");
    expect(report.rejectionReasonDistribution![2].percentage).toBeCloseTo(0.1, 5);
  });

  it("Markdown output includes rejection distribution section when provided", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, {
      now: () => 1_000,
      rejectionCounts: {
        conflicting_fact: 2,
        task_mismatch: 1,
      },
    });
    const md = formatEnhancedReportAsMarkdown(report);
    expect(md).toContain("### Rejection Reason Distribution");
    expect(md).toContain("| conflicting_fact | 2 |");
    expect(md).toContain("| task_mismatch | 1 |");
  });
});

describe("enhanced report generator — new recommendations (B4)", () => {
  it("generates recommendation when wrongConflictWinnerRate > 0", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      conflictResolution: {
        wrongConflictWinnerRate: 0.1,
        conflictSuppressionRate: 1.0,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.recommendations.some((r) => r.includes("冲突解决选出错误 winner"))).toBe(true);
  });

  it("generates recommendation when hazardStringLeaked is non-empty", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      hazardSuppression: {
        promptInjectionSuppressionRate: 1.0,
        rawLeakSuppressionRate: 1.0,
        hazardStringLeaked: ["record_json leak"],
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.recommendations.some((r) => r.includes("风险字符串泄漏"))).toBe(true);
  });

  it("generates recommendation when correctReasonRate < 1", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      crossAxisRejection: {
        rejectionCoverage: 1.0,
        allReasonsFired: true,
        correctReasonRate: 0.8,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.recommendations.some((r) => r.includes("拒绝原因匹配错误"))).toBe(true);
  });

  it("generates recommendation when rejectionCoverage < 1", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      crossAxisRejection: {
        rejectionCoverage: 0.8,
        allReasonsFired: false,
        correctReasonRate: 1.0,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.recommendations.some((r) => r.includes("拒绝路径覆盖不全"))).toBe(true);
  });

  it("generates recommendation when latencyMsP95 exceeds budget", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      latencyBenchmark: {
        latencyMsP50: 30,
        latencyMsP95: 75,
        tokenOverheadP50: 100,
        tokenOverheadP95: 150,
      },
    };
    const report = generateEnhancedReport(dims);
    expect(report.summary.recommendations.some((r) => r.includes("延迟 P95 超标"))).toBe(true);
  });
});

describe("enhanced report generator — cross-dimension correlation (B5)", () => {
  it("crossDimensionCorrelation is generated when utility + at least one other dimension present", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, { now: () => 1_000 });
    expect(report.crossDimensionCorrelation).toBeDefined();
    expect(report.crossDimensionCorrelation!.pairs.length).toBeGreaterThan(0);
  });

  it("all pairs bothPass when all dimensions are perfect (overallJointPassRate = 1)", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, { now: () => 1_000 });
    const cdc = report.crossDimensionCorrelation!;
    expect(cdc.overallJointPassRate).toBe(1);
    for (const entry of cdc.pairs) {
      expect(entry.bothPass).toBe(true);
      expect(entry.jointScore).toBe(1);
    }
  });

  it("latency+utility pair fails when latency score < threshold", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      latencyBenchmark: {
        latencyMsP50: 30,
        latencyMsP95: 40,
        tokenOverheadP50: 100,
        tokenOverheadP95: 150,
      },
    };
    const report = generateEnhancedReport(dims);
    const cdc = report.crossDimensionCorrelation!;
    const latPair = cdc.pairs.find((p) => p.pair === "latencyBenchmark+utility");
    expect(latPair).toBeDefined();
    expect(latPair!.bothPass).toBe(false);
    expect(cdc.overallJointPassRate).toBeLessThan(1);
  });

  it("hazard+utility pair fails when hazard score < threshold", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      hazardSuppression: {
        promptInjectionSuppressionRate: 0.3,
        rawLeakSuppressionRate: 1.0,
        hazardStringLeaked: [],
      },
    };
    const report = generateEnhancedReport(dims);
    const cdc = report.crossDimensionCorrelation!;
    const hazPair = cdc.pairs.find((p) => p.pair === "hazardSuppression+utility");
    expect(hazPair).toBeDefined();
    expect(hazPair!.bothPass).toBe(false);
  });

  it("jointScore = min(scoreA, scoreB)", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      conflictResolution: {
        wrongConflictWinnerRate: 0,
        conflictSuppressionRate: 0.6,
      },
    };
    const report = generateEnhancedReport(dims);
    const cdc = report.crossDimensionCorrelation!;
    const confPair = cdc.pairs.find((p) => p.pair === "conflictResolution+utility");
    expect(confPair).toBeDefined();
    expect(confPair!.jointScore).toBeCloseTo(Math.min(0.6, 1.0), 5);
  });

  it("custom threshold is respected", () => {
    const dims: EnhancedEvalDimensions = {
      ...FULL_PERFECT_DIMS,
      conflictResolution: {
        wrongConflictWinnerRate: 0,
        conflictSuppressionRate: 0.7,
      },
    };
    const report = generateEnhancedReport(dims, { correlationThreshold: 0.8 });
    const cdc = report.crossDimensionCorrelation!;
    const confPair = cdc.pairs.find((p) => p.pair === "conflictResolution+utility");
    expect(confPair!.threshold).toBe(0.8);
    expect(confPair!.bothPass).toBe(false);
  });

  it("pairs only include dimensions that exist in scores", () => {
    const dims: EnhancedEvalDimensions = {
      longConversation: { significant: true, cohensD: 1.0, achieved: true },
    };
    const report = generateEnhancedReport(dims);
    const cdc = report.crossDimensionCorrelation!;
    expect(cdc.pairs).toHaveLength(0);
    expect(cdc.overallJointPassRate).toBe(0);
  });

  it("markdown contains cross-dimension correlation section", () => {
    const report = generateEnhancedReport(FULL_PERFECT_DIMS, { now: () => 1_000 });
    const md = formatEnhancedReportAsMarkdown(report);
    expect(md).toContain("### Cross-Dimension Correlation");
    expect(md).toContain("Overall joint pass rate");
    expect(md).toContain("latencyBenchmark+utility");
  });
});
