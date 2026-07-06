import { describe, expect, it } from "vitest";
import {
  CODE_TASK_EVIDENCE_GATE_ALLOW_RISK_TIERS,
  CODE_TASK_EVIDENCE_GATE_BLOCK_REASONS,
  CODE_TASK_EVIDENCE_GATE_EVIDENCE_CAPTURE_ISSUES,
  CODE_TASK_EVIDENCE_GATE_EVALUATION_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DECISIONS,
  CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DEFAULT_MAX_COLLECTIONS,
  CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_LEGACY_TERMINAL_STATUSES,
  CODE_TASK_EVIDENCE_GATE_MANUAL_REVIEW_LABELS,
  CODE_TASK_EVIDENCE_GATE_READINESS_DECISIONS,
  CODE_TASK_EVIDENCE_GATE_READINESS_STAGES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DECISIONS,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DEFAULT_MAX_SAMPLES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES,
  CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DECISIONS,
  CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_CAPABILITY_SHORTFALL_CODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_MODES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_OUTCOMES,
  CODE_TASK_EVIDENCE_GATE_SHADOW_DECISIONS,
  CODE_TASK_EVIDENCE_GATE_SHADOW_DIAGNOSTIC_CODES,
  CODE_TASK_EVIDENCE_GATE_TASK_KINDS,
  buildCodeTaskEvidenceGateInternalShadowObservationResult,
  buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport,
  buildCodeTaskEvidenceGateShadowEvidenceQualityReport,
  buildCodeTaskEvidenceGateRuntimeCallerResult,
  buildCodeTaskEvidenceGateRuntimeShadowCollectionResult,
  buildCodeTaskEvidenceGateRuntimeShadowProducerResult,
  buildCodeTaskEvidenceGateShadowSamplerEvent,
  buildCodeTaskEvidenceGateShadowReport,
  buildEvidenceRefFixture,
  buildEvidenceVerifierInputFixture,
  buildToolCallResultFixture,
  evaluateEvidenceVerifier,
  evaluateCodeTaskEvidenceGateShadowSamples,
  evaluateCodeTaskEvidenceGateReadiness,
  evaluateCodeTaskEvidenceGateRuntimeReplayReadiness,
  evaluateCodeTaskEvidenceGateRuntimeReplaySamples,
  summarizeCodeTaskEvidenceGateRuntimeCallerResults,
  summarizeCodeTaskEvidenceGateShadowReports,
  summarizeCodeTaskEvidenceGateShadowSamplerEvents,
  type CodeTaskEvidenceGateEvaluationSample,
  type CodeTaskEvidenceGateManualReviewLabel,
  type CodeTaskEvidenceGateRuntimeCallerInput,
  type CodeTaskEvidenceGateRuntimeReplaySample,
  type CodeTaskEvidenceGateRuntimeShadowProducerResult,
  type CodeTaskEvidenceGateShadowInput,
  type EvidenceVerifierInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime evidence verifier code-task gate shadow MVP", () => {
  it("defines a closed shadow taxonomy without changing verifier flags", () => {
    expect(CODE_TASK_EVIDENCE_GATE_TASK_KINDS).toEqual([
      "code_edit",
      "non_code",
      "unknown",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_LEGACY_TERMINAL_STATUSES).toEqual([
      "complete",
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "error",
      "repair",
      "unknown",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_DECISIONS).toEqual([
      "would_allow",
      "would_block",
      "not_applicable",
      "invalid_input",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_BLOCK_REASONS).toEqual([
      "missing_verifier_report",
      "verifier_failed",
      "verifier_blocked",
      "verifier_cancelled",
      "verifier_insufficient_evidence",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_EVIDENCE_CAPTURE_ISSUES).toEqual([
      "truly_missing_validation",
      "validation_done_but_not_captured",
      "external_validation_not_represented",
      "local_test_not_required",
      "report_task_id_or_shape_issue",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SEMANTIC_RISK_CODES).toEqual([
      "evidence_diff_mismatch",
      "weak_test_coverage",
      "changed_files_not_represented",
      "obligation_not_mapped_to_evidence",
      "semantic_regression_risk",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_ALLOW_RISK_TIERS).toEqual([
      "clean_allow",
      "risky_allow",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SAMPLE_CATEGORIES).toContain(
      "semantic_regression_with_complete_refs",
    );
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_DIAGNOSTIC_CODES).toContain(
      "legacy_not_completed",
    );
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_DIAGNOSTIC_CODES).toContain(
      "changed_files_not_represented",
    );
    expect(CODE_TASK_EVIDENCE_GATE_MANUAL_REVIEW_LABELS).toEqual([
      "valid_completion",
      "bad_completion",
      "inconclusive",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_EVALUATION_OUTCOMES).toEqual([
      "true_allow",
      "useful_block",
      "false_block",
      "false_allow",
      "inconclusive",
      "not_evaluated",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_READINESS_STAGES).toEqual([
      "offline_corpus",
      "shadow_sampler",
      "active_pilot",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_READINESS_DECISIONS).toEqual([
      "ready",
      "needs_more_evidence",
      "blocked",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DECISIONS).toEqual([
      "ready_for_limited_default_off_readiness_review",
      "continue_internal_shadow_observation_hardening",
      "stop_or_freeze_route",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_QUALITY_DIAGNOSTIC_CODES)
      .toEqual([
        "shadow_evidence_quality_no_input",
        "shadow_evidence_quality_incomplete_inputs",
        "shadow_evidence_quality_false_block_causes_covered",
        "shadow_evidence_quality_false_block_causes_incomplete",
        "shadow_evidence_quality_risky_false_allows_covered",
        "shadow_evidence_quality_risky_false_allows_incomplete",
        "shadow_evidence_quality_runtime_replay_ready",
        "shadow_evidence_quality_runtime_replay_continue_hardening",
        "shadow_evidence_quality_runtime_replay_blocked",
        "shadow_evidence_quality_observation_ready",
        "shadow_evidence_quality_observation_continue_hardening",
        "shadow_evidence_quality_observation_stop_or_freeze",
        "shadow_evidence_quality_non_authoritative",
        "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
      ]);
    expect(
      CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_REQUIRED_CATEGORIES,
    ).toEqual([
      "valid_full_evidence",
      "missing_validation_evidence",
      "tool_or_test_failure",
      "missing_verifier_report",
      "local_test_not_required",
      "external_validation_uncaptured",
      "non_code_task",
      "legacy_not_completed",
      "reviewer_inconclusive",
      "semantic_regression_with_complete_refs",
      "report_shape_issue",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_DIAGNOSTIC_CODES)
      .toEqual([
        "shadow_evidence_optimization_strategy_ready",
        "shadow_evidence_optimization_strategy_continue_hardening",
        "shadow_evidence_optimization_strategy_stop_or_freeze",
        "shadow_evidence_optimization_matrix_complete",
        "shadow_evidence_optimization_matrix_incomplete",
        "shadow_evidence_optimization_min_samples_not_met",
        "shadow_evidence_optimization_min_evaluated_candidates_not_met",
        "shadow_evidence_optimization_block_precision_missing",
        "shadow_evidence_optimization_block_precision_below_threshold",
        "shadow_evidence_optimization_false_block_rate_missing",
        "shadow_evidence_optimization_false_block_rate_above_threshold",
        "shadow_evidence_optimization_false_allow_rate_missing",
        "shadow_evidence_optimization_false_allow_rate_above_threshold",
        "shadow_evidence_optimization_non_authoritative",
        "shadow_evidence_optimization_active_pilot_still_forbidden",
      ]);
    expect(
      CODE_TASK_EVIDENCE_GATE_SHADOW_EVIDENCE_OPTIMIZATION_CAPABILITY_SHORTFALL_CODES,
    ).toEqual([
      "quality_strategy_not_ready",
      "sample_count_below_threshold",
      "evaluated_candidate_count_below_threshold",
      "fixture_matrix_incomplete",
      "block_precision_missing",
      "block_precision_below_threshold",
      "false_block_rate_missing",
      "false_block_rate_above_threshold",
      "false_allow_rate_missing",
      "false_allow_rate_above_threshold",
      "false_block_cause_coverage_incomplete",
      "risky_false_allow_share_below_threshold",
      "authority_parity_broken",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_MODES).toEqual([
      "disabled",
      "shadow_only",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_OUTCOMES).toEqual([
      "not_sampled",
      "sampled",
      "invalid_input",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_SHADOW_SAMPLER_DIAGNOSTIC_CODES).toEqual([
      "sampler_disabled",
      "sampler_invalid_input",
      "sampler_shadow_sampled",
      "sampler_non_authoritative",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_OUTCOMES).toEqual([
      "disabled",
      "sampled",
      "invalid_input",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_CALLER_DIAGNOSTIC_CODES).toEqual([
      "runtime_shadow_sampler_disabled",
      "runtime_shadow_sampler_invalid_input",
      "runtime_shadow_sampler_sampled",
      "runtime_shadow_sampler_non_authoritative",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_REPLAY_READINESS_DECISIONS).toEqual([
      "ready_for_shadow_evidence_review",
      "continue_runtime_shadow_replay",
      "blocked",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_OUTCOMES).toEqual([
      "disabled",
      "sampled",
      "invalid_input",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_PRODUCER_DIAGNOSTIC_CODES)
      .toEqual([
        "runtime_shadow_producer_disabled",
        "runtime_shadow_producer_invalid_input",
        "runtime_shadow_producer_sampled",
        "runtime_shadow_producer_would_block",
        "runtime_shadow_producer_risky_allow",
        "runtime_shadow_producer_non_authoritative",
      ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DEFAULT_MAX_SAMPLES)
      .toBe(20);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_OUTCOMES).toEqual([
      "disabled",
      "collected",
      "invalid_input",
    ]);
    expect(CODE_TASK_EVIDENCE_GATE_RUNTIME_SHADOW_COLLECTION_DIAGNOSTIC_CODES)
      .toEqual([
        "runtime_shadow_collection_disabled",
        "runtime_shadow_collection_invalid_input",
        "runtime_shadow_collection_sample_limit_applied",
        "runtime_shadow_collection_collected",
        "runtime_shadow_collection_non_authoritative",
        "runtime_shadow_collection_active_pilot_still_requires_fresh_spec",
      ]);
    expect(CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DEFAULT_MAX_COLLECTIONS)
      .toBe(50);
    expect(CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_OUTCOMES)
      .toEqual([
        "disabled",
        "observed",
        "invalid_input",
      ]);
    expect(CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DECISIONS)
      .toEqual([
        "ready_for_limited_default_off_internal_shadow_observation_review",
        "continue_internal_shadow_observation_hardening",
        "stop_or_freeze_route",
      ]);
    expect(CODE_TASK_EVIDENCE_GATE_INTERNAL_SHADOW_OBSERVATION_DIAGNOSTIC_CODES)
      .toEqual([
        "internal_shadow_observation_disabled",
        "internal_shadow_observation_invalid_input",
        "internal_shadow_observation_collection_limit_applied",
        "internal_shadow_observation_no_collections",
        "internal_shadow_observation_observed",
        "internal_shadow_observation_replay_ready_for_review",
        "internal_shadow_observation_replay_continue_hardening",
        "internal_shadow_observation_replay_blocked",
        "internal_shadow_observation_non_authoritative",
        "internal_shadow_observation_active_pilot_still_forbidden",
      ]);
  });

  it("would allow a legacy-completed code task with a completed verifier report", () => {
    const report = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier());

    expect(report).toMatchObject({
      taskId: "task_1",
      decision: "would_allow",
      gateCandidate: true,
      wouldBlock: false,
      verifierDecision: "completed",
      allowRiskTier: "clean_allow",
      semanticRiskCodes: [],
      diagnostics: [{ code: "verifier_completed", severity: "info" }],
      legacyDecisionUnaffected: true,
    });
  });

  it("would block a legacy-completed code task when verifier evidence is missing", () => {
    const verifierReport = evaluateEvidenceVerifier(
      withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
    );
    const report = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier({
      verifierReport,
    }));

    expect(report).toMatchObject({
      decision: "would_block",
      gateCandidate: true,
      wouldBlock: true,
      blockReason: "verifier_insufficient_evidence",
      verifierDecision: "insufficient_evidence",
      diagnostics: [
        {
          code: "verifier_insufficient_evidence",
          findingCodes: ["missing_test_evidence"],
        },
        {
          code: "evidence_capture_truly_missing_validation",
          evidenceCaptureIssue: "truly_missing_validation",
        },
      ],
    });
  });

  it("would block failed verifier reports and preserve finding codes", () => {
    const verifierReport = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_error",
          status: "error",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_error" })],
        }),
      ],
    }));
    const report = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier({
      verifierReport,
    }));

    expect(report).toMatchObject({
      decision: "would_block",
      blockReason: "verifier_failed",
      verifierDecision: "failed",
      verifierFindingCodes: ["tool_result_error"],
      legacyDecisionUnaffected: true,
    });
  });

  it("would block a legacy-completed code task when no verifier report exists", () => {
    const report = buildCodeTaskEvidenceGateShadowReport({
      taskId: "task_missing_report",
      objective: "Implement a code change.",
      taskKind: "code_edit",
      legacyTerminalStatus: "complete",
    });

    expect(report).toMatchObject({
      decision: "would_block",
      gateCandidate: true,
      wouldBlock: true,
      blockReason: "missing_verifier_report",
      evidenceCaptureIssue: "truly_missing_validation",
      diagnostics: [
        { code: "missing_verifier_report", severity: "warning" },
        {
          code: "evidence_capture_truly_missing_validation",
          severity: "warning",
        },
      ],
    });
  });

  it("classifies evidence-capture false-block sources without changing block behavior", () => {
    const report = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier({
      verifierReport: evaluateEvidenceVerifier(
        withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
      ),
      metadata: {
        evidenceCaptureIssue: "local_test_not_required",
      },
    }));

    expect(report).toMatchObject({
      decision: "would_block",
      blockReason: "verifier_insufficient_evidence",
      evidenceCaptureIssue: "local_test_not_required",
    });
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "evidence_capture_local_test_not_required",
    );
  });

  it("marks completed verifier reports as risky allows when semantic signals are present", () => {
    const report = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier({
      metadata: {
        changedFiles: ["src/changed.ts"],
        evidenceDiffMismatch: true,
        obligationEvidenceMapped: false,
        semanticRegressionRisk: true,
        testCoverage: "weak",
      },
    }));

    expect(report).toMatchObject({
      decision: "would_allow",
      allowRiskTier: "risky_allow",
      semanticRiskCodes: [
        "evidence_diff_mismatch",
        "weak_test_coverage",
        "changed_files_not_represented",
        "obligation_not_mapped_to_evidence",
        "semantic_regression_risk",
      ],
    });
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "evidence_diff_mismatch",
        "weak_test_coverage",
        "changed_files_not_represented",
        "obligation_not_mapped_to_evidence",
        "semantic_regression_risk",
      ]),
    );
  });

  it("keeps non-code tasks and non-completed legacy states out of gate candidates", () => {
    const nonCode = buildCodeTaskEvidenceGateShadowReport({
      taskId: "task_docs",
      objective: "Update docs.",
      taskKind: "non_code",
      legacyTerminalStatus: "complete",
    });
    const notCompleted = buildCodeTaskEvidenceGateShadowReport({
      taskId: "task_repair",
      objective: "Repair a code change.",
      taskKind: "code_edit",
      legacyTerminalStatus: "repair",
    });

    expect(nonCode).toMatchObject({
      decision: "not_applicable",
      gateCandidate: false,
      diagnostics: [{ code: "non_code_task" }],
    });
    expect(notCompleted).toMatchObject({
      decision: "not_applicable",
      gateCandidate: false,
      diagnostics: [{ code: "legacy_not_completed" }],
    });
  });

  it("fails closed for invalid input and task id mismatch", () => {
    const invalid = buildCodeTaskEvidenceGateShadowReport({
      taskId: "",
      objective: "Missing task id.",
      taskKind: "code_edit",
      legacyTerminalStatus: "complete",
    });
    const mismatch = buildCodeTaskEvidenceGateShadowReport({
      ...inputWithVerifier(),
      taskId: "different_task",
    });

    expect(invalid).toMatchObject({
      taskId: "unknown",
      decision: "invalid_input",
      diagnostics: [{ code: "invalid_shadow_input", severity: "error" }],
    });
    expect(mismatch).toMatchObject({
      taskId: "different_task",
      decision: "invalid_input",
      diagnostics: [{ code: "verifier_report_task_mismatch", severity: "error" }],
    });
  });

  it("summarizes shadow reports for later risk and benefit evaluation", () => {
    const allow = buildCodeTaskEvidenceGateShadowReport(inputWithVerifier());
    const missing = buildCodeTaskEvidenceGateShadowReport({
      taskId: "task_missing_report",
      objective: "Implement a code change.",
      taskKind: "code_edit",
      legacyTerminalStatus: "complete",
    });
    const nonCode = buildCodeTaskEvidenceGateShadowReport({
      taskId: "task_docs",
      objective: "Update docs.",
      taskKind: "non_code",
      legacyTerminalStatus: "complete",
    });
    const invalid = buildCodeTaskEvidenceGateShadowReport({});

    expect(summarizeCodeTaskEvidenceGateShadowReports([
      allow,
      missing,
      nonCode,
      invalid,
    ])).toEqual({
      sampleCount: 4,
      gateCandidateCount: 2,
      wouldAllowCount: 1,
      wouldBlockCount: 1,
      notApplicableCount: 1,
      invalidInputCount: 1,
      blockReasonCounts: {
        missing_verifier_report: 1,
        verifier_failed: 0,
        verifier_blocked: 0,
        verifier_cancelled: 0,
        verifier_insufficient_evidence: 0,
      },
      evidenceCaptureIssueCounts: {
        truly_missing_validation: 1,
        validation_done_but_not_captured: 0,
        external_validation_not_represented: 0,
        local_test_not_required: 0,
        report_task_id_or_shape_issue: 0,
      },
      allowRiskTierCounts: {
        clean_allow: 1,
        risky_allow: 0,
      },
      semanticRiskCounts: {
        evidence_diff_mismatch: 0,
        weak_test_coverage: 0,
        changed_files_not_represented: 0,
        obligation_not_mapped_to_evidence: 0,
        semantic_regression_risk: 0,
      },
      verifierDecisionCounts: {
        completed: 1,
        failed: 0,
        blocked: 0,
        cancelled: 0,
        insufficient_evidence: 0,
        missing_report: 1,
      },
    });
  });

  it("keeps the shadow sampler default-off unless shadow_only is explicit", () => {
    const event = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler_default_off",
      sampleId: "sample_1",
      input: inputWithVerifier(),
    });

    expect(event).toEqual({
      eventKind: "code_task_evidence_gate_shadow_sample",
      samplerId: "sampler_default_off",
      sampleId: "sample_1",
      taskId: "task_1",
      mode: "disabled",
      outcome: "not_sampled",
      sampled: false,
      verifierFindingCodes: [],
      semanticRiskCodes: [],
      diagnosticCodes: ["sampler_disabled"],
      diagnostics: [
        {
          code: "sampler_disabled",
          severity: "info",
          message: "Default-off shadow sampler is disabled for this explicit call.",
        },
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      retention: "caller_owned_non_persistent",
      legacyDecisionUnaffected: true,
    });
  });

  it("builds a bounded non-authoritative sampler event in explicit shadow_only mode", () => {
    const event = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler_shadow",
      sampleId: "sample_2",
      mode: "shadow_only",
      input: inputWithVerifier({
        metadata: {
          changedFiles: ["src/changed.ts"],
          semanticRegressionRisk: true,
        },
      }),
    });

    expect(event).toMatchObject({
      eventKind: "code_task_evidence_gate_shadow_sample",
      samplerId: "sampler_shadow",
      sampleId: "sample_2",
      taskId: "task_1",
      mode: "shadow_only",
      outcome: "sampled",
      sampled: true,
      shadowDecision: "would_allow",
      gateCandidate: true,
      wouldBlock: false,
      allowRiskTier: "risky_allow",
      semanticRiskCodes: [
        "changed_files_not_represented",
        "semantic_regression_risk",
      ],
      diagnosticCodes: [
        "sampler_shadow_sampled",
        "sampler_non_authoritative",
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      retention: "caller_owned_non_persistent",
      legacyDecisionUnaffected: true,
    });
  });

  it("records invalid sampler input without sampling", () => {
    const event = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler_invalid",
      sampleId: "",
      mode: "shadow_only",
      input: inputWithVerifier(),
    });

    expect(event).toMatchObject({
      samplerId: "sampler_invalid",
      sampleId: "unknown",
      taskId: "task_1",
      mode: "disabled",
      outcome: "invalid_input",
      sampled: false,
      diagnosticCodes: ["sampler_invalid_input"],
      nonAuthoritative: true,
      completionAuthority: false,
    });
  });

  it("summarizes sampler events without granting completion authority", () => {
    const disabled = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler",
      sampleId: "disabled",
      input: inputWithVerifier(),
    });
    const allow = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler",
      sampleId: "allow",
      mode: "shadow_only",
      input: inputWithVerifier(),
    });
    const block = buildCodeTaskEvidenceGateShadowSamplerEvent({
      samplerId: "sampler",
      sampleId: "block",
      mode: "shadow_only",
      input: missingEvidenceInput(),
    });
    const invalid = buildCodeTaskEvidenceGateShadowSamplerEvent({});

    expect(summarizeCodeTaskEvidenceGateShadowSamplerEvents([
      disabled,
      allow,
      block,
      invalid,
    ])).toMatchObject({
      eventCount: 4,
      sampledCount: 2,
      notSampledCount: 2,
      invalidSamplerInputCount: 1,
      invalidShadowInputCount: 0,
      gateCandidateCount: 2,
      wouldAllowCount: 1,
      wouldBlockCount: 1,
      riskyAllowCount: 0,
      modeCounts: {
        disabled: 2,
        shadow_only: 2,
      },
      outcomeCounts: {
        not_sampled: 1,
        sampled: 2,
        invalid_input: 1,
      },
      shadowDecisionCounts: {
        would_allow: 1,
        would_block: 1,
        not_applicable: 0,
        invalid_input: 0,
        not_sampled: 2,
      },
      blockReasonCounts: {
        missing_verifier_report: 0,
        verifier_failed: 0,
        verifier_blocked: 0,
        verifier_cancelled: 0,
        verifier_insufficient_evidence: 1,
      },
      evidenceCaptureIssueCounts: {
        truly_missing_validation: 1,
        validation_done_but_not_captured: 0,
        external_validation_not_represented: 0,
        local_test_not_required: 0,
        report_task_id_or_shape_issue: 0,
      },
      diagnosticCodeCounts: {
        sampler_disabled: 1,
        sampler_invalid_input: 1,
        sampler_shadow_sampled: 2,
        sampler_non_authoritative: 2,
      },
      nonAuthoritativeCount: 4,
      completionAuthorityCount: 0,
      retention: "caller_owned_non_persistent",
      legacyDecisionUnaffected: true,
    });
  });

  it("keeps the runtime caller adapter disabled by default without requiring shadow input", () => {
    const result = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "completion_1",
      shadowInput: {
        taskId: "",
        objective: "Invalid shadow input should not matter while disabled.",
      },
    });

    expect(result).toEqual({
      callerId: "runtime_caller",
      completionEventId: "completion_1",
      mode: "disabled",
      outcome: "disabled",
      sampled: false,
      taskId: "unknown",
      diagnosticCodes: ["runtime_shadow_sampler_disabled"],
      diagnostics: [
        {
          code: "runtime_shadow_sampler_disabled",
          severity: "info",
          message: "Runtime shadow sampler caller is disabled by default.",
        },
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
  });

  it("lets the runtime caller adapter sample only in explicit shadow_only mode", () => {
    const result = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "completion_2",
      mode: "shadow_only",
      samplerId: "sampler",
      sampleId: "sample",
      shadowInput: inputWithVerifier(),
    });

    expect(result).toMatchObject({
      callerId: "runtime_caller",
      completionEventId: "completion_2",
      mode: "shadow_only",
      outcome: "sampled",
      sampled: true,
      taskId: "task_1",
      samplerEvent: {
        outcome: "sampled",
        shadowDecision: "would_allow",
        completionAuthority: false,
      },
      diagnosticCodes: [
        "runtime_shadow_sampler_sampled",
        "runtime_shadow_sampler_non_authoritative",
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
    });
  });

  it("fails closed for invalid explicit runtime caller sampling input", () => {
    const result = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "completion_3",
      mode: "shadow_only",
      shadowInput: inputWithVerifier(),
    });

    expect(result).toMatchObject({
      mode: "shadow_only",
      outcome: "invalid_input",
      sampled: false,
      diagnosticCodes: ["runtime_shadow_sampler_invalid_input"],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
    });
  });

  it("summarizes runtime caller adapter results without completion authority", () => {
    const disabled = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "disabled",
    });
    const sampled = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "sampled",
      mode: "shadow_only",
      samplerId: "sampler",
      sampleId: "sampled",
      shadowInput: missingEvidenceInput(),
    });
    const invalid = buildCodeTaskEvidenceGateRuntimeCallerResult({
      callerId: "runtime_caller",
      completionEventId: "invalid",
      mode: "shadow_only",
    });

    expect(summarizeCodeTaskEvidenceGateRuntimeCallerResults([
      disabled,
      sampled,
      invalid,
    ])).toMatchObject({
      resultCount: 3,
      sampledCount: 1,
      disabledCount: 1,
      invalidInputCount: 1,
      modeCounts: {
        disabled: 1,
        shadow_only: 2,
      },
      outcomeCounts: {
        disabled: 1,
        sampled: 1,
        invalid_input: 1,
      },
      diagnosticCodeCounts: {
        runtime_shadow_sampler_disabled: 1,
        runtime_shadow_sampler_invalid_input: 1,
        runtime_shadow_sampler_sampled: 1,
        runtime_shadow_sampler_non_authoritative: 1,
      },
      samplerSummary: {
        eventCount: 1,
        sampledCount: 1,
        wouldBlockCount: 1,
        completionAuthorityCount: 0,
      },
      nonAuthoritativeCount: 3,
      completionAuthorityCount: 0,
      runtimeDecisionUnaffectedCount: 3,
      legacyDecisionUnaffected: true,
    });
  });

  it("keeps the real-runtime shadow producer disabled without calling the caller adapter", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowProducerResult({
      producerId: "runtime_shadow_producer",
      completionEventId: "completion_disabled",
      completion: {
        taskId: "",
        objective: "Invalid completion metadata should not matter while disabled.",
        taskKind: "not_a_task_kind",
        legacyTerminalStatus: "not_a_status",
        verifierReport: { invalid: true },
      },
    });

    expect(result).toEqual({
      producerId: "runtime_shadow_producer",
      completionEventId: "completion_disabled",
      mode: "disabled",
      outcome: "disabled",
      sampled: false,
      taskId: "unknown",
      semanticRiskCodes: [],
      diagnosticCodes: ["runtime_shadow_producer_disabled"],
      diagnostics: [
        {
          code: "runtime_shadow_producer_disabled",
          severity: "info",
          message: "Default-off runtime shadow producer is disabled.",
        },
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
    expect(result.callerInput).toBeUndefined();
    expect(result.callerResult).toBeUndefined();
  });

  it("samples valid completions only in explicit real-runtime shadow producer mode", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("valid_completion", inputWithVerifier()),
    );

    expect(result).toMatchObject({
      producerId: "runtime_shadow_producer",
      completionEventId: "completion_valid_completion",
      mode: "shadow_only",
      outcome: "sampled",
      sampled: true,
      taskId: "task_1",
      shadowDecision: "would_allow",
      allowRiskTier: "clean_allow",
      diagnosticCodes: [
        "runtime_shadow_producer_sampled",
        "runtime_shadow_producer_non_authoritative",
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      callerResult: {
        outcome: "sampled",
        sampled: true,
        samplerEvent: {
          shadowDecision: "would_allow",
          completionAuthority: false,
        },
      },
    });
  });

  it("emits would-block producer diagnostics for missing reports and insufficient evidence", () => {
    const missingReport = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("missing_report", missingReportInput()),
    );
    const insufficientEvidence = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("insufficient_evidence", missingEvidenceInput()),
    );

    expect(missingReport).toMatchObject({
      outcome: "sampled",
      sampled: true,
      shadowDecision: "would_block",
      blockReason: "missing_verifier_report",
      diagnosticCodes: [
        "runtime_shadow_producer_sampled",
        "runtime_shadow_producer_would_block",
        "runtime_shadow_producer_non_authoritative",
      ],
      completionAuthority: false,
    });
    expect(insufficientEvidence).toMatchObject({
      outcome: "sampled",
      sampled: true,
      shadowDecision: "would_block",
      blockReason: "verifier_insufficient_evidence",
      diagnosticCodes: [
        "runtime_shadow_producer_sampled",
        "runtime_shadow_producer_would_block",
        "runtime_shadow_producer_non_authoritative",
      ],
      completionAuthority: false,
    });
  });

  it("emits risky-allow producer diagnostics for semantic-risk completions", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("risky_allow", inputWithVerifier({
        metadata: {
          changedFiles: ["src/changed.ts"],
          semanticRegressionRisk: true,
        },
      })),
    );

    expect(result).toMatchObject({
      outcome: "sampled",
      sampled: true,
      shadowDecision: "would_allow",
      allowRiskTier: "risky_allow",
      semanticRiskCodes: [
        "changed_files_not_represented",
        "semantic_regression_risk",
      ],
      diagnosticCodes: [
        "runtime_shadow_producer_sampled",
        "runtime_shadow_producer_risky_allow",
        "runtime_shadow_producer_non_authoritative",
      ],
      completionAuthority: false,
    });
  });

  it("fails closed for invalid explicit real-runtime shadow producer input", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowProducerResult({
      producerId: "runtime_shadow_producer",
      completionEventId: "completion_invalid",
      mode: "shadow_only",
      samplerId: "sampler",
      sampleId: "sample_invalid",
      completion: {
        taskId: "",
        objective: "Missing task id.",
        taskKind: "code_edit",
        legacyTerminalStatus: "complete",
      },
    });

    expect(result).toMatchObject({
      mode: "shadow_only",
      outcome: "invalid_input",
      sampled: false,
      taskId: "unknown",
      diagnosticCodes: ["runtime_shadow_producer_invalid_input"],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
    expect(result.callerResult).toBeUndefined();
  });

  it("feeds producer outputs into runtime replay readiness without active-pilot authority", () => {
    const usefulBlock = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("producer_useful_block", missingEvidenceInput()),
    );
    const falseBlock = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("producer_false_block", missingEvidenceInput()),
    );
    const riskyFalseAllow = buildCodeTaskEvidenceGateRuntimeShadowProducerResult(
      runtimeShadowProducerInput("producer_risky_false_allow", inputWithVerifier({
        metadata: {
          changedFiles: ["src/regression.ts"],
          semanticRegressionRisk: true,
        },
      })),
    );

    const report = evaluateCodeTaskEvidenceGateRuntimeReplaySamples([
      {
        replayId: "producer_useful_block",
        callerInput: requiredProducerCallerInput(usefulBlock),
        manualReviewLabel: "bad_completion",
      },
      {
        replayId: "producer_false_block",
        callerInput: requiredProducerCallerInput(falseBlock),
        manualReviewLabel: "valid_completion",
      },
      {
        replayId: "producer_risky_false_allow",
        callerInput: requiredProducerCallerInput(riskyFalseAllow),
        manualReviewLabel: "bad_completion",
      },
    ]);

    expect(report.summary).toMatchObject({
      sampleCount: 3,
      sampledCount: 3,
      evaluatedCandidateCount: 3,
      usefulBlockCount: 1,
      falseBlockCount: 1,
      falseAllowCount: 1,
      riskyFalseAllowCount: 1,
      completionAuthorityCount: 0,
      runtimeDecisionUnaffectedCount: 3,
    });

    const readiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(report, {
      minSamples: 3,
      minEvaluatedCandidates: 3,
      minBlockPrecision: 0.5,
      maxFalseBlockRate: 0.5,
      maxFalseAllowRate: 1,
      minUsefulBlockFalseBlockRatio: 1,
      minRiskyFalseAllowShare: 1,
    });
    expect(readiness).toMatchObject({
      decision: "ready_for_shadow_evidence_review",
      activePilotRequiresFreshSpec: true,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
    expect(readiness.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "runtime_replay_thresholds_met",
      "runtime_replay_active_pilot_still_requires_fresh_spec",
    ]);
  });

  it("keeps runtime shadow collection disabled without calling the producer", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowCollectionResult(
      {
        collectorId: "runtime_shadow_collector",
        samples: [
          {
            collectionSampleId: "",
            producerInput: {
              invalid: true,
            },
            manualReviewLabel: "not_a_label",
          },
        ],
        maxSamples: -1,
      },
      {
        buildProducerResult: () => {
          throw new Error("producer should not run while collection is disabled");
        },
      },
    );

    expect(result).toEqual({
      collectorId: "runtime_shadow_collector",
      mode: "disabled",
      outcome: "disabled",
      requestedSampleCount: 1,
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      sampledCount: 0,
      disabledCount: 0,
      invalidInputCount: 0,
      replaySampleCount: 0,
      entries: [],
      diagnosticCodes: ["runtime_shadow_collection_disabled"],
      diagnostics: [
        {
          code: "runtime_shadow_collection_disabled",
          severity: "info",
          message: "Default-off runtime shadow collection is disabled.",
        },
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
  });

  it("limits explicit runtime shadow collection and replays accepted samples only", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
      collectorId: "runtime_shadow_collector",
      mode: "shadow_only",
      maxSamples: 3,
      readinessThresholds: replayThresholdsForThreeSamples(),
      samples: [
        runtimeShadowCollectionSample(
          "useful_block",
          missingEvidenceInput(),
          "bad_completion",
        ),
        runtimeShadowCollectionSample(
          "false_block",
          missingEvidenceInput(),
          "valid_completion",
        ),
        runtimeShadowCollectionSample(
          "risky_false_allow",
          inputWithVerifier({
            metadata: {
              changedFiles: ["src/collection-risk.ts"],
              semanticRegressionRisk: true,
            },
          }),
          "bad_completion",
        ),
        runtimeShadowCollectionSample(
          "dropped",
          inputWithVerifier(),
          "valid_completion",
        ),
      ],
    });

    expect(result).toMatchObject({
      collectorId: "runtime_shadow_collector",
      mode: "shadow_only",
      outcome: "collected",
      requestedSampleCount: 4,
      acceptedSampleCount: 3,
      droppedSampleCount: 1,
      sampledCount: 3,
      disabledCount: 0,
      invalidInputCount: 0,
      replaySampleCount: 3,
      diagnosticCodes: [
        "runtime_shadow_collection_sample_limit_applied",
        "runtime_shadow_collection_collected",
        "runtime_shadow_collection_non_authoritative",
        "runtime_shadow_collection_active_pilot_still_requires_fresh_spec",
      ],
      replayReport: {
        summary: {
          sampleCount: 3,
          sampledCount: 3,
          usefulBlockCount: 1,
          falseBlockCount: 1,
          falseAllowCount: 1,
          riskyFalseAllowCount: 1,
          completionAuthorityCount: 0,
          runtimeDecisionUnaffectedCount: 3,
        },
      },
      replayReadiness: {
        decision: "ready_for_shadow_evidence_review",
        activePilotRequiresFreshSpec: true,
      },
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
    expect(result.entries.map((entry) => entry.collectionSampleId)).toEqual([
      "useful_block",
      "false_block",
      "risky_false_allow",
    ]);
    expect(result.replayReadiness?.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual([
        "runtime_replay_thresholds_met",
        "runtime_replay_active_pilot_still_requires_fresh_spec",
      ]);
  });

  it("records invalid producer samples without granting collection authority", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
      collectorId: "runtime_shadow_collector",
      mode: "shadow_only",
      maxSamples: 2,
      samples: [
        {
          collectionSampleId: "invalid_producer",
          producerInput: {
            producerId: "runtime_shadow_producer",
            completionEventId: "completion_invalid",
            mode: "shadow_only",
            samplerId: "sampler",
            sampleId: "sample_invalid",
            completion: {
              taskId: "",
              objective: "Invalid completion.",
              taskKind: "code_edit",
              legacyTerminalStatus: "complete",
            },
          },
          manualReviewLabel: "bad_completion",
        },
      ],
    });

    expect(result).toMatchObject({
      outcome: "collected",
      requestedSampleCount: 1,
      acceptedSampleCount: 1,
      sampledCount: 0,
      invalidInputCount: 1,
      replaySampleCount: 0,
      replayReport: {
        summary: {
          sampleCount: 0,
          completionAuthorityCount: 0,
          runtimeDecisionUnaffectedCount: 0,
        },
      },
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
    });
    expect(result.entries[0]?.producerResult).toMatchObject({
      outcome: "invalid_input",
      sampled: false,
      completionAuthority: false,
    });
  });

  it("fails closed for invalid explicit runtime shadow collection input", () => {
    const result = buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
      collectorId: "runtime_shadow_collector",
      mode: "shadow_only",
      maxSamples: 0,
      samples: [
        runtimeShadowCollectionSample(
          "valid",
          inputWithVerifier(),
          "valid_completion",
        ),
      ],
    });

    expect(result).toMatchObject({
      mode: "shadow_only",
      outcome: "invalid_input",
      requestedSampleCount: 1,
      acceptedSampleCount: 0,
      droppedSampleCount: 0,
      sampledCount: 0,
      invalidInputCount: 0,
      replaySampleCount: 0,
      entries: [],
      diagnosticCodes: ["runtime_shadow_collection_invalid_input"],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
  });

  it("keeps internal shadow observation default-off without requiring collections", () => {
    const result = buildCodeTaskEvidenceGateInternalShadowObservationResult({
      observerId: "internal_observer",
      collections: [{} as never],
    });

    expect(result).toEqual({
      observerId: "internal_observer",
      mode: "disabled",
      outcome: "disabled",
      observationDecision: "continue_internal_shadow_observation_hardening",
      requestedCollectionCount: 1,
      acceptedCollectionCount: 0,
      droppedCollectionCount: 0,
      collectedCollectionCount: 0,
      disabledCollectionCount: 0,
      invalidCollectionCount: 0,
      requestedSampleCount: 0,
      acceptedSampleCount: 0,
      sampledCount: 0,
      replaySampleCount: 0,
      wouldBlockCount: 0,
      riskyAllowCount: 0,
      diagnosticCodes: ["internal_shadow_observation_disabled"],
      diagnostics: [
        {
          code: "internal_shadow_observation_disabled",
          severity: "info",
          message: "Default-off internal shadow observation is disabled.",
        },
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      activePilotRequiresFreshSpec: true,
    });
  });

  it("observes bounded in-memory collections with replay readiness only", () => {
    const collections = [
      buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
        collectorId: "runtime_shadow_collector_a",
        mode: "shadow_only",
        maxSamples: 3,
        readinessThresholds: replayThresholdsForThreeSamples(),
        samples: [
          runtimeShadowCollectionSample(
            "useful_block",
            missingEvidenceInput(),
            "bad_completion",
          ),
          runtimeShadowCollectionSample(
            "false_block",
            missingEvidenceInput(),
            "valid_completion",
          ),
          runtimeShadowCollectionSample(
            "risky_false_allow",
            inputWithVerifier({
              metadata: {
                changedFiles: ["src/observation-risk.ts"],
                semanticRegressionRisk: true,
              },
            }),
            "bad_completion",
          ),
        ],
      }),
      buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
        collectorId: "runtime_shadow_collector_b",
        mode: "shadow_only",
        maxSamples: 1,
        readinessThresholds: replayThresholdsForThreeSamples(),
        samples: [
          runtimeShadowCollectionSample(
            "true_allow",
            inputWithVerifier(),
            "valid_completion",
          ),
        ],
      }),
    ];

    const result = buildCodeTaskEvidenceGateInternalShadowObservationResult({
      observerId: "internal_observer",
      mode: "shadow_only",
      maxCollections: 1,
      readinessThresholds: replayThresholdsForThreeSamples(),
      collections,
    });

    expect(result).toMatchObject({
      observerId: "internal_observer",
      mode: "shadow_only",
      outcome: "observed",
      observationDecision:
        "ready_for_limited_default_off_internal_shadow_observation_review",
      requestedCollectionCount: 2,
      acceptedCollectionCount: 1,
      droppedCollectionCount: 1,
      collectedCollectionCount: 1,
      disabledCollectionCount: 0,
      invalidCollectionCount: 0,
      requestedSampleCount: 3,
      acceptedSampleCount: 3,
      sampledCount: 3,
      replaySampleCount: 3,
      wouldBlockCount: 2,
      riskyAllowCount: 1,
      replayReadinessDecision: "ready_for_shadow_evidence_review",
      diagnosticCodes: [
        "internal_shadow_observation_collection_limit_applied",
        "internal_shadow_observation_observed",
        "internal_shadow_observation_replay_ready_for_review",
        "internal_shadow_observation_non_authoritative",
        "internal_shadow_observation_active_pilot_still_forbidden",
      ],
      replayReport: {
        summary: {
          sampleCount: 3,
          usefulBlockCount: 1,
          falseBlockCount: 1,
          falseAllowCount: 1,
          completionAuthorityCount: 0,
          runtimeDecisionUnaffectedCount: 3,
        },
      },
      replayReadiness: {
        activePilotRequiresFreshSpec: true,
        runtimeDecisionUnaffected: true,
        legacyDecisionUnaffected: true,
      },
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      activePilotRequiresFreshSpec: true,
    });
  });

  it("fails closed for invalid explicit internal shadow observation input", () => {
    const result = buildCodeTaskEvidenceGateInternalShadowObservationResult({
      observerId: "internal_observer",
      mode: "shadow_only",
      maxCollections: 0,
      collections: [],
    });

    expect(result).toMatchObject({
      observerId: "internal_observer",
      mode: "shadow_only",
      outcome: "invalid_input",
      observationDecision: "stop_or_freeze_route",
      requestedCollectionCount: 0,
      acceptedCollectionCount: 0,
      diagnosticCodes: ["internal_shadow_observation_invalid_input"],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      activePilotRequiresFreshSpec: true,
    });
  });

  it("evaluates runtime-shaped replay samples into shadow evidence readiness", () => {
    const report = evaluateCodeTaskEvidenceGateRuntimeReplaySamples([
      ...runtimeReplaySamples("true_allow", 10, (index) => ({
        callerInput: runtimeCallerInput(`true_allow_${index}`, inputWithVerifier()),
        manualReviewLabel: "valid_completion",
      })),
      ...runtimeReplaySamples("useful_block", 5, (index) => ({
        callerInput: runtimeCallerInput(`useful_block_${index}`, missingEvidenceInput()),
        manualReviewLabel: "bad_completion",
      })),
      {
        replayId: "false_block_0",
        callerInput: runtimeCallerInput("false_block_0", missingEvidenceInput()),
        manualReviewLabel: "valid_completion",
      },
      ...runtimeReplaySamples("risky_false_allow", 2, (index) => ({
        callerInput: runtimeCallerInput(`risky_false_allow_${index}`, inputWithVerifier({
          metadata: {
            changedFiles: [`src/runtime-risk-${index}.ts`],
            semanticRegressionRisk: true,
          },
        })),
        manualReviewLabel: "bad_completion",
      })),
      ...runtimeReplaySamples("disabled", 2, (index) => ({
        callerInput: {
          callerId: "runtime_caller",
          completionEventId: `disabled_${index}`,
        },
        manualReviewLabel: "valid_completion",
      })),
    ]);

    expect(report.summary).toMatchObject({
      sampleCount: 20,
      sampledCount: 18,
      disabledCount: 2,
      invalidInputCount: 0,
      evaluatedCandidateCount: 18,
      trueAllowCount: 10,
      usefulBlockCount: 5,
      falseBlockCount: 1,
      falseAllowCount: 2,
      notEvaluatedCount: 2,
      blockPrecision: 5 / 6,
      falseBlockRate: 1 / 6,
      falseAllowRate: 2 / 12,
      usefulBlockFalseBlockRatio: 5,
      riskyFalseAllowCount: 2,
      riskyFalseAllowShare: 1,
      nonAuthoritativeCount: 20,
      completionAuthorityCount: 0,
      runtimeDecisionUnaffectedCount: 20,
    });

    const readiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(report);
    expect(readiness).toMatchObject({
      decision: "ready_for_shadow_evidence_review",
      metrics: {
        sampleCount: 20,
        sampledCount: 18,
        evaluatedCandidateCount: 18,
        blockPrecision: 5 / 6,
        falseBlockRate: 1 / 6,
        falseAllowRate: 2 / 12,
        usefulBlockFalseBlockRatio: 5,
        riskyFalseAllowShare: 1,
        completionAuthorityCount: 0,
      },
      activePilotRequiresFreshSpec: true,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
    });
    expect(readiness.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      [
        "runtime_replay_thresholds_met",
        "runtime_replay_active_pilot_still_requires_fresh_spec",
      ],
    );
  });

  it("summarizes shadow evidence quality without opening an active gate", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      {
        sampleId: "true_allow",
        input: inputWithVerifier(),
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "useful_block",
        input: missingEvidenceInput(),
        manualReviewLabel: "bad_completion",
      },
      {
        sampleId: "false_block_classified",
        input: inputWithVerifier({
          verifierReport: evaluateEvidenceVerifier(
            withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
          ),
          metadata: { evidenceCaptureIssue: "local_test_not_required" },
        }),
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "risky_false_allow",
        input: inputWithVerifier({
          metadata: {
            changedFiles: ["src/quality-risk.ts"],
            semanticRegressionRisk: true,
          },
        }),
        manualReviewLabel: "bad_completion",
      },
    ]);
    const runtimeReplayReadiness = buildReadyRuntimeReplayReadiness();
    const internalObservation = buildReadyInternalObservation();

    const quality = buildCodeTaskEvidenceGateShadowEvidenceQualityReport({
      evaluation,
      runtimeReplayReadiness,
      internalObservation,
    });

    expect(quality).toMatchObject({
      decision: "ready_for_limited_default_off_readiness_review",
      metrics: {
        offlineSampleCount: 4,
        offlineEvaluatedCandidateCount: 4,
        falseBlockCount: 1,
        falseBlockCauseClassifiedCount: 1,
        falseBlockCauseCoverageRate: 1,
        falseAllowCount: 1,
        riskyFalseAllowCount: 1,
        riskyFalseAllowShare: 1,
        runtimeReplayDecision: "ready_for_shadow_evidence_review",
        internalObservationDecision:
          "ready_for_limited_default_off_internal_shadow_observation_review",
        nonAuthorityParity: true,
      },
      diagnosticCodes: [
        "shadow_evidence_quality_false_block_causes_covered",
        "shadow_evidence_quality_risky_false_allows_covered",
        "shadow_evidence_quality_runtime_replay_ready",
        "shadow_evidence_quality_observation_ready",
        "shadow_evidence_quality_non_authoritative",
        "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
      ],
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      activePilotRequiresFreshSpec: true,
    });
  });

  it("routes incomplete shadow evidence quality to hardening only", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      {
        sampleId: "uncategorized_false_allow",
        input: inputWithVerifier(),
        manualReviewLabel: "bad_completion",
      },
    ]);

    const quality = buildCodeTaskEvidenceGateShadowEvidenceQualityReport({
      evaluation,
    });

    expect(quality.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(quality.diagnosticCodes).toEqual([
      "shadow_evidence_quality_incomplete_inputs",
      "shadow_evidence_quality_false_block_causes_covered",
      "shadow_evidence_quality_risky_false_allows_incomplete",
      "shadow_evidence_quality_non_authoritative",
      "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
    ]);
  });

  it("keeps ready runtime and observation evidence in hardening when evaluation is missing", () => {
    const quality = buildCodeTaskEvidenceGateShadowEvidenceQualityReport({
      runtimeReplayReadiness: buildReadyRuntimeReplayReadiness(),
      internalObservation: buildReadyInternalObservation(),
    });

    expect(quality.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(quality.diagnosticCodes).toEqual([
      "shadow_evidence_quality_incomplete_inputs",
      "shadow_evidence_quality_runtime_replay_ready",
      "shadow_evidence_quality_observation_ready",
      "shadow_evidence_quality_non_authoritative",
      "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
    ]);
  });

  it("routes blocked runtime replay quality to stop or freeze", () => {
    const runtimeReplayReadiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(
      evaluateCodeTaskEvidenceGateRuntimeReplaySamples([
        {
          replayId: "small_false_allow",
          callerInput: runtimeCallerInput("small_false_allow", inputWithVerifier()),
          manualReviewLabel: "bad_completion",
        },
      ]),
    );

    const quality = buildCodeTaskEvidenceGateShadowEvidenceQualityReport({
      runtimeReplayReadiness,
      internalObservation: buildCodeTaskEvidenceGateInternalShadowObservationResult({
        observerId: "blocked_observer",
        mode: "shadow_only",
        collections: [],
      }),
    });

    expect(quality.decision).toBe("stop_or_freeze_route");
    expect(quality.diagnosticCodes).toEqual(
      expect.arrayContaining([
        "shadow_evidence_quality_runtime_replay_blocked",
        "shadow_evidence_quality_observation_stop_or_freeze",
        "shadow_evidence_quality_active_pilot_still_requires_fresh_spec",
      ]),
    );
  });

  it("quantifies an optimized capability matrix without active authority", () => {
    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({
      evaluation: optimizedCapabilityEvaluation(),
      runtimeReplayReadiness: buildReadyRuntimeReplayReadiness(),
      internalObservation: buildReadyInternalObservation(),
    });

    expect(optimization).toMatchObject({
      decision: "ready_for_limited_default_off_readiness_review",
      strategy: {
        qualityDecision: "ready_for_limited_default_off_readiness_review",
        falseBlockCauseCoverageRate: 1,
        riskyFalseAllowShare: 1,
        nonAuthorityParity: true,
      },
      quantification: {
        sampleCount: 52,
        evaluatedCandidateCount: 49,
        blockPrecision: 20 / 23,
        blockRecall: 20 / 21,
        falseBlockRate: 3 / 23,
        falseAllowRate: 1 / 26,
        riskyFalseAllowShare: 1,
        falseBlockCauseCoverageRate: 1,
        falseBlockCauseCounts: {
          truly_missing_validation: 0,
          validation_done_but_not_captured: 0,
          external_validation_not_represented: 1,
          local_test_not_required: 1,
          report_task_id_or_shape_issue: 1,
        },
        riskyFalseAllowSignalCounts: {
          evidence_diff_mismatch: 0,
          weak_test_coverage: 0,
          changed_files_not_represented: 1,
          obligation_not_mapped_to_evidence: 0,
          semantic_regression_risk: 1,
        },
        coveredRequiredCategoryCount: 11,
        requiredCategoryCount: 11,
        matrixCoverageRate: 1,
        runtimeReplayDecisionCounts: {
          ready_for_shadow_evidence_review: 1,
          continue_runtime_shadow_replay: 0,
          blocked: 0,
        },
        internalObservationDecisionCounts: {
          ready_for_limited_default_off_internal_shadow_observation_review: 1,
          continue_internal_shadow_observation_hardening: 0,
          stop_or_freeze_route: 0,
        },
        blockedOrFreezeReasons: [],
      },
      capabilityAssessment: {
        passed: true,
        thresholds: {
          minSamples: 20,
          minEvaluatedCandidates: 16,
          minBlockPrecision: 0.8,
          maxFalseBlockRate: 0.2,
          maxFalseAllowRate: 0.25,
          minRiskyFalseAllowShare: 0.6,
          requiredFalseBlockCauseCoverageRate: 1,
          requiredMatrixCoverageRate: 1,
        },
        metricMargins: {
          sampleCount: 32,
          evaluatedCandidateCount: 33,
          blockPrecision: 20 / 23 - 0.8,
          falseBlockRate: 0.2 - 3 / 23,
          falseAllowRate: 0.25 - 1 / 26,
          riskyFalseAllowShare: 0.4,
          falseBlockCauseCoverageRate: 0,
          matrixCoverageRate: 0,
        },
        categoryCoverage: {
          valid_full_evidence: {
            count: 25,
            covered: true,
            required: true,
          },
        },
        shortfallCodes: [],
        remediationTargets: [],
      },
      diagnosticCodes: [
        "shadow_evidence_optimization_strategy_ready",
        "shadow_evidence_optimization_matrix_complete",
        "shadow_evidence_optimization_non_authoritative",
        "shadow_evidence_optimization_active_pilot_still_forbidden",
      ],
      diagnosticOnly: true,
      taskCompletionEvidence: false,
      callerOwnedInMemoryOnly: true,
      nonAuthoritative: true,
      completionAuthority: false,
      runtimeDecisionUnaffected: true,
      legacyDecisionUnaffected: true,
      activePilotRequiresFreshSpec: true,
    });
    expect(optimization.quantification.categoryCounts).toMatchObject({
      valid_full_evidence: 25,
      missing_validation_evidence: 8,
      tool_or_test_failure: 6,
      missing_verifier_report: 6,
      local_test_not_required: 1,
      external_validation_uncaptured: 1,
      non_code_task: 1,
      legacy_not_completed: 1,
      reviewer_inconclusive: 1,
      semantic_regression_with_complete_refs: 1,
      report_shape_issue: 1,
    });
    expect(JSON.stringify(optimization)).not.toContain(
      ["ready", "for", "active", "pilot"].join("_"),
    );
  });

  it("routes a complete but weak quantitative matrix to hardening", () => {
    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({
      evaluation: completeOptimizationEvaluation(),
      runtimeReplayReadiness: buildReadyRuntimeReplayReadiness(),
      internalObservation: buildReadyInternalObservation(),
    });

    expect(optimization.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(optimization.quantification).toMatchObject({
      sampleCount: 11,
      evaluatedCandidateCount: 8,
      blockPrecision: 0.5,
      falseBlockRate: 0.5,
      falseAllowRate: 0.5,
      coveredRequiredCategoryCount: 11,
      matrixCoverageRate: 1,
    });
    expect(optimization.diagnosticCodes).toEqual([
      "shadow_evidence_optimization_strategy_ready",
      "shadow_evidence_optimization_matrix_complete",
      "shadow_evidence_optimization_min_samples_not_met",
      "shadow_evidence_optimization_min_evaluated_candidates_not_met",
      "shadow_evidence_optimization_block_precision_below_threshold",
      "shadow_evidence_optimization_false_block_rate_above_threshold",
      "shadow_evidence_optimization_false_allow_rate_above_threshold",
      "shadow_evidence_optimization_non_authoritative",
      "shadow_evidence_optimization_active_pilot_still_forbidden",
    ]);
    expect(optimization.capabilityAssessment).toMatchObject({
      passed: false,
      shortfallCodes: [
        "sample_count_below_threshold",
        "evaluated_candidate_count_below_threshold",
        "block_precision_below_threshold",
        "false_block_rate_above_threshold",
        "false_allow_rate_above_threshold",
      ],
    });
    expect(optimization.capabilityAssessment.remediationTargets.map(
      (target) => target.metric,
    )).toEqual([
      "sampleCount",
      "evaluatedCandidateCount",
      "blockPrecision",
      "falseBlockRate",
      "falseAllowRate",
    ]);
  });

  it("keeps a high-scoring but undersized quantitative matrix in hardening", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      ...samples("undersized_true_allow", 10, (index) => ({
        input: inputWithVerifier({
          metadata: { changedFiles: [`src/undersized-true-${index}.ts`] },
        }),
        manualReviewLabel: "valid_completion",
      })),
      ...samples("undersized_useful_block", 7, () => ({
        input: missingEvidenceInput(),
        manualReviewLabel: "bad_completion",
      })),
      {
        sampleId: "undersized_risky_false_allow",
        input: inputWithVerifier({
          metadata: {
            changedFiles: ["src/undersized-risk.ts"],
            semanticRegressionRisk: true,
          },
        }),
        manualReviewLabel: "bad_completion",
      },
    ]);

    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({
      evaluation,
      runtimeReplayReadiness: buildReadyRuntimeReplayReadiness(),
      internalObservation: buildReadyInternalObservation(),
      fixtureMatrix: {
        categoryCounts: fullRequiredCategoryCounts(),
      },
    });

    expect(optimization.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(optimization.quantification).toMatchObject({
      sampleCount: 18,
      evaluatedCandidateCount: 18,
      blockPrecision: 1,
      falseBlockRate: 0,
      falseAllowRate: 1 / 11,
      riskyFalseAllowShare: 1,
      coveredRequiredCategoryCount: 11,
      matrixCoverageRate: 1,
    });
    expect(optimization.diagnosticCodes).toEqual([
      "shadow_evidence_optimization_strategy_ready",
      "shadow_evidence_optimization_matrix_complete",
      "shadow_evidence_optimization_min_samples_not_met",
      "shadow_evidence_optimization_non_authoritative",
      "shadow_evidence_optimization_active_pilot_still_forbidden",
    ]);
    expect(optimization.capabilityAssessment).toMatchObject({
      passed: false,
      shortfallCodes: ["sample_count_below_threshold"],
      remediationTargets: [
        {
          code: "sample_count_below_threshold",
          metric: "sampleCount",
          actual: 18,
          target: 20,
        },
      ],
    });
  });

  it("keeps missing optimization metrics in hardening", () => {
    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({});

    expect(optimization.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(optimization.quantification).toMatchObject({
      sampleCount: 0,
      evaluatedCandidateCount: 0,
      coveredRequiredCategoryCount: 0,
      matrixCoverageRate: 0,
    });
    expect(optimization.diagnosticCodes).toEqual([
      "shadow_evidence_optimization_strategy_continue_hardening",
      "shadow_evidence_optimization_matrix_incomplete",
      "shadow_evidence_optimization_min_samples_not_met",
      "shadow_evidence_optimization_min_evaluated_candidates_not_met",
      "shadow_evidence_optimization_block_precision_missing",
      "shadow_evidence_optimization_false_block_rate_missing",
      "shadow_evidence_optimization_false_allow_rate_missing",
      "shadow_evidence_optimization_non_authoritative",
      "shadow_evidence_optimization_active_pilot_still_forbidden",
    ]);
    expect(optimization.capabilityAssessment).toMatchObject({
      passed: false,
      shortfallCodes: [
        "quality_strategy_not_ready",
        "sample_count_below_threshold",
        "evaluated_candidate_count_below_threshold",
        "fixture_matrix_incomplete",
        "block_precision_missing",
        "false_block_rate_missing",
        "false_allow_rate_missing",
      ],
    });
  });

  it("keeps an otherwise ready strategy in hardening when the fixture matrix is incomplete", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      {
        sampleId: "true_allow",
        input: inputWithVerifier(),
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "useful_block",
        input: missingEvidenceInput(),
        manualReviewLabel: "bad_completion",
      },
      {
        sampleId: "classified_false_block",
        input: inputWithVerifier({
          verifierReport: evaluateEvidenceVerifier(
            withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
          ),
          metadata: { evidenceCaptureIssue: "local_test_not_required" },
        }),
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "risky_false_allow",
        input: inputWithVerifier({
          metadata: { semanticRegressionRisk: true },
        }),
        manualReviewLabel: "bad_completion",
      },
    ]);

    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({
      evaluation,
      runtimeReplayReadiness: buildReadyRuntimeReplayReadiness(),
      internalObservation: buildReadyInternalObservation(),
    });

    expect(optimization.decision).toBe(
      "continue_internal_shadow_observation_hardening",
    );
    expect(optimization.diagnosticCodes).toEqual([
      "shadow_evidence_optimization_strategy_ready",
      "shadow_evidence_optimization_matrix_incomplete",
      "shadow_evidence_optimization_min_samples_not_met",
      "shadow_evidence_optimization_min_evaluated_candidates_not_met",
      "shadow_evidence_optimization_block_precision_below_threshold",
      "shadow_evidence_optimization_false_block_rate_above_threshold",
      "shadow_evidence_optimization_false_allow_rate_above_threshold",
      "shadow_evidence_optimization_non_authoritative",
      "shadow_evidence_optimization_active_pilot_still_forbidden",
    ]);
    expect(optimization.quantification.coveredRequiredCategoryCount).toBe(0);
    expect(optimization.capabilityAssessment.shortfallCodes).toEqual([
      "sample_count_below_threshold",
      "evaluated_candidate_count_below_threshold",
      "fixture_matrix_incomplete",
      "block_precision_below_threshold",
      "false_block_rate_above_threshold",
      "false_allow_rate_above_threshold",
    ]);
  });

  it("routes optimization authority drift to stop or freeze", () => {
    const readyRuntimeReplayReadiness = buildReadyRuntimeReplayReadiness();
    const driftedRuntimeReplayReadiness = {
      ...readyRuntimeReplayReadiness,
      metrics: {
        ...readyRuntimeReplayReadiness.metrics,
        completionAuthorityCount: 1 as 0,
      },
    };

    const optimization = buildCodeTaskEvidenceGateShadowEvidenceOptimizationReport({
      evaluation: optimizedCapabilityEvaluation(),
      runtimeReplayReadiness: driftedRuntimeReplayReadiness,
      internalObservation: buildReadyInternalObservation(),
      fixtureMatrix: {
        blockedOrFreezeReasons: ["authority_drift_sentinel"],
      },
    });

    expect(optimization.decision).toBe("stop_or_freeze_route");
    expect(optimization.strategy.nonAuthorityParity).toBe(false);
    expect(optimization.diagnosticCodes).toEqual([
      "shadow_evidence_optimization_strategy_stop_or_freeze",
      "shadow_evidence_optimization_matrix_complete",
      "shadow_evidence_optimization_non_authoritative",
      "shadow_evidence_optimization_active_pilot_still_forbidden",
    ]);
    expect(optimization.quantification.blockedOrFreezeReasons).toEqual([
      "shadow_evidence_quality_non_authoritative",
      "authority_drift_sentinel",
    ]);
    expect(optimization.capabilityAssessment.shortfallCodes).toEqual([
      "quality_strategy_not_ready",
      "authority_parity_broken",
    ]);
    expect(optimization.taskCompletionEvidence).toBe(false);
  });

  it("blocks runtime-shaped replay readiness when evidence is too small", () => {
    const report = evaluateCodeTaskEvidenceGateRuntimeReplaySamples([
      {
        replayId: "small_true_allow",
        callerInput: runtimeCallerInput("small_true_allow", inputWithVerifier()),
        manualReviewLabel: "valid_completion",
      },
      {
        replayId: "small_false_allow",
        callerInput: runtimeCallerInput("small_false_allow", inputWithVerifier()),
        manualReviewLabel: "bad_completion",
      },
    ]);

    const readiness = evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(report);

    expect(readiness.decision).toBe("blocked");
    expect(readiness.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "runtime_replay_min_samples_not_met",
        "runtime_replay_min_evaluated_candidates_not_met",
        "runtime_replay_false_allow_rate_above_threshold",
      ]),
    );
  });

  it("evaluates labeled samples with useful-block and false-block metrics", () => {
    const validCompletion = inputWithVerifier();
    const missingEvidence = inputWithVerifier({
      verifierReport: evaluateEvidenceVerifier(
        withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
      ),
    });
    const missingReport: CodeTaskEvidenceGateShadowInput = {
      taskId: "task_missing_report",
      objective: "Implement a code change.",
      taskKind: "code_edit",
      legacyTerminalStatus: "complete",
    };
    const docsTask: CodeTaskEvidenceGateShadowInput = {
      taskId: "task_docs",
      objective: "Update docs.",
      taskKind: "non_code",
      legacyTerminalStatus: "complete",
    };

    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      {
        sampleId: "true_allow",
        input: validCompletion,
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "useful_block",
        input: missingEvidence,
        manualReviewLabel: "bad_completion",
      },
      {
        sampleId: "false_block",
        input: missingReport,
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "false_allow",
        input: validCompletion,
        manualReviewLabel: "bad_completion",
      },
      {
        sampleId: "not_evaluated",
        input: docsTask,
        manualReviewLabel: "valid_completion",
      },
    ]);

    expect(evaluation.legacyDecisionUnaffected).toBe(true);
    expect(evaluation.results.map((result) => [result.sampleId, result.outcome]))
      .toEqual([
        ["true_allow", "true_allow"],
        ["useful_block", "useful_block"],
        ["false_block", "false_block"],
        ["false_allow", "false_allow"],
        ["not_evaluated", "not_evaluated"],
      ]);
    expect(evaluation.summary).toMatchObject({
      sampleCount: 5,
      gateCandidateCount: 4,
      evaluatedCandidateCount: 4,
      trueAllowCount: 1,
      usefulBlockCount: 1,
      falseBlockCount: 1,
      falseAllowCount: 1,
      inconclusiveCount: 0,
      notEvaluatedCount: 1,
      blockPrecision: 0.5,
      blockRecall: 0.5,
      falseBlockRate: 0.5,
      falseAllowRate: 0.5,
      usefulBlockFalseBlockRatio: 1,
      shadowSummary: {
        gateCandidateCount: 4,
        wouldAllowCount: 2,
        wouldBlockCount: 2,
        notApplicableCount: 1,
      },
    });
  });

  it("marks the offline corpus stage ready when sample coverage is sufficient", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      ...samples("valid", 4, () => ({
        input: inputWithVerifier(),
        manualReviewLabel: "valid_completion",
      })),
      ...samples("bad", 2, () => ({
        input: missingEvidenceInput(),
        manualReviewLabel: "bad_completion",
      })),
      {
        sampleId: "non_code",
        input: nonCodeInput(),
        manualReviewLabel: "valid_completion",
      },
      {
        sampleId: "inconclusive",
        input: inputWithVerifier(),
        manualReviewLabel: "inconclusive",
      },
    ]);

    const readiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "offline_corpus",
    );

    expect(readiness).toMatchObject({
      stage: "offline_corpus",
      decision: "ready",
      diagnostics: [{ code: "readiness_thresholds_met", severity: "info" }],
      metrics: {
        sampleCount: 8,
        evaluatedCandidateCount: 6,
      },
      legacyDecisionUnaffected: true,
    });
  });

  it("blocks shadow sampler readiness when false blocks and missing reports dominate", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples([
      ...samples("valid", 6, () => ({
        input: inputWithVerifier(),
        manualReviewLabel: "valid_completion",
      })),
      ...samples("useful", 3, () => ({
        input: missingEvidenceInput(),
        manualReviewLabel: "bad_completion",
      })),
      ...samples("false_block", 3, () => ({
        input: missingReportInput(),
        manualReviewLabel: "valid_completion",
      })),
    ]);

    const readiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "shadow_sampler",
      {
        thresholds: {
          minSamples: 12,
          minEvaluatedCandidates: 12,
          minBlockPrecision: 0.75,
          maxFalseBlockRate: 0.25,
          maxMissingReportShare: 0.25,
        },
      },
    );

    expect(readiness.decision).toBe("blocked");
    expect(readiness.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "block_precision_below_threshold",
        "false_block_rate_above_threshold",
        "missing_report_share_above_threshold",
      ]),
    );
  });

  it("requires explicit runtime shadow evidence before active pilot readiness", () => {
    const evaluation = strongEvaluation();
    const readiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "active_pilot",
    );

    expect(readiness).toMatchObject({
      stage: "active_pilot",
      decision: "blocked",
      diagnostics: [
        {
          code: "runtime_shadow_evidence_required",
          severity: "error",
        },
      ],
    });
  });

  it("allows active pilot readiness only with strong metrics and runtime shadow evidence", () => {
    const evaluation = strongEvaluation();
    const readiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "active_pilot",
      {
        runtimeShadowEvidence: {
          sampleCount: 120,
          evaluatedCandidateCount: 40,
          usefulBlockCount: 8,
          falseBlockCount: 1,
          falseAllowCount: 1,
        },
      },
    );

    expect(readiness).toMatchObject({
      stage: "active_pilot",
      decision: "ready",
      metrics: {
        sampleCount: 50,
        evaluatedCandidateCount: 30,
        blockPrecision: 8 / 9,
        blockRecall: 8 / 9,
        falseBlockRate: 1 / 9,
        falseAllowRate: 1 / 21,
        runtimeShadowSampleCount: 120,
      },
      diagnostics: [{ code: "readiness_thresholds_met", severity: "info" }],
      legacyDecisionUnaffected: true,
    });
  });
});

