import { describe, expect, it } from "vitest";
import {
  buildAstReadonlyInvestmentEvalReport,
  writeAstReadonlyInvestmentEvalReport,
} from "./helpers/ast-readonly-investment-eval";

describe("AST readonly internal investment evaluation", () => {
  it("quantifies migration scenario value without granting runtime authority", () => {
    const report = buildAstReadonlyInvestmentEvalReport();
    const outPath = writeAstReadonlyInvestmentEvalReport(report);

    expect(report.scope).toBe("ast_readonly_internal_investment_eval");
    expect(report.summary.sampleCount).toBe(30);
    expect(report.summary.passCount).toBe(report.summary.sampleCount);
    expect(report.summary.failCount).toBe(0);
    expect(report.summary.precision).toBe(1);
    expect(report.summary.falsePositiveRate).toBe(0);
    expect(report.summary.falseNegativeRate).toBe(0);
    expect(report.summary.failClosedRate).toBe(1);
    expect(report.summary.authorityViolationCount).toBe(0);
    expect(report.summary.reviewRequiredRate).toBe(0);
    expect(report.summary.boundedOmissionRate).toBe(0);
    expect(report.summary.previewSliceCoverageRate).toBe(1);
    expect(report.summary.semanticPrecheckCoverageRate).toBe(1);
    expect(report.summary.batchSplitCoverageRate).toBe(1);
    expect(report.summary.semanticContractHoldRate).toBe(0.2);
    expect(report.latency.p95Ms).toBeLessThan(1_500);
    expect(report.volume.maxFiles).toBeGreaterThanOrEqual(5);
    expect(report.volume.maxMatches).toBeGreaterThanOrEqual(5);
    expect(report.componentMaturity).toBe("promising_but_needs_more_evidence");
    expect(report.investmentDecision).toBe("limited_invest");
    expect(report.recommendedInvestmentScenarios).toEqual([
      "api_rename",
      "import_rewrite",
      "deprecated_option_removal",
      "react_prop_rename",
    ]);
    expect(report.notRecommendedInvestmentScenarios).toEqual(["ipc_host_api_route_rename"]);
    expect(report.evidenceQuality).toMatchObject({
      readiness: "usable_for_internal_review_packets",
      score: 100,
      explicitTargetCoverageRate: 1,
      reviewPacketCompletenessRate: 1,
      semanticPrecheckCoverageRate: 1,
      batchCompletenessRate: 1,
      failClosedCoverageRate: 1,
      authorityCleanRate: 1,
      routeHoldCoverageRate: 1,
      operatorActionabilityRate: 1,
      evidenceQualityViolationCount: 0,
    });
    expect(report.authority).toMatchObject({
      readonly: true,
      diagnosticsOnly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      notCompletionEvidence: true,
    });
    expect(outPath).toContain("artifacts");

    for (const scenario of report.scenarioBreakdown) {
      const kinds = new Set(
        report.cases.filter((item) => item.scenarioId === scenario.scenarioId).map((item) => item.kind),
      );
      expect(kinds).toEqual(new Set([
        "true_positive_fixture",
        "near_miss_false_positive_trap",
        "real_corpus_fixture",
        "overbroad_rule",
        "invalid_input",
        "budget_or_preview_pressure",
      ]));
      expect(scenario.sampleCount).toBe(6);
      expect(scenario.precision).toBe(1);
      expect(scenario.falsePositiveRate).toBe(0);
      expect(scenario.falseNegativeRate).toBe(0);
      expect(scenario.failClosedRate).toBe(1);
      expect(scenario.reviewRequiredRate).toBe(0);
      expect(scenario.boundedOmissionRate).toBe(0);
      expect(scenario.semanticPrecheckCoverageRate).toBe(1);
      expect(["invest", "limited_invest", "hold", "stop"]).toContain(scenario.verdict);
    }

    expect(report.completedOptimizations.map((item) => [item.id, item.before, item.after])).toEqual([
      ["scenario_batch_splitter", 0.36, 0],
      ["semantic_precheck_metadata", 0, 1],
      ["real_corpus_expansion", 25, 30],
    ]);
    expect(report.currentShortfalls.map((item) => item.id)).toEqual([
      "route_contract_review_hold",
    ]);
    expect(report.nextOptimizations.map((item) => item.id)).toEqual([
      "host_api_contract_precheck",
      "reviewed_corpus_expansion",
    ]);
    expect(report.realUsePlaybook.allowedUseCases.map((item) => item.id)).toEqual([
      "bounded_migration_review_packet",
      "batch_candidate_inventory",
      "route_boundary_hold_packet",
    ]);
    expect(report.realUsePlaybook.allowedUseCases[0]).toMatchObject({
      scenarioIds: [
        "api_rename",
        "import_rewrite",
        "deprecated_option_removal",
        "react_prop_rename",
      ],
      boundary: "internal_review_only",
    });
    expect(report.realUsePlaybook.allowedUseCases[2]).toMatchObject({
      scenarioIds: ["ipc_host_api_route_rename"],
      boundary: "proof_hold_only",
    });
    expect(report.realUsePlaybook.disallowedUseCases.map((item) => item.id)).toEqual([
      "automatic_code_change",
      "runtime_decision_input",
      "repo_wide_discovery",
      "route_change_without_contract_owner",
    ]);
    expect(report.failureResponsePlan.strategyCoverageRate).toBe(1);
    expect(report.failureResponsePlan.strategies.map((item) => item.trigger)).toEqual([
      "invalid_rule_or_input",
      "overbroad_rule",
      "match_budget_pressure",
      "preview_budget_pressure",
      "semantic_precheck_gap",
      "ipc_host_api_route_contract_gap",
      "authority_boundary_violation",
    ]);

    console.info("AST readonly investment-eval summary", {
      sampleCount: report.summary.sampleCount,
      precision: report.summary.precision,
      falsePositiveRate: report.summary.falsePositiveRate,
      falseNegativeRate: report.summary.falseNegativeRate,
      failClosedRate: report.summary.failClosedRate,
      reviewRequiredRate: report.summary.reviewRequiredRate,
      boundedOmissionRate: report.summary.boundedOmissionRate,
      semanticPrecheckCoverageRate: report.summary.semanticPrecheckCoverageRate,
      batchSplitCoverageRate: report.summary.batchSplitCoverageRate,
      evidenceQualityScore: report.evidenceQuality.score,
      evidenceReadiness: report.evidenceQuality.readiness,
      p95Ms: report.latency.p95Ms,
      componentMaturity: report.componentMaturity,
      investmentDecision: report.investmentDecision,
      reportPath: outPath,
    });
  });
});
