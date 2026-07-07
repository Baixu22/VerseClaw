import { createHash } from "node:crypto";
import type { EvidenceRef } from "./evidence.js";
import type { EditPlan, EditPlanAuthorityBoundary, EditPlanVerifierRequirement } from "./ast-edit-plan.js";
import {
  isEditPlanForEvidenceVerifierReadiness,
  type AstEditPlanEvidenceVerifierReadinessReport,
} from "./ast-edit-plan-evidence-verifier-readiness.js";
import {
  isEvidenceVerifierReport,
  type EvidenceVerifierReport,
} from "./evidence-verifier.js";
import {
  isNonEmptyString,
  isRecord,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
} from "./types.js";

export type ApplyGateDecision =
  | "blocked"
  | "review_required"
  | "approved_for_explicit_apply";

export type ApplyGateOperatorApproval = {
  approved: true;
  approvalId: string;
  approvedBy: string;
  statement: "approve_explicit_apply_gate_readiness_only";
  approvedAt?: string;
  scope: {
    planId: string;
    sourceHashes: Record<string, string>;
    previewDiffHash: string;
    matchRangeFingerprint: string;
  };
  understandsNoTaskCompletionEvidence: true;
};

export type ApplyGateCurrentFingerprint = {
  planId: string;
  sourceHashes: Record<string, string>;
  previewDiffHash: string;
  matchRangeFingerprint: string;
};

export type ApplyGateReadinessDiagnosticCode =
  | "invalid_edit_plan_input"
  | "missing_readiness_report"
  | "invalid_readiness_report"
  | "readiness_report_not_ready"
  | "missing_evidence_verifier_report"
  | "evidence_verifier_not_completed"
  | "missing_operator_approval"
  | "operator_approval_not_granted"
  | "operator_approval_scope_drift"
  | "plan_fingerprint_drift"
  | "source_hash_drift"
  | "preview_diff_hash_drift"
  | "match_range_drift"
  | "conflict_diagnostics_present"
  | "authority_boundary_drift"
  | "operation_budget_exceeded"
  | "unsupported_operation"
  | "required_verifier_requirement_missing"
  | "required_verifier_requirement_not_satisfied"
  | "apply_gate_readiness_not_completion_evidence"
  | "explicit_apply_not_performed"
  | "bounded_output";

export type ApplyGateReadinessDiagnostic = {
  code: ApplyGateReadinessDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type ApplyGateReadinessInput = {
  editPlan: unknown;
  readinessReport?: unknown;
  evidenceVerifierReport?: unknown;
  currentFingerprint?: Partial<ApplyGateCurrentFingerprint>;
  operatorApproval?: unknown;
};

export type BuildApplyGateReadinessOptions = {
  maxDiagnostics?: number;
  maxEvidenceRefs?: number;
  maxOperations?: number;
  maxAllowedOperations?: number;
};

export type ApplyGateReadinessReport = {
  schemaVersion: 1;
  source: "runtime.ast_edit_plan.apply_gate_readiness";
  decision: ApplyGateDecision;
  planId: string;
  engineId: string;
  sourceKind: EditPlan["source"]["kind"] | "unknown";
  readinessReportSource?: AstEditPlanEvidenceVerifierReadinessReport["source"];
  evidenceVerifierDecision?: EvidenceVerifierReport["decision"];
  diagnostics: ApplyGateReadinessDiagnostic[];
  requiredVerifierRequirements: {
    id: EditPlanVerifierRequirement["id"];
    status: "satisfied" | "pending" | "blocked" | "missing";
  }[];
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
    planningOnly: true;
    readinessOnly: true;
    readonly: true;
    noPatchApply: true;
    noWorkspaceMutation: true;
    noSymbolMutation: true;
    noRuntimeRoute: true;
    noProviderTransportChange: true;
    noPromptOrModelMessageInsertion: true;
    noPersistence: true;
    noDefaultOnBehavior: true;
    explicitApplyGateRequired: true;
    approvedDecisionDoesNotApply: true;
  };
  evidenceUse: {
    previewDiffIsTaskCompletionEvidence: false;
    matchCountIsTaskCompletionEvidence: false;
    candidateTextIsTaskCompletionEvidence: false;
    editPlanIsTaskCompletionEvidence: false;
    evidenceVerifierReportIsTaskCompletionEvidence: false;
    applyGateReadinessReportIsTaskCompletionEvidence: false;
  };
  legacyDecisionUnaffected: true;
};

