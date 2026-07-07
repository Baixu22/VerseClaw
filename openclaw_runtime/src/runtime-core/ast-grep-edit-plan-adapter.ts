import { createHash } from "node:crypto";
import { Lang, parse, type SgNode } from "@ast-grep/napi";
import type { EvidenceRef } from "./evidence.js";
import {
  EDIT_PLAN_AUTHORITY_BOUNDARY,
  type EditPlan,
  type EditPlanApplyEligibility,
  type EditPlanConflictDiagnostic,
  type EditPlanMatchEvidence,
  type EditPlanOperation,
  type EditPlanPreviewDiffMetadata,
  type EditPlanSourceScope,
  type EditPlanTargetFile,
  type EditPlanVerifierRequirement,
  type EditPlanVerifierRequirements,
} from "./ast-edit-plan.js";
import type { AstPatchPlannerLanguage, AstPatchPlannerRange } from "./ast-patch-planner.js";
import type { RuntimeCoreJsonObject, RuntimeCoreJsonValue } from "./types.js";

export type AstGrepEditPlanRule = {
  id?: string;
  language: AstPatchPlannerLanguage;
  pattern: string;
  fix?: string;
  constraints?: Record<string, string | { regex: string }>;
  message?: string;
  severity?: string;
};

export type AstGrepEditPlanTargetFile = {
  filePath: string;
  content: string;
  language?: AstPatchPlannerLanguage;
};

export type AstGrepEditPlanDiagnosticCode =
  | "invalid_rule"
  | "invalid_language"
  | "invalid_pattern"
  | "invalid_fix"
  | "invalid_constraint"
  | "unbound_metavariable"
  | "unsupported_transform"
  | "overbroad_pattern"
  | "invalid_target_files"
  | "target_language_mismatch"
  | "parse_error"
  | "match_limit_exceeded"
  | "overlapping_ranges"
  | "unfixable_rule"
  | "preview_diff_truncated"
  | "diagnostics_truncated"
  | "source_hash_drift"
  | "match_count_drift"
  | "match_range_drift"
  | "preview_diff_hash_drift";

export type AstGrepEditPlanDiagnostic = {
  code: AstGrepEditPlanDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  filePath?: string;
  range?: AstPatchPlannerRange;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AstGrepEditPlanCheckpoint = {
  schemaVersion: 1;
  ruleHash: string;
  targetFiles: {
    filePath: string;
    language: AstPatchPlannerLanguage;
    sourceHash: string;
  }[];
  matchCount: number;
  matchRanges: {
    matchId: string;
    filePath: string;
    start: number;
    end: number;
    excerptHash: string;
    replacementHash?: string;
  }[];
  previewDiffHash: string;
  sourceFileHashes: Record<string, string>;
};

export type AstGrepEditPlanAdapterInput = {
  rule: unknown;
  targetFiles: readonly AstGrepEditPlanTargetFile[];
  sourceScope?: Partial<EditPlanSourceScope>;
  maxMatches?: number;
  maxDiagnostics?: number;
  maxPreviewDiffBytes?: number;
};

export type AstGrepEditPlanAdapterResult = {
  schemaVersion: 1;
  source: "runtime.ast_grep_edit_plan_adapter.readonly_candidate_generation";
  status:
    | "invalid_rule"
    | "invalid_input"
    | "scan_failed"
    | "success"
    | "review_required";
  mode: "readonly_scan";
  editPlan: EditPlan;
  checkpoint?: AstGrepEditPlanCheckpoint;
  diagnostics: AstGrepEditPlanDiagnostic[];
  evidenceRefs: EvidenceRef[];
};

export type AstGrepEditPlanResumeDriftInput = AstGrepEditPlanAdapterInput & {
  checkpoint: AstGrepEditPlanCheckpoint;
};

export type AstGrepEditPlanResumeDriftResult = {
  schemaVersion: 1;
  source: "runtime.ast_grep_edit_plan_adapter.resume_drift";
  status: "stable" | "review_required" | "invalid";
  scan: AstGrepEditPlanAdapterResult;
  diagnostics: AstGrepEditPlanDiagnostic[];
  evidenceRefs: EvidenceRef[];
};

type RuleValidation =
  | {
      status: "accepted";
      rule: AstGrepEditPlanRule;
      ruleHash: string;
      patternMetavariables: string[];
      fixMetavariables: string[];
      diagnostics: AstGrepEditPlanDiagnostic[];
      evidenceRefs: EvidenceRef[];
    }
  | {
      status: "rejected";
      ruleHash: string;
      diagnostics: AstGrepEditPlanDiagnostic[];
      evidenceRefs: EvidenceRef[];
    };

type ConstraintMatcher = {
  variable: string;
  regex: RegExp;
};

type PreparedTarget = AstGrepEditPlanTargetFile & {
  language: AstPatchPlannerLanguage;
  sourceHash: string;
};

type CandidateMatch = EditPlanMatchEvidence & {
  replacementPreview?: string;
  replacementHash?: string;
};

type Replacement = {
  start: number;
  end: number;
  text: string;
};

const AST_GREP_ADAPTER_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref: "openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts",
  label: "ast-grep readonly EditPlan candidate adapter",
};

