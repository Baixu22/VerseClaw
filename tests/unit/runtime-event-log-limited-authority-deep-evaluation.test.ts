import { describe, expect, it } from "vitest";
import {
  LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS,
  LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS,
  buildRuntimeEventLogLimitedAuthorityDeepEvaluation,
} from "./helpers/runtime-event-log-limited-authority-deep-eval";

describe("runtime event-log limited authority deep evaluation", () => {
  it("quantifies helper safety, coverage, diagnostics, and optimization readiness", () => {
    const evaluation = buildRuntimeEventLogLimitedAuthorityDeepEvaluation();
    const { corpus, observations, scorecard, diagnosticGroups } = evaluation;

    expect(corpus.length).toBeGreaterThanOrEqual(
      LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.minCaseCount,
    );
    expect(new Set(corpus.map((item) => item.id)).size).toBe(corpus.length);
    expect(observations.every((item) => item.report.fallbackSource === "long_task_checkpoints"))
      .toBe(true);
    expect(scorecard).toMatchObject({
      score: 100,
      decision: "ready_for_explicit_internal_wiring_spec_or_next_optimization",
      dimensions: LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS,
      thresholds: LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS,
      metrics: {
        caseCount: corpus.length,
        failClosedRate: LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.failClosedRate,
        cleanReadyRate: LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.cleanReadyRate,
        vetoBlockRate: LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.vetoBlockRate,
        boundarySensitivityRate:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.boundarySensitivityRate,
        rollbackSensitivityRate:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.rollbackSensitivityRate,
        forbiddenStringLeakCount:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.forbiddenStringLeakCount,
        defaultAuthorityDriftCount:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.defaultAuthorityDriftCount,
        taskLoopDecisionDriftCount:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.taskLoopDecisionDriftCount,
        schemaApiUiProviderTransportDriftCount:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.schemaApiUiProviderTransportDriftCount,
        diagnosticsBoundedRate:
          LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.diagnosticsBoundedRate,
        hardVetoCount: LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.hardVetoCount,
      },
    });
    expect(scorecard.score).toBeGreaterThanOrEqual(
      LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.minScore,
    );
    expect(scorecard.optimizationRecommendations).toEqual([
      "dedupe_limited_authority_test_fixture_builders",
      "group_diagnostics_by_gate_family_for_review_noise",
      "preserve_scorecard_thresholds_before_internal_wiring",
      "keep_reports_readable_without_expanding_runtime_authority",
    ]);
    expect(diagnosticGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: "opt-in / explicit invocation",
        codes: expect.arrayContaining(["explicit_invocation_required", "pilot_disabled"]),
      }),
      expect.objectContaining({
        family: "operator gate / kill switch",
        codes: expect.arrayContaining(["operator_gate_closed", "kill_switch_active"]),
      }),
      expect.objectContaining({
        family: "controlled dual-read evidence",
        codes: expect.arrayContaining([
          "dual_read_report_missing",
          "dual_read_report_invalid",
          "dual_read_report_not_ready",
        ]),
      }),
      expect.objectContaining({
        family: "veto gates",
        codes: expect.arrayContaining(["dual_read_veto_not_blocking"]),
      }),
      expect.objectContaining({
        family: "boundary proof",
        codes: expect.arrayContaining(["boundary_missing", "boundary_forbidden"]),
      }),
      expect.objectContaining({
        family: "rollback proof",
        codes: expect.arrayContaining(["rollback_proof_missing"]),
      }),
      expect.objectContaining({
        family: "bounded diagnostics / leakage",
        codes: expect.arrayContaining(["bounded_output"]),
      }),
    ]));
  });
});