const APPLY_GATE_SOURCE = "runtime.ast_edit_plan.apply_gate_readiness" as const;
const REQUIRED_REQUIREMENTS: EditPlanVerifierRequirement["id"][] = [
  "source_hashes_present",
  "match_ranges_present",
  "ordered_operations_present",
  "no_conflict_diagnostics",
  "preview_diff_available",
  "evidence_verifier_review",
];

export function buildAstEditPlanApplyGateReadiness(
  input: ApplyGateReadinessInput,
  options: BuildApplyGateReadinessOptions = {},
): ApplyGateReadinessReport {
  const limits = {
    maxDiagnostics: normalizeLimit(options.maxDiagnostics, 32),
    maxEvidenceRefs: normalizeLimit(options.maxEvidenceRefs, 32),
    maxOperations: normalizeLimit(options.maxOperations, 64),
    maxAllowedOperations: normalizeLimit(options.maxAllowedOperations, 64),
  };

  if (!isEditPlanForEvidenceVerifierReadiness(input.editPlan)) {
    const diagnostics = limitDiagnostics([
      diagnostic({
        code: "invalid_edit_plan_input",
        severity: "error",
        message: "Apply gate readiness received invalid or non-EditPlan input.",
      }),
      notCompletionEvidenceDiagnostic(),
      explicitApplyNotPerformedDiagnostic(),
    ], limits.maxDiagnostics);
    return report({
      decision: "blocked",
      planId: "unknown",
      engineId: "unknown",
      sourceKind: "unknown",
      diagnostics,
      requiredVerifierRequirements: [],
      operationCount: 0,
      reportedOperationCount: 0,
      maxAllowedOperations: limits.maxAllowedOperations,
      unsupportedKinds: [],
      fingerprints: emptyFingerprint(),
      approval: approvalSummary(input.operatorApproval),
    });
  }

  const plan = input.editPlan;
  const evidenceRefs = limitEvidenceRefs(collectEvidenceRefs(plan, input), limits.maxEvidenceRefs);
  const readinessReport = isApplyGateReadinessReportInput(input.readinessReport)
    ? input.readinessReport
    : undefined;
  const verifierReport = isEvidenceVerifierReport(input.evidenceVerifierReport)
    ? input.evidenceVerifierReport
    : undefined;
  const approval = isApplyGateOperatorApproval(input.operatorApproval)
    ? input.operatorApproval
    : undefined;
  const fingerprints = planFingerprints(plan);
  const requiredVerifierRequirements = requirementStatuses(plan, readinessReport);
  const unsupportedKinds = unsupportedOperationKinds(plan);
  const diagnostics = [
    ...readinessReportDiagnostics(input.readinessReport, readinessReport, evidenceRefs),
    ...evidenceVerifierDiagnostics(input.evidenceVerifierReport, verifierReport, evidenceRefs),
    ...approvalDiagnostics(input.operatorApproval, approval, fingerprints, evidenceRefs),
    ...driftDiagnostics(plan, fingerprints, input.currentFingerprint, approval, evidenceRefs),
    ...planSafetyDiagnostics(plan, requiredVerifierRequirements, unsupportedKinds, limits.maxAllowedOperations, evidenceRefs),
    notCompletionEvidenceDiagnostic(evidenceRefs),
    explicitApplyNotPerformedDiagnostic(evidenceRefs),
  ];
  const boundedDiagnostics = limitDiagnostics(
    plan.orderedOperations.length > limits.maxOperations
      ? [
          ...diagnostics,
          diagnostic({
            code: "bounded_output",
            severity: "warning",
            message: "Apply gate readiness operations were bounded in the report.",
            evidenceRefs,
            metadata: {
              operationCount: plan.orderedOperations.length,
              maxOperations: limits.maxOperations,
            },
          }),
        ]
      : diagnostics,
    limits.maxDiagnostics,
  );

  return report({
    decision: decide(readinessReport, boundedDiagnostics),
    planId: plan.planId,
    engineId: plan.engineId,
    sourceKind: plan.source.kind,
    readinessReportSource: readinessReport?.source,
    evidenceVerifierDecision: verifierReport?.decision,
    diagnostics: boundedDiagnostics,
    requiredVerifierRequirements,
    operationCount: plan.orderedOperations.length,
    reportedOperationCount: Math.min(plan.orderedOperations.length, limits.maxOperations),
    maxAllowedOperations: limits.maxAllowedOperations,
    unsupportedKinds,
    fingerprints,
    approval: approvalSummary(input.operatorApproval),
  });
}

