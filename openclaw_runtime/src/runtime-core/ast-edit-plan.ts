import { createHash } from "node:crypto";
import type { EvidenceRef } from "./evidence.js";
import type {
  AstPatchPlannerDiagnostic,
  AstPatchPlannerDiagnosticCode,
  AstPatchPlannerMatchEvidence,
  AstPatchPlannerPreviewDiff,
  AstPatchPlannerRange,
  AstPatchPlannerReadonlyScanResult,
} from "./ast-patch-planner.js";
import type { RuntimeCoreJsonObject, RuntimeCoreJsonValue } from "./types.js";

export type EditPlanSourceMode = "readonly_scan" | "future_adapter";

export type EditPlanSource = {
  kind: "ast_patch_planner_readonly_scan" | "ast_grep_readonly_adapter" | "future_ast_adapter";
  mode: EditPlanSourceMode;
  prototypeOnly: boolean;
  productionEngine: false;
};

export type EditPlanSourceScope = {
  kind: "explicit_targets" | "agent_map_symbol_scope" | "future_adapter_scope";
  targetFilePaths: string[];
  description: string;
  evidenceRefs: EvidenceRef[];
};

export type EditPlanTargetFile = {
  filePath: string;
  language?: string;
  sourceHash?: string;
};

export type EditPlanMatchEvidence = {
  matchId: string;
  filePath: string;
  language: string;
  astKind: string;
  range: AstPatchPlannerRange;
  excerptHash: string;
  excerpt?: string;
  metavariableHashes: Record<string, string>;
  evidenceRefs: EvidenceRef[];
};

export type EditPlanOperation =
  | {
      order: number;
      operationId: string;
      kind: "replace_range";
      matchId: string;
      filePath: string;
      astKind: string;
      range: AstPatchPlannerRange;
      excerptHash: string;
      replacementHash: string;
      replacementPreview?: string;
      evidenceRefs: EvidenceRef[];
    }
  | {
      order: number;
      operationId: string;
      kind: "match_only";
      matchId: string;
      filePath: string;
      astKind: string;
      range: AstPatchPlannerRange;
      excerptHash: string;
      reason: "unfixable_rule";
      evidenceRefs: EvidenceRef[];
    };

export type EditPlanConflictDiagnostic = {
  code: AstPatchPlannerDiagnosticCode | string;
  severity: AstPatchPlannerDiagnostic["severity"];
  message: string;
  filePath?: string;
  range?: AstPatchPlannerRange;
  metadata?: RuntimeCoreJsonObject;
  evidenceRefs: EvidenceRef[];
};

export type EditPlanPreviewDiffMetadata = {
  requested: boolean;
  available: boolean;
  hash?: string;
  fullByteLength?: number;
  truncated?: boolean;
  files: {
    filePath: string;
    diffHash: string;
    byteLength: number;
  }[];
  unavailableReason?:
    | "preview_diff_disabled"
    | "unfixable_rule"
    | "review_required"
    | "scan_not_successful";
};

export type EditPlanVerifierRequirementStatus =
  | "satisfied_by_readonly_scan"
  | "pending"
  | "blocked";

export type EditPlanVerifierRequirement = {
  id:
    | "source_hashes_present"
    | "match_ranges_present"
    | "ordered_operations_present"
    | "no_conflict_diagnostics"
    | "preview_diff_available"
    | "evidence_verifier_review";
  required: boolean;
  status: EditPlanVerifierRequirementStatus;
  evidenceRefs: EvidenceRef[];
  diagnostics: string[];
};

export type EditPlanVerifierRequirements = {
  requiredBeforeApplyGate: true;
  requirements: EditPlanVerifierRequirement[];
};

export type EditPlanApplyEligibilityStatus =
  | "ineligible"
  | "review_required"
  | "eligible_after_verification";

export type EditPlanApplyEligibility = {
  status: EditPlanApplyEligibilityStatus;
  reasons: string[];
  descriptiveOnly: true;
};

