import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAstEditPlanApplyGateReadiness,
  buildAstEditPlanEvidenceVerifierReadiness,
  fingerprintEditPlanMatchRanges,
  generateAstGrepEditPlanReadonlyCandidates,
  runAstEditPlanControlledApplyPilot,
  type ApplyGateCurrentFingerprint,
  type ApplyGateOperatorApproval,
  type ApplyGateReadinessReport,
  type AstEditPlanEvidenceVerifierReadinessReport,
  type ControlledApplyOperatorApproval,
  type ControlledApplyTarget,
  type EditPlan,
  type EvidenceVerifierReport,
} from "../../openclaw_runtime/src/runtime-core";

const tempFiles: string[] = [];

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    rmSync(filePath, { force: true });
  }
});

describe("AST EditPlan controlled explicit apply pilot", () => {
  it("returns dry-run summaries for an approved explicit target without writing", () => {
    const plan = validAstGrepPlan();
    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: targetsFor(plan),
      options: { dryRun: true },
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.ast_edit_plan.controlled_apply_pilot",
      decision: "dry_run_ready",
      dryRun: true,
      operationSummary: {
        count: 1,
        reportedCount: 1,
        maxAllowedOperations: 64,
        unsupportedKinds: [],
      },
      authority: {
        explicitCallOnly: true,
        controlledPilotOnly: true,
        noWorkspaceScan: true,
        noFileDiscovery: true,
        noSymbolMutation: true,
        noRuntimeRoute: true,
        noProviderTransportChange: true,
        noPromptOrModelMessageInsertion: true,
        noPersistence: true,
        noDefaultOnBehavior: true,
        callerOwnedTargetsOnly: true,
      },
      evidenceUse: {
        previewDiffIsTaskCompletionEvidence: false,
        matchCountIsTaskCompletionEvidence: false,
        candidateTextIsTaskCompletionEvidence: false,
        editPlanIsTaskCompletionEvidence: false,
        applyGateReadinessReportIsTaskCompletionEvidence: false,
        controlledApplyPilotReportIsTaskCompletionEvidence: false,
      },
      legacyDecisionUnaffected: true,
    });
    expect(report.fileSummaries).toHaveLength(1);
    expect(report.fileSummaries[0]).toMatchObject({
      filePath: plan.orderedOperations[0].filePath,
      operationCount: 1,
      originalHash: plan.sourceHashes[plan.orderedOperations[0].filePath],
      wrote: false,
      failed: false,
    });
    expect(report.fileSummaries[0].plannedHash).not.toBe(report.fileSummaries[0].originalHash);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "controlled_apply_not_completion_evidence",
      severity: "info",
    }));
  });

  it("applies to an explicit test-owned file only when allowWrite is true", () => {
    const original = fixtureContent("api-call-migration.ts");
    const filePath = tempFilePath("controlled-apply-approved");
    writeFileSync(filePath, original);
    const plan = movePlanToFiles(validAstGrepPlan(), [filePath]);

    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, false),
      targets: targetsFor(plan, new Map([[filePath, original]])),
      options: { dryRun: false, allowWrite: true },
    });

    expect(report.decision).toBe("applied");
    expect(report.fileSummaries).toContainEqual(expect.objectContaining({
      filePath,
      wrote: true,
      failed: false,
    }));
    expect(readFileSync(filePath, "utf8")).toContain("newApi(input)");
  });

  it("fails closed for invalid EditPlan input and missing or invalid gate reports", () => {
    const invalid = runAstEditPlanControlledApplyPilot({
      editPlan: { nope: true },
      applyGateReadinessReport: { nope: true },
      operatorApproval: { nope: true },
    });
    expect(invalid.decision).toBe("blocked");
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_edit_plan_input",
      severity: "error",
    }));

    const plan = validAstGrepPlan();
    const missingGate = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: targetsFor(plan),
    });
    expect(missingGate.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_apply_gate_readiness_report",
      severity: "error",
    }));

    const invalidGate = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: { nope: true },
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: targetsFor(plan),
    });
    expect(invalidGate.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_apply_gate_readiness_report",
      severity: "error",
    }));
  });

  it.each(["blocked", "review_required"] as const)(
    "blocks when the Phase 4 ApplyGateDecision is %s",
    (decision) => {
      const plan = validAstGrepPlan();
      const gate: ApplyGateReadinessReport = {
        ...approvedGateFor(plan),
        decision,
      };

      const report = runAstEditPlanControlledApplyPilot({
        editPlan: plan,
        applyGateReadinessReport: gate,
        currentFingerprint: currentFingerprintFor(plan),
        operatorApproval: pilotApprovalFor(plan, true),
        targets: targetsFor(plan),
      });

      expect(report.decision).toBe("blocked");
      expect(report.diagnostics).toContainEqual(expect.objectContaining({
        code: "apply_gate_not_approved",
        severity: "error",
      }));
    },
  );

  it("blocks missing approval and approval scope drift", () => {
    const plan = validAstGrepPlan();
    const missing = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      targets: targetsFor(plan),
    });
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_operator_approval",
      severity: "error",
    }));

    const driftedApproval: ControlledApplyOperatorApproval = {
      ...pilotApprovalFor(plan, true),
      scope: {
        ...pilotApprovalFor(plan, true).scope,
        targetFilePaths: ["different.ts"],
      },
    };
    const drift = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: driftedApproval,
      targets: targetsFor(plan),
    });
    expect(drift.diagnostics).toContainEqual(expect.objectContaining({
      code: "operator_approval_scope_drift",
      severity: "error",
    }));
  });

  it("blocks source, preview, and match range drift", () => {
    const plan = validAstGrepPlan();
    const base = {
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: targetsFor(plan),
    };

    expect(runAstEditPlanControlledApplyPilot({
      ...base,
      currentFingerprint: { ...currentFingerprintFor(plan), sourceHashes: { [plan.orderedOperations[0].filePath]: "different" } },
    }).diagnostics).toContainEqual(expect.objectContaining({ code: "source_hash_drift" }));
    expect(runAstEditPlanControlledApplyPilot({
      ...base,
      currentFingerprint: { ...currentFingerprintFor(plan), previewDiffHash: "different" },
    }).diagnostics).toContainEqual(expect.objectContaining({ code: "preview_diff_hash_drift" }));
    expect(runAstEditPlanControlledApplyPilot({
      ...base,
      currentFingerprint: { ...currentFingerprintFor(plan), matchRangeFingerprint: "different" },
    }).diagnostics).toContainEqual(expect.objectContaining({ code: "match_range_drift" }));
  });

  it("blocks target content and match excerpt drift", () => {
    const plan = validAstGrepPlan();
    const filePath = plan.orderedOperations[0].filePath;
    const targetContentDrift = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: [{ filePath, currentContent: fixtureContent("api-call-migration.ts").replace("oldApi", "otherApi") }],
    });
    expect(targetContentDrift.diagnostics).toContainEqual(expect.objectContaining({
      code: "target_content_hash_drift",
      severity: "error",
    }));

    const excerptDriftContent = fixtureContent("api-call-migration.ts").replace("oldApi", "sameLen");
    const excerptDriftPlan: EditPlan = {
      ...plan,
      sourceHashes: { ...plan.sourceHashes, [filePath]: digest(excerptDriftContent) },
      targetFiles: plan.targetFiles.map((file) =>
        file.filePath === filePath ? { ...file, sourceHash: digest(excerptDriftContent) } : file
      ),
    };
    const excerptDrift = runAstEditPlanControlledApplyPilot({
      editPlan: excerptDriftPlan,
      applyGateReadinessReport: approvedGateFor(excerptDriftPlan),
      currentFingerprint: currentFingerprintFor(excerptDriftPlan),
      operatorApproval: pilotApprovalFor(excerptDriftPlan, true),
      targets: [{ filePath, currentContent: excerptDriftContent }],
    });
    expect(excerptDrift.diagnostics).toContainEqual(expect.objectContaining({
      code: "match_excerpt_drift",
      severity: "error",
    }));
  });

  it("refuses overlapping ranges, match_only operations, and conflict diagnostics", () => {
    const overlapPlan = duplicateOverlappingOperation(validAstGrepPlan());
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: overlapPlan,
      applyGateReadinessReport: approvedGateFor(overlapPlan),
      currentFingerprint: currentFingerprintFor(overlapPlan),
      operatorApproval: pilotApprovalFor(overlapPlan, true),
      targets: targetsFor(overlapPlan),
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "overlapping_ranges",
      severity: "error",
    }));

    const matchOnlyPlan = unfixablePlan();
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: matchOnlyPlan,
      applyGateReadinessReport: approvedGateFor(matchOnlyPlan),
      currentFingerprint: currentFingerprintFor(matchOnlyPlan),
      operatorApproval: pilotApprovalFor(matchOnlyPlan, true),
      targets: targetsFor(matchOnlyPlan),
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported_operation",
      severity: "error",
    }));

    const conflictPlan = conflictDiagnosticPlan();
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: conflictPlan,
      applyGateReadinessReport: approvedGateFor(conflictPlan),
      currentFingerprint: currentFingerprintFor(conflictPlan),
      operatorApproval: pilotApprovalFor(conflictPlan, true),
      targets: targetsFor(conflictPlan),
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "conflict_diagnostics_present",
      severity: "error",
    }));
  });

  it("blocks missing targets, real apply without allowWrite, operation budget excess, and authority drift", () => {
    const plan = validAstGrepPlan();
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: [],
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_caller_owned_target",
      severity: "error",
    }));

    expect(runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, false),
      targets: targetsFor(plan),
      options: { dryRun: false },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "allow_write_required",
      severity: "error",
    }));

    expect(runAstEditPlanControlledApplyPilot({
      editPlan: duplicateOverlappingOperation(plan),
      applyGateReadinessReport: approvedGateFor(duplicateOverlappingOperation(plan)),
      currentFingerprint: currentFingerprintFor(duplicateOverlappingOperation(plan)),
      operatorApproval: pilotApprovalFor(duplicateOverlappingOperation(plan), true),
      targets: targetsFor(plan),
      options: { maxOperations: 1 },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "operation_budget_exceeded",
      severity: "error",
    }));

    const authorityDrift: EditPlan = {
      ...plan,
      authority: { ...plan.authority, noPatchApply: false } as EditPlan["authority"],
    };
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: authorityDrift,
      applyGateReadinessReport: approvedGateFor(authorityDrift),
      currentFingerprint: currentFingerprintFor(authorityDrift),
      operatorApproval: pilotApprovalFor(authorityDrift, true),
      targets: targetsFor(authorityDrift),
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "authority_boundary_drift",
      severity: "error",
    }));
  });

  it("bounds diagnostics and keeps pilot output non-authoritative", () => {
    const plan = validAstGrepPlan();
    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: { nope: true },
      currentFingerprint: {},
      operatorApproval: { approved: false },
      targets: [],
      options: { dryRun: false, maxDiagnostics: 3 },
    });

    expect(report.decision).toBe("blocked");
    expect(report.diagnostics.length).toBeLessThanOrEqual(3);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "bounded_output" }));
    expect(Object.values(report.evidenceUse).every((value) => value === false)).toBe(true);
  });

  it("does not mask partial write failure as applied", () => {
    const original = fixtureContent("api-call-migration.ts");
    const first = tempFilePath("controlled-apply-first");
    const second = tempFilePath("controlled-apply-second");
    writeFileSync(first, original);
    writeFileSync(second, original);
    const plan = movePlanToFiles(validAstGrepPlan(), [first, second]);
    const writes: string[] = [];

    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateFor(plan),
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, false),
      targets: targetsFor(plan, new Map([[first, original], [second, original]])),
      options: {
        dryRun: false,
        allowWrite: true,
        writer: (filePath) => {
          writes.push(filePath);
          if (filePath === second) {
            throw new Error("simulated failure");
          }
        },
      },
    });

    expect(writes).toEqual([first, second]);
    expect(report.decision).toBe("blocked");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "write_failed",
      severity: "error",
    }));
    expect(report.fileSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: first, wrote: true }),
      expect.objectContaining({ filePath: second, failed: true }),
    ]));
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