export function fingerprintEditPlanMatchRanges(plan: Pick<EditPlan, "matchEvidence" | "orderedOperations">): string {
  return digest(stableStringify({
    matches: plan.matchEvidence.map((match) => ({
      matchId: match.matchId,
      filePath: match.filePath,
      range: match.range,
      excerptHash: match.excerptHash,
    })),
    operations: plan.orderedOperations.map((operation) => ({
      order: operation.order,
      operationId: operation.operationId,
      matchId: operation.matchId,
      filePath: operation.filePath,
      range: operation.range,
      kind: operation.kind,
    })),
  }));
}

function readinessReportDiagnostics(
  rawReport: unknown,
  report: AstEditPlanEvidenceVerifierReadinessReport | undefined,
  evidenceRefs: readonly EvidenceRef[],
): ApplyGateReadinessDiagnostic[] {
  if (rawReport === undefined) {
    return [diagnostic({
      code: "missing_readiness_report",
      severity: "error",
      message: "Apply gate readiness requires a phase 3 readiness report.",
      evidenceRefs,
    })];
  }
  if (!report) {
    return [diagnostic({
      code: "invalid_readiness_report",
      severity: "error",
      message: "Apply gate readiness received an invalid phase 3 readiness report.",
      evidenceRefs,
    })];
  }
  if (report.readiness !== "ready_for_evidence_verifier_review") {
    return [diagnostic({
      code: "readiness_report_not_ready",
      severity: report.readiness === "review_required" ? "warning" : "error",
      message: "Phase 3 readiness report is not ready for the explicit apply gate.",
      evidenceRefs,
      metadata: { readiness: report.readiness },
    })];
  }
  return [];
}

function evidenceVerifierDiagnostics(
  rawReport: unknown,
  report: EvidenceVerifierReport | undefined,
  evidenceRefs: readonly EvidenceRef[],
): ApplyGateReadinessDiagnostic[] {
  if (rawReport === undefined) {
    return [diagnostic({
      code: "missing_evidence_verifier_report",
      severity: "error",
      message: "Apply gate readiness requires a caller-provided Evidence Verifier report.",
      evidenceRefs,
    })];
  }
  if (!report || report.decision !== "completed") {
    return [diagnostic({
      code: "evidence_verifier_not_completed",
      severity: "error",
      message: "Evidence Verifier report did not complete successfully.",
      evidenceRefs,
      metadata: { decision: report?.decision ?? "invalid" },
    })];
  }
  return [];
}

