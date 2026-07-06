import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const NARROW_REPLAY_SOURCE_SCOPE = {
  kind: "agent_map_symbol_scope",
  description: "P6 fixed narrow-rule replay proof target.",
} as const;

type NarrowRuleSample = {
  id: string;
  category: "react_prop_rename" | "api_call_migration" | "import_rewrite" | "ipc_route_rename" | "deprecated_option_removal";
  extension: "ts" | "tsx";
  language: "typescript" | "tsx";
  pattern: string;
  fix: string;
  content: string;
  expected: string;
};

type ReplayResult = {
  sampleId: string;
  category: NarrowRuleSample["category"];
  decision: "allow_more_narrow_evaluation";
  planId: string;
  sourceHash: string;
  previewDiffHash: string;
  matchRangeFingerprint: string;
  dryRunPlannedHash: string;
  appliedHash: string;
};

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("AST EditPlan narrow-rule replay proof", () => {
  it("replays ten fixed narrow-rule samples through readonly, gate, dry-run, and temp-file apply", () => {
    const samples = narrowRuleSamples();

    expect(samples).toHaveLength(10);
    expect(countByCategory(samples)).toEqual({
      api_call_migration: 2,
      deprecated_option_removal: 2,
      import_rewrite: 2,
      ipc_route_rename: 2,
      react_prop_rename: 2,
    });

    const results = samples.map(replaySample);

    expect(results).toHaveLength(10);
    expect(results.every((item) => item.decision === "allow_more_narrow_evaluation")).toBe(true);
    expect(new Set(results.map((item) => item.planId)).size).toBe(10);
    for (const result of results) {
      expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.previewDiffHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.matchRangeFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.dryRunPlannedHash).toBe(result.appliedHash);
    }
  });

  it("fails closed for drift, overlap, unsupported operation, missing approval, and missing temp target", () => {
    const sample = narrowRuleSamples().find((item) => item.category === "api_call_migration");
    expect(sample).toBeDefined();
    const { plan, target } = buildPlanForSample(sample as NarrowRuleSample);
    const approvedGate = approvedGateFor(plan);
    const baseInput = {
      editPlan: plan,
      applyGateReadinessReport: approvedGate,
      currentFingerprint: currentFingerprintFor(plan),
      operatorApproval: pilotApprovalFor(plan, true),
      targets: [target],
      options: { dryRun: true },
    };

    expect(runAstEditPlanControlledApplyPilot({
      ...baseInput,
      currentFingerprint: {
        ...currentFingerprintFor(plan),
        matchRangeFingerprint: "different",
      },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "match_range_drift",
      severity: "error",
    }));

    const overlapPlan = duplicateOverlappingOperation(plan);
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: overlapPlan,
      applyGateReadinessReport: approvedGateFor(overlapPlan),
      currentFingerprint: currentFingerprintFor(overlapPlan),
      operatorApproval: pilotApprovalFor(overlapPlan, true),
      targets: [target],
      options: { dryRun: true },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "overlapping_ranges",
      severity: "error",
    }));

    const unsupportedPlan = toUnsupportedMatchOnlyPlan(plan);
    expect(runAstEditPlanControlledApplyPilot({
      editPlan: unsupportedPlan,
      applyGateReadinessReport: approvedGateFor(unsupportedPlan),
      currentFingerprint: currentFingerprintFor(unsupportedPlan),
      operatorApproval: pilotApprovalFor(unsupportedPlan, true),
      targets: [target],
      options: { dryRun: true },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported_operation",
      severity: "error",
    }));

    expect(runAstEditPlanControlledApplyPilot({
      ...baseInput,
      operatorApproval: undefined,
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_operator_approval",
      severity: "error",
    }));

    expect(runAstEditPlanControlledApplyPilot({
      ...baseInput,
      targets: [],
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_caller_owned_target",
      severity: "error",
    }));
  });
});

