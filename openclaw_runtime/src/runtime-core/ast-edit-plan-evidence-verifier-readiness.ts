import type { EvidenceRef } from "./evidence.js";
import { isEvidenceRef } from "./evidence.js";
import type {
  EditPlan,
  EditPlanAuthorityBoundary,
  EditPlanVerifierRequirement,
} from "./ast-edit-plan.js";
import type {
  EvidenceVerifierInput,
  EvidenceVerifierObligation,
} from "./evidence-verifier.js";
import {
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
} from "./types.js";

export type AstEditPlanEvidenceVerifierReadinessStatus =
  | "ready_for_evidence_verifier_review"
  | "review_required"
  | "blocked"
  | "invalid_input";

export type AstEditPlanEvidenceVerifierReadinessDiagnosticCode =
  | "invalid_edit_plan_input"
  | "authority_boundary_missing"
  | "source_hashes_missing"
  | "match_ranges_missing"
  | "ordered_operations_missing"
  | "conflict_diagnostics_present"
  | "preview_diff_pending"
  | "evidence_verifier_review_pending"
  | "edit_plan_fingerprint_mismatch"
  | "source_hash_drift"
  | "preview_diff_hash_drift"
  | "readonly_candidate_not_completion_evidence"
  | "bounded_output";

export type AstEditPlanEvidenceVerifierReadinessDiagnostic = {
  code: AstEditPlanEvidenceVerifierReadinessDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  requirementId?: EditPlanVerifierRequirement["id"];
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AstEditPlanEvidenceVerifierReadinessRequirement = {
  id: EditPlanVerifierRequirement["id"];
  status: "satisfied" | "pending" | "blocked";
  evidenceRefs: EvidenceRef[];
  diagnostics: string[];
};

export type AstEditPlanEvidenceVerifierCandidateOperation = {
  order: number;
  operationId: string;
  kind: EditPlan["orderedOperations"][number]["kind"];
  matchId: string;
  filePath: string;
  range: EditPlan["orderedOperations"][number]["range"];
};

export type AstEditPlanEvidenceVerifierReadinessReport = {
  schemaVersion: 1;
  source: "runtime.ast_edit_plan.evidence_verifier_readiness";
  readiness: AstEditPlanEvidenceVerifierReadinessStatus;
  planId: string;
  engineId: string;
  sourceKind: EditPlan["source"]["kind"] | "unknown";
  verifierInput?: EvidenceVerifierInput;
  requirements: AstEditPlanEvidenceVerifierReadinessRequirement[];
  diagnostics: AstEditPlanEvidenceVerifierReadinessDiagnostic[];
  candidateOperations: AstEditPlanEvidenceVerifierCandidateOperation[];
  targetFileCount: number;
  matchCount: number;
  previewDiff: {
    requested: boolean;
    available: boolean;
    hash?: string;
    fileCount: number;
  };
  authority: {
    planningOnly: true;
    readonly: true;
    noPatchApply: true;
    noWorkspaceMutation: true;
    noSymbolMutation: true;
    explicitApplyGateRequired: true;
    noActiveCompletionGate: true;
    editPlanIsNotTaskCompletionEvidence: true;
    readinessReportIsNotTaskCompletionEvidence: true;
    eligibleAfterVerificationDoesNotApply: true;
  };
  evidenceUse: {
    readonlyCandidateTextIsTaskCompletionEvidence: false;
    previewDiffIsTaskCompletionEvidence: false;
    matchCountIsTaskCompletionEvidence: false;
    astGrepResultIsTaskCompletionEvidence: false;
    editPlanIsTaskCompletionEvidence: false;
    readinessReportIsTaskCompletionEvidence: false;
  };
  legacyDecisionUnaffected: true;
};

export type BuildAstEditPlanEvidenceVerifierReadinessOptions = {
  taskId?: string;
  objective?: string;
  expectedPlanId?: string;
  expectedSourceHashes?: Record<string, string>;
  expectedPreviewDiffHash?: string;
  maxDiagnostics?: number;
  maxEvidenceRefs?: number;
  maxOperations?: number;
};

const REQUIREMENT_ORDER: EditPlanVerifierRequirement["id"][] = [
  "source_hashes_present",
  "match_ranges_present",
  "ordered_operations_present",
  "no_conflict_diagnostics",
  "preview_diff_available",
  "evidence_verifier_review",
];

const DRIFT_DIAGNOSTIC_CODES = new Set([
  "source_hash_drift",
  "match_count_drift",
  "match_range_drift",
  "preview_diff_hash_drift",
]);

const READINESS_SOURCE = "runtime.ast_edit_plan.evidence_verifier_readiness" as const;

export function buildAstEditPlanEvidenceVerifierReadiness(
  value: unknown,
  options: BuildAstEditPlanEvidenceVerifierReadinessOptions = {},
): AstEditPlanEvidenceVerifierReadinessReport {
  const limits = {
    maxDiagnostics: normalizeLimit(options.maxDiagnostics, 32),
    maxEvidenceRefs: normalizeLimit(options.maxEvidenceRefs, 32),
    maxOperations: normalizeLimit(options.maxOperations, 64),
  };

  if (!isEditPlanForEvidenceVerifierReadiness(value)) {
    const diagnostics = limitDiagnostics([
      diagnostic({
        code: "invalid_edit_plan_input",
        severity: "error",
        message: "EditPlan readiness bridge received invalid or non-EditPlan input.",
      }),
    ], limits.maxDiagnostics);
    return buildReport({
      readiness: "invalid_input",
      planId: "unknown",
      engineId: "unknown",
      sourceKind: "unknown",
      verifierInput: undefined,
      requirements: [],
      diagnostics,
      candidateOperations: [],
      targetFileCount: 0,
      matchCount: 0,
      previewDiff: { requested: false, available: false, fileCount: 0 },
    });
  }

  const plan = value;
  const evidenceRefs = limitEvidenceRefs(
    uniqueEvidenceRefs([
      ...plan.evidenceRefs,
      ...plan.targetFiles.flatMap((file) => fileEvidenceRef(file.filePath, file.sourceHash)),
      ...plan.diagnostics.flatMap((item) => item.evidenceRefs),
      ...plan.conflictDiagnostics.flatMap((item) => item.evidenceRefs),
      ...plan.matchEvidence.flatMap((item) => item.evidenceRefs),
    ]),
    limits.maxEvidenceRefs,
  );
  const requirements = requirementReadiness(plan, evidenceRefs, limits.maxEvidenceRefs);
  const diagnostics = [
    ...requirementDiagnostics(requirements),
    ...authorityDiagnostics(plan.authority, evidenceRefs),
    ...driftDiagnostics(plan, options, evidenceRefs),
    diagnostic({
      code: "readonly_candidate_not_completion_evidence",
      severity: "info",
      message: "Readonly AST candidates, preview diffs, match counts, EditPlan output, and readiness reports are not task completion proof.",
      evidenceRefs,
    }),
  ];
  const boundedOperations = candidateOperations(plan).slice(0, limits.maxOperations);
  const boundedDiagnostics = limitDiagnostics(
    boundedOperations.length < plan.orderedOperations.length
      ? [
          ...diagnostics,
          diagnostic({
            code: "bounded_output",
            severity: "warning",
            message: "EditPlan readiness candidate operations were bounded.",
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
  const readiness = decideReadiness(plan, requirements, boundedDiagnostics);
  const verifierInput = readiness === "invalid_input"
    ? undefined
    : buildVerifierInput(plan, requirements, evidenceRefs, options);

  return buildReport({
    readiness,
    planId: plan.planId,
    engineId: plan.engineId,
    sourceKind: plan.source.kind,
    verifierInput,
    requirements,
    diagnostics: boundedDiagnostics,
    candidateOperations: boundedOperations,
    targetFileCount: plan.targetFiles.length,
    matchCount: plan.matchEvidence.length,
    previewDiff: {
      requested: plan.previewDiff.requested,
      available: plan.previewDiff.available,
      ...(plan.previewDiff.hash ? { hash: plan.previewDiff.hash } : {}),
      fileCount: plan.previewDiff.files.length,
    },
  });
}

export function isEditPlanForEvidenceVerifierReadiness(value: unknown): value is EditPlan {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.planId) &&
    isNonEmptyString(value.engineId) &&
    isRecord(value.source) &&
    isNonEmptyString(value.source.kind) &&
    value.mode === "readonly_scan" &&
    isRecord(value.sourceScope) &&
    Array.isArray(value.targetFiles) &&
    value.targetFiles.every(isEditPlanTargetFileShape) &&
    isStringRecord(value.sourceHashes) &&
    Array.isArray(value.matchEvidence) &&
    value.matchEvidence.every(isEditPlanMatchShape) &&
    Array.isArray(value.orderedOperations) &&
    value.orderedOperations.every(isEditPlanOperationShape) &&
    Array.isArray(value.conflictDiagnostics) &&
    value.conflictDiagnostics.every(isEditPlanDiagnosticShape) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isEditPlanDiagnosticShape) &&
    isRecord(value.previewDiff) &&
    typeof value.previewDiff.requested === "boolean" &&
    typeof value.previewDiff.available === "boolean" &&
    Array.isArray(value.previewDiff.files) &&
    isRecord(value.verifierRequirements) &&
    value.verifierRequirements.requiredBeforeApplyGate === true &&
    Array.isArray(value.verifierRequirements.requirements) &&
    value.verifierRequirements.requirements.every(isEditPlanRequirementShape) &&
    isRecord(value.applyEligibility) &&
    isNonEmptyString(value.applyEligibility.status) &&
    value.applyEligibility.descriptiveOnly === true &&
    isRecord(value.authority) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef)
  );
}

function requirementReadiness(
  plan: EditPlan,
  evidenceRefs: readonly EvidenceRef[],
  maxEvidenceRefs: number,
): AstEditPlanEvidenceVerifierReadinessRequirement[] {
  const byId = new Map(plan.verifierRequirements.requirements.map((requirement) => [
    requirement.id,
    requirement,
  ]));
  return REQUIREMENT_ORDER.map((id) => {
    const requirement = byId.get(id);
    const status = requirementStatus(id, requirement, plan);
    return {
      id,
      status,
      evidenceRefs: limitEvidenceRefs(
        uniqueEvidenceRefs(requirement?.evidenceRefs.length ? requirement.evidenceRefs : evidenceRefs),
        maxEvidenceRefs,
      ),
      diagnostics: [...(requirement?.diagnostics ?? [])].sort((left, right) =>
        left.localeCompare(right)
      ),
    };
  });
}

function requirementStatus(
  id: EditPlanVerifierRequirement["id"],
  requirement: EditPlanVerifierRequirement | undefined,
  plan: EditPlan,
): AstEditPlanEvidenceVerifierReadinessRequirement["status"] {
  if (!requirement) {
    return "blocked";
  }
  if (id === "source_hashes_present") {
    return hasSourceHashes(plan) ? "satisfied" : "blocked";
  }
  if (id === "match_ranges_present") {
    return hasValidMatchRanges(plan) ? "satisfied" : "blocked";
  }
  if (id === "ordered_operations_present") {
    return hasOrderedOperations(plan) ? "satisfied" : "blocked";
  }
  if (id === "no_conflict_diagnostics") {
    return plan.conflictDiagnostics.length === 0 ? "satisfied" : "blocked";
  }
  if (id === "preview_diff_available") {
    return plan.previewDiff.available ? "satisfied" : "pending";
  }
  return "pending";
}

function requirementDiagnostics(
  requirements: readonly AstEditPlanEvidenceVerifierReadinessRequirement[],
): AstEditPlanEvidenceVerifierReadinessDiagnostic[] {
  return requirements.flatMap((requirement) => {
    if (requirement.status === "satisfied") {
      return [];
    }
    return [diagnostic({
      code: diagnosticCodeForRequirement(requirement),
      severity: requirement.status === "blocked" ? "error" : "warning",
      message: diagnosticMessageForRequirement(requirement),
      requirementId: requirement.id,
      evidenceRefs: requirement.evidenceRefs,
      metadata: {
        requirementStatus: requirement.status,
        diagnostics: requirement.diagnostics,
      },
    })];
  });
}

function authorityDiagnostics(
  authority: EditPlanAuthorityBoundary,
  evidenceRefs: readonly EvidenceRef[],
): AstEditPlanEvidenceVerifierReadinessDiagnostic[] {
  const valid =
    authority.planningOnly === true &&
    authority.readonly === true &&
    authority.noPatchApply === true &&
    authority.noWorkspaceMutation === true &&
    authority.noSymbolMutation === true &&
    authority.explicitApplyGateRequired === true &&
    authority.editPlanIsNotTaskCompletionEvidence === true;
  return valid
    ? []
    : [
        diagnostic({
          code: "authority_boundary_missing",
          severity: "error",
          message: "EditPlan authority boundary does not preserve readonly planning-only semantics.",
          evidenceRefs,
        }),
      ];
}

function driftDiagnostics(
  plan: EditPlan,
  options: BuildAstEditPlanEvidenceVerifierReadinessOptions,
  evidenceRefs: readonly EvidenceRef[],
): AstEditPlanEvidenceVerifierReadinessDiagnostic[] {
  const diagnostics: AstEditPlanEvidenceVerifierReadinessDiagnostic[] = [];
  if (options.expectedPlanId && options.expectedPlanId !== plan.planId) {
    diagnostics.push(diagnostic({
      code: "edit_plan_fingerprint_mismatch",
      severity: "error",
      message: "EditPlan fingerprint does not match the expected plan id.",
      evidenceRefs,
      metadata: { expectedPlanId: options.expectedPlanId, actualPlanId: plan.planId },
    }));
  }
  if (
    options.expectedSourceHashes &&
    stableStringify(options.expectedSourceHashes) !== stableStringify(plan.sourceHashes)
  ) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "EditPlan source hashes do not match the expected verifier-readiness fingerprint.",
      evidenceRefs,
    }));
  }
  if (
    options.expectedPreviewDiffHash &&
    options.expectedPreviewDiffHash !== (plan.previewDiff.hash ?? "")
  ) {
    diagnostics.push(diagnostic({
      code: "preview_diff_hash_drift",
      severity: "error",
      message: "EditPlan preview diff hash does not match the expected verifier-readiness fingerprint.",
      evidenceRefs,
    }));
  }
  if (plan.diagnostics.some((item) => DRIFT_DIAGNOSTIC_CODES.has(String(item.code)))) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "EditPlan diagnostics include drift codes from a previous resume/fingerprint check.",
      evidenceRefs,
    }));
  }
  return diagnostics;
}