const METAVARIABLE_RE = /\$([A-Z_][A-Z0-9_]*)/gu;
const UNSUPPORTED_RULE_KEYS = ["transform", "transforms", "rewriters", "utils"] as const;

export function generateAstGrepEditPlanReadonlyCandidates(
  input: AstGrepEditPlanAdapterInput,
): AstGrepEditPlanAdapterResult {
  const maxDiagnostics = normalizeLimit(input.maxDiagnostics, 32);
  const validation = validateAstGrepEditPlanRule(input.rule, { maxDiagnostics });
  const diagnostics: AstGrepEditPlanDiagnostic[] = [...validation.diagnostics];
  const emptyTargets = emptyTargetData(input.targetFiles);
  const base = (params: {
    status: AstGrepEditPlanAdapterResult["status"];
    targetFiles?: PreparedTarget[];
    matches?: CandidateMatch[];
    diagnostics?: AstGrepEditPlanDiagnostic[];
    checkpoint?: AstGrepEditPlanCheckpoint;
    previewDiff?: EditPlanPreviewDiffMetadata;
  }): AstGrepEditPlanAdapterResult => {
    const allDiagnostics = limitDiagnostics([
      ...diagnostics,
      ...(params.diagnostics ?? []),
    ], maxDiagnostics);
    const targetFiles = params.targetFiles ?? emptyTargets;
    const matches = params.matches ?? [];
    const sourceHashes = Object.fromEntries(targetFiles.map((target) => [
      target.filePath,
      target.sourceHash,
    ]));
    const previewDiff = params.previewDiff ?? unavailablePreview(params.status, false);
    const conflictDiagnostics = allDiagnostics
      .filter((item) => isConflictDiagnostic(item.code))
      .map(toEditPlanDiagnostic);
    const editPlanDiagnostics = allDiagnostics.map(toEditPlanDiagnostic);
    const evidenceRefs = uniqueEvidenceRefs([
      AST_GREP_ADAPTER_EVIDENCE_REF,
      ...validation.evidenceRefs,
      ...allDiagnostics.flatMap((item) => item.evidenceRefs),
      ...matches.flatMap((match) => match.evidenceRefs),
      ...(input.sourceScope?.evidenceRefs ?? []),
    ]);
    const orderedOperations = matches.map(toOperation);
    const sourceScope = buildSourceScope(input.sourceScope, targetFiles);
    const applyEligibility = deriveApplyEligibility(
      params.status,
      orderedOperations,
      conflictDiagnostics,
      previewDiff,
    );
    const editPlan = buildEditPlan({
      status: params.status,
      validation,
      sourceScope,
      targetFiles,
      sourceHashes,
      matches,
      orderedOperations,
      conflictDiagnostics,
      diagnostics: editPlanDiagnostics,
      previewDiff,
      applyEligibility,
      evidenceRefs,
    });
    return {
      schemaVersion: 1,
      source: "runtime.ast_grep_edit_plan_adapter.readonly_candidate_generation",
      status: params.status,
      mode: "readonly_scan",
      editPlan,
      ...(params.checkpoint ? { checkpoint: params.checkpoint } : {}),
      diagnostics: allDiagnostics,
      evidenceRefs,
    };
  };

  if (validation.status === "rejected") {
    return base({ status: "invalid_rule" });
  }

  const targets = prepareTargetFiles(input.targetFiles, validation.rule.language);
  if ("diagnostics" in targets) {
    return base({
      status: "invalid_input",
      diagnostics: targets.diagnostics,
    });
  }

  let matches: CandidateMatch[];
  try {
    matches = scanTargets(targets, validation.rule, validation);
  } catch (error) {
    return base({
      status: "scan_failed",
      targetFiles: targets,
      diagnostics: [
        diagnostic({
          code: "parse_error",
          severity: "error",
          message: "ast-grep readonly candidate generation failed while parsing or matching.",
          metadata: { error: error instanceof Error ? error.message : String(error) },
        }),
      ],
    });
  }

  const orderedMatches = orderMatches(dedupeMatches(matches));
  const maxMatches = normalizeLimit(input.maxMatches, 64);
  if (orderedMatches.length > maxMatches) {
    const keptMatches = orderedMatches.slice(0, maxMatches);
    const checkpoint = buildCheckpoint(validation.ruleHash, targets, keptMatches, undefined);
    return base({
      status: "review_required",
      targetFiles: targets,
      matches: keptMatches,
      checkpoint,
      diagnostics: [
        diagnostic({
          code: "match_limit_exceeded",
          severity: "error",
          message: "ast-grep match count exceeded the readonly candidate safety limit.",
          metadata: { matchCount: orderedMatches.length, maxMatches },
        }),
      ],
    });
  }

  if (validation.rule.fix === undefined) {
    const checkpoint = buildCheckpoint(validation.ruleHash, targets, orderedMatches, undefined);
    return base({
      status: "success",
      targetFiles: targets,
      matches: orderedMatches,
      checkpoint,
      diagnostics: orderedMatches.length > 0
        ? [
            diagnostic({
              code: "unfixable_rule",
              severity: "info",
              message: "ast-grep rule has no fix; readonly adapter returned match evidence only.",
            }),
          ]
        : [],
    });
  }

  const overlap = findFirstOverlap(orderedMatches);
  if (overlap) {
    const checkpoint = buildCheckpoint(validation.ruleHash, targets, orderedMatches, undefined);
    return base({
      status: "review_required",
      targetFiles: targets,
      matches: orderedMatches,
      checkpoint,
      diagnostics: [
        diagnostic({
          code: "overlapping_ranges",
          severity: "error",
          message: "ast-grep readonly adapter detected overlapping candidate ranges.",
          filePath: overlap.filePath,
          range: overlap.range,
          metadata: { firstMatchId: overlap.firstMatchId, secondMatchId: overlap.secondMatchId },
        }),
      ],
    });
  }

  const preview = buildPreviewDiff(
    targets,
    orderedMatches,
    normalizeLimit(input.maxPreviewDiffBytes, 20_000),
  );
  const checkpoint = buildCheckpoint(validation.ruleHash, targets, orderedMatches, preview.diff);
  return base({
    status: "success",
    targetFiles: targets,
    matches: orderedMatches,
    checkpoint,
    previewDiff: preview.diff,
    diagnostics: preview.diagnostics,
  });
}