function inputWithVerifier(
  overrides: Partial<CodeTaskEvidenceGateShadowInput> = {},
): CodeTaskEvidenceGateShadowInput {
  const verifierInput = buildEvidenceVerifierInputFixture();
  return {
    taskId: "task_1",
    objective: "Implement a code change.",
    taskKind: "code_edit",
    legacyTerminalStatus: "complete",
    verifierReport: evaluateEvidenceVerifier(verifierInput),
    ...overrides,
  };
}

function missingEvidenceInput(): CodeTaskEvidenceGateShadowInput {
  return inputWithVerifier({
    verifierReport: evaluateEvidenceVerifier(
      withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
    ),
  });
}

function missingReportInput(
  metadata?: CodeTaskEvidenceGateShadowInput["metadata"],
): CodeTaskEvidenceGateShadowInput {
  return {
    taskId: "task_missing_report",
    objective: "Implement a code change.",
    taskKind: "code_edit",
    legacyTerminalStatus: "complete",
    ...(metadata ? { metadata } : {}),
  };
}

function nonCodeInput(): CodeTaskEvidenceGateShadowInput {
  return {
    taskId: "task_docs",
    objective: "Update docs.",
    taskKind: "non_code",
    legacyTerminalStatus: "complete",
  };
}

function strongEvaluation() {
  return evaluateCodeTaskEvidenceGateShadowSamples([
    ...samples("true_allow", 20, () => ({
      input: inputWithVerifier(),
      manualReviewLabel: "valid_completion",
    })),
    ...samples("useful_block", 8, () => ({
      input: missingEvidenceInput(),
      manualReviewLabel: "bad_completion",
    })),
    {
      sampleId: "false_block_0",
      input: inputWithVerifier({
        verifierReport: evaluateEvidenceVerifier(
          withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
        ),
      }),
      manualReviewLabel: "valid_completion",
    },
    {
      sampleId: "false_allow_0",
      input: inputWithVerifier(),
      manualReviewLabel: "bad_completion",
    },
    ...samples("not_evaluated", 20, () => ({
      input: nonCodeInput(),
      manualReviewLabel: "valid_completion",
    })),
  ]);
}