function conflictDiagnosticPlan(): EditPlan {
  const result = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: "typescript",
      pattern: "oldApi($VALUE)",
      fix: "newApi($VALUE)",
    },
    targetFiles: [target("overlap-conflict.ts")],
  });
  expect(result.editPlan.conflictDiagnostics.length).toBeGreaterThan(0);
  return result.editPlan;
}

function duplicateOverlappingOperation(plan: EditPlan): EditPlan {
  const operation = plan.orderedOperations[0];
  return {
    ...plan,
    orderedOperations: [
      operation,
      {
        ...operation,
        order: 2,
        operationId: "operation_0002",
      },
    ],
  };
}

function movePlanToFiles(plan: EditPlan, filePaths: string[]): EditPlan {
  const originalPath = plan.orderedOperations[0].filePath;
  const originalHash = plan.sourceHashes[originalPath];
  return {
    ...plan,
    targetFiles: filePaths.map((filePath) => ({
      ...plan.targetFiles[0],
      filePath,
      sourceHash: originalHash,
    })),
    sourceHashes: Object.fromEntries(filePaths.map((filePath) => [filePath, originalHash])),
    matchEvidence: filePaths.map((filePath, index) => ({
      ...plan.matchEvidence[0],
      matchId: `match_${index + 1}`,
      filePath,
    })),
    orderedOperations: filePaths.map((filePath, index) => ({
      ...plan.orderedOperations[0],
      order: index + 1,
      operationId: `operation_${String(index + 1).padStart(4, "0")}`,
      matchId: `match_${index + 1}`,
      filePath,
    })),
  };
}

