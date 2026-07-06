import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAstEditPlanEvidenceVerifierReadiness,
  evaluateEvidenceVerifier,
  generateAstGrepEditPlanReadonlyCandidates,
  isEditPlanForEvidenceVerifierReadiness,
  type EditPlan,
} from "../../openclaw_runtime/src/runtime-core";

describe("AST EditPlan Evidence Verifier readiness bridge", () => {
  it("turns a valid ast-grep EditPlan into bounded verifier-readiness input", () => {
    const plan = validAstGrepPlan();
    const report = buildAstEditPlanEvidenceVerifierReadiness(plan, {
      taskId: "task_ast_readiness",
      objective: "Review readonly AST EditPlan readiness.",
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.ast_edit_plan.evidence_verifier_readiness",
      readiness: "ready_for_evidence_verifier_review",
      planId: plan.planId,
      engineId: "runtime.ast_grep.napi.readonly_candidate_generation",
      sourceKind: "ast_grep_readonly_adapter",
      targetFileCount: 1,
      matchCount: 1,
      previewDiff: {
        requested: true,
        available: true,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        fileCount: 1,
      },
      authority: {
        planningOnly: true,
        readonly: true,
        noPatchApply: true,
        noWorkspaceMutation: true,
        noSymbolMutation: true,
        explicitApplyGateRequired: true,
        noActiveCompletionGate: true,
        eligibleAfterVerificationDoesNotApply: true,
      },
      evidenceUse: {
        readonlyCandidateTextIsTaskCompletionEvidence: false,
        previewDiffIsTaskCompletionEvidence: false,
        matchCountIsTaskCompletionEvidence: false,
        astGrepResultIsTaskCompletionEvidence: false,
        editPlanIsTaskCompletionEvidence: false,
        readinessReportIsTaskCompletionEvidence: false,
      },
      legacyDecisionUnaffected: true,
    });
    expect(report.requirements.map((item) => [item.id, item.status])).toEqual([
      ["source_hashes_present", "satisfied"],
      ["match_ranges_present", "satisfied"],
      ["ordered_operations_present", "satisfied"],
      ["no_conflict_diagnostics", "satisfied"],
      ["preview_diff_available", "satisfied"],
      ["evidence_verifier_review", "pending"],
    ]);
    expect(report.candidateOperations).toEqual([
      expect.objectContaining({
        order: 1,
        operationId: "operation_0001",
        kind: "replace_range",
        filePath: "tests/fixtures/ast-grep-edit-plan/api-call-migration.ts",
      }),
    ]);
    expect(report.verifierInput).toMatchObject({
      taskId: "task_ast_readiness",
      objective: "Review readonly AST EditPlan readiness.",
      eventReplay: {
        status: "not_run",
        diagnosticCodes: ["ast_edit_plan_readiness_bridge_non_gating"],
      },
      metadata: {
        planId: plan.planId,
        explicitApplyGateRequired: true,
        taskCompletionEvidence: false,
        noActiveCompletionGate: true,
      },
    });
    expect(report.verifierInput?.obligations).toContainEqual(expect.objectContaining({
      id: "edit_plan_requirement:evidence_verifier_review",
      status: "open",
    }));
    expect(evaluateEvidenceVerifier(report.verifierInput).decision).not.toBe("completed");
  });

  it("fails closed when source hashes are missing", () => {
    const plan = validAstGrepPlan();
    const missingHashes: EditPlan = {
      ...plan,
      sourceHashes: {},
      targetFiles: plan.targetFiles.map(({ sourceHash: _sourceHash, ...file }) => file),
    };
    const report = buildAstEditPlanEvidenceVerifierReadiness(missingHashes);

    expect(report.readiness).toBe("blocked");
    expect(report.requirements).toContainEqual(expect.objectContaining({
      id: "source_hashes_present",
      status: "blocked",
    }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "source_hashes_missing",
      severity: "error",
    }));
    expect(report.verifierInput?.obligations).toContainEqual(expect.objectContaining({
      id: "edit_plan_requirement:source_hashes_present",
      status: "blocked",
    }));
  });

  it("blocks readiness when conflict diagnostics are present", () => {
    const result = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("overlap-conflict.ts")],
    });
    const report = buildAstEditPlanEvidenceVerifierReadiness(result.editPlan);

    expect(result.status).toBe("review_required");
    expect(report.readiness).toBe("blocked");
    expect(report.requirements).toContainEqual(expect.objectContaining({
      id: "no_conflict_diagnostics",
      status: "blocked",
      diagnostics: ["overlapping_ranges"],
    }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "conflict_diagnostics_present",
      severity: "error",
    }));
  });

  it("keeps missing preview diff pending and review-required", () => {
    const result = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
      },
      targetFiles: [target("api-call-migration.ts")],
    });
    const report = buildAstEditPlanEvidenceVerifierReadiness(result.editPlan);

    expect(result.editPlan.previewDiff).toMatchObject({
      available: false,
      unavailableReason: "unfixable_rule",
    });
    expect(report.readiness).toBe("review_required");
    expect(report.requirements).toContainEqual(expect.objectContaining({
      id: "preview_diff_available",
      status: "pending",
      diagnostics: ["unfixable_rule"],
    }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "preview_diff_pending",
      severity: "warning",
    }));
  });

  it("prevents readiness when fingerprints drift", () => {
    const plan = validAstGrepPlan();
    const report = buildAstEditPlanEvidenceVerifierReadiness(plan, {
      expectedPlanId: "edit_plan_deadbeef",
      expectedSourceHashes: {
        "tests/fixtures/ast-grep-edit-plan/api-call-migration.ts": "different_hash",
      },
      expectedPreviewDiffHash: "different_preview_hash",
    });

    expect(report.readiness).toBe("blocked");
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "edit_plan_fingerprint_mismatch" }),
      expect.objectContaining({ code: "source_hash_drift" }),
      expect.objectContaining({ code: "preview_diff_hash_drift" }),
    ]));
  });

  it("fails closed for invalid and non-EditPlan input", () => {
    expect(isEditPlanForEvidenceVerifierReadiness({ nope: true })).toBe(false);

    const report = buildAstEditPlanEvidenceVerifierReadiness({ nope: true });

    expect(report).toMatchObject({
      readiness: "invalid_input",
      planId: "unknown",
      engineId: "unknown",
      candidateOperations: [],
      diagnostics: [{ code: "invalid_edit_plan_input", severity: "error" }],
    });
    expect("verifierInput" in report).toBe(false);
  });

  it("does not treat readonly candidate text, preview diff, or match count as task-completion evidence", () => {
    const report = buildAstEditPlanEvidenceVerifierReadiness(validAstGrepPlan());

    expect(report.evidenceUse).toEqual({
      readonlyCandidateTextIsTaskCompletionEvidence: false,
      previewDiffIsTaskCompletionEvidence: false,
      matchCountIsTaskCompletionEvidence: false,
      astGrepResultIsTaskCompletionEvidence: false,
      editPlanIsTaskCompletionEvidence: false,
      readinessReportIsTaskCompletionEvidence: false,
    });
    expect(JSON.stringify(report.verifierInput?.metadata)).toContain('"taskCompletionEvidence":false');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "readonly_candidate_not_completion_evidence",
      severity: "info",
    }));
  });

  it("keeps deterministic ordering and bounded output", () => {
    const plan = multiMatchPlan();
    const first = buildAstEditPlanEvidenceVerifierReadiness(plan, {
      maxOperations: 1,
      maxDiagnostics: 3,
      maxEvidenceRefs: 2,
    });
    const second = buildAstEditPlanEvidenceVerifierReadiness(plan, {
      maxOperations: 1,
      maxDiagnostics: 3,
      maxEvidenceRefs: 2,
    });

    expect(first).toEqual(second);
    expect(first.candidateOperations).toHaveLength(1);
    expect(first.candidateOperations[0]).toMatchObject({
      order: 1,
      operationId: "operation_0001",
    });
    expect(first.diagnostics.length).toBeLessThanOrEqual(3);
    expect(first.diagnostics).toContainEqual(expect.objectContaining({
      code: "bounded_output",
    }));
    expect(first.verifierInput?.evidenceRefs.length).toBeLessThanOrEqual(2);
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

function multiMatchPlan(): EditPlan {
  const result = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: "typescript",
      pattern: "oldApi($VALUE)",
      fix: "newApi($VALUE)",
    },
    targetFiles: [target("overlap-conflict.ts")],
    maxMatches: 16,
  });
  expect(result.editPlan.orderedOperations.length).toBeGreaterThan(1);
  return result.editPlan;
}

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-grep-edit-plan/${fileName}`;
  return {
    filePath,
    content: readFileSync(path.join(process.cwd(), filePath), "utf8"),
  };
}