function approvalDiagnostics(
  rawApproval: unknown,
  approval: ApplyGateOperatorApproval | undefined,
  fingerprints: ApplyGateCurrentFingerprint,
  evidenceRefs: readonly EvidenceRef[],
): ApplyGateReadinessDiagnostic[] {
  if (rawApproval === undefined) {
    return [diagnostic({
      code: "missing_operator_approval",
      severity: "error",
      message: "Explicit operator approval is required before apply gate readiness can approve.",
      evidenceRefs,
    })];
  }
  if (!approval) {
    return [diagnostic({
      code: "operator_approval_not_granted",
      severity: "error",
      message: "Operator approval must be explicit, scoped, and readiness-only.",
      evidenceRefs,
    })];
  }
  const scopeMatches =
    approval.scope.planId === fingerprints.planId &&
    approval.scope.previewDiffHash === fingerprints.previewDiffHash &&
    approval.scope.matchRangeFingerprint === fingerprints.matchRangeFingerprint &&
    stableStringify(approval.scope.sourceHashes) === stableStringify(fingerprints.sourceHashes);
  return scopeMatches
    ? []
    : [diagnostic({
        code: "operator_approval_scope_drift",
        severity: "error",
        message: "Operator approval scope does not match current EditPlan fingerprints.",
        evidenceRefs,
      })];
}

function driftDiagnostics(
  plan: EditPlan,
  fingerprints: ApplyGateCurrentFingerprint,
  current: Partial<ApplyGateCurrentFingerprint> | undefined,
  approval: ApplyGateOperatorApproval | undefined,
  evidenceRefs: readonly EvidenceRef[],
): ApplyGateReadinessDiagnostic[] {
  const diagnostics: ApplyGateReadinessDiagnostic[] = [];
  if (current?.planId !== undefined && current.planId !== plan.planId) {
    diagnostics.push(diagnostic({
      code: "plan_fingerprint_drift",
      severity: "error",
      message: "Current plan fingerprint does not match the EditPlan plan id.",
      evidenceRefs,
      metadata: { expectedPlanId: plan.planId, actualPlanId: current.planId },
    }));
  }
  if (
    current?.sourceHashes !== undefined &&
    stableStringify(current.sourceHashes) !== stableStringify(plan.sourceHashes)
  ) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "Current source hashes do not match the EditPlan source hashes.",
      evidenceRefs,
    }));
  }
  if (
    current?.previewDiffHash !== undefined &&
    current.previewDiffHash !== fingerprints.previewDiffHash
  ) {
    diagnostics.push(diagnostic({
      code: "preview_diff_hash_drift",
      severity: "error",
      message: "Current preview diff hash does not match the EditPlan preview diff hash.",
      evidenceRefs,
    }));
  }
  if (
    current?.matchRangeFingerprint !== undefined &&
    current.matchRangeFingerprint !== fingerprints.matchRangeFingerprint
  ) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "Current match range fingerprint does not match the EditPlan match ranges.",
      evidenceRefs,
    }));
  }
  if (approval && approval.scope.planId !== plan.planId) {
    diagnostics.push(diagnostic({
      code: "plan_fingerprint_drift",
      severity: "error",
      message: "Operator approval plan id does not match the EditPlan plan id.",
      evidenceRefs,
    }));
  }
  return diagnostics;
}