function replaySample(sample: NarrowRuleSample): ReplayResult {
  const { plan, target, tempFilePath } = buildPlanForSample(sample);
  const second = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: sample.language,
      pattern: sample.pattern,
      fix: sample.fix,
    },
    targetFiles: [{ filePath: tempFilePath, content: sample.content }],
    sourceScope: NARROW_REPLAY_SOURCE_SCOPE,
  });

  expect(second.status, sample.id).toBe("success");
  expect(second.editPlan.planId, sample.id).toBe(plan.planId);
  expect(second.editPlan.sourceHashes, sample.id).toEqual(plan.sourceHashes);
  expect(second.editPlan.previewDiff.hash, sample.id).toBe(plan.previewDiff.hash);
  expect(fingerprintEditPlanMatchRanges(second.editPlan), sample.id).toBe(fingerprintEditPlanMatchRanges(plan));

  const gate = approvedGateFor(plan);
  expect(gate.decision, sample.id).toBe("approved_for_explicit_apply");

  const dryRun = runAstEditPlanControlledApplyPilot({
    editPlan: plan,
    applyGateReadinessReport: gate,
    currentFingerprint: currentFingerprintFor(plan),
    operatorApproval: pilotApprovalFor(plan, true),
    targets: [target],
    options: { dryRun: true },
  });
  expect(dryRun.diagnostics.filter((item) => item.severity === "error"), sample.id).toEqual([]);
  expect(dryRun.decision, sample.id).toBe("dry_run_ready");
  expect(dryRun.fileSummaries, sample.id).toHaveLength(1);
  expect(dryRun.fileSummaries[0].plannedHash, sample.id).toBeDefined();
  expect(dryRun.evidenceUse.controlledApplyPilotReportIsTaskCompletionEvidence, sample.id).toBe(false);

  const applied = runAstEditPlanControlledApplyPilot({
    editPlan: plan,
    applyGateReadinessReport: gate,
    currentFingerprint: currentFingerprintFor(plan),
    operatorApproval: pilotApprovalFor(plan, false),
    targets: [target],
    options: { dryRun: false, allowWrite: true },
  });
  const appliedContent = readFileSync(tempFilePath, "utf8");

  expect(applied.diagnostics.filter((item) => item.severity === "error"), sample.id).toEqual([]);
  expect(applied.decision, sample.id).toBe("applied");
  expect(appliedContent, sample.id).toContain(sample.expected);
  expect(digest(appliedContent), sample.id).toBe(dryRun.fileSummaries[0].plannedHash);
  expect(applied.evidenceUse.controlledApplyPilotReportIsTaskCompletionEvidence, sample.id).toBe(false);

  return {
    sampleId: sample.id,
    category: sample.category,
    decision: "allow_more_narrow_evaluation",
    planId: plan.planId,
    sourceHash: plan.sourceHashes[tempFilePath],
    previewDiffHash: plan.previewDiff.hash ?? "",
    matchRangeFingerprint: fingerprintEditPlanMatchRanges(plan),
    dryRunPlannedHash: dryRun.fileSummaries[0].plannedHash ?? "",
    appliedHash: digest(appliedContent),
  };
}