function completeOptimizationEvaluation() {
  return evaluateCodeTaskEvidenceGateShadowSamples([
    {
      sampleId: "optimization_valid_full_evidence",
      input: inputWithVerifier(),
      manualReviewLabel: "valid_completion",
      category: "valid_full_evidence",
    },
    {
      sampleId: "optimization_missing_validation",
      input: missingEvidenceInput(),
      manualReviewLabel: "bad_completion",
      category: "missing_validation_evidence",
    },
    {
      sampleId: "optimization_tool_or_test_failure",
      input: missingEvidenceInput(),
      manualReviewLabel: "bad_completion",
      category: "tool_or_test_failure",
    },
    {
      sampleId: "optimization_missing_report",
      input: missingReportInput(),
      manualReviewLabel: "bad_completion",
      category: "missing_verifier_report",
    },
    {
      sampleId: "optimization_local_test_not_required",
      input: inputWithVerifier({
        verifierReport: evaluateEvidenceVerifier(
          withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
        ),
        metadata: { evidenceCaptureIssue: "local_test_not_required" },
      }),
      manualReviewLabel: "valid_completion",
      category: "local_test_not_required",
    },
    {
      sampleId: "optimization_external_validation_uncaptured",
      input: missingReportInput({
        evidenceCaptureIssue: "external_validation_not_represented",
      }),
      manualReviewLabel: "valid_completion",
      category: "external_validation_uncaptured",
    },
    {
      sampleId: "optimization_non_code_task",
      input: nonCodeInput(),
      manualReviewLabel: "valid_completion",
      category: "non_code_task",
    },
    {
      sampleId: "optimization_legacy_not_completed",
      input: {
        taskId: "task_repair",
        objective: "Repair a code task.",
        taskKind: "code_edit",
        legacyTerminalStatus: "repair",
      },
      manualReviewLabel: "bad_completion",
      category: "legacy_not_completed",
    },
    {
      sampleId: "optimization_reviewer_inconclusive",
      input: inputWithVerifier(),
      manualReviewLabel: "inconclusive",
      category: "reviewer_inconclusive",
    },
    {
      sampleId: "optimization_semantic_regression",
      input: inputWithVerifier({
        metadata: {
          changedFiles: ["src/optimization-regression.ts"],
          semanticRegressionRisk: true,
        },
      }),
      manualReviewLabel: "bad_completion",
      category: "semantic_regression_with_complete_refs",
    },
    {
      sampleId: "optimization_report_shape_issue",
      input: inputWithVerifier({
        verifierReport: evaluateEvidenceVerifier(
          withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
        ),
        metadata: { evidenceCaptureIssue: "report_task_id_or_shape_issue" },
      }),
      manualReviewLabel: "valid_completion",
      category: "report_shape_issue",
    },
  ]);
}

