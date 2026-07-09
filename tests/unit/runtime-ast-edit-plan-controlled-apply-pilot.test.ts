import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  editPlanFromReadonlyAstPatchPlannerScan,
  fingerprintEditPlanMatchRanges,
  runAstEditPlanControlledApplyPilot,
  type ApplyGateCurrentFingerprint,
  type ApplyGateReadinessReport,
  type AstPatchPlannerReadonlyScanResult,
  type ControlledApplyOperatorApproval,
  type EditPlan,
} from "../../openclaw_runtime/src/runtime-core";
import {
  eventBus,
  evidenceLedger,
  lifecycleEngine,
} from "../../openclaw_runtime/src/runtime-spine";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readonlyScanFixture(filePath: string, source: string, replacement: string): AstPatchPlannerReadonlyScanResult {
  const range = {
    start: 0,
    end: source.length,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: source.length + 1,
  };
  const evidenceRefs = [{ type: "file" as const, ref: filePath, label: "controlled apply fixture" }];

  return {
    schemaVersion: 1,
    source: "runtime.ast_patch_planner.readonly_scan",
    status: "success",
    mode: "readonly_scan",
    flags: { readonlyScan: true, previewDiff: true },
    authority: {
      diagnosticsOnly: true,
      readonly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      previewDiffOnly: true,
      previewDiffIsNotCompletionEvidence: true,
    },
    validation: {
      status: "accepted",
      ruleHash: digest("rule"),
      language: "typescript",
      patternMetavariables: [],
      fixMetavariables: [],
      diagnostics: [],
      evidenceRefs,
    },
    matches: [
      {
        matchId: "match-1",
        filePath,
        language: "typescript",
        astKind: "SourceFile",
        range,
        excerpt: source,
        excerptHash: digest(source),
        metavariables: {},
        replacementPreview: replacement,
        replacementHash: digest(replacement),
        evidenceRefs,
      },
    ],
    previewDiff: {
      text: "-before\n+after\n",
      hash: digest("preview"),
      fullByteLength: 15,
      truncated: false,
      files: [
        {
          filePath,
          diffHash: digest("preview:file"),
          byteLength: 15,
          previewText: "-before\n+after\n",
          previewTextByteLength: 15,
          truncated: false,
          replacementCount: 1,
        },
      ],
    },
    checkpoint: {
      schemaVersion: 1,
      ruleHash: digest("rule"),
      targetFiles: [{ filePath, language: "typescript", sourceHash: digest(source) }],
      matchCount: 1,
      matchRanges: [
        {
          matchId: "match-1",
          filePath,
          start: range.start,
          end: range.end,
          excerptHash: digest(source),
          replacementHash: digest(replacement),
        },
      ],
      previewDiffHash: digest("preview"),
      sourceFileHashes: { [filePath]: digest(source) },
    },
    diagnostics: [],
    evidenceRefs,
  };
}

function currentFingerprint(plan: EditPlan): ApplyGateCurrentFingerprint {
  return {
    planId: plan.planId,
    sourceHashes: plan.sourceHashes,
    previewDiffHash: plan.previewDiff.hash ?? "",
    matchRangeFingerprint: fingerprintEditPlanMatchRanges(plan),
  };
}

function approvedGateReport(plan: EditPlan): ApplyGateReadinessReport {
  const fingerprints = currentFingerprint(plan);
  return {
    schemaVersion: 1,
    source: "runtime.ast_edit_plan.apply_gate_readiness",
    decision: "approved_for_explicit_apply",
    planId: plan.planId,
    engineId: plan.engineId,
    sourceKind: plan.source.kind,
    diagnostics: [],
    requiredVerifierRequirements: [],
    operationSummary: {
      count: plan.orderedOperations.length,
      reportedCount: plan.orderedOperations.length,
      maxAllowedOperations: 64,
      unsupportedKinds: [],
    },
    fingerprints: {
      planId: fingerprints.planId,
      previewDiffHash: fingerprints.previewDiffHash,
      matchRangeFingerprint: fingerprints.matchRangeFingerprint,
      sourceHashCount: Object.keys(fingerprints.sourceHashes).length,
    },
    operatorApproval: { present: true, approved: true, approvalId: "approval-1", approvedBy: "tester" },
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
  };
}