export type EditPlanAuthorityBoundary = {
  planningOnly: true;
  readonly: true;
  noPatchApply: true;
  noWorkspaceMutation: true;
  noSymbolMutation: true;
  noTaskLoopInvocation: true;
  noGatewayIntegration: true;
  noProviderTransportChange: true;
  noPromptOrModelMessageInsertion: true;
  noPersistence: true;
  noDefaultOnBehavior: true;
  explicitApplyGateRequired: true;
  editPlanIsNotTaskCompletionEvidence: true;
};

export type EditPlan = {
  schemaVersion: 1;
  planId: string;
  engineId: string;
  source: EditPlanSource;
  mode: EditPlanSourceMode;
  sourceScope: EditPlanSourceScope;
  targetFiles: EditPlanTargetFile[];
  sourceHashes: Record<string, string>;
  matchEvidence: EditPlanMatchEvidence[];
  orderedOperations: EditPlanOperation[];
  conflictDiagnostics: EditPlanConflictDiagnostic[];
  diagnostics: EditPlanConflictDiagnostic[];
  previewDiff: EditPlanPreviewDiffMetadata;
  verifierRequirements: EditPlanVerifierRequirements;
  applyEligibility: EditPlanApplyEligibility;
  authority: EditPlanAuthorityBoundary;
  evidenceRefs: EvidenceRef[];
};

export type EditPlanFromReadonlyScanOptions = {
  sourceScope?: Partial<EditPlanSourceScope>;
  engineId?: string;
};

export const EDIT_PLAN_AUTHORITY_BOUNDARY: EditPlanAuthorityBoundary = {
  planningOnly: true,
  readonly: true,
  noPatchApply: true,
  noWorkspaceMutation: true,
  noSymbolMutation: true,
  noTaskLoopInvocation: true,
  noGatewayIntegration: true,
  noProviderTransportChange: true,
  noPromptOrModelMessageInsertion: true,
  noPersistence: true,
  noDefaultOnBehavior: true,
  explicitApplyGateRequired: true,
  editPlanIsNotTaskCompletionEvidence: true,
};

export function editPlanFromReadonlyAstPatchPlannerScan(
  scan: AstPatchPlannerReadonlyScanResult,
  options: EditPlanFromReadonlyScanOptions = {},
): EditPlan {
  const targetFiles = targetFilesFromScan(scan);
  const sourceHashes = scan.checkpoint?.sourceFileHashes ?? {};
  const evidenceRefs = uniqueEvidenceRefs([
    ...scan.evidenceRefs,
    ...scan.diagnostics.flatMap((diagnostic) => diagnostic.evidenceRefs),
    ...scan.matches.flatMap((match) => match.evidenceRefs),
    ...(options.sourceScope?.evidenceRefs ?? []),
  ]);
  const diagnostics = scan.diagnostics.map(toEditPlanDiagnostic);
  const conflictDiagnostics = diagnostics.filter((diagnostic) =>
    isConflictDiagnostic(diagnostic.code)
  );
  const orderedOperations = scan.matches.map(toEditPlanOperation);
  const previewDiff = previewDiffMetadata(scan);
  const verifierRequirements = buildVerifierRequirements({
    evidenceRefs,
    sourceHashes,
    matches: scan.matches,
    operations: orderedOperations,
    conflictDiagnostics,
    previewDiff,
  });
  const applyEligibility = deriveApplyEligibility(scan, orderedOperations, conflictDiagnostics, previewDiff);
  const sourceScope: EditPlanSourceScope = {
    kind: options.sourceScope?.kind ?? "explicit_targets",
    targetFilePaths: options.sourceScope?.targetFilePaths ?? targetFiles.map((file) => file.filePath),
    description: options.sourceScope?.description ??
      "Caller-owned explicit in-memory readonly scan targets.",
    evidenceRefs: uniqueEvidenceRefs(options.sourceScope?.evidenceRefs ?? []),
  };
  const planCore = {
    engineId: options.engineId ?? "runtime.ast_patch_planner.typescript_text_matcher.prototype",
    scanSource: scan.source,
    scanStatus: scan.status,
    sourceScope,
    targetFiles,
    sourceHashes,
    matchRanges: scan.matches.map((match) => ({
      filePath: match.filePath,
      start: match.range.start,
      end: match.range.end,
      excerptHash: match.excerptHash,
      replacementHash: match.replacementHash ?? "",
    })),
    diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
    previewDiffHash: previewDiff.hash ?? "",
  };

  return {
    schemaVersion: 1,
    planId: `edit_plan_${digest(stableStringify(planCore)).slice(0, 24)}`,
    engineId: planCore.engineId,
    source: {
      kind: "ast_patch_planner_readonly_scan",
      mode: scan.mode,
      prototypeOnly: true,
      productionEngine: false,
    },
    mode: scan.mode,
    sourceScope,
    targetFiles,
    sourceHashes,
    matchEvidence: scan.matches.map(toEditPlanMatchEvidence),
    orderedOperations,
    conflictDiagnostics,
    diagnostics,
    previewDiff,
    verifierRequirements,
    applyEligibility,
    authority: EDIT_PLAN_AUTHORITY_BOUNDARY,
    evidenceRefs,
  };
}

