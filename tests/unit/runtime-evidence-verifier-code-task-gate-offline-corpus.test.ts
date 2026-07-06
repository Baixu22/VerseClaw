import { describe, expect, it } from "vitest";
import {
  buildEvidenceRefFixture,
  buildEvidenceVerifierInputFixture,
  buildToolCallResultFixture,
  evaluateCodeTaskEvidenceGateReadiness,
  evaluateCodeTaskEvidenceGateShadowSamples,
  evaluateEvidenceVerifier,
  type CodeTaskEvidenceGateEvaluationSample,
  type CodeTaskEvidenceGateShadowInput,
  type EvidenceVerifierInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime evidence verifier code-task gate offline corpus", () => {
  it("quantifies first-pass gate usefulness before runtime integration", () => {
    const evaluation = evaluateCodeTaskEvidenceGateShadowSamples(offlineCorpus());

    expect(evaluation.summary).toMatchObject({
      sampleCount: 120,
      gateCandidateCount: 104,
      evaluatedCandidateCount: 96,
      trueAllowCount: 43,
      usefulBlockCount: 32,
      falseBlockCount: 7,
      falseAllowCount: 14,
      inconclusiveCount: 8,
      notEvaluatedCount: 16,
      blockPrecision: 32 / 39,
      blockRecall: 32 / 46,
      falseBlockRate: 7 / 39,
      falseAllowRate: 14 / 57,
      usefulBlockFalseBlockRatio: 32 / 7,
      riskyAllowCount: 10,
      riskyFalseAllowCount: 10,
      riskyFalseAllowShare: 10 / 14,
      shadowSummary: {
        gateCandidateCount: 104,
        wouldAllowCount: 61,
        wouldBlockCount: 43,
        notApplicableCount: 16,
      },
    });
    expect(evaluation.summary.shadowSummary.blockReasonCounts).toEqual({
      missing_verifier_report: 10,
      verifier_failed: 6,
      verifier_blocked: 4,
      verifier_cancelled: 4,
      verifier_insufficient_evidence: 19,
    });
    expect(evaluation.summary.shadowSummary.evidenceCaptureIssueCounts).toEqual({
      truly_missing_validation: 37,
      validation_done_but_not_captured: 1,
      external_validation_not_represented: 1,
      local_test_not_required: 3,
      report_task_id_or_shape_issue: 1,
    });
    expect(evaluation.summary.falseBlockCauseCounts).toEqual({
      truly_missing_validation: 1,
      validation_done_but_not_captured: 1,
      external_validation_not_represented: 1,
      local_test_not_required: 3,
      report_task_id_or_shape_issue: 1,
    });
    expect(evaluation.summary.categoryCounts).toMatchObject({
      valid_full_evidence: 43,
      missing_validation_evidence: 11,
      tool_or_test_failure: 14,
      missing_verifier_report: 8,
      local_test_not_required: 3,
      external_validation_uncaptured: 2,
      non_code_task: 8,
      legacy_not_completed: 8,
      reviewer_inconclusive: 8,
      semantic_regression_with_complete_refs: 14,
      report_shape_issue: 1,
    });

    const offlineReadiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "offline_corpus",
    );
    expect(offlineReadiness).toMatchObject({
      decision: "ready",
      diagnostics: [{ code: "readiness_thresholds_met" }],
    });

    const samplerReadiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "shadow_sampler",
    );
    expect(samplerReadiness).toMatchObject({
      decision: "ready",
      diagnostics: [{ code: "readiness_thresholds_met" }],
    });

    const activePilotReadiness = evaluateCodeTaskEvidenceGateReadiness(
      evaluation,
      "active_pilot",
    );
    expect(activePilotReadiness).toMatchObject({
      decision: "blocked",
    });
    expect(activePilotReadiness.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(
        expect.arrayContaining([
          "false_block_rate_above_threshold",
          "runtime_shadow_evidence_required",
        ]),
      );
  });
});