function controlledApproval(plan: EditPlan, dryRun: boolean): ControlledApplyOperatorApproval {
  const fingerprints = currentFingerprint(plan);
  return {
    approved: true,
    approvalId: "approval-1",
    approvedBy: "tester",
    statement: "approve_controlled_explicit_apply_pilot",
    scope: {
      planId: plan.planId,
      sourceHashes: fingerprints.sourceHashes,
      previewDiffHash: fingerprints.previewDiffHash,
      matchRangeFingerprint: fingerprints.matchRangeFingerprint,
      targetFilePaths: plan.targetFiles.map((file) => file.filePath),
      dryRun,
    },
    understandsNoTaskCompletionEvidence: true,
  };
}

describe("AST EditPlan controlled apply runtime spine integration", () => {
  it("records pre-mutation gate diagnostics and mutation evidence without completion evidence", async () => {
    eventBus.clear();
    const dir = mkdtempSync(join(tmpdir(), "openclaw-spine-apply-"));
    const filePath = join(dir, "target.ts");
    const source = "const value = 1;\n";
    const replacement = "const value = 2;\n";
    writeFileSync(filePath, source);
    const plan = editPlanFromReadonlyAstPatchPlannerScan(
      readonlyScanFixture(filePath, source, replacement),
    );

    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateReport(plan),
      currentFingerprint: currentFingerprint(plan),
      operatorApproval: controlledApproval(plan, false),
      targets: [{ filePath, currentContent: source }],
      options: { dryRun: false, allowWrite: true },
    });
    await Promise.resolve();

    expect(report.decision).toBe("applied");
    const entity = lifecycleEngine
      .getByType("ast_edit_plan")
      .find((candidate) => candidate.metadata?.planId === plan.planId);
    expect(entity).toBeDefined();
    const events = eventBus.getByEntity(entity!.entityId);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["gate_decision", "ast.applied"]),
    );
    expect(events.find((event) => event.kind === "ast.applied")?.payload).toMatchObject({
      evidenceKind: "mutation_evidence",
      isCompletionProof: false,
    });

    const evidence = evidenceLedger.getByEntity(entity!.entityId);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "diagnostic_snapshot" }),
        expect.objectContaining({
          kind: "mutation_evidence",
          mutationEvidence: true,
          metadata: expect.objectContaining({
            evidenceKind: "mutation_evidence",
            isCompletionProof: false,
          }),
        }),
      ]),
    );
    const mutationEvidence = evidence.find((item) => item.kind === "mutation_evidence");
    expect(mutationEvidence).toBeDefined();
    expect(mutationEvidence).not.toHaveProperty("completionEvidence");
    expect(evidence.some((item) => item.kind === "completion_evidence")).toBe(false);
  });

  it("emits drift diagnostics and fails the AST lifecycle entity when apply fingerprints drift", () => {
    eventBus.clear();
    const filePath = join(mkdtempSync(join(tmpdir(), "openclaw-spine-drift-")), "target.ts");
    const source = "const value = 1;\n";
    const replacement = "const value = 2;\n";
    writeFileSync(filePath, source);
    const plan = editPlanFromReadonlyAstPatchPlannerScan(
      readonlyScanFixture(filePath, source, replacement),
    );

    const report = runAstEditPlanControlledApplyPilot({
      editPlan: plan,
      applyGateReadinessReport: approvedGateReport(plan),
      currentFingerprint: {
        ...currentFingerprint(plan),
        previewDiffHash: "drifted-preview",
      },
      operatorApproval: controlledApproval(plan, false),
      targets: [{ filePath, currentContent: source }],
      options: { dryRun: false, allowWrite: true },
    });

    expect(report.decision).toBe("blocked");
    const entity = lifecycleEngine
      .getByType("ast_edit_plan")
      .find((candidate) => candidate.metadata?.planId === plan.planId);
    expect(entity?.phase).toBe("failed");
    expect(eventBus.getByEntity(entity!.entityId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "ast.drift_detected",
          payload: expect.objectContaining({
            diagnosticCodes: expect.arrayContaining(["preview_diff_hash_drift"]),
          }),
        }),
      ]),
    );
  });
});