export function checkAstGrepEditPlanResumeDrift(
  input: AstGrepEditPlanResumeDriftInput,
): AstGrepEditPlanResumeDriftResult {
  const scan = generateAstGrepEditPlanReadonlyCandidates(input);
  const nextCheckpoint = scan.checkpoint;
  const diagnostics: AstGrepEditPlanDiagnostic[] = [];
  if (!nextCheckpoint) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "ast-grep resume check could not rebuild readonly checkpoint data.",
      metadata: { scanStatus: scan.status },
    }));
    return resumeResult("invalid", scan, diagnostics);
  }

    if (input.checkpoint.sourceFileHashes && stableStringify(input.checkpoint.sourceFileHashes) !== stableStringify(nextCheckpoint.sourceFileHashes)) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "ast-grep target source hashes changed since checkpoint.",
    }));
  }
  if (input.checkpoint.matchCount !== nextCheckpoint.matchCount) {
    diagnostics.push(diagnostic({
      code: "match_count_drift",
      severity: "error",
      message: "ast-grep match count changed since checkpoint.",
      metadata: {
        previous: input.checkpoint.matchCount,
        next: nextCheckpoint.matchCount,
      },
    }));
  }
  if (stableStringify(input.checkpoint.matchRanges) !== stableStringify(nextCheckpoint.matchRanges)) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "ast-grep match ranges changed since checkpoint.",
    }));
  }
  if (input.checkpoint.previewDiffHash !== nextCheckpoint.previewDiffHash) {
    diagnostics.push(diagnostic({
      code: "preview_diff_hash_drift",
      severity: "error",
      message: "ast-grep preview diff hash changed since checkpoint.",
    }));
  }

  return resumeResult(diagnostics.length > 0 ? "review_required" : "stable", scan, diagnostics);
}