function optimizedCapabilityEvaluation() {
  return evaluateCodeTaskEvidenceGateShadowSamples([
    ...samples("optimization_strong_valid_full", 25, () => ({
      input: inputWithVerifier(),
      manualReviewLabel: "valid_completion",
      category: "valid_full_evidence",
    })),
    ...samples("optimization_strong_missing_validation", 8, () => ({
      input: missingEvidenceInput(),
      manualReviewLabel: "bad_completion",
      category: "missing_validation_evidence",
    })),
    ...samples("optimization_strong_tool_or_test_failure", 6, () => ({
      input: missingEvidenceInput(),
      manualReviewLabel: "bad_completion",
      category: "tool_or_test_failure",
    })),
    ...samples("optimization_strong_missing_report", 6, () => ({
      input: missingReportInput(),
      manualReviewLabel: "bad_completion",
      category: "missing_verifier_report",
    })),
    {
      sampleId: "optimization_strong_local_test_not_required",
      input: inputWithVerifier({
        verifierReport: evaluateEvidenceVerifier(
          withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
        ),
        metadata: { evidenceCaptureIssue: "local_test_not_required" },
      }),
      manualReviewLabel: "valid_completion",
      category: "local_test_not_required",
    },
    {
      sampleId: "optimization_strong_external_validation_uncaptured",
      input: missingReportInput({
        evidenceCaptureIssue: "external_validation_not_represented",
      }),
      manualReviewLabel: "valid_completion",
      category: "external_validation_uncaptured",
    },
    {
      sampleId: "optimization_strong_report_shape_issue",
      input: inputWithVerifier({
        verifierReport: evaluateEvidenceVerifier(
          withoutEvidenceKind(buildEvidenceVerifierInputFixture(), "test"),
        ),
        metadata: { evidenceCaptureIssue: "report_task_id_or_shape_issue" },
      }),
      manualReviewLabel: "valid_completion",
      category: "report_shape_issue",
    },
    {
      sampleId: "optimization_strong_semantic_regression",
      input: inputWithVerifier({
        metadata: {
          changedFiles: ["src/optimization-strong-regression.ts"],
          semanticRegressionRisk: true,
        },
      }),
      manualReviewLabel: "bad_completion",
      category: "semantic_regression_with_complete_refs",
    },
    {
      sampleId: "optimization_strong_non_code_task",
      input: nonCodeInput(),
      manualReviewLabel: "valid_completion",
      category: "non_code_task",
    },
    {
      sampleId: "optimization_strong_legacy_not_completed",
      input: {
        taskId: "task_repair",
        objective: "Repair a code task.",
        taskKind: "code_edit",
        legacyTerminalStatus: "repair",
      },
      manualReviewLabel: "bad_completion",
      category: "legacy_not_completed",
    },
    {
      sampleId: "optimization_strong_reviewer_inconclusive",
      input: inputWithVerifier(),
      manualReviewLabel: "inconclusive",
      category: "reviewer_inconclusive",
    },
  ]);
}