function targetFilesFromScan(scan: AstPatchPlannerReadonlyScanResult): EditPlanTargetFile[] {
  if (scan.checkpoint) {
    return scan.checkpoint.targetFiles.map((file) => ({
      filePath: file.filePath,
      language: file.language,
      sourceHash: file.sourceHash,
    }));
  }
  const byPath = new Map<string, EditPlanTargetFile>();
  for (const match of scan.matches) {
    byPath.set(match.filePath, {
      filePath: match.filePath,
      language: match.language,
    });
  }
  return [...byPath.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function toEditPlanMatchEvidence(match: AstPatchPlannerMatchEvidence): EditPlanMatchEvidence {
  return {
    matchId: match.matchId,
    filePath: match.filePath,
    language: match.language,
    astKind: match.astKind,
    range: match.range,
    excerptHash: match.excerptHash,
    excerpt: match.excerpt,
    metavariableHashes: Object.fromEntries(
      Object.entries(match.metavariables).map(([name, value]) => [name, value.textHash]),
    ),
    evidenceRefs: match.evidenceRefs,
  };
}

function toEditPlanOperation(match: AstPatchPlannerMatchEvidence, index: number): EditPlanOperation {
  const operationBase = {
    order: index + 1,
    operationId: `operation_${String(index + 1).padStart(4, "0")}`,
    matchId: match.matchId,
    filePath: match.filePath,
    astKind: match.astKind,
    range: match.range,
    excerptHash: match.excerptHash,
    evidenceRefs: match.evidenceRefs,
  };
  if (match.replacementHash) {
    return {
      ...operationBase,
      kind: "replace_range",
      replacementHash: match.replacementHash,
      ...(match.replacementPreview ? { replacementPreview: match.replacementPreview } : {}),
    };
  }
  return {
    ...operationBase,
    kind: "match_only",
    reason: "unfixable_rule",
  };
}

function toEditPlanDiagnostic(diagnostic: AstPatchPlannerDiagnostic): EditPlanConflictDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.filePath ? { filePath: diagnostic.filePath } : {}),
    ...(diagnostic.range ? { range: diagnostic.range } : {}),
    ...(diagnostic.metadata ? { metadata: diagnostic.metadata } : {}),
    evidenceRefs: diagnostic.evidenceRefs,
  };
}

function previewDiffMetadata(scan: AstPatchPlannerReadonlyScanResult): EditPlanPreviewDiffMetadata {
  if (scan.previewDiff) {
    return {
      requested: scan.flags.previewDiff,
      available: true,
      ...previewDiffMetadataFields(scan.previewDiff),
    };
  }
  return {
    requested: scan.flags.previewDiff,
    available: false,
    files: [],
    unavailableReason: previewUnavailableReason(scan),
  };
}

function previewDiffMetadataFields(previewDiff: AstPatchPlannerPreviewDiff) {
  return {
    hash: previewDiff.hash,
    fullByteLength: previewDiff.fullByteLength,
    truncated: previewDiff.truncated,
    files: previewDiff.files.map((file) => ({
      filePath: file.filePath,
      diffHash: file.diffHash,
      byteLength: file.byteLength,
    })),
  };
}