function validateAstGrepEditPlanRule(
  rule: unknown,
  options: { maxDiagnostics?: number } = {},
): RuleValidation {
  const diagnostics: AstGrepEditPlanDiagnostic[] = [];
  const ruleHash = digest(stableStringify(rule));
  const record = recordFrom(rule);
  if (record !== rule) {
    diagnostics.push(diagnostic({
      code: "invalid_rule",
      severity: "error",
      message: "ast-grep EditPlan rule must be an object.",
    }));
    return rejectedRule(ruleHash, diagnostics, options.maxDiagnostics);
  }

  const language = record.language;
  if (language !== "typescript" && language !== "tsx") {
    diagnostics.push(diagnostic({
      code: "invalid_language",
      severity: "error",
      message: "ast-grep EditPlan adapter supports only TypeScript and TSX languages.",
      metadata: { supported: ["typescript", "tsx"] },
    }));
  }

  const pattern = record.pattern;
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    diagnostics.push(diagnostic({
      code: "invalid_pattern",
      severity: "error",
      message: "ast-grep EditPlan rule requires a non-empty pattern string.",
    }));
  } else if (pattern.includes("$$")) {
    diagnostics.push(diagnostic({
      code: "invalid_pattern",
      severity: "error",
      message: "ast-grep EditPlan adapter accepts single-node metavariables only in this phase.",
    }));
  } else if (isOverbroadPattern(pattern)) {
    diagnostics.push(diagnostic({
      code: "overbroad_pattern",
      severity: "error",
      message: "ast-grep EditPlan adapter rejected an overbroad pattern.",
      metadata: { patternHash: digest(pattern) },
    }));
  }

  const fix = record.fix;
  if (fix !== undefined && typeof fix !== "string") {
    diagnostics.push(diagnostic({
      code: "invalid_fix",
      severity: "error",
      message: "ast-grep EditPlan fix must be a string when provided.",
    }));
  }

  for (const key of UNSUPPORTED_RULE_KEYS) {
    if (record[key] !== undefined) {
      diagnostics.push(diagnostic({
        code: "unsupported_transform",
        severity: "error",
        message: "ast-grep EditPlan readonly adapter does not support transforms or rewrite utilities.",
        metadata: { key },
      }));
    }
  }

  const patternMetavariables = typeof pattern === "string" ? extractMetavariables(pattern) : [];
  const fixMetavariables = typeof fix === "string" ? extractMetavariables(fix) : [];
  const patternVariableSet = new Set(patternMetavariables);
  for (const name of fixMetavariables) {
    if (!patternVariableSet.has(name)) {
      diagnostics.push(diagnostic({
        code: "unbound_metavariable",
        severity: "error",
        message: "ast-grep EditPlan fix references a metavariable not bound by the pattern.",
        metadata: { metavariable: name },
      }));
    }
  }
  parseConstraintMatchers(record.constraints, patternVariableSet, diagnostics);

  const boundedDiagnostics = limitDiagnostics(diagnostics, options.maxDiagnostics);
  if (boundedDiagnostics.some((item) => item.severity === "error")) {
    return rejectedRule(ruleHash, boundedDiagnostics, options.maxDiagnostics);
  }
  return {
    status: "accepted",
    rule: {
      ...(typeof record.id === "string" ? { id: record.id } : {}),
      language: language as AstPatchPlannerLanguage,
      pattern: pattern as string,
      ...(typeof fix === "string" ? { fix } : {}),
      ...(record.constraints !== undefined
        ? { constraints: record.constraints as AstGrepEditPlanRule["constraints"] }
        : {}),
      ...(typeof record.message === "string" ? { message: record.message } : {}),
      ...(typeof record.severity === "string" ? { severity: record.severity } : {}),
    },
    ruleHash,
    patternMetavariables: unique(patternMetavariables),
    fixMetavariables: unique(fixMetavariables),
    diagnostics: boundedDiagnostics,
    evidenceRefs: [AST_GREP_ADAPTER_EVIDENCE_REF],
  };
}

function scanTargets(
  targets: PreparedTarget[],
  rule: AstGrepEditPlanRule,
  validation: Extract<RuleValidation, { status: "accepted" }>,
): CandidateMatch[] {
  const constraints = parseConstraintMatchers(
    rule.constraints,
    new Set(validation.patternMetavariables),
    [],
  );
  const matches: CandidateMatch[] = [];
  for (const target of targets) {
    const root = parse(langFor(target.language), target.content);
    for (const node of root.root().findAll(rule.pattern)) {
      const metavariables = metavariableHashes(node, validation.patternMetavariables);
      if (!constraintsPass(metavariables, constraints)) {
        continue;
      }
      const replacement = typeof rule.fix === "string" ? renderReplacement(rule.fix, node) : undefined;
      const index = matches.length + 1;
      const text = node.text();
      matches.push({
        matchId: `match_${String(index).padStart(4, "0")}`,
        filePath: target.filePath,
        language: target.language,
        astKind: String(node.kind()),
        range: rangeFromNode(node),
        excerpt: boundText(text),
        excerptHash: digest(text),
        metavariableHashes: Object.fromEntries(
          Object.entries(metavariables).map(([name, value]) => [name, value.textHash]),
        ),
        ...(replacement === undefined
          ? {}
          : {
              replacementPreview: boundText(replacement),
              replacementHash: digest(replacement),
            }),
        evidenceRefs: [AST_GREP_ADAPTER_EVIDENCE_REF],
      });
    }
  }
  return matches;
}

function prepareTargetFiles(
  targetFiles: readonly AstGrepEditPlanTargetFile[],
  ruleLanguage: AstPatchPlannerLanguage,
): PreparedTarget[] | { diagnostics: AstGrepEditPlanDiagnostic[] } {
  const diagnostics: AstGrepEditPlanDiagnostic[] = [];
  if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
    diagnostics.push(diagnostic({
      code: "invalid_target_files",
      severity: "error",
      message: "ast-grep EditPlan adapter requires explicit caller-owned target files.",
    }));
    return { diagnostics };
  }

  const prepared = targetFiles.flatMap((file): PreparedTarget[] => {
    if (
      typeof file.filePath !== "string" ||
      file.filePath.trim().length === 0 ||
      file.filePath.includes("*") ||
      typeof file.content !== "string"
    ) {
      diagnostics.push(diagnostic({
        code: "invalid_target_files",
        severity: "error",
        message: "ast-grep EditPlan target files must include explicit filePath and in-memory content.",
        metadata: { filePath: typeof file.filePath === "string" ? file.filePath : "<invalid>" },
      }));
      return [];
    }
    const filePath = normalizeFilePath(file.filePath);
    const language = file.language ?? languageFromFilePath(filePath);
    if (!language) {
      diagnostics.push(diagnostic({
        code: "invalid_target_files",
        severity: "error",
        message: "ast-grep EditPlan target file language must be TypeScript or TSX.",
        filePath,
      }));
      return [];
    }
    if (language !== ruleLanguage) {
      diagnostics.push(diagnostic({
        code: "target_language_mismatch",
        severity: "error",
        message: "ast-grep EditPlan target language must match the rule language.",
        filePath,
        metadata: { ruleLanguage, targetLanguage: language },
      }));
      return [];
    }
    return [{
      ...file,
      filePath,
      language,
      sourceHash: digest(file.content),
    }];
  }).sort((left, right) => left.filePath.localeCompare(right.filePath));

  return diagnostics.length > 0 ? { diagnostics } : prepared;
}

