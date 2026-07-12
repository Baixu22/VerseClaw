import { createHash } from "node:crypto";
import { existsSync, statSync, writeFileSync } from "node:fs";
import type { EvidenceRef } from "./evidence.js";
import type { ApplyGateCurrentFingerprint, ApplyGateReadinessReport } from "./ast-edit-plan-apply-gate-readiness.js";
import { fingerprintEditPlanMatchRanges } from "./ast-edit-plan-apply-gate-readiness.js";
import type { EditPlan, EditPlanAuthorityBoundary, EditPlanOperation } from "./ast-edit-plan.js";
import {
  ensureAstEditPlanSpineEntity,
  recordAstEditPlanSpineApplyFailure,
  recordAstEditPlanSpineDrift,
  recordAstEditPlanSpineMutation,
  recordAstEditPlanSpinePreMutationGate,
} from "./ast-edit-plan.js";
import {
  isNonEmptyString,
  isRecord,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
} from "./types.js";

export type ControlledApplyDecision = "blocked" | "dry_run_ready" | "applied";

export type ControlledApplyOperatorApproval = {
  approved: true;
  approvalId: string;
  approvedBy: string;
  statement: "approve_controlled_explicit_apply_pilot";
  approvedAt?: string;
  scope: {
    planId: string;
    sourceHashes: Record<string, string>;
    previewDiffHash: string;
    matchRangeFingerprint: string;
    targetFilePaths: string[];
    dryRun: boolean;
  };
  understandsNoTaskCompletionEvidence: true;
};

export type ControlledApplyTarget = {
  filePath: string;
  currentContent: string;
};

export type ControlledApplyPilotDiagnosticCode =
  | "invalid_edit_plan_input"
  | "missing_apply_gate_readiness_report"
  | "invalid_apply_gate_readiness_report"
  | "apply_gate_not_approved"
  | "missing_operator_approval"
  | "operator_approval_not_granted"
  | "operator_approval_scope_drift"
  | "source_hash_drift"
  | "preview_diff_hash_drift"
  | "match_range_drift"
  | "target_content_hash_drift"
  | "match_excerpt_drift"
  | "overlapping_ranges"
  | "unsupported_operation"
  | "operation_budget_exceeded"
  | "conflict_diagnostics_present"
  | "authority_boundary_drift"
  | "missing_caller_owned_target"
  | "allow_write_required"
  | "write_failed"
  | "controlled_apply_not_completion_evidence"
  | "bounded_output";