function fullRequiredCategoryCounts() {
  return {
    valid_full_evidence: 1,
    missing_validation_evidence: 1,
    tool_or_test_failure: 1,
    missing_verifier_report: 1,
    local_test_not_required: 1,
    external_validation_uncaptured: 1,
    non_code_task: 1,
    legacy_not_completed: 1,
    reviewer_inconclusive: 1,
    semantic_regression_with_complete_refs: 1,
    report_shape_issue: 1,
  };
}

function buildReadyRuntimeReplayReadiness() {
  const report = evaluateCodeTaskEvidenceGateRuntimeReplaySamples([
    ...runtimeReplaySamples("quality_true_allow", 10, (index) => ({
      callerInput: runtimeCallerInput(
        `quality_true_allow_${index}`,
        inputWithVerifier(),
      ),
      manualReviewLabel: "valid_completion",
    })),
    ...runtimeReplaySamples("quality_useful_block", 5, (index) => ({
      callerInput: runtimeCallerInput(
        `quality_useful_block_${index}`,
        missingEvidenceInput(),
      ),
      manualReviewLabel: "bad_completion",
    })),
    {
      replayId: "quality_false_block_0",
      callerInput: runtimeCallerInput(
        "quality_false_block_0",
        missingEvidenceInput(),
      ),
      manualReviewLabel: "valid_completion",
    },
    ...runtimeReplaySamples("quality_risky_false_allow", 2, (index) => ({
      callerInput: runtimeCallerInput(
        `quality_risky_false_allow_${index}`,
        inputWithVerifier({
          metadata: {
            changedFiles: [`src/quality-runtime-risk-${index}.ts`],
            semanticRegressionRisk: true,
          },
        }),
      ),
      manualReviewLabel: "bad_completion",
    })),
    ...runtimeReplaySamples("quality_disabled", 2, (index) => ({
      callerInput: {
        callerId: "runtime_caller",
        completionEventId: `quality_disabled_${index}`,
      },
      manualReviewLabel: "valid_completion",
    })),
  ]);

  return evaluateCodeTaskEvidenceGateRuntimeReplayReadiness(report);
}

