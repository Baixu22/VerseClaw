import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAstEditPlanApplyGateReadiness,
  buildAstEditPlanEvidenceVerifierReadiness,
  fingerprintEditPlanMatchRanges,
  generateAstGrepEditPlanReadonlyCandidates,
  type ApplyGateOperatorApproval,
  type ApplyGateCurrentFingerprint,
  type AstEditPlanEvidenceVerifierReadinessReport,
  type EditPlan,
  type EvidenceVerifierReport,
} from "../../openclaw_runtime/src/runtime-core";

describe("AST EditPlan explicit apply gate readiness", () => {
  it("approves only readiness when plan, verifier, fingerprints, and operator approval all align", () => {
    const plan = validAstGrepPlan();
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const evidenceVerifierReport = completedVerifierReport(readinessReport);
    const currentFingerprint = currentFingerprintFor(plan);
    const operatorApproval = approvalFor(currentFingerprint);

    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport,
      evidenceVerifierReport,
      currentFingerprint,
      operatorApproval,
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.ast_edit_plan.apply_gate_readiness",
      decision: "approved_for_explicit_apply",
      planId: plan.planId,
      engineId: "runtime.ast_grep.napi.readonly_candidate_generation",
      sourceKind: "ast_grep_readonly_adapter",
      readinessReportSource: "runtime.ast_edit_plan.evidence_verifier_readiness",
      evidenceVerifierDecision: "completed",
      operationSummary: {
        count: 1,
        reportedCount: 1,
        maxAllowedOperations: 64,
        unsupportedKinds: [],
      },
      operatorApproval: {
        present: true,
        approved: true,
        approvalId: "approval_1",
        approvedBy: "operator@example.test",
      },
      authority: {
        planningOnly: true,
        readinessOnly: true,
        readonly: true,
        noPatchApply: true,
        noWorkspaceMutation: true,
        noSymbolMutation: true,
        noRuntimeRoute: true,
        noProviderTransportChange: true,
        noPromptOrModelMessageInsertion: true,
        noPersistence: true,
        noDefaultOnBehavior: true,
        explicitApplyGateRequired: true,
        approvedDecisionDoesNotApply: true,
      },
      evidenceUse: {
        previewDiffIsTaskCompletionEvidence: false,
        matchCountIsTaskCompletionEvidence: false,
        candidateTextIsTaskCompletionEvidence: false,
        editPlanIsTaskCompletionEvidence: false,
        evidenceVerifierReportIsTaskCompletionEvidence: false,
        applyGateReadinessReportIsTaskCompletionEvidence: false,
      },
      legacyDecisionUnaffected: true,
    });
    expect(report.requiredVerifierRequirements.every((item) => item.status === "satisfied")).toBe(true);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "apply_gate_readiness_not_completion_evidence", severity: "info" }),
      expect.objectContaining({ code: "explicit_apply_not_performed", severity: "info" }),
    ]));
  });

  it("blocks when explicit operator approval is missing", () => {
    const plan = validAstGrepPlan();
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport: buildAstEditPlanEvidenceVerifierReadiness(plan),
      evidenceVerifierReport: completedVerifierReport(buildAstEditPlanEvidenceVerifierReadiness(plan)),
      currentFingerprint: currentFingerprintFor(plan),
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_operator_approval",
      severity: "error",
    }));
  });

  it("blocks when the Evidence Verifier report did not pass", () => {
    const plan = validAstGrepPlan();
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport,
      evidenceVerifierReport: {
        ...completedVerifierReport(readinessReport),
        decision: "failed",
      },
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: approvalFor(currentFingerprintFor(plan)),
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "evidence_verifier_not_completed",
      severity: "error",
    }));
  });

  it("keeps a pending readiness report in review_required", () => {
    const plan = validAstGrepPlan();
    const ready = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const pendingReadiness: AstEditPlanEvidenceVerifierReadinessReport = {
      ...ready,
      readiness: "review_required",
    };
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport: pendingReadiness,
      evidenceVerifierReport: completedVerifierReport(ready),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: approvalFor(currentFingerprintFor(plan)),
    });

    expect(report.decision).toBe("review_required");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "readiness_report_not_ready",
      severity: "warning",
    }));
  });

  it("blocks source, preview, and match range drift", () => {
    const plan = validAstGrepPlan();
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport,
      evidenceVerifierReport: completedVerifierReport(readinessReport),
      currentFingerprint: {
        planId: "edit_plan_drift",
        sourceHashes: { "tests/fixtures/ast-grep-edit-plan/api-call-migration.ts": "different" },
        previewDiffHash: "different",
        matchRangeFingerprint: "different",
      },
      operatorApproval: approvalFor(currentFingerprintFor(plan)),
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "plan_fingerprint_drift" }),
      expect.objectContaining({ code: "source_hash_drift" }),
      expect.objectContaining({ code: "preview_diff_hash_drift" }),
      expect.objectContaining({ code: "match_range_drift" }),
    ]));
  });

  it("blocks conflict diagnostics before any later apply pilot can proceed", () => {
    const result = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("overlap-conflict.ts")],
    });
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(result.editPlan);
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: result.editPlan,
      readinessReport,
      evidenceVerifierReport: completedVerifierReport(readinessReport),
      currentFingerprint: currentFingerprintFor(result.editPlan),
      operatorApproval: approvalFor(currentFingerprintFor(result.editPlan)),
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "conflict_diagnostics_present",
      severity: "error",
    }));
  });

  it("blocks authority boundary drift", () => {
    const plan = validAstGrepPlan();
    const driftedPlan: EditPlan = {
      ...plan,
      authority: {
        ...plan.authority,
        noPatchApply: false,
      } as unknown as EditPlan["authority"],
    };
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: driftedPlan,
      readinessReport,
      evidenceVerifierReport: completedVerifierReport(readinessReport),
      currentFingerprint: currentFingerprintFor(driftedPlan),
      operatorApproval: approvalFor(currentFingerprintFor(driftedPlan)),
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "authority_boundary_drift",
      severity: "error",
    }));
  });

  it("blocks over-budget and unsupported operations", () => {
    const basePlan = unfixablePlan();
    const plan: EditPlan = {
      ...basePlan,
      orderedOperations: [
        basePlan.orderedOperations[0],
        {
          ...basePlan.orderedOperations[0],
          order: 2,
          operationId: "operation_0002",
        },
      ],
    };
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport,
      evidenceVerifierReport: completedVerifierReport(readinessReport),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: approvalFor(currentFingerprintFor(plan)),
    }, {
      maxAllowedOperations: 1,
    });

    expect(report.decision).toBe("blocked");
    expect(report.operationSummary.unsupportedKinds).toEqual(["match_only"]);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "operation_budget_exceeded" }),
      expect.objectContaining({ code: "unsupported_operation" }),
    ]));
  });

  it("blocks missing required verifier requirements", () => {
    const plan = validAstGrepPlan();
    const ready = buildAstEditPlanEvidenceVerifierReadiness(plan);
    const missingRequirement: AstEditPlanEvidenceVerifierReadinessReport = {
      ...ready,
      requirements: ready.requirements.filter((item) => item.id !== "preview_diff_available"),
    };
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: plan,
      readinessReport: missingRequirement,
      evidenceVerifierReport: completedVerifierReport(ready),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: approvalFor(currentFingerprintFor(plan)),
    });

    expect(report.decision).toBe("blocked");
    expect(report.requiredVerifierRequirements).toContainEqual({
      id: "preview_diff_available",
      status: "missing",
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "required_verifier_requirement_missing",
      severity: "error",
    }));
  });

  it("keeps deterministic bounded output", () => {
    const result = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("overlap-conflict.ts")],
      maxMatches: 16,
    });
    const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(result.editPlan);
    const input = {
      editPlan: result.editPlan,
      readinessReport,
      evidenceVerifierReport: completedVerifierReport(readinessReport),
      currentFingerprint: currentFingerprintFor(result.editPlan),
      operatorApproval: approvalFor(currentFingerprintFor(result.editPlan)),
    };
    const first = buildAstEditPlanApplyGateReadiness(input, {
      maxOperations: 1,
      maxAllowedOperations: 16,
      maxDiagnostics: 4,
      maxEvidenceRefs: 2,
    });
    const second = buildAstEditPlanApplyGateReadiness(input, {
      maxOperations: 1,
      maxAllowedOperations: 16,
      maxDiagnostics: 4,
      maxEvidenceRefs: 2,
    });

    expect(first).toEqual(second);
    expect(first.operationSummary.reportedCount).toBe(1);
    expect(first.diagnostics.length).toBeLessThanOrEqual(4);
    expect(first.diagnostics).toContainEqual(expect.objectContaining({ code: "bounded_output" }));
  });

  it("fails closed for invalid input", () => {
    const report = buildAstEditPlanApplyGateReadiness({
      editPlan: { nope: true },
      readinessReport: { nope: true },
      evidenceVerifierReport: { nope: true },
      operatorApproval: { nope: true },
    });

    expect(report).toMatchObject({
      decision: "blocked",
      planId: "unknown",
      engineId: "unknown",
      operatorApproval: {
        present: true,
        approved: false,
      },
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_edit_plan_input",
      severity: "error",
    }));
  });
});