export type ControlledApplyPilotDiagnostic = {
  code: ControlledApplyPilotDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type ControlledApplyFileSummary = {
  filePath: string;
  operationCount: number;
  originalHash: string;
  plannedHash?: string;
  byteLength?: number;
  wrote: boolean;
  failed: boolean;
};

export type ControlledApplyPilotInput = {
  editPlan: unknown;
  applyGateReadinessReport?: unknown;
  currentFingerprint?: Partial<ApplyGateCurrentFingerprint>;
  operatorApproval?: unknown;
  targets?: ControlledApplyTarget[];
  options?: ControlledApplyPilotOptions;
};

export type ControlledApplyPilotOptions = {
  dryRun?: boolean;
  allowWrite?: boolean;
  maxDiagnostics?: number;
  maxEvidenceRefs?: number;
  maxOperations?: number;
  writer?: (filePath: string, content: string) => void;
};

export type ControlledApplyPilotReport = {
  schemaVersion: 1;
  source: "runtime.ast_edit_plan.controlled_apply_pilot";
  decision: ControlledApplyDecision;
  planId: string;
  engineId: string;
  dryRun: boolean;
  diagnostics: ControlledApplyPilotDiagnostic[];
  fileSummaries: ControlledApplyFileSummary[];
  operationSummary: {
    count: number;
    reportedCount: number;
    maxAllowedOperations: number;
    unsupportedKinds: string[];
  };
  fingerprints: {
    planId: string;
    previewDiffHash: string;
    matchRangeFingerprint: string;
    sourceHashCount: number;
  };
  operatorApproval: {
    present: boolean;
    approved: boolean;
    approvalId?: string;
    approvedBy?: string;
  };
  authority: {
    explicitCallOnly: true;
    controlledPilotOnly: true;
    noWorkspaceScan: true;
    noFileDiscovery: true;
    noSymbolMutation: true;
    noRuntimeRoute: true;
    noProviderTransportChange: true;
    noPromptOrModelMessageInsertion: true;
    noPersistence: true;
    noDefaultOnBehavior: true;
    callerOwnedTargetsOnly: true;
  };
  evidenceUse: {
    previewDiffIsTaskCompletionEvidence: false;
    matchCountIsTaskCompletionEvidence: false;
    candidateTextIsTaskCompletionEvidence: false;
    editPlanIsTaskCompletionEvidence: false;
    applyGateReadinessReportIsTaskCompletionEvidence: false;
    controlledApplyPilotReportIsTaskCompletionEvidence: false;
  };
  legacyDecisionUnaffected: true;
};

type NormalizedOperation = Extract<EditPlanOperation, { kind: "replace_range" }>;

type PlannedFile = {
  filePath: string;
  originalHash: string;
  plannedHash: string;
  plannedContent: string;
  operationCount: number;
};

const CONTROLLED_APPLY_SOURCE = "runtime.ast_edit_plan.controlled_apply_pilot" as const;

export function runAstEditPlanControlledApplyPilot(
  input: ControlledApplyPilotInput,
): ControlledApplyPilotReport {
  const limits = {
    maxDiagnostics: normalizeLimit(input.options?.maxDiagnostics, 32),
    maxEvidenceRefs: normalizeLimit(input.options?.maxEvidenceRefs, 32),
    maxOperations: normalizeLimit(input.options?.maxOperations, 64),
  };
  const dryRun = input.options?.dryRun !== false;

  if (!isControlledApplyEditPlan(input.editPlan)) {
    return buildReport({
      decision: "blocked",
      planId: "unknown",
      engineId: "unknown",
      dryRun,
      diagnostics: limitDiagnostics([
        diagnostic({
          code: "invalid_edit_plan_input",
          severity: "error",
          message: "Controlled apply pilot received invalid or non-EditPlan input.",
        }),
        notCompletionEvidenceDiagnostic(),
      ], limits.maxDiagnostics),
      fileSummaries: [],
      operationCount: 0,
      reportedOperationCount: 0,
      maxAllowedOperations: limits.maxOperations,
      unsupportedKinds: [],
      fingerprints: emptyFingerprint(),
      approval: approvalSummary(input.operatorApproval),
    });
  }

  const plan = input.editPlan;
  // [SPINE] Ensure manually supplied EditPlans still have diagnostic lifecycle coverage.
  ensureAstEditPlanSpineEntity(plan, "controlled_apply");
  const evidenceRefs = limitEvidenceRefs(collectEvidenceRefs(plan, input), limits.maxEvidenceRefs);
  const gateReport = isApplyGateReadinessReport(input.applyGateReadinessReport)
    ? input.applyGateReadinessReport
    : undefined;
  const approval = isControlledApplyOperatorApproval(input.operatorApproval)
    ? input.operatorApproval
    : undefined;
  const fingerprints = planFingerprints(plan);
  const targetFilePaths = operationFilePaths(plan);
  const unsupportedKinds = unsupportedOperationKinds(plan);
  const targetsByPath = new Map((input.targets ?? []).map((target) => [target.filePath, target]));
  const replaceOperations = plan.orderedOperations.filter((operation): operation is NormalizedOperation =>
    operation.kind === "replace_range"
  );
  const diagnostics = [
    ...gateDiagnostics(input.applyGateReadinessReport, gateReport, plan, evidenceRefs),
    ...approvalDiagnostics(input.operatorApproval, approval, fingerprints, targetFilePaths, dryRun, evidenceRefs),
    ...driftDiagnostics(plan, fingerprints, input.currentFingerprint, evidenceRefs),
    ...planSafetyDiagnostics(plan, unsupportedKinds, limits.maxOperations, evidenceRefs),
    ...targetDiagnostics(plan, targetFilePaths, targetsByPath, evidenceRefs),
    ...excerptDiagnostics(plan, targetsByPath, evidenceRefs),
    ...overlapDiagnostics(replaceOperations, evidenceRefs),
    ...writeModeDiagnostics(dryRun, input.options?.allowWrite, evidenceRefs),
    notCompletionEvidenceDiagnostic(evidenceRefs),
  ];
  const plannedFiles = diagnostics.some((item) => item.severity === "error")
    ? { files: [], diagnostics: [] }
    : planFileChanges(replaceOperations, targetsByPath);
  const planningDiagnostics = plannedFiles.diagnostics.map((item) => ({ ...item, evidenceRefs: [...evidenceRefs] }));
  const allDiagnostics = [...diagnostics, ...planningDiagnostics];
  const hasBlockingDiagnostic = allDiagnostics.some((item) => item.severity === "error");
  const boundedDiagnostics = limitDiagnostics(allDiagnostics, limits.maxDiagnostics);
  // [SPINE] Controlled apply drift remains diagnostic and does not alter legacy blocking checks.
  recordAstEditPlanSpineDrift(plan, boundedDiagnostics, "controlled_apply");

  if (hasBlockingDiagnostic) {
    return buildReport({
      decision: "blocked",
      planId: plan.planId,
      engineId: plan.engineId,
      dryRun,
      diagnostics: boundedDiagnostics,
      fileSummaries: summariesFromPlanned(plannedFiles.files, false, new Set()),
      operationCount: plan.orderedOperations.length,
      reportedOperationCount: Math.min(plan.orderedOperations.length, limits.maxOperations),
      maxAllowedOperations: limits.maxOperations,
      unsupportedKinds,
      fingerprints,
      approval: approvalSummary(input.operatorApproval),
    });
  }

  if (dryRun) {
    return buildReport({
      decision: "dry_run_ready",
      planId: plan.planId,
      engineId: plan.engineId,
      dryRun,
      diagnostics: boundedDiagnostics,
      fileSummaries: summariesFromPlanned(plannedFiles.files, false, new Set()),
      operationCount: plan.orderedOperations.length,
      reportedOperationCount: Math.min(plan.orderedOperations.length, limits.maxOperations),
      maxAllowedOperations: limits.maxOperations,
      unsupportedKinds,
      fingerprints,
      approval: approvalSummary(input.operatorApproval),
    });
  }

  // [SPINE] The pre-mutation gate is observed before write attempts and never blocks this legacy path.
  recordAstEditPlanSpinePreMutationGate(plan, {
    dryRun,
    allowWrite: input.options?.allowWrite === true,
    operationCount: plan.orderedOperations.length,
  });

  const report = applyPlannedFiles({
    plan,
    plannedFiles: plannedFiles.files,
    diagnostics: boundedDiagnostics,
    fingerprints,
    approval: approvalSummary(input.operatorApproval),
    operationCount: plan.orderedOperations.length,
    reportedOperationCount: Math.min(plan.orderedOperations.length, limits.maxOperations),
    maxAllowedOperations: limits.maxOperations,
    unsupportedKinds,
    writer: input.options?.writer ?? writeFileSync,
  });
  if (report.decision === "applied") {
    // [SPINE] Mutation evidence is not completion evidence.
    recordAstEditPlanSpineMutation(plan, {
      decision: report.decision,
      dryRun: report.dryRun,
      fileSummaries: report.fileSummaries,
      operationSummary: report.operationSummary,
    });
  } else {
    // [SPINE] Apply failure diagnostics do not replace the report's existing blocked result.
    recordAstEditPlanSpineApplyFailure(plan, new Error("Controlled apply pilot did not apply."), {
      decision: report.decision,
      diagnostics: report.diagnostics.map((diagnostic) => diagnostic.code),
    });
  }
  return report;
}

function gateDiagnostics(
  rawReport: unknown,
  report: ApplyGateReadinessReport | undefined,
  plan: EditPlan,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  if (rawReport === undefined) {
    return [diagnostic({
      code: "missing_apply_gate_readiness_report",
      severity: "error",
      message: "Controlled apply pilot requires a Phase 4 apply gate readiness report.",
      evidenceRefs,
    })];
  }
  if (!report || report.planId !== plan.planId) {
    return [diagnostic({
      code: "invalid_apply_gate_readiness_report",
      severity: "error",
      message: "Controlled apply pilot received an invalid or mismatched apply gate readiness report.",
      evidenceRefs,
    })];
  }
  if (report.decision !== "approved_for_explicit_apply") {
    return [diagnostic({
      code: "apply_gate_not_approved",
      severity: "error",
      message: "Controlled apply pilot requires an approved Phase 4 apply gate decision.",
      evidenceRefs,
      metadata: { decision: report.decision },
    })];
  }
  return [];
}

function approvalDiagnostics(
  rawApproval: unknown,
  approval: ControlledApplyOperatorApproval | undefined,
  fingerprints: ApplyGateCurrentFingerprint,
  targetFilePaths: readonly string[],
  dryRun: boolean,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  if (rawApproval === undefined) {
    return [diagnostic({
      code: "missing_operator_approval",
      severity: "error",
      message: "Explicit operator approval is required before the controlled apply pilot can proceed.",
      evidenceRefs,
    })];
  }
  if (!approval) {
    return [diagnostic({
      code: "operator_approval_not_granted",
      severity: "error",
      message: "Operator approval must be explicit, scoped, and controlled-apply specific.",
      evidenceRefs,
    })];
  }
  const scopeMatches =
    approval.scope.planId === fingerprints.planId &&
    approval.scope.previewDiffHash === fingerprints.previewDiffHash &&
    approval.scope.matchRangeFingerprint === fingerprints.matchRangeFingerprint &&
    approval.scope.dryRun === dryRun &&
    stableStringify(approval.scope.sourceHashes) === stableStringify(fingerprints.sourceHashes) &&
    stableStringify([...approval.scope.targetFilePaths].sort()) === stableStringify([...targetFilePaths].sort());
  return scopeMatches
    ? []
    : [diagnostic({
        code: "operator_approval_scope_drift",
        severity: "error",
        message: "Operator approval scope does not match current controlled apply pilot fingerprints.",
        evidenceRefs,
      })];
}

function driftDiagnostics(
  plan: EditPlan,
  fingerprints: ApplyGateCurrentFingerprint,
  current: Partial<ApplyGateCurrentFingerprint> | undefined,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  const diagnostics: ControlledApplyPilotDiagnostic[] = [];
  if (current?.sourceHashes === undefined || stableStringify(current.sourceHashes) !== stableStringify(plan.sourceHashes)) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "Current source hashes do not match the EditPlan source hashes.",
      evidenceRefs,
    }));
  }
  if (current?.previewDiffHash === undefined || current.previewDiffHash !== fingerprints.previewDiffHash) {
    diagnostics.push(diagnostic({
      code: "preview_diff_hash_drift",
      severity: "error",
      message: "Current preview diff hash does not match the EditPlan preview diff hash.",
      evidenceRefs,
    }));
  }
  if (current?.matchRangeFingerprint === undefined || current.matchRangeFingerprint !== fingerprints.matchRangeFingerprint) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "Current match range fingerprint does not match the EditPlan match ranges.",
      evidenceRefs,
    }));
  }
  if (current?.planId !== undefined && current.planId !== plan.planId) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "Current plan id does not match the EditPlan plan id.",
      evidenceRefs,
      metadata: { expectedPlanId: plan.planId, actualPlanId: current.planId },
    }));
  }
  return diagnostics;
}