function buildPlanForSample(sample: NarrowRuleSample): {
  plan: EditPlan;
  target: ControlledApplyTarget;
  tempFilePath: string;
} {
  const tempFilePath = createTempTarget(sample);
  writeFileSync(tempFilePath, sample.content);
  const result = generateAstGrepEditPlanReadonlyCandidates({
    rule: {
      language: sample.language,
      pattern: sample.pattern,
      fix: sample.fix,
    },
    targetFiles: [{ filePath: tempFilePath, content: sample.content }],
    sourceScope: NARROW_REPLAY_SOURCE_SCOPE,
  });

  expect(result.status, sample.id).toBe("success");
  expect(result.editPlan.orderedOperations, sample.id).toHaveLength(1);
  expect(result.editPlan.previewDiff.available, sample.id).toBe(true);
  const normalizedFilePath = result.editPlan.orderedOperations[0].filePath;
  return {
    plan: result.editPlan,
    target: { filePath: normalizedFilePath, currentContent: sample.content },
    tempFilePath: normalizedFilePath,
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
  return {
    approved: true,
    approvalId: `gate_${plan.planId}`,
    approvedBy: "operator@example.test",
    statement: "approve_explicit_apply_gate_readiness_only",
    scope: currentFingerprintFor(plan),
    understandsNoTaskCompletionEvidence: true,
  };
}

function pilotApprovalFor(plan: EditPlan, dryRun: boolean): ControlledApplyOperatorApproval {
  const scope = currentFingerprintFor(plan);
  return {
    approved: true,
    approvalId: `pilot_${plan.planId}`,
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
    taskId: readinessReport.verifierInput?.taskId ?? "task_ast_narrow_rule_replay",
    objective: readinessReport.verifierInput?.objective ?? "Review AST narrow-rule replay readiness.",
    decision: "completed",
    findings: [],
    requiredEvidenceKinds: ["file", "test", "tool"],
    evidenceRefs: readinessReport.verifierInput?.evidenceRefs ?? [],
    legacyDecisionUnaffected: true,
  };
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

function toUnsupportedMatchOnlyPlan(plan: EditPlan): EditPlan {
  const operation = plan.orderedOperations[0];
  return {
    ...plan,
    orderedOperations: [{
      kind: "match_only",
      order: operation.order,
      operationId: operation.operationId,
      matchId: operation.matchId,
      filePath: operation.filePath,
      range: operation.range,
      reason: "unfixable_rule",
      evidenceRefs: operation.evidenceRefs,
    }],
  };
}

function createTempTarget(sample: NarrowRuleSample): string {
  const root = path.join(os.tmpdir(), `ast-narrow-replay-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return path.join(root, `${sample.id}.${sample.extension}`);
}

function narrowRuleSamples(): NarrowRuleSample[] {
  return [
    {
      id: "react-prop-rename-a",
      category: "react_prop_rename",
      extension: "tsx",
      language: "tsx",
      pattern: "<Widget oldName={$VALUE} />",
      fix: "<Widget newName={$VALUE} />",
      content: fixture("react-prop-rename.tsx"),
      expected: "<Widget newName={label} />",
    },
    {
      id: "react-prop-rename-b",
      category: "react_prop_rename",
      extension: "tsx",
      language: "tsx",
      pattern: "<Widget oldName={$VALUE} />",
      fix: "<Widget newName={$VALUE} />",
      content: "export function Demo({ count }: { count: number }) {\n  return <Widget oldName={count} />;\n}\n",
      expected: "<Widget newName={count} />",
    },
    {
      id: "api-call-migration-a",
      category: "api_call_migration",
      extension: "ts",
      language: "typescript",
      pattern: "oldApi($VALUE)",
      fix: "newApi($VALUE)",
      content: fixture("api-call-migration.ts"),
      expected: "newApi(input)",
    },
    {
      id: "api-call-migration-b",
      category: "api_call_migration",
      extension: "ts",
      language: "typescript",
      pattern: "oldApi($VALUE)",
      fix: "newApi($VALUE)",
      content: "export const loaded = oldApi(userId);\n",
      expected: "newApi(userId)",
    },
    {
      id: "import-rewrite-a",
      category: "import_rewrite",
      extension: "ts",
      language: "typescript",
      pattern: 'import { legacyThing } from $SOURCE',
      fix: 'import { modernThing as legacyThing } from "modern-lib"',
      content: fixture("import-rewrite.ts"),
      expected: 'import { modernThing as legacyThing } from "modern-lib"',
    },
    {
      id: "import-rewrite-b",
      category: "import_rewrite",
      extension: "ts",
      language: "typescript",
      pattern: 'import { legacyThing } from $SOURCE',
      fix: 'import { modernThing as legacyThing } from "modern-lib"',
      content: 'import { legacyThing } from "old-kit";\n\nexport const next = legacyThing();\n',
      expected: 'import { modernThing as legacyThing } from "modern-lib"',
    },
    {
      id: "ipc-route-rename-a",
      category: "ipc_route_rename",
      extension: "ts",
      language: "typescript",
      pattern: 'ipcRenderer.invoke("old-route", $PAYLOAD)',
      fix: 'ipcRenderer.invoke("new-route", $PAYLOAD)',
      content: fixture("ipc-route-rename.ts"),
      expected: 'ipcRenderer.invoke("new-route", payload)',
    },
    {
      id: "ipc-route-rename-b",
      category: "ipc_route_rename",
      extension: "ts",
      language: "typescript",
      pattern: 'ipcRenderer.invoke("old-route", $PAYLOAD)',
      fix: 'ipcRenderer.invoke("new-route", $PAYLOAD)',
      content: 'export const result = ipcRenderer.invoke("old-route", request);\n',
      expected: 'ipcRenderer.invoke("new-route", request)',
    },
    {
      id: "deprecated-option-removal-a",
      category: "deprecated_option_removal",
      extension: "ts",
      language: "typescript",
      pattern: "createClient({ endpoint: $ENDPOINT, deprecatedOption: true })",
      fix: "createClient({ endpoint: $ENDPOINT })",
      content: fixture("deprecated-option-removal.ts"),
      expected: 'createClient({ endpoint: "/v1" })',
    },
    {
      id: "deprecated-option-removal-b",
      category: "deprecated_option_removal",
      extension: "ts",
      language: "typescript",
      pattern: "createClient({ endpoint: $ENDPOINT, deprecatedOption: true })",
      fix: "createClient({ endpoint: $ENDPOINT })",
      content: 'export const client = createClient({ endpoint: "/v2", deprecatedOption: true });\n',
      expected: 'createClient({ endpoint: "/v2" })',
    },
  ];
}

function countByCategory(samples: readonly NarrowRuleSample[]): Record<NarrowRuleSample["category"], number> {
  return samples.reduce<Record<NarrowRuleSample["category"], number>>((counts, sample) => ({
    ...counts,
    [sample.category]: counts[sample.category] + 1,
  }), {
    api_call_migration: 0,
    deprecated_option_removal: 0,
    import_rewrite: 0,
    ipc_route_rename: 0,
    react_prop_rename: 0,
  });
}

function fixture(fileName: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "ast-grep-edit-plan", fileName), "utf8");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
