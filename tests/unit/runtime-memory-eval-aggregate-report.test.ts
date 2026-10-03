// @vitest-environment node
// Phase 38 D3: Aggregate report test.
// Verifies that generateAggregateReport correctly combines enhanced report,
// rejection coverage, and test suite results into a unified artifact.

import { describe, expect, it } from "vitest";
import {
  generateAggregateReport,
  formatAggregateReportAsMarkdown,
  ALL_REJECTION_REASONS,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/aggregate-report";
import {
  generateEnhancedReport,
  type EnhancedEvalDimensions,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/enhanced-report-eval";

const MOCK_DIMS: EnhancedEvalDimensions = {
  longConversation: { significant: true, cohensD: 1.2, achieved: true },
  utility: { meanUtility: 0.9, meanCoverage: 0.9, meanCompleteness: 0.9 },
};

describe("aggregate report generator", () => {
  it("generateAggregateReport merges enhanced report with rejection coverage and test suite", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS, { now: () => 1_000 });
    const report = generateAggregateReport({
      enhancedReport,
      firedReasons: [...ALL_REJECTION_REASONS],
      testSuite: { totalFiles: 12, passedFiles: 12, failedFiles: [] },
      now: () => 1_000,
    });

    expect(report.generatedAt).toBe(1_000);
    expect(report.enhancedReport).toBe(enhancedReport);
    expect(report.rejectionCoverage.totalReasons).toBe(13);
    expect(report.rejectionCoverage.firedReasons).toHaveLength(13);
    expect(report.rejectionCoverage.missingReasons).toEqual([]);
    expect(report.rejectionCoverage.coverageRate).toBe(1);
    expect(report.testSuite.totalFiles).toBe(12);
    expect(report.testSuite.passedFiles).toBe(12);
    expect(report.testSuite.failedFiles).toEqual([]);
  });

  it("rejectionCoverage computes missing reasons correctly when some are not fired", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS);
    const partialFired = [
      "record_kind_not_fact",
      "task_mismatch",
      "conflicting_fact",
    ];
    const report = generateAggregateReport({
      enhancedReport,
      firedReasons: partialFired,
    });

    expect(report.rejectionCoverage.totalReasons).toBe(13);
    expect(report.rejectionCoverage.firedReasons).toHaveLength(3);
    expect(report.rejectionCoverage.missingReasons).toHaveLength(10);
    expect(report.rejectionCoverage.coverageRate).toBeCloseTo(3 / 13, 5);
    expect(report.rejectionCoverage.missingReasons).toContain("prompt_injection_sentinel");
    expect(report.rejectionCoverage.missingReasons).toContain("raw_leak_sentinel");
    expect(report.rejectionCoverage.missingReasons).toContain("limit_exceeded");
  });

  it("rejectionCoverage handles empty firedReasons", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS);
    const report = generateAggregateReport({
      enhancedReport,
      firedReasons: [],
    });

    expect(report.rejectionCoverage.firedReasons).toEqual([]);
    expect(report.rejectionCoverage.missingReasons).toHaveLength(13);
    expect(report.rejectionCoverage.coverageRate).toBe(0);
  });

  it("default testSuite is empty when not provided", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS);
    const report = generateAggregateReport({ enhancedReport });

    expect(report.testSuite.totalFiles).toBe(0);
    expect(report.testSuite.passedFiles).toBe(0);
    expect(report.testSuite.failedFiles).toEqual([]);
  });

  it("defaults aggregate evidence to unaccepted synthetic data", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS);
    const report = generateAggregateReport({ enhancedReport });

    expect(report.evidenceClass).toBe("synthetic");
    expect(report.accepted).toBe(false);
    expect(report.acceptanceNote).toContain("not runtime or live-session");
  });

  it("preserves an explicitly supplied evidence classification", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS);
    const report = generateAggregateReport({
      enhancedReport,
      evidenceClass: "runtime-fixture",
      accepted: false,
      acceptanceNote: "Fixture-only regression evidence.",
    });

    expect(report.evidenceClass).toBe("runtime-fixture");
    expect(report.accepted).toBe(false);
    expect(report.acceptanceNote).toBe("Fixture-only regression evidence.");
  });

  it("Markdown output contains all sections", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS, { now: () => 1_000 });
    const report = generateAggregateReport({
      enhancedReport,
      firedReasons: [...ALL_REJECTION_REASONS],
      testSuite: { totalFiles: 12, passedFiles: 11, failedFiles: ["test-x.ts"] },
      now: () => 1_000,
    });
    const md = formatAggregateReportAsMarkdown(report);

    expect(md).toContain("# Runtime Memory Aggregate Evaluation Report");
    expect(md).toContain("## Rejection Coverage");
    expect(md).toContain("## Test Suite");
    expect(md).toContain("### Fired Rejection Reasons");
    expect(md).toContain("### Failed Files");
    expect(md).toContain("test-x.ts");
    expect(md).toContain("Coverage rate: 100.0%");
  });

  it("Markdown does not include missing reasons section when coverage is complete", () => {
    const enhancedReport = generateEnhancedReport(MOCK_DIMS, { now: () => 1_000 });
    const report = generateAggregateReport({
      enhancedReport,
      firedReasons: [...ALL_REJECTION_REASONS],
      now: () => 1_000,
    });
    const md = formatAggregateReportAsMarkdown(report);

    expect(md).not.toContain("### Missing Rejection Reasons");
  });
});