function approvedGateFor(plan: EditPlan): ApplyGateReadinessReport {
  const readinessReport = buildAstEditPlanEvidenceVerifierReadiness(plan);
  const gate = buildAstEditPlanApplyGateReadiness({
    editPlan: plan,
    readinessReport,
    evidenceVerifierReport: completedVerifierReport(readinessReport),
    currentFingerprint: currentFingerprintFor(plan),
    operatorApproval: gateApprovalFor(plan),
  });
  return {
    ...gate,
    decision: "approved_for_explicit_apply",
    planId: plan.planId,
    engineId: plan.engineId,
  };
}

function currentFingerprintFor(plan: EditPlan): ApplyGateCurrentFingerprint {
  return {
    planId: plan.planId,
    sourceHashes: plan.sourceHashes,
    previewDiffHash: plan.previewDiff.hash ?? "",
    matchRangeFingerprint: fingerprintEditPlanMatchRanges(plan),
  };
}

function gateApprovalFor(plan: EditPlan): ApplyGateOperatorApproval {
  const scope = currentFingerprintFor(plan);
  return {
    approved: true,
    approvalId: "gate_approval_1",
    approvedBy: "operator@example.test",
    statement: "approve_explicit_apply_gate_readiness_only",
    scope,
    understandsNoTaskCompletionEvidence: true,
  };
}