function buildEditPlan(params: {
  status: AstGrepEditPlanAdapterResult["status"];
  validation: RuleValidation;
  sourceScope: EditPlanSourceScope;
  targetFiles: PreparedTarget[];
  sourceHashes: Record<string, string>;
  matches: CandidateMatch[];
  orderedOperations: EditPlanOperation[];
  conflictDiagnostics: EditPlanConflictDiagnostic[];
  diagnostics: EditPlanConflictDiagnostic[];
  previewDiff: EditPlanPreviewDiffMetadata;
  applyEligibility: EditPlanApplyEligibility;
  evidenceRefs: EvidenceRef[];
}): EditPlan {
  const targetFiles: EditPlanTargetFile[] = params.targetFiles.map((file) => ({
    filePath: file.filePath,
    language: file.language,
    sourceHash: file.sourceHash,
  }));
  const planCore = {
    engineId: "runtime.ast_grep.napi.readonly_candidate_generation",
    status: params.status,
    ruleHash: params.validation.ruleHash,
    sourceScope: params.sourceScope,
    targetFiles,
    sourceHashes: params.sourceHashes,
    matchRanges: params.matches.map((match) => ({
      filePath: match.filePath,
      start: match.range.start,
      end: match.range.end,
      excerptHash: match.excerptHash,
      replacementHash: match.replacementHash ?? "",
    })),
    diagnostics: params.diagnostics.map((item) => item.code),
    previewDiffHash: params.previewDiff.hash ?? "",
  };

  return {
    schemaVersion: 1,
    planId: `edit_plan_${digest(stableStringify(planCore)).slice(0, 24)}`,
    engineId: planCore.engineId,
    source: {
      kind: "ast_grep_readonly_adapter",
      mode: "readonly_scan",
      prototypeOnly: false,
      productionEngine: false,
    },
    mode: "readonly_scan",
    sourceScope: params.sourceScope,
    targetFiles,
    sourceHashes: params.sourceHashes,
    matchEvidence: params.matches.map(({ replacementPreview: _preview, replacementHash: _hash, ...match }) => match),
    orderedOperations: params.orderedOperations,
    conflictDiagnostics: params.conflictDiagnostics,
    diagnostics: params.diagnostics,
    previewDiff: params.previewDiff,
    verifierRequirements: buildVerifierRequirements({
      evidenceRefs: params.evidenceRefs,
      sourceHashes: params.sourceHashes,
      matches: params.matches,
      operations: params.orderedOperations,
      conflictDiagnostics: params.conflictDiagnostics,
      previewDiff: params.previewDiff,
    }),
    applyEligibility: params.applyEligibility,
    authority: EDIT_PLAN_AUTHORITY_BOUNDARY,
    evidenceRefs: params.evidenceRefs,
  };
}