function validAstGrepPlan(): EditPlan {
  const result = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: "typescript",
      pattern: "oldApi($VALUE)",
      fix: "newApi($VALUE)",
    },
    targetFiles: [target("api-call-migration.ts")],
  });
  expect(result.status).toBe("success");
  return result.editPlan;
}

function unfixablePlan(): EditPlan {
  const result = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: "typescript",
      pattern: "oldApi($VALUE)",
    },
    targetFiles: [target("api-call-migration.ts")],
  });
  expect(result.editPlan.orderedOperations).toContainEqual(expect.objectContaining({ kind: "match_only" }));
  return result.editPlan;
}

function currentFingerprintFor(plan: EditPlan): ApplyGateCurrentFingerprint {
  return {
    planId: plan.planId,
    sourceHashes: plan.sourceHashes,
    previewDiffHash: plan.previewDiff.hash ?? "",
    matchRangeFingerprint: fingerprintEditPlanMatchRanges(plan),
  };
}

function approvalFor(scope: ApplyGateCurrentFingerprint): ApplyGateOperatorApproval {
  return {
    approved: true,
    approvalId: "approval_1",
    approvedBy: "operator@example.test",
    statement: "approve_explicit_apply_gate_readiness_only",
    scope,
    understandsNoTaskCompletionEvidence: true,
  };
}

function completedVerifierReport(
  readinessReport: AstEditPlanEvidenceVerifierReadinessReport,
): EvidenceVerifierReport {
  return {
    taskId: readinessReport.verifierInput?.taskId ?? "task_ast_apply_gate",
    objective: readinessReport.verifierInput?.objective ?? "Review AST apply gate readiness.",
    decision: "completed",
    findings: [],
    requiredEvidenceKinds: ["file", "test", "tool"],
    evidenceRefs: readinessReport.verifierInput?.evidenceRefs ?? [],
    legacyDecisionUnaffected: true,
  };
}

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-grep-edit-plan/${fileName}`;
  return {
    filePath,
    content: readFileSync(path.join(process.cwd(), filePath), "utf8"),
  };
}