function decideReadiness(
  plan: EditPlan,
  requirements: readonly AstEditPlanEvidenceVerifierReadinessRequirement[],
  diagnostics: readonly AstEditPlanEvidenceVerifierReadinessDiagnostic[],
): AstEditPlanEvidenceVerifierReadinessStatus {
  if (diagnostics.some((item) => item.code === "invalid_edit_plan_input")) {
    return "invalid_input";
  }
  if (
    requirements.some((item) => item.status === "blocked") ||
    diagnostics.some((item) => item.severity === "error")
  ) {
    return "blocked";
  }
  const pending = requirements.filter((item) => item.status === "pending").map((item) => item.id);
  if (
    pending.length === 1 &&
    pending[0] === "evidence_verifier_review" &&
    plan.applyEligibility.status === "eligible_after_verification"
  ) {
    return "ready_for_evidence_verifier_review";
  }
  return "review_required";
}

function buildVerifierInput(
  plan: EditPlan,
  requirements: readonly AstEditPlanEvidenceVerifierReadinessRequirement[],
  evidenceRefs: readonly EvidenceRef[],
  options: BuildAstEditPlanEvidenceVerifierReadinessOptions,
): EvidenceVerifierInput {
  return {
    taskId: options.taskId ?? `ast_edit_plan_readiness:${plan.planId}`,
    objective: options.objective ??
      `Prepare EditPlan ${plan.planId} for Evidence Verifier review; this is not task completion proof.`,
    obligations: requirements.map((requirement): EvidenceVerifierObligation => ({
      id: `edit_plan_requirement:${requirement.id}`,
      description: descriptionForRequirement(requirement.id),
      status: requirement.status === "satisfied"
        ? "satisfied"
        : requirement.status === "blocked"
          ? "blocked"
          : "open",
      evidenceRefs: requirement.evidenceRefs,
      metadata: {
        editPlanRequirementId: requirement.id,
        readinessStatus: requirement.status,
      },
    })),
    evidenceRefs: [...evidenceRefs],
    toolResults: [],
    eventReplay: {
      status: "not_run",
      state: "unknown",
      diagnosticCodes: ["ast_edit_plan_readiness_bridge_non_gating"],
      pendingToolCallIds: [],
      evidenceRefCount: evidenceRefs.length,
    },
    metadata: {
      source: READINESS_SOURCE,
      planId: plan.planId,
      engineId: plan.engineId,
      sourceKind: plan.source.kind,
      applyEligibility: plan.applyEligibility.status,
      explicitApplyGateRequired: true,
      taskCompletionEvidence: false,
      noActiveCompletionGate: true,
    },
  };
}