function buildVerifierRequirements(params: {
  evidenceRefs: EvidenceRef[];
  sourceHashes: Record<string, string>;
  matches: CandidateMatch[];
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
        params.conflictDiagnostics.map((item) => item.code),
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
  status: EditPlanVerifierRequirement["status"],
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

function toOperation(match: CandidateMatch, index: number): EditPlanOperation {
  const base = {
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
      ...base,
      kind: "replace_range",
      replacementHash: match.replacementHash,
      ...(match.replacementPreview ? { replacementPreview: match.replacementPreview } : {}),
    };
  }
  return {
    ...base,
    kind: "match_only",
    reason: "unfixable_rule",
  };
}

function deriveApplyEligibility(
  status: AstGrepEditPlanAdapterResult["status"],
  operations: readonly EditPlanOperation[],
  conflictDiagnostics: readonly EditPlanConflictDiagnostic[],
  previewDiff: EditPlanPreviewDiffMetadata,
): EditPlanApplyEligibility {
  const reasons: string[] = [];
  if (status !== "success") {
    reasons.push(`ast_grep_status:${status}`);
  }
  if (operations.length === 0) {
    reasons.push("no_candidate_operations");
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

  if (status === "invalid_rule" || status === "invalid_input" || status === "scan_failed") {
    return { status: "ineligible", reasons, descriptiveOnly: true };
  }
  if (operations.some((operation) => operation.kind === "match_only")) {
    return { status: "ineligible", reasons, descriptiveOnly: true };
  }
  if (status !== "success" || operations.length === 0 || conflictDiagnostics.length > 0 || !previewDiff.available) {
    return { status: "review_required", reasons, descriptiveOnly: true };
  }
  return {
    status: "eligible_after_verification",
    reasons: ["explicit_evidence_verifier_review_required"],
    descriptiveOnly: true,
  };
}

function buildSourceScope(
  sourceScope: Partial<EditPlanSourceScope> | undefined,
  targetFiles: PreparedTarget[],
): EditPlanSourceScope {
  return {
    kind: sourceScope?.kind ?? "explicit_targets",
    targetFilePaths: sourceScope?.targetFilePaths ?? targetFiles.map((file) => file.filePath),
    description: sourceScope?.description ??
      "Caller-owned explicit in-memory ast-grep readonly candidate targets.",
    evidenceRefs: uniqueEvidenceRefs(sourceScope?.evidenceRefs ?? []),
  };
}

function buildPreviewDiff(
  targets: PreparedTarget[],
  matches: CandidateMatch[],
  maxPreviewDiffBytes: number,
): { diff: EditPlanPreviewDiffMetadata; diagnostics: AstGrepEditPlanDiagnostic[] } {
  const diagnostics: AstGrepEditPlanDiagnostic[] = [];
  const targetByPath = new Map(targets.map((target) => [target.filePath, target]));
  const replacementsByPath = new Map<string, Replacement[]>();
  for (const match of matches) {
    if (match.replacementPreview === undefined) {
      continue;
    }
    replacementsByPath.set(match.filePath, [
      ...(replacementsByPath.get(match.filePath) ?? []),
      {
        start: match.range.start,
        end: match.range.end,
        text: match.replacementPreview,
      },
    ]);
  }
  const fileDiffs = [...replacementsByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([filePath, replacements]) => {
      const target = targetByPath.get(filePath);
      if (!target) {
        return [];
      }
      const after = renderContentWithReplacements(target.content, replacements);
      const text = previewDiffForFile(filePath, target.content, after);
      return text
        ? [{
            filePath,
            text,
            diffHash: digest(text),
            byteLength: byteLength(text),
          }]
        : [];
    });
  const fullText = fileDiffs.map((item) => item.text).join("\n");
  const fullByteLength = byteLength(fullText);
  const truncated = fullByteLength > maxPreviewDiffBytes;
  if (truncated) {
    diagnostics.push(diagnostic({
      code: "preview_diff_truncated",
      severity: "warning",
      message: "ast-grep preview diff metadata was bounded for diagnostics.",
      metadata: { fullByteLength, maxPreviewDiffBytes },
    }));
  }
  const text = truncated ? truncateByBytes(fullText, maxPreviewDiffBytes) : fullText;
  return {
    diff: {
      requested: true,
      available: true,
      hash: digest(fullText),
      fullByteLength,
      truncated,
      files: fileDiffs.map(({ filePath, diffHash, byteLength: fileByteLength }) => ({
        filePath,
        diffHash,
        byteLength: fileByteLength,
      })),
      ...(text.length === 0 ? { unavailableReason: undefined } : {}),
    },
    diagnostics,
  };
}

function unavailablePreview(
  status: AstGrepEditPlanAdapterResult["status"],
  fixPresent: boolean,
): EditPlanPreviewDiffMetadata {
  return {
    requested: true,
    available: false,
    files: [],
    unavailableReason: status === "success" && !fixPresent
      ? "unfixable_rule"
      : status === "review_required"
        ? "review_required"
        : "scan_not_successful",
  };
}

function buildCheckpoint(
  ruleHash: string,
  targets: PreparedTarget[],
  matches: CandidateMatch[],
  previewDiff: EditPlanPreviewDiffMetadata | undefined,
): AstGrepEditPlanCheckpoint {
  return {
    schemaVersion: 1,
    ruleHash,
    targetFiles: targets.map((target) => ({
      filePath: target.filePath,
      language: target.language,
      sourceHash: target.sourceHash,
    })),
    matchCount: matches.length,
    matchRanges: matches.map((match) => ({
      matchId: match.matchId,
      filePath: match.filePath,
      start: match.range.start,
      end: match.range.end,
      excerptHash: match.excerptHash,
      ...(match.replacementHash ? { replacementHash: match.replacementHash } : {}),
    })),
    previewDiffHash: previewDiff?.hash ?? "",
    sourceFileHashes: Object.fromEntries(targets.map((target) => [target.filePath, target.sourceHash])),
  };
}

function orderMatches(matches: CandidateMatch[]): CandidateMatch[] {
  return matches
    .sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.range.start - right.range.start ||
      left.range.end - right.range.end
    )
    .map((match, index) => ({
      ...match,
      matchId: `match_${String(index + 1).padStart(4, "0")}`,
    }));
}

function dedupeMatches(matches: CandidateMatch[]): CandidateMatch[] {
  const byRange = new Map<string, CandidateMatch>();
  for (const match of matches) {
    const key = [
      match.filePath,
      match.range.start,
      match.range.end,
      match.excerptHash,
      match.replacementHash ?? "",
    ].join(":");
    if (!byRange.has(key)) {
      byRange.set(key, match);
    }
  }
  return [...byRange.values()];
}

function findFirstOverlap(matches: readonly CandidateMatch[]):
  { filePath: string; range: AstPatchPlannerRange; firstMatchId: string; secondMatchId: string } | undefined {
  const byFile = new Map<string, CandidateMatch[]>();
  for (const match of matches) {
    byFile.set(match.filePath, [...(byFile.get(match.filePath) ?? []), match]);
  }
  for (const [filePath, fileMatches] of byFile) {
    const ordered = [...fileMatches].sort((left, right) => left.range.start - right.range.start);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const next = ordered[index];
      if (next.range.start < previous.range.end) {
        return {
          filePath,
          range: previous.range,
          firstMatchId: previous.matchId,
          secondMatchId: next.matchId,
        };
      }
    }
  }
  return undefined;
}