function offlineCorpus(): CodeTaskEvidenceGateEvaluationSample[] {
  return [
    ...many("valid_with_full_evidence", 43, () => ({
      input: codeTaskWithVerifier("completed"),
      manualReviewLabel: "valid_completion",
      category: "valid_full_evidence",
    })),
    ...many("bad_missing_tests", 10, () => ({
      input: codeTaskWithVerifier("missing_test_evidence"),
      manualReviewLabel: "bad_completion",
      category: "missing_validation_evidence",
    })),
    ...many("bad_tool_error", 6, () => ({
      input: codeTaskWithVerifier("tool_error"),
      manualReviewLabel: "bad_completion",
      category: "tool_or_test_failure",
    })),
    ...many("bad_cancelled_tool", 4, () => ({
      input: codeTaskWithVerifier("cancelled_tool"),
      manualReviewLabel: "bad_completion",
      category: "tool_or_test_failure",
    })),
    ...many("bad_blocked_external", 4, () => ({
      input: codeTaskWithVerifier("blocked_external"),
      manualReviewLabel: "bad_completion",
      category: "tool_or_test_failure",
    })),
    ...many("bad_missing_report", 8, () => ({
      input: codeTaskWithoutVerifier(),
      manualReviewLabel: "bad_completion",
      category: "missing_verifier_report",
    })),
    ...many("valid_no_local_test_expected", 3, () => ({
      input: codeTaskWithVerifier("missing_test_evidence", {
        evidenceCaptureIssue: "local_test_not_required",
      }),
      manualReviewLabel: "valid_completion",
      category: "local_test_not_required",
    })),
    {
      sampleId: "valid_validation_done_but_not_captured",
      input: codeTaskWithoutVerifier({
        evidenceCaptureIssue: "validation_done_but_not_captured",
      }),
      manualReviewLabel: "valid_completion",
      notes: "Represents a valid code task whose validation evidence was not captured.",
      category: "external_validation_uncaptured",
    },
    {
      sampleId: "valid_external_validation_not_represented",
      input: codeTaskWithoutVerifier({
        evidenceCaptureIssue: "external_validation_not_represented",
      }),
      manualReviewLabel: "valid_completion",
      notes: "Represents external validation that happened outside the verifier report.",
      category: "external_validation_uncaptured",
    },
    {
      sampleId: "valid_but_validation_truly_missing",
      input: codeTaskWithVerifier("missing_test_evidence"),
      manualReviewLabel: "valid_completion",
      notes: "Represents a correct code edit whose validation was genuinely missing.",
      category: "missing_validation_evidence",
    },
    {
      sampleId: "valid_report_shape_issue",
      input: codeTaskWithVerifier("missing_test_evidence", {
        evidenceCaptureIssue: "report_task_id_or_shape_issue",
      }),
      manualReviewLabel: "valid_completion",
      notes: "Represents a valid task misclassified by report shape or task-id capture.",
      category: "report_shape_issue",
    },
    ...many("bad_semantic_regression_risky", 10, (index) => ({
      input: codeTaskWithVerifier("completed", semanticRiskMetadata(index)),
      manualReviewLabel: "bad_completion",
      category: "semantic_regression_with_complete_refs",
    })),
    ...many("bad_semantic_regression_clean_gap", 4, () => ({
      input: codeTaskWithVerifier("completed"),
      manualReviewLabel: "bad_completion",
      category: "semantic_regression_with_complete_refs",
    })),
    ...many("reviewer_uncertain_missing_evidence", 4, () => ({
      input: codeTaskWithVerifier("missing_test_evidence"),
      manualReviewLabel: "inconclusive",
      category: "reviewer_inconclusive",
    })),
    ...many("reviewer_uncertain_completed", 4, () => ({
      input: codeTaskWithVerifier("completed"),
      manualReviewLabel: "inconclusive",
      category: "reviewer_inconclusive",
    })),
    ...many("non_code_docs", 8, () => ({
      input: {
        taskId: "task_docs",
        objective: "Update docs only.",
        taskKind: "non_code",
        legacyTerminalStatus: "complete",
      },
      manualReviewLabel: "valid_completion",
      category: "non_code_task",
    })),
    ...many("legacy_not_completed", 8, () => ({
      input: {
        taskId: "task_repair",
        objective: "Repair a code task.",
        taskKind: "code_edit",
        legacyTerminalStatus: "repair",
      },
      manualReviewLabel: "bad_completion",
      category: "legacy_not_completed",
    })),
  ];
}

function codeTaskWithVerifier(
  verifierState: VerifierState,
  metadata?: CodeTaskEvidenceGateShadowInput["metadata"],
): CodeTaskEvidenceGateShadowInput {
  const verifierInput = verifierInputFor(verifierState);
  return {
    taskId: verifierInput.taskId,
    objective: "Implement a representative code change.",
    taskKind: "code_edit",
    legacyTerminalStatus: "complete",
    verifierReport: evaluateEvidenceVerifier(verifierInput),
    ...(metadata ? { metadata } : {}),
  };
}

function codeTaskWithoutVerifier(
  metadata?: CodeTaskEvidenceGateShadowInput["metadata"],
): CodeTaskEvidenceGateShadowInput {
  return {
    taskId: "task_missing_report",
    objective: "Implement a representative code change.",
    taskKind: "code_edit",
    legacyTerminalStatus: "complete",
    ...(metadata ? { metadata } : {}),
  };
}

type VerifierState =
  | "completed"
  | "missing_test_evidence"
  | "tool_error"
  | "cancelled_tool"
  | "blocked_external";

function verifierInputFor(verifierState: VerifierState): EvidenceVerifierInput {
  const input = buildEvidenceVerifierInputFixture({
    taskId: `task_${verifierState}`,
  });
  if (verifierState === "missing_test_evidence") {
    return withoutEvidenceKind(input, "test");
  }
  if (verifierState === "tool_error") {
    return {
      ...input,
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_error",
          status: "error",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_error" })],
        }),
      ],
    };
  }
  if (verifierState === "cancelled_tool") {
    return {
      ...input,
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_cancelled",
          status: "cancelled",
          evidence: [
            buildEvidenceRefFixture({ type: "tool", ref: "tool_cancelled" }),
          ],
        }),
      ],
    };
  }
  if (verifierState === "blocked_external") {
    return {
      ...input,
      obligations: input.obligations.map((obligation) => ({
        ...obligation,
        status: "blocked",
        externalDependency: true,
      })),
    };
  }
  return input;
}

function semanticRiskMetadata(
  index: number,
): CodeTaskEvidenceGateShadowInput["metadata"] {
  return {
    changedFiles: [`src/regression-${index}.ts`],
    evidenceDiffMismatch: true,
    obligationEvidenceMapped: false,
    semanticRegressionRisk: true,
    testCoverage: "weak",
  };
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

function many(
  prefix: string,
  count: number,
  build: (index: number) => Omit<CodeTaskEvidenceGateEvaluationSample, "sampleId">,
): CodeTaskEvidenceGateEvaluationSample[] {
  return Array.from({ length: count }, (_, index) => ({
    sampleId: `${prefix}_${index}`,
    ...build(index),
  }));
}