function buildReport(params: {
  readiness: AstEditPlanEvidenceVerifierReadinessStatus;
  planId: string;
  engineId: string;
  sourceKind: EditPlan["source"]["kind"] | "unknown";
  verifierInput?: EvidenceVerifierInput;
  requirements: AstEditPlanEvidenceVerifierReadinessRequirement[];
  diagnostics: AstEditPlanEvidenceVerifierReadinessDiagnostic[];
  candidateOperations: AstEditPlanEvidenceVerifierCandidateOperation[];
  targetFileCount: number;
  matchCount: number;
  previewDiff: AstEditPlanEvidenceVerifierReadinessReport["previewDiff"];
}): AstEditPlanEvidenceVerifierReadinessReport {
  return {
    schemaVersion: 1,
    source: READINESS_SOURCE,
    readiness: params.readiness,
    planId: params.planId,
    engineId: params.engineId,
    sourceKind: params.sourceKind,
    ...(params.verifierInput ? { verifierInput: params.verifierInput } : {}),
    requirements: params.requirements,
    diagnostics: params.diagnostics,
    candidateOperations: params.candidateOperations,
    targetFileCount: params.targetFileCount,
    matchCount: params.matchCount,
    previewDiff: params.previewDiff,
    authority: {
      planningOnly: true,
      readonly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      explicitApplyGateRequired: true,
      noActiveCompletionGate: true,
      editPlanIsNotTaskCompletionEvidence: true,
      readinessReportIsNotTaskCompletionEvidence: true,
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
  };
}

function candidateOperations(plan: EditPlan): AstEditPlanEvidenceVerifierCandidateOperation[] {
  return [...plan.orderedOperations]
    .sort((left, right) =>
      left.order - right.order ||
      left.filePath.localeCompare(right.filePath) ||
      left.operationId.localeCompare(right.operationId)
    )
    .map((operation) => ({
      order: operation.order,
      operationId: operation.operationId,
      kind: operation.kind,
      matchId: operation.matchId,
      filePath: operation.filePath,
      range: operation.range,
    }));
}

function hasSourceHashes(plan: EditPlan): boolean {
  if (plan.targetFiles.length === 0) {
    return false;
  }
  return plan.targetFiles.every((file) =>
    Boolean(file.sourceHash && plan.sourceHashes[file.filePath] === file.sourceHash)
  );
}

function hasValidMatchRanges(plan: EditPlan): boolean {
  return plan.matchEvidence.length > 0 &&
    plan.matchEvidence.every((match) => match.range.end >= match.range.start);
}

function hasOrderedOperations(plan: EditPlan): boolean {
  return plan.orderedOperations.length === plan.matchEvidence.length &&
    plan.orderedOperations.every((operation, index) => operation.order === index + 1);
}

function diagnosticCodeForRequirement(
  requirement: AstEditPlanEvidenceVerifierReadinessRequirement,
): AstEditPlanEvidenceVerifierReadinessDiagnosticCode {
  switch (requirement.id) {
    case "source_hashes_present":
      return "source_hashes_missing";
    case "match_ranges_present":
      return "match_ranges_missing";
    case "ordered_operations_present":
      return "ordered_operations_missing";
    case "no_conflict_diagnostics":
      return "conflict_diagnostics_present";
    case "preview_diff_available":
      return "preview_diff_pending";
    case "evidence_verifier_review":
      return "evidence_verifier_review_pending";
  }
}

function diagnosticMessageForRequirement(
  requirement: AstEditPlanEvidenceVerifierReadinessRequirement,
): string {
  switch (requirement.id) {
    case "source_hashes_present":
      return "EditPlan source hashes are missing or do not cover every target file.";
    case "match_ranges_present":
      return "EditPlan match ranges are missing or invalid.";
    case "ordered_operations_present":
      return "EditPlan ordered operations are missing or do not align with match evidence.";
    case "no_conflict_diagnostics":
      return "EditPlan conflict diagnostics must be resolved before verifier readiness.";
    case "preview_diff_available":
      return "EditPlan preview diff is not available; readiness remains review-required.";
    case "evidence_verifier_review":
      return "Evidence Verifier review remains pending and is not an apply gate.";
  }
}

function descriptionForRequirement(id: EditPlanVerifierRequirement["id"]): string {
  switch (id) {
    case "source_hashes_present":
      return "EditPlan includes source hashes for every readonly target file.";
    case "match_ranges_present":
      return "EditPlan includes bounded match ranges for candidate operations.";
    case "ordered_operations_present":
      return "EditPlan includes deterministic ordered candidate operations.";
    case "no_conflict_diagnostics":
      return "EditPlan has no conflict diagnostics blocking verifier review.";
    case "preview_diff_available":
      return "EditPlan includes preview diff metadata for reviewer/verifier inspection.";
    case "evidence_verifier_review":
      return "Evidence Verifier review is still required before any explicit apply gate.";
  }
}

function diagnostic(params: {
  code: AstEditPlanEvidenceVerifierReadinessDiagnosticCode;
  severity: AstEditPlanEvidenceVerifierReadinessDiagnostic["severity"];
  message: string;
  requirementId?: EditPlanVerifierRequirement["id"];
  evidenceRefs?: readonly EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
}): AstEditPlanEvidenceVerifierReadinessDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.requirementId ? { requirementId: params.requirementId } : {}),
    evidenceRefs: [...(params.evidenceRefs ?? [])],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function fileEvidenceRef(filePath: string, sourceHash: string | undefined): EvidenceRef[] {
  return sourceHash
    ? [{
        type: "file",
        ref: filePath,
        label: "EditPlan readonly target source hash",
        summary: "File evidence projected from readonly EditPlan source hash metadata.",
        metadata: {
          source: READINESS_SOURCE,
          sourceHash,
          taskCompletionEvidence: false,
        },
      }]
    : [];
}