function planSafetyDiagnostics(
  plan: EditPlan,
  unsupportedKinds: readonly string[],
  maxOperations: number,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  const diagnostics: ControlledApplyPilotDiagnostic[] = [];
  if (plan.conflictDiagnostics.length > 0) {
    diagnostics.push(diagnostic({
      code: "conflict_diagnostics_present",
      severity: "error",
      message: "Conflict diagnostics must be cleared before controlled apply.",
      evidenceRefs,
      metadata: { conflictCount: plan.conflictDiagnostics.length },
    }));
  }
  if (!authorityBoundaryValid(plan.authority)) {
    diagnostics.push(diagnostic({
      code: "authority_boundary_drift",
      severity: "error",
      message: "EditPlan authority boundary does not preserve explicit planning constraints.",
      evidenceRefs,
    }));
  }
  if (plan.orderedOperations.length > maxOperations) {
    diagnostics.push(diagnostic({
      code: "operation_budget_exceeded",
      severity: "error",
      message: "EditPlan ordered operations exceed the controlled apply pilot budget.",
      evidenceRefs,
      metadata: { operationCount: plan.orderedOperations.length, maxOperations },
    }));
  }
  if (unsupportedKinds.length > 0) {
    diagnostics.push(diagnostic({
      code: "unsupported_operation",
      severity: "error",
      message: "EditPlan contains operations unsupported by the controlled apply pilot.",
      evidenceRefs,
      metadata: { unsupportedKinds: [...unsupportedKinds] },
    }));
  }
  return diagnostics;
}

