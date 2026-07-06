import { describe, expect, it } from "vitest";
import {
  buildAstReadonlyDeepEvalReport,
  writeAstReadonlyDeepEvalReport,
} from "./helpers/ast-readonly-deep-eval";

describe("AST readonly internal deep evaluation", () => {
  it("quantifies current shortfalls and emits an optimization plan without runtime authority", () => {
    const report = buildAstReadonlyDeepEvalReport();
    const outPath = writeAstReadonlyDeepEvalReport(report);

    expect(report.scope).toBe("ast_readonly_internal_optimization_eval");
    expect(report.status).toBe("ready_for_internal_optimization");
    expect(report.summary.sampleCount).toBeGreaterThanOrEqual(30);
    expect(report.summary.exactExpectedOutputRate).toBe(1);
    expect(report.summary.failClosedRate).toBe(1);
    expect(report.summary.authorityViolationCount).toBe(0);
    expect(report.summary.falsePositiveRate).toBe(0);
    expect(report.summary.falseNegativeRate).toBe(0);
    expect(report.summary.boundedOmissionRate).toBeGreaterThan(0);
    expect(report.latency.p95Ms).toBeLessThan(1_500);
    expect(report.byStatus).toMatchObject({
      skipped: 1,
      success: expect.any(Number),
      invalid_rule: 5,
      invalid_input: 2,
      scan_failed: 1,
      review_required: 1,
    });
    expect(report.byDiagnosticCode).toMatchObject({
      flag_disabled: 1,
      preview_diff_disabled: 1,
      unfixable_rule: 1,
      overbroad_pattern: 1,
      unbound_metavariable: expect.any(Number),
      unsupported_transform: 1,
      invalid_language: 1,
      invalid_target_files: 1,
      target_language_mismatch: 1,
      parse_error: 1,
      preflight_budget_exceeded: 1,
      preview_diff_truncated: 1,
    });
    expect(report.summary.preflightPreventedScanCount).toBe(1);
    expect(report.summary.previewSliceCoverageRate).toBe(1);
    expect(report.shortfalls).toEqual([]);
    expect(report.executedOptimizations.map((item) => item.id)).toEqual([
      "preflight_estimator",
      "per_file_preview_slices",
    ]);
    expect(report.optimizationPlan).toEqual([]);
    expect(report.authority).toMatchObject({
      readonly: true,
      diagnosticsOnly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      notTaskCompletionEvidence: true,
    });
    expect(outPath).toContain("artifacts");

    console.info("AST readonly deep-eval summary", {
      sampleCount: report.summary.sampleCount,
      exactExpectedOutputRate: report.summary.exactExpectedOutputRate,
      failClosedRate: report.summary.failClosedRate,
      reviewRequiredRate: report.summary.reviewRequiredRate,
      previewTruncationRate: report.summary.previewTruncationRate,
      p95Ms: report.latency.p95Ms,
      shortfalls: report.shortfalls.map((item) => item.id),
      reportPath: outPath,
    });
  });
});