function isEditPlanTargetFileShape(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.filePath) &&
    (value.language === undefined || typeof value.language === "string") &&
    (value.sourceHash === undefined || typeof value.sourceHash === "string");
}

function isEditPlanMatchShape(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.matchId) &&
    isNonEmptyString(value.filePath) &&
    isNonEmptyString(value.language) &&
    isNonEmptyString(value.astKind) &&
    isRangeShape(value.range) &&
    isNonEmptyString(value.excerptHash) &&
    isStringRecord(value.metavariableHashes) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef);
}

function isEditPlanOperationShape(value: unknown): boolean {
  return isRecord(value) &&
    Number.isInteger(value.order) &&
    isNonEmptyString(value.operationId) &&
    (value.kind === "replace_range" || value.kind === "match_only") &&
    isNonEmptyString(value.matchId) &&
    isNonEmptyString(value.filePath) &&
    isRangeShape(value.range) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef);
}

function isEditPlanDiagnosticShape(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.code) &&
    (value.severity === "info" || value.severity === "warning" || value.severity === "error") &&
    isNonEmptyString(value.message) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata)) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef);
}

function isEditPlanRequirementShape(value: unknown): value is EditPlanVerifierRequirement {
  return isRecord(value) &&
    REQUIREMENT_ORDER.includes(value.id as EditPlanVerifierRequirement["id"]) &&
    value.required === true &&
    (
      value.status === "satisfied_by_readonly_scan" ||
      value.status === "pending" ||
      value.status === "blocked"
    ) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every((item) => typeof item === "string");
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function limitDiagnostics(
  diagnostics: AstEditPlanEvidenceVerifierReadinessDiagnostic[],
  limit: number,
): AstEditPlanEvidenceVerifierReadinessDiagnostic[] {
  if (diagnostics.length <= limit) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, limit - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "EditPlan readiness diagnostics were bounded.",
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