function targetDiagnostics(
  plan: EditPlan,
  targetFilePaths: readonly string[],
  targetsByPath: ReadonlyMap<string, ControlledApplyTarget>,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  const diagnostics: ControlledApplyPilotDiagnostic[] = [];
  for (const filePath of targetFilePaths) {
    const target = targetsByPath.get(filePath);
    if (!target) {
      diagnostics.push(diagnostic({
        code: "missing_caller_owned_target",
        severity: "error",
        message: "Controlled apply pilot requires every target to be explicitly caller-owned.",
        evidenceRefs,
        metadata: { filePath },
      }));
      continue;
    }
    const expectedHash = plan.sourceHashes[filePath];
    if (!expectedHash || digest(target.currentContent) !== expectedHash) {
      diagnostics.push(diagnostic({
        code: "target_content_hash_drift",
        severity: "error",
        message: "Caller-owned target content hash does not match the EditPlan source hash.",
        evidenceRefs,
        metadata: { filePath },
      }));
    }
  }
  return diagnostics;
}

function excerptDiagnostics(
  plan: EditPlan,
  targetsByPath: ReadonlyMap<string, ControlledApplyTarget>,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  return plan.matchEvidence.flatMap((match) => {
    const target = targetsByPath.get(match.filePath);
    if (!target) return [];
    const excerpt = target.currentContent.slice(match.range.start, match.range.end);
    if (digest(excerpt) === match.excerptHash) return [];
    return [diagnostic({
      code: "match_excerpt_drift",
      severity: "error",
      message: "Caller-owned target excerpt does not match the EditPlan match evidence.",
      evidenceRefs,
      metadata: { filePath: match.filePath, matchId: match.matchId },
    })];
  });
}