function parseConstraintMatchers(
  raw: unknown,
  patternVariables: Set<string>,
  diagnostics: AstGrepEditPlanDiagnostic[],
): ConstraintMatcher[] {
  if (raw === undefined) {
    return [];
  }
  const constraints = recordFrom(raw);
  if (constraints !== raw) {
    diagnostics.push(diagnostic({
      code: "invalid_constraint",
      severity: "error",
      message: "ast-grep EditPlan constraints must be an object.",
    }));
    return [];
  }
  return Object.entries(constraints).flatMap(([key, value]) => {
    const variable = key.startsWith("$") ? key.slice(1) : key;
    if (!patternVariables.has(variable)) {
      diagnostics.push(diagnostic({
        code: "unbound_metavariable",
        severity: "error",
        message: "ast-grep EditPlan constraint references an unbound metavariable.",
        metadata: { metavariable: variable },
      }));
      return [];
    }
    const regexSource = typeof value === "string"
      ? value
      : typeof recordFrom(value).regex === "string"
        ? String(recordFrom(value).regex)
        : undefined;
    if (!regexSource) {
      diagnostics.push(diagnostic({
        code: "invalid_constraint",
        severity: "error",
        message: "ast-grep EditPlan constraints require regex strings.",
        metadata: { metavariable: variable },
      }));
      return [];
    }
    try {
      return [{ variable, regex: new RegExp(regexSource, "u") }];
    } catch {
      diagnostics.push(diagnostic({
        code: "invalid_constraint",
        severity: "error",
        message: "ast-grep EditPlan constraint regex is invalid.",
        metadata: { metavariable: variable },
      }));
      return [];
    }
  });
}

function constraintsPass(
  metavariables: Record<string, { text: string; textHash: string }>,
  constraints: readonly ConstraintMatcher[],
): boolean {
  return constraints.every((constraint) =>
    constraint.regex.test(metavariables[constraint.variable]?.text ?? "")
  );
}

function metavariableHashes(
  node: SgNode,
  names: readonly string[],
): Record<string, { text: string; textHash: string }> {
  return Object.fromEntries(names.map((name) => {
    const match = node.getMatch(name);
    const text = match?.text() ?? "";
    return [name, { text: boundText(text), textHash: digest(text) }];
  }));
}

function renderReplacement(fix: string, node: SgNode): string {
  return fix.replace(METAVARIABLE_RE, (_match, name: string) => node.getMatch(name)?.text() ?? "");
}

function rangeFromNode(node: SgNode): AstPatchPlannerRange {
  const range = node.range();
  return {
    start: range.start.index,
    end: range.end.index,
    startLine: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
  };
}