function previewUnavailableReason(
  scan: AstPatchPlannerReadonlyScanResult,
): EditPlanPreviewDiffMetadata["unavailableReason"] {
  if (scan.diagnostics.some((diagnostic) => diagnostic.code === "preview_diff_disabled")) {
    return "preview_diff_disabled";
  }
  if (scan.diagnostics.some((diagnostic) => diagnostic.code === "unfixable_rule")) {
    return "unfixable_rule";
  }
  if (scan.status === "review_required") {
    return "review_required";
  }
  return scan.status === "success" ? undefined : "scan_not_successful";
}

function buildVerifierRequirements(params: {
  evidenceRefs: EvidenceRef[];
  sourceHashes: Record<string, string>;
  matches: AstPatchPlannerMatchEvidence[];
  operations: EditPlanOperation[];
  conflictDiagnostics: EditPlanConflictDiagnostic[];
  previewDiff: EditPlanPreviewDiffMetadata;
}): EditPlanVerifierRequirements {
  return {
    requiredBeforeApplyGate: true,
    requirements: [
      requirement(
        "source_hashes_present",
        Object.keys(params.sourceHashes).length > 0 ? "satisfied_by_readonly_scan" : "blocked",
        params.evidenceRefs,
      ),
      requirement(
        "match_ranges_present",
        params.matches.every((match) => match.range.end >= match.range.start)
          ? "satisfied_by_readonly_scan"
          : "blocked",
        params.evidenceRefs,
      ),
      requirement(
        "ordered_operations_present",
        params.operations.length === params.matches.length ? "satisfied_by_readonly_scan" : "blocked",
        params.evidenceRefs,
      ),
      requirement(
        "no_conflict_diagnostics",
        params.conflictDiagnostics.length === 0 ? "satisfied_by_readonly_scan" : "blocked",
        params.evidenceRefs,
        params.conflictDiagnostics.map((diagnostic) => diagnostic.code),
      ),
      requirement(
        "preview_diff_available",
        params.previewDiff.available ? "satisfied_by_readonly_scan" : "pending",
        params.evidenceRefs,
        params.previewDiff.unavailableReason ? [params.previewDiff.unavailableReason] : [],
      ),
      requirement("evidence_verifier_review", "pending", params.evidenceRefs),
    ],
  };
}

function requirement(
  id: EditPlanVerifierRequirement["id"],
  status: EditPlanVerifierRequirementStatus,
  evidenceRefs: EvidenceRef[],
  diagnostics: string[] = [],
): EditPlanVerifierRequirement {
  return {
    id,
    required: true,
    status,
    evidenceRefs,
    diagnostics,
  };
}

function deriveApplyEligibility(
  scan: AstPatchPlannerReadonlyScanResult,
  operations: readonly EditPlanOperation[],
  conflictDiagnostics: readonly EditPlanConflictDiagnostic[],
  previewDiff: EditPlanPreviewDiffMetadata,
): EditPlanApplyEligibility {
  const reasons: string[] = [];
  if (scan.status !== "success") {
    reasons.push(`readonly_scan_status:${scan.status}`);
  }
  if (operations.some((operation) => operation.kind === "match_only")) {
    reasons.push("unfixable_rule");
  }
  if (conflictDiagnostics.length > 0) {
    reasons.push("conflict_diagnostics_present");
  }
  if (!previewDiff.available) {
    reasons.push(`preview_diff:${previewDiff.unavailableReason ?? "unavailable"}`);
  }

  if (
    scan.status === "invalid_rule" ||
    scan.status === "invalid_input" ||
    scan.status === "scan_failed" ||
    scan.status === "skipped"
  ) {
    return { status: "ineligible", reasons, descriptiveOnly: true };
  }
  if (operations.some((operation) => operation.kind === "match_only")) {
    return { status: "ineligible", reasons, descriptiveOnly: true };
  }
  if (scan.status !== "success" || conflictDiagnostics.length > 0 || !previewDiff.available) {
    return { status: "review_required", reasons, descriptiveOnly: true };
  }
  return {
    status: "eligible_after_verification",
    reasons: ["explicit_evidence_verifier_review_required"],
    descriptiveOnly: true,
  };
}

function isConflictDiagnostic(code: string): boolean {
  return code === "overlapping_ranges" || code === "match_limit_exceeded";
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [ref];
  });
}