function pilotApprovalFor(plan: EditPlan, dryRun: boolean): ControlledApplyOperatorApproval {
  const scope = currentFingerprintFor(plan);
  return {
    approved: true,
    approvalId: "pilot_approval_1",
    approvedBy: "operator@example.test",
    statement: "approve_controlled_explicit_apply_pilot",
    scope: {
      ...scope,
      targetFilePaths: [...new Set(plan.orderedOperations.map((operation) => operation.filePath))].sort(),
      dryRun,
    },
    understandsNoTaskCompletionEvidence: true,
  };
}

function completedVerifierReport(
  readinessReport: AstEditPlanEvidenceVerifierReadinessReport,
): EvidenceVerifierReport {
  return {
    taskId: readinessReport.verifierInput?.taskId ?? "task_ast_controlled_apply",
    objective: readinessReport.verifierInput?.objective ?? "Review AST controlled apply readiness.",
    decision: "completed",
    findings: [],
    requiredEvidenceKinds: ["file", "test", "tool"],
    evidenceRefs: readinessReport.verifierInput?.evidenceRefs ?? [],
    legacyDecisionUnaffected: true,
  };
}

function targetsFor(plan: EditPlan, contentByPath = new Map<string, string>()): ControlledApplyTarget[] {
  return [...new Set(plan.orderedOperations.map((operation) => operation.filePath))].map((filePath) => ({
    filePath,
    currentContent: contentByPath.get(filePath) ?? fixtureContent(path.basename(filePath)),
  }));
}

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-grep-edit-plan/${fileName}`;
  return {
    filePath,
    content: fixtureContent(fileName),
  };
}

function fixtureContent(fileName: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "ast-grep-edit-plan", fileName), "utf8");
}

function tempFilePath(label: string): string {
  const filePath = path.join(os.tmpdir(), `${label}-${randomUUID()}.ts`);
  tempFiles.push(filePath);
  return filePath;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