function previewDiffForFile(filePath: string, before: string, after: string): string {
  if (before === after) {
    return "";
  }
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }
  const context = 3;
  const contextStart = Math.max(0, prefix - context);
  const beforeEnd = Math.min(beforeLines.length - 1, beforeSuffix + context);
  const afterEnd = Math.min(afterLines.length - 1, afterSuffix + context);
  const oldCount = beforeEnd - contextStart + 1;
  const nextCount = afterEnd - contextStart + 1;
  const lines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${nextCount} @@`,
  ];
  for (const line of beforeLines.slice(contextStart, prefix)) {
    lines.push(` ${line}`);
  }
  for (const line of beforeLines.slice(prefix, beforeSuffix + 1)) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines.slice(prefix, afterSuffix + 1)) {
    lines.push(`+${line}`);
  }
  for (const line of afterLines.slice(afterSuffix + 1, afterEnd + 1)) {
    lines.push(` ${line}`);
  }
  return lines.join("\n");
}

function renderContentWithReplacements(content: string, replacements: readonly Replacement[]): string {
  let next = content;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}

function resumeResult(
  status: AstGrepEditPlanResumeDriftResult["status"],
  scan: AstGrepEditPlanAdapterResult,
  diagnostics: AstGrepEditPlanDiagnostic[],
): AstGrepEditPlanResumeDriftResult {
  return {
    schemaVersion: 1,
    source: "runtime.ast_grep_edit_plan_adapter.resume_drift",
    status,
    scan,
    diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      AST_GREP_ADAPTER_EVIDENCE_REF,
      ...scan.evidenceRefs,
      ...diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
  };
}

function rejectedRule(
  ruleHash: string,
  diagnostics: AstGrepEditPlanDiagnostic[],
  maxDiagnostics: number | undefined,
): Extract<RuleValidation, { status: "rejected" }> {
  return {
    status: "rejected",
    ruleHash,
    diagnostics: limitDiagnostics(diagnostics, maxDiagnostics),
    evidenceRefs: [AST_GREP_ADAPTER_EVIDENCE_REF],
  };
}

function toEditPlanDiagnostic(diagnosticValue: AstGrepEditPlanDiagnostic): EditPlanConflictDiagnostic {
  return {
    code: diagnosticValue.code,
    severity: diagnosticValue.severity,
    message: diagnosticValue.message,
    ...(diagnosticValue.filePath ? { filePath: diagnosticValue.filePath } : {}),
    ...(diagnosticValue.range ? { range: diagnosticValue.range } : {}),
    ...(diagnosticValue.metadata ? { metadata: diagnosticValue.metadata } : {}),
    evidenceRefs: diagnosticValue.evidenceRefs,
  };
}

function diagnostic(params: {
  code: AstGrepEditPlanDiagnosticCode;
  severity: AstGrepEditPlanDiagnostic["severity"];
  message: string;
  filePath?: string;
  range?: AstPatchPlannerRange;
  metadata?: RuntimeCoreJsonObject;
}): AstGrepEditPlanDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.filePath ? { filePath: params.filePath } : {}),
    ...(params.range ? { range: params.range } : {}),
    evidenceRefs: [AST_GREP_ADAPTER_EVIDENCE_REF],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function emptyTargetData(
  targetFiles: readonly AstGrepEditPlanTargetFile[],
): PreparedTarget[] {
  return targetFiles.flatMap((file): PreparedTarget[] => {
    if (typeof file.filePath !== "string" || typeof file.content !== "string") {
      return [];
    }
    const filePath = normalizeFilePath(file.filePath);
    const language = file.language ?? languageFromFilePath(filePath);
    if (!language) {
      return [];
    }
    return [{
      ...file,
      filePath,
      language,
      sourceHash: digest(file.content),
    }];
  });
}

function languageFromFilePath(filePath: string): AstPatchPlannerLanguage | undefined {
  if (filePath.endsWith(".tsx")) {
    return "tsx";
  }
  if (filePath.endsWith(".ts")) {
    return "typescript";
  }
  return undefined;
}

function langFor(language: AstPatchPlannerLanguage): Lang {
  return language === "tsx" ? Lang.Tsx : Lang.TypeScript;
}

function isOverbroadPattern(pattern: string): boolean {
  const trimmed = pattern.trim().replace(/;$/u, "");
  if (/^\$[A-Z_][A-Z0-9_]*$/u.test(trimmed)) {
    return true;
  }
  const literalOnly = pattern.replace(METAVARIABLE_RE, " ");
  const anchors = literalOnly.match(/[A-Za-z_][A-Za-z0-9_.]*|<\s*[A-Za-z][A-Za-z0-9_]*/gu) ?? [];
  return anchors.filter((anchor) => anchor.replace(/[<\s]/gu, "").length > 1).length === 0;
}

function isConflictDiagnostic(code: string): boolean {
  return code === "overlapping_ranges" || code === "match_limit_exceeded";
}

function extractMetavariables(value: string): string[] {
  return [...value.matchAll(METAVARIABLE_RE)].map((match) => match[1]);
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
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

function limitDiagnostics(
  diagnostics: AstGrepEditPlanDiagnostic[],
  maxDiagnostics: number | undefined,
): AstGrepEditPlanDiagnostic[] {
  const limit = normalizeLimit(maxDiagnostics, 32);
  if (diagnostics.length <= limit) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, limit - 1)),
    diagnostic({
      code: "diagnostics_truncated",
      severity: "warning",
      message: "ast-grep EditPlan diagnostics were bounded.",
      metadata: { diagnosticCount: diagnostics.length, maxDiagnostics: limit },
    }),
  ];
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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateByBytes(value: string, maxBytes: number): string {
  let output = "";
  for (const char of value) {
    if (byteLength(`${output}${char}`) > maxBytes) {
      break;
    }
    output += char;
  }
  return output;
}

function boundText(value: string): string {
  return value.length > 512 ? `${value.slice(0, 512)}...` : value;
}