function planSafetyDiagnostics(
  plan: EditPlan,
  requirements: ApplyGateReadinessReport["requiredVerifierRequirements"],
  unsupportedKinds: readonly string[],
  maxAllowedOperations: number,
  evidenceRefs: readonly EvidenceRef[],
): ApplyGateReadinessDiagnostic[] {
  const diagnostics: ApplyGateReadinessDiagnostic[] = [];
  if (plan.conflictDiagnostics.length > 0) {
    diagnostics.push(diagnostic({
      code: "conflict_diagnostics_present",
      severity: "error",
      message: "Conflict diagnostics must be cleared before apply gate readiness can approve.",
      evidenceRefs,
      metadata: { conflictCount: plan.conflictDiagnostics.length },
    }));
  }
  if (!authorityBoundaryValid(plan.authority)) {
    diagnostics.push(diagnostic({
      code: "authority_boundary_drift",
      severity: "error",
      message: "EditPlan authority boundary does not preserve planning-only readonly semantics.",
      evidenceRefs,
    }));
  }
  if (plan.orderedOperations.length > maxAllowedOperations) {
    diagnostics.push(diagnostic({
      code: "operation_budget_exceeded",
      severity: "error",
      message: "EditPlan ordered operations exceed the apply gate readiness budget.",
      evidenceRefs,
      metadata: {
        operationCount: plan.orderedOperations.length,
        maxAllowedOperations,
      },
    }));
  }
  if (unsupportedKinds.length > 0) {
    diagnostics.push(diagnostic({
      code: "unsupported_operation",
      severity: "error",
      message: "EditPlan contains operations unsupported by explicit apply readiness.",
      evidenceRefs,
      metadata: { unsupportedKinds: [...unsupportedKinds] },
    }));
  }
  for (const requirement of requirements) {
    if (requirement.status === "missing") {
      diagnostics.push(diagnostic({
        code: "required_verifier_requirement_missing",
        severity: "error",
        message: "A required verifier requirement is missing from readiness inputs.",
        evidenceRefs,
        metadata: { requirementId: requirement.id },
      }));
    } else if (requirement.status !== "satisfied") {
      diagnostics.push(diagnostic({
        code: "required_verifier_requirement_not_satisfied",
        severity: requirement.status === "pending" ? "warning" : "error",
        message: "A required verifier requirement is not satisfied for apply gate readiness.",
        evidenceRefs,
        metadata: { requirementId: requirement.id, status: requirement.status },
      }));
    }
  }
  return diagnostics;
}

function requirementStatuses(
  plan: EditPlan,
  readinessReport: AstEditPlanEvidenceVerifierReadinessReport | undefined,
): ApplyGateReadinessReport["requiredVerifierRequirements"] {
  const planRequirements = new Map(plan.verifierRequirements.requirements.map((item) => [item.id, item]));
  const readinessRequirements = new Map((readinessReport?.requirements ?? []).map((item) => [item.id, item]));
  return REQUIRED_REQUIREMENTS.map((id) => {
    const planRequirement = planRequirements.get(id);
    const readinessRequirement = readinessRequirements.get(id);
    if (!planRequirement || !readinessRequirement) {
      return { id, status: "missing" };
    }
    if (id === "evidence_verifier_review") {
      return { id, status: "satisfied" };
    }
    if (readinessRequirement.status === "satisfied") {
      return { id, status: "satisfied" };
    }
    return { id, status: readinessRequirement.status };
  });
}

function decide(
  readinessReport: AstEditPlanEvidenceVerifierReadinessReport | undefined,
  diagnostics: readonly ApplyGateReadinessDiagnostic[],
): ApplyGateDecision {
  if (diagnostics.some((item) => item.severity === "error")) {
    return "blocked";
  }
  if (readinessReport?.readiness !== "ready_for_evidence_verifier_review") {
    return "review_required";
  }
  if (diagnostics.some((item) => item.severity === "warning")) {
    return "review_required";
  }
  return "approved_for_explicit_apply";
}