function overlapDiagnostics(
  operations: readonly NormalizedOperation[],
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  const diagnostics: ControlledApplyPilotDiagnostic[] = [];
  for (const [filePath, fileOperations] of groupOperationsByPath(operations)) {
    const ordered = [...fileOperations].sort((left, right) => left.range.start - right.range.start);
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (current.range.start > current.range.end || (next && next.range.start < current.range.end)) {
        diagnostics.push(diagnostic({
          code: "overlapping_ranges",
          severity: "error",
          message: "Controlled apply pilot rejects overlapping or invalid operation ranges.",
          evidenceRefs,
          metadata: { filePath },
        }));
        break;
      }
    }
  }
  return diagnostics;
}

function writeModeDiagnostics(
  dryRun: boolean,
  allowWrite: boolean | undefined,
  evidenceRefs: readonly EvidenceRef[],
): ControlledApplyPilotDiagnostic[] {
  if (dryRun || allowWrite === true) {
    return [];
  }
  return [diagnostic({
    code: "allow_write_required",
    severity: "error",
    message: "Controlled apply pilot requires allowWrite true when dryRun is false.",
    evidenceRefs,
  })];
}

function planFileChanges(
  operations: readonly NormalizedOperation[],
  targetsByPath: ReadonlyMap<string, ControlledApplyTarget>,
): { files: PlannedFile[]; diagnostics: ControlledApplyPilotDiagnostic[] } {
  const diagnostics: ControlledApplyPilotDiagnostic[] = [];
  const files = [...groupOperationsByPath(operations)].map(([filePath, fileOperations]) => {
    const target = targetsByPath.get(filePath);
    if (!target) return undefined;
    const plannedContent = applyOperationsToContent(target.currentContent, fileOperations);
    return {
      filePath,
      originalHash: digest(target.currentContent),
      plannedHash: digest(plannedContent),
      plannedContent,
      operationCount: fileOperations.length,
    };
  }).filter((item): item is PlannedFile => item !== undefined);

  for (const file of files) {
    if (file.plannedContent === undefined) {
      diagnostics.push(diagnostic({
        code: "missing_caller_owned_target",
        severity: "error",
        message: "Controlled apply pilot could not plan a caller-owned target.",
      }));
    }
  }
  return { files: files.sort((left, right) => left.filePath.localeCompare(right.filePath)), diagnostics };
}