function buildReadyInternalObservation() {
  const collection = buildCodeTaskEvidenceGateRuntimeShadowCollectionResult({
    collectorId: "quality_runtime_shadow_collector",
    mode: "shadow_only",
    maxSamples: 3,
    readinessThresholds: replayThresholdsForThreeSamples(),
    samples: [
      runtimeShadowCollectionSample(
        "quality_useful_block",
        missingEvidenceInput(),
        "bad_completion",
      ),
      runtimeShadowCollectionSample(
        "quality_false_block",
        missingEvidenceInput(),
        "valid_completion",
      ),
      runtimeShadowCollectionSample(
        "quality_risky_false_allow",
        inputWithVerifier({
          metadata: {
            changedFiles: ["src/quality-observation-risk.ts"],
            semanticRegressionRisk: true,
          },
        }),
        "bad_completion",
      ),
    ],
  });

  return buildCodeTaskEvidenceGateInternalShadowObservationResult({
    observerId: "quality_internal_observer",
    mode: "shadow_only",
    readinessThresholds: replayThresholdsForThreeSamples(),
    collections: [collection],
  });
}

function samples(
  prefix: string,
  count: number,
  build: (index: number) => Omit<CodeTaskEvidenceGateEvaluationSample, "sampleId">,
): CodeTaskEvidenceGateEvaluationSample[] {
  return Array.from({ length: count }, (_, index) => ({
    sampleId: `${prefix}_${index}`,
    ...build(index),
  }));
}