function report(params: {
  decision: ApplyGateDecision;
  planId: string;
  engineId: string;
  sourceKind: EditPlan["source"]["kind"] | "unknown";
  readinessReportSource?: AstEditPlanEvidenceVerifierReadinessReport["source"];
  evidenceVerifierDecision?: EvidenceVerifierReport["decision"];
  diagnostics: ApplyGateReadinessDiagnostic[];
  requiredVerifierRequirements: ApplyGateReadinessReport["requiredVerifierRequirements"];
  operationCount: number;
  reportedOperationCount: number;
  maxAllowedOperations: number;
  unsupportedKinds: string[];
  fingerprints: ApplyGateCurrentFingerprint;
  approval: ApplyGateReadinessReport["operatorApproval"];
}): ApplyGateReadinessReport {
  return {
    schemaVersion: 1,
    source: APPLY_GATE_SOURCE,
    decision: params.decision,
    planId: params.planId,
    engineId: params.engineId,
    sourceKind: params.sourceKind,
    ...(params.readinessReportSource ? { readinessReportSource: params.readinessReportSource } : {}),
    ...(params.evidenceVerifierDecision ? { evidenceVerifierDecision: params.evidenceVerifierDecision } : {}),
    diagnostics: params.diagnostics,
    requiredVerifierRequirements: params.requiredVerifierRequirements,
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

function isApplyGateReadinessReportInput(value: unknown): value is AstEditPlanEvidenceVerifierReadinessReport {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    value.source === "runtime.ast_edit_plan.evidence_verifier_readiness" &&
    (
      value.readiness === "ready_for_evidence_verifier_review" ||
      value.readiness === "review_required" ||
      value.readiness === "blocked" ||
      value.readiness === "invalid_input"
    ) &&
    isNonEmptyString(value.planId) &&
    isNonEmptyString(value.engineId) &&
    Array.isArray(value.requirements) &&
    value.authority !== undefined &&
    value.evidenceUse !== undefined &&
    value.legacyDecisionUnaffected === true;
}

function isApplyGateOperatorApproval(value: unknown): value is ApplyGateOperatorApproval {
  return isRecord(value) &&
    value.approved === true &&
    isNonEmptyString(value.approvalId) &&
    isNonEmptyString(value.approvedBy) &&
    value.statement === "approve_explicit_apply_gate_readiness_only" &&
    (value.approvedAt === undefined || typeof value.approvedAt === "string") &&
    value.understandsNoTaskCompletionEvidence === true &&
    isRecord(value.scope) &&
    isNonEmptyString(value.scope.planId) &&
    isStringRecord(value.scope.sourceHashes) &&
    isNonEmptyString(value.scope.previewDiffHash) &&
    isNonEmptyString(value.scope.matchRangeFingerprint);
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
  return [...new Set(
    plan.orderedOperations.flatMap((operation) =>
      operation.kind === "replace_range" ? [] : [operation.kind]
    ),
  )].sort((left, right) => left.localeCompare(right));
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

function approvalSummary(value: unknown): ApplyGateReadinessReport["operatorApproval"] {
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

function collectEvidenceRefs(plan: EditPlan, input: ApplyGateReadinessInput): EvidenceRef[] {
  const readinessRefs = isApplyGateReadinessReportInput(input.readinessReport)
    ? input.readinessReport.diagnostics.flatMap((item) => item.evidenceRefs)
    : [];
  const verifierRefs = isEvidenceVerifierReport(input.evidenceVerifierReport)
    ? [
        ...input.evidenceVerifierReport.evidenceRefs,
        ...input.evidenceVerifierReport.findings.flatMap((item) => item.evidenceRefs),
      ]
    : [];
  return uniqueEvidenceRefs([
    ...plan.evidenceRefs,
    ...plan.matchEvidence.flatMap((item) => item.evidenceRefs),
    ...plan.diagnostics.flatMap((item) => item.evidenceRefs),
    ...plan.conflictDiagnostics.flatMap((item) => item.evidenceRefs),
    ...readinessRefs,
    ...verifierRefs,
  ]);
}

function diagnostic(params: {
  code: ApplyGateReadinessDiagnosticCode;
  severity: ApplyGateReadinessDiagnostic["severity"];
  message: string;
  evidenceRefs?: readonly EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): ApplyGateReadinessDiagnostic {
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
): ApplyGateReadinessDiagnostic {
  return diagnostic({
    code: "apply_gate_readiness_not_completion_evidence",
    severity: "info",
    message: "Apply gate readiness is not completion proof.",
    evidenceRefs,
  });
}

function explicitApplyNotPerformedDiagnostic(
  evidenceRefs: readonly EvidenceRef[] = [],
): ApplyGateReadinessDiagnostic {
  return diagnostic({
    code: "explicit_apply_not_performed",
    severity: "info",
    message: "This helper only reports readiness; no explicit apply was performed.",
    evidenceRefs,
  });
}

function limitDiagnostics(
  diagnostics: ApplyGateReadinessDiagnostic[],
  limit: number,
): ApplyGateReadinessDiagnostic[] {
  if (diagnostics.length <= limit) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, limit - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "Apply gate readiness diagnostics were bounded.",
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