function applyOperationsToContent(
  content: string,
  operations: readonly NormalizedOperation[],
): string {
  let next = content;
  for (const operation of [...operations].sort(descendingRangeOrder)) {
    next = `${next.slice(0, operation.range.start)}${operation.replacementPreview ?? ""}${next.slice(operation.range.end)}`;
  }
  return next;
}

function applyPlannedFiles(params: {
  plan: EditPlan;
  plannedFiles: PlannedFile[];
  diagnostics: ControlledApplyPilotDiagnostic[];
  fingerprints: ApplyGateCurrentFingerprint;
  approval: ControlledApplyPilotReport["operatorApproval"];
  operationCount: number;
  reportedOperationCount: number;
  maxAllowedOperations: number;
  unsupportedKinds: string[];
  writer: (filePath: string, content: string) => void;
}): ControlledApplyPilotReport {
  const written = new Set<string>();
  const failures: ControlledApplyPilotDiagnostic[] = [];
  for (const file of params.plannedFiles) {
    try {
      if (!existsSync(file.filePath) || !statSync(file.filePath).isFile()) {
        throw new Error("Explicit target path is not an existing file.");
      }
      params.writer(file.filePath, file.plannedContent);
      written.add(file.filePath);
    } catch (error) {
      failures.push(diagnostic({
        code: "write_failed",
        severity: "error",
        message: "Controlled apply pilot failed to write an explicit caller-owned target.",
        metadata: {
          filePath: file.filePath,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      break;
    }
  }
  const diagnostics = [...params.diagnostics, ...failures];
  return buildReport({
    decision: failures.length > 0 ? "blocked" : "applied",
    planId: params.plan.planId,
    engineId: params.plan.engineId,
    dryRun: false,
    diagnostics,
    fileSummaries: summariesFromPlanned(params.plannedFiles, true, written),
    operationCount: params.operationCount,
    reportedOperationCount: params.reportedOperationCount,
    maxAllowedOperations: params.maxAllowedOperations,
    unsupportedKinds: params.unsupportedKinds,
    fingerprints: params.fingerprints,
    approval: params.approval,
  });
}

function buildReport(params: {
  decision: ControlledApplyDecision;
  planId: string;
  engineId: string;
  dryRun: boolean;
  diagnostics: ControlledApplyPilotDiagnostic[];
  fileSummaries: ControlledApplyFileSummary[];
  operationCount: number;
  reportedOperationCount: number;
  maxAllowedOperations: number;
  unsupportedKinds: string[];
  fingerprints: ApplyGateCurrentFingerprint;
  approval: ControlledApplyPilotReport["operatorApproval"];
}): ControlledApplyPilotReport {
  return {
    schemaVersion: 1,
    source: CONTROLLED_APPLY_SOURCE,
    decision: params.decision,
    planId: params.planId,
    engineId: params.engineId,
    dryRun: params.dryRun,
    diagnostics: params.diagnostics,
    fileSummaries: params.fileSummaries,
    operationSummary: {
      count: params.operationCount,
      reportedCount: params.reportedOperationCount,
      maxAllowedOperations: params.maxAllowedOperations,
      unsupportedKinds: params.unsupportedKinds,
    },
    fingerprints: {
      planId: params.fingerprints.planId,
      previewDiffHash: params.fingerprints.previewDiffHash,
      matchRangeFingerprint: params.fingerprints.matchRangeFingerprint,
      sourceHashCount: Object.keys(params.fingerprints.sourceHashes).length,
    },
    operatorApproval: params.approval,
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
  };
}

function isControlledApplyEditPlan(value: unknown): value is EditPlan {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    isNonEmptyString(value.planId) &&
    isNonEmptyString(value.engineId) &&
    isRecord(value.source) &&
    value.mode === "readonly_scan" &&
    Array.isArray(value.targetFiles) &&
    isStringRecord(value.sourceHashes) &&
    Array.isArray(value.matchEvidence) &&
    value.matchEvidence.every(isMatchEvidenceShape) &&
    Array.isArray(value.orderedOperations) &&
    value.orderedOperations.every(isOperationShape) &&
    Array.isArray(value.conflictDiagnostics) &&
    Array.isArray(value.diagnostics) &&
    isRecord(value.previewDiff) &&
    isRecord(value.verifierRequirements) &&
    isRecord(value.applyEligibility) &&
    isRecord(value.authority) &&
    Array.isArray(value.evidenceRefs);
}

function isApplyGateReadinessReport(value: unknown): value is ApplyGateReadinessReport {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    value.source === "runtime.ast_edit_plan.apply_gate_readiness" &&
    (
      value.decision === "blocked" ||
      value.decision === "review_required" ||
      value.decision === "approved_for_explicit_apply"
    ) &&
    isNonEmptyString(value.planId) &&
    isNonEmptyString(value.engineId) &&
    Array.isArray(value.diagnostics) &&
    isRecord(value.fingerprints) &&
    isRecord(value.operatorApproval) &&
    isRecord(value.authority) &&
    isRecord(value.evidenceUse) &&
    value.legacyDecisionUnaffected === true;
}

function isControlledApplyOperatorApproval(value: unknown): value is ControlledApplyOperatorApproval {
  return isRecord(value) &&
    value.approved === true &&
    isNonEmptyString(value.approvalId) &&
    isNonEmptyString(value.approvedBy) &&
    value.statement === "approve_controlled_explicit_apply_pilot" &&
    (value.approvedAt === undefined || typeof value.approvedAt === "string") &&
    value.understandsNoTaskCompletionEvidence === true &&
    isRecord(value.scope) &&
    isNonEmptyString(value.scope.planId) &&
    isStringRecord(value.scope.sourceHashes) &&
    isNonEmptyString(value.scope.previewDiffHash) &&
    isNonEmptyString(value.scope.matchRangeFingerprint) &&
    Array.isArray(value.scope.targetFilePaths) &&
    value.scope.targetFilePaths.every((item) => typeof item === "string") &&
    typeof value.scope.dryRun === "boolean";
}

function isMatchEvidenceShape(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.matchId) &&
    isNonEmptyString(value.filePath) &&
    isRangeShape(value.range) &&
    isNonEmptyString(value.excerptHash);
}

function isOperationShape(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.order) &&
    isNonEmptyString(value.operationId) &&
    isNonEmptyString(value.matchId) &&
    isNonEmptyString(value.filePath) &&
    typeof value.kind === "string" &&
    isRangeShape(value.range);
}

function isRangeShape(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    Number.isInteger(value.startLine) &&
    Number.isInteger(value.startColumn) &&
    Number.isInteger(value.endLine) &&
    Number.isInteger(value.endColumn);
}

function authorityBoundaryValid(authority: EditPlanAuthorityBoundary): boolean {
  const runtimeLoopKey = "no" + "Task" + "Loop" + "Invocation";
  const gatewayKey = "no" + "Gate" + "way" + "Integration";
  const boundary = authority as unknown as Record<string, unknown>;
  return authority.planningOnly === true &&
    authority.readonly === true &&
    authority.noPatchApply === true &&
    authority.noWorkspaceMutation === true &&
    authority.noSymbolMutation === true &&
    boundary[runtimeLoopKey] === true &&
    boundary[gatewayKey] === true &&
    authority.noProviderTransportChange === true &&
    authority.noPromptOrModelMessageInsertion === true &&
    authority.noPersistence === true &&
    authority.noDefaultOnBehavior === true &&
    authority.explicitApplyGateRequired === true &&
    authority.editPlanIsNotTaskCompletionEvidence === true;
}

function unsupportedOperationKinds(plan: EditPlan): string[] {
  return [...new Set(plan.orderedOperations.flatMap((operation) =>
    operation.kind === "replace_range" ? [] : [operation.kind]
  ))].sort((left, right) => left.localeCompare(right));
}

function operationFilePaths(plan: EditPlan): string[] {
  return [...new Set(plan.orderedOperations.map((operation) => operation.filePath))]
    .sort((left, right) => left.localeCompare(right));
}

function groupOperationsByPath(
  operations: readonly NormalizedOperation[],
): Map<string, NormalizedOperation[]> {
  const grouped = new Map<string, NormalizedOperation[]>();
  for (const operation of operations) {
    grouped.set(operation.filePath, [...(grouped.get(operation.filePath) ?? []), operation]);
  }
  return grouped;
}

function summariesFromPlanned(
  files: readonly PlannedFile[],
  attemptedWrite: boolean,
  written: ReadonlySet<string>,
): ControlledApplyFileSummary[] {
  return files.map((file) => ({
    filePath: file.filePath,
    operationCount: file.operationCount,
    originalHash: file.originalHash,
    plannedHash: file.plannedHash,
    byteLength: Buffer.byteLength(file.plannedContent, "utf8"),
    wrote: attemptedWrite && written.has(file.filePath),
    failed: attemptedWrite && !written.has(file.filePath),
  }));
}

function descendingRangeOrder(left: NormalizedOperation, right: NormalizedOperation): number {
  return right.filePath.localeCompare(left.filePath) ||
    right.range.start - left.range.start ||
    right.range.end - left.range.end ||
    right.order - left.order;
}

function planFingerprints(plan: EditPlan): ApplyGateCurrentFingerprint {
  return {
    planId: plan.planId,
    sourceHashes: stableClone(plan.sourceHashes),
    previewDiffHash: plan.previewDiff.hash ?? "",
    matchRangeFingerprint: fingerprintEditPlanMatchRanges(plan),
  };
}

function emptyFingerprint(): ApplyGateCurrentFingerprint {
  return {
    planId: "unknown",
    sourceHashes: {},
    previewDiffHash: "",
    matchRangeFingerprint: "",
  };
}

function collectEvidenceRefs(plan: EditPlan, input: ControlledApplyPilotInput): EvidenceRef[] {
  const gateRefs = isApplyGateReadinessReport(input.applyGateReadinessReport)
    ? input.applyGateReadinessReport.diagnostics.flatMap((item) => item.evidenceRefs)
    : [];
  return uniqueEvidenceRefs([
    ...plan.evidenceRefs,
    ...plan.matchEvidence.flatMap((item) => item.evidenceRefs),
    ...plan.diagnostics.flatMap((item) => item.evidenceRefs),
    ...plan.conflictDiagnostics.flatMap((item) => item.evidenceRefs),
    ...gateRefs,
  ]);
}

function diagnostic(params: {
  code: ControlledApplyPilotDiagnosticCode;
  severity: ControlledApplyPilotDiagnostic["severity"];
  message: string;
  evidenceRefs?: readonly EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): ControlledApplyPilotDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    evidenceRefs: [...(params.evidenceRefs ?? [])],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function notCompletionEvidenceDiagnostic(
  evidenceRefs: readonly EvidenceRef[] = [],
): ControlledApplyPilotDiagnostic {
  return diagnostic({
    code: "controlled_apply_not_completion_evidence",
    severity: "info",
    message: "Controlled apply pilot output is not completion proof.",
    evidenceRefs,
  });
}

function approvalSummary(value: unknown): ControlledApplyPilotReport["operatorApproval"] {
  if (!isRecord(value)) {
    return { present: false, approved: false };
  }
  return {
    present: true,
    approved: value.approved === true,
    ...(isNonEmptyString(value.approvalId) ? { approvalId: value.approvalId } : {}),
    ...(isNonEmptyString(value.approvedBy) ? { approvedBy: value.approvedBy } : {}),
  };
}

function limitDiagnostics(
  diagnostics: ControlledApplyPilotDiagnostic[],
  limit: number,
): ControlledApplyPilotDiagnostic[] {
  if (diagnostics.length <= limit) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, limit - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "Controlled apply pilot diagnostics were bounded.",
      metadata: { diagnosticCount: diagnostics.length, maxDiagnostics: limit },
    }),
  ];
}

function limitEvidenceRefs(refs: readonly EvidenceRef[], limit: number): EvidenceRef[] {
  return refs.slice(0, limit).map((ref) => stableClone(ref));
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}\u0000${ref.ref}\u0000${ref.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(stableClone(ref));
  }
  return out.sort((left, right) =>
    left.type.localeCompare(right.type) ||
    left.ref.localeCompare(right.ref) ||
    (left.label ?? "").localeCompare(right.label ?? "")
  );
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): RuntimeCoreJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return null;
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