function runtimeReplaySamples(
  prefix: string,
  count: number,
  build: (index: number) => Omit<CodeTaskEvidenceGateRuntimeReplaySample, "replayId">,
): CodeTaskEvidenceGateRuntimeReplaySample[] {
  return Array.from({ length: count }, (_, index) => ({
    replayId: `${prefix}_${index}`,
    ...build(index),
  }));
}

function runtimeCallerInput(
  id: string,
  shadowInput: CodeTaskEvidenceGateShadowInput,
) {
  return {
    callerId: "runtime_caller",
    completionEventId: `completion_${id}`,
    mode: "shadow_only" as const,
    samplerId: "sampler",
    sampleId: `sample_${id}`,
    shadowInput,
  };
}

function runtimeShadowProducerInput(
  id: string,
  completion: CodeTaskEvidenceGateShadowInput,
) {
  return {
    producerId: "runtime_shadow_producer",
    completionEventId: `completion_${id}`,
    mode: "shadow_only" as const,
    samplerId: "sampler",
    sampleId: `sample_${id}`,
    completion,
  };
}

function runtimeShadowCollectionSample(
  id: string,
  completion: CodeTaskEvidenceGateShadowInput,
  manualReviewLabel: CodeTaskEvidenceGateManualReviewLabel,
) {
  return {
    collectionSampleId: id,
    producerInput: runtimeShadowProducerInput(id, completion),
    manualReviewLabel,
  };
}

function replayThresholdsForThreeSamples() {
  return {
    minSamples: 3,
    minEvaluatedCandidates: 3,
    minBlockPrecision: 0.5,
    maxFalseBlockRate: 0.5,
    maxFalseAllowRate: 1,
    minUsefulBlockFalseBlockRatio: 1,
    minRiskyFalseAllowShare: 1,
  };
}

function requiredProducerCallerInput(
  result: CodeTaskEvidenceGateRuntimeShadowProducerResult,
): CodeTaskEvidenceGateRuntimeCallerInput {
  expect(result.callerInput).toBeDefined();
  return result.callerInput as CodeTaskEvidenceGateRuntimeCallerInput;
}

function withoutEvidenceKind(
  input: EvidenceVerifierInput,
  kind: EvidenceVerifierInput["evidenceRefs"][number]["type"],
): EvidenceVerifierInput {
  return {
    ...input,
    evidenceRefs: input.evidenceRefs.filter((ref) => ref.type !== kind),
    toolResults: input.toolResults.map((result) => ({
      ...result,
      evidence: result.evidence.filter((ref) => ref.type !== kind),
    })),
    obligations: input.obligations.map((obligation) => {
      const evidenceRefs = obligation.evidenceRefs?.filter((ref) => ref.type !== kind);
      return {
        ...obligation,
        ...(evidenceRefs ? { evidenceRefs } : {}),
      };
    }),
  };
}
