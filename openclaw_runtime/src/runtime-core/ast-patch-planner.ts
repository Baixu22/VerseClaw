import { createHash } from "node:crypto";
import * as ts from "typescript";
import type { EvidenceRef } from "./evidence.js";
import type { RuntimeCoreJsonObject, RuntimeCoreJsonValue } from "./types.js";

export type AstPatchPlannerLanguage = "typescript" | "tsx";

export type AstPatchPlannerRule = {
  id?: string;
  language: AstPatchPlannerLanguage;
  pattern: string;
  fix?: string;
  constraints?: Record<string, string | { regex: string }>;
  message?: string;
  severity?: string;
};

export type AstPatchPlannerTargetFile = {
  filePath: string;
  content: string;
  language?: AstPatchPlannerLanguage;
};

export type AstPatchPlannerFlags = {
  readonlyScan: boolean;
  previewDiff: boolean;
};

export type AstPatchPlannerAuthorityBoundary = {
  diagnosticsOnly: true;
  readonly: true;
  noPatchApply: true;
  noWorkspaceMutation: true;
  noSymbolMutation: true;
  noTaskLoopInvocation: true;
  noGatewayIntegration: true;
  noProviderTransportChange: true;
  previewDiffOnly: true;
  previewDiffIsNotCompletionEvidence: true;
};

export type AstPatchPlannerRange = {
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type AstPatchPlannerDiagnosticCode =
  | "flag_disabled"
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
  | "preflight_budget_exceeded"
  | "parse_error"
  | "match_limit_exceeded"
  | "overlapping_ranges"
  | "unfixable_rule"
  | "preview_diff_disabled"
  | "preview_diff_truncated"
  | "diagnostics_truncated"
  | "rule_hash_drift"
  | "target_files_drift"
  | "source_hash_drift"
  | "match_count_drift"
  | "match_range_drift"
  | "preview_diff_hash_drift";

export type AstPatchPlannerDiagnostic = {
  code: AstPatchPlannerDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  filePath?: string;
  range?: AstPatchPlannerRange;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type AstPatchPlannerRuleValidationResult =
  | {
      status: "accepted";
      ruleHash: string;
      language: AstPatchPlannerLanguage;
      patternMetavariables: string[];
      fixMetavariables: string[];
      diagnostics: AstPatchPlannerDiagnostic[];
      evidenceRefs: EvidenceRef[];
    }
  | {
      status: "rejected";
      ruleHash: string;
      diagnostics: AstPatchPlannerDiagnostic[];
      evidenceRefs: EvidenceRef[];
    };

export type AstPatchPlannerMetavariableBinding = {
  text: string;
  textHash: string;
};

export type AstPatchPlannerMatchEvidence = {
  matchId: string;
  filePath: string;
  language: AstPatchPlannerLanguage;
  astKind: string;
  range: AstPatchPlannerRange;
  excerpt: string;
  excerptHash: string;
  metavariables: Record<string, AstPatchPlannerMetavariableBinding>;
  replacementPreview?: string;
  replacementHash?: string;
  evidenceRefs: EvidenceRef[];
};

export type AstPatchPlannerPreviewDiffFile = {
  filePath: string;
  diffHash: string;
  byteLength: number;
  previewText: string;
  previewTextByteLength: number;
  truncated: boolean;
  replacementCount: number;
};

export type AstPatchPlannerPreviewDiff = {
  text: string;
  hash: string;
  fullByteLength: number;
  truncated: boolean;
  files: AstPatchPlannerPreviewDiffFile[];
};

export type AstPatchPlannerCheckpoint = {
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

export type AstPatchPlannerReadonlyScanInput = {
  rule: unknown;
  targetFiles: readonly AstPatchPlannerTargetFile[];
  config?: unknown;
  maxTargetFiles?: number;
  maxSourceBytes?: number;
  maxEstimatedMatches?: number;
  maxMatches?: number;
  maxDiagnostics?: number;
  maxPreviewDiffBytes?: number;
};

export type AstPatchPlannerReadonlyScanResult = {
  schemaVersion: 1;
  source: "runtime.ast_patch_planner.readonly_scan";
  status:
    | "skipped"
    | "invalid_rule"
    | "invalid_input"
    | "scan_failed"
    | "success"
    | "review_required";
  mode: "readonly_scan";
  flags: AstPatchPlannerFlags;
  authority: AstPatchPlannerAuthorityBoundary;
  validation: AstPatchPlannerRuleValidationResult;
  matches: AstPatchPlannerMatchEvidence[];
  previewDiff?: AstPatchPlannerPreviewDiff;
  checkpoint?: AstPatchPlannerCheckpoint;
  diagnostics: AstPatchPlannerDiagnostic[];
  evidenceRefs: EvidenceRef[];
};

export type AstPatchPlannerResumeDriftInput = {
  checkpoint: AstPatchPlannerCheckpoint;
  rule: unknown;
  targetFiles: readonly AstPatchPlannerTargetFile[];
  config?: unknown;
  maxMatches?: number;
  maxDiagnostics?: number;
  maxPreviewDiffBytes?: number;
};

export type AstPatchPlannerResumeDriftResult = {
  schemaVersion: 1;
  source: "runtime.ast_patch_planner.resume_drift";
  status: "stable" | "review_required" | "invalid";
  authority: AstPatchPlannerAuthorityBoundary;
  scan: AstPatchPlannerReadonlyScanResult;
  diagnostics: AstPatchPlannerDiagnostic[];
  evidenceRefs: EvidenceRef[];
};

type CompiledPattern = {
  regex: RegExp;
  variables: string[];
  constraints: ConstraintMatcher[];
};

type ConstraintMatcher = {
  variable: string;
  regex: RegExp;
};

type Replacement = {
  matchId: string;
  start: number;
  end: number;
  text: string;
};

type PreparedTarget = AstPatchPlannerTargetFile & {
  language: AstPatchPlannerLanguage;
  sourceHash: string;
  sourceByteLength: number;
  lineStarts: number[];
};

type SourceFileWithParseDiagnostics = ts.SourceFile & {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
};

const RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF: EvidenceRef = {
  type: "file",
  ref: "openclaw_runtime/src/runtime-core/ast-patch-planner.ts",
  label: "AST patch planner readonly scan helper",
};

const AUTHORITY_BOUNDARY: AstPatchPlannerAuthorityBoundary = {
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
};

const METAVARIABLE_RE = /\$([A-Z_][A-Z0-9_]*)/gu;
const UNSUPPORTED_RULE_KEYS = ["transform", "transforms", "rewriters", "utils"] as const;
const DEFAULT_AST_PATCH_PLANNER_MAX_TARGET_FILES = 64;
const DEFAULT_AST_PATCH_PLANNER_MAX_SOURCE_BYTES = 250_000;
const AST_PATCH_PLANNER_MIN_FILE_PREVIEW_BYTES = 120;

export function resolveRuntimeAstPatchPlannerFlags(value: unknown): AstPatchPlannerFlags {
  const runtime = runtimeConfigFrom(value);
  const planner = recordFrom(runtime?.astPatchPlanner);
  return {
    readonlyScan: planner.readonlyScan === true,
    previewDiff: planner.previewDiff === true,
  };
}

export function validateAstPatchPlannerRule(
  rule: unknown,
  options: { maxDiagnostics?: number } = {},
): AstPatchPlannerRuleValidationResult {
  const diagnostics: AstPatchPlannerDiagnostic[] = [];
  const ruleHash = hashRuleConfig(rule);
  const record = recordFrom(rule);

  if (record !== rule) {
    diagnostics.push(diagnostic({
      code: "invalid_rule",
      severity: "error",
      message: "AST patch planner rule must be an object.",
    }));
    return rejectedRule(ruleHash, diagnostics, options.maxDiagnostics);
  }

  const language = record.language;
  if (language !== "typescript" && language !== "tsx") {
    diagnostics.push(diagnostic({
      code: "invalid_language",
      severity: "error",
      message: "AST patch planner MVP supports only TypeScript and TSX languages.",
      metadata: { supported: ["typescript", "tsx"] },
    }));
  }

  const pattern = record.pattern;
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    diagnostics.push(diagnostic({
      code: "invalid_pattern",
      severity: "error",
      message: "AST patch planner rule requires a non-empty pattern string.",
    }));
  } else if (pattern.includes("$$")) {
    diagnostics.push(diagnostic({
      code: "invalid_pattern",
      severity: "error",
      message: "AST patch planner MVP supports single-node metavariables only.",
    }));
  }

  const fix = record.fix;
  if (fix !== undefined && typeof fix !== "string") {
    diagnostics.push(diagnostic({
      code: "invalid_fix",
      severity: "error",
      message: "AST patch planner fix must be a string when provided.",
    }));
  }

  for (const key of UNSUPPORTED_RULE_KEYS) {
    if (record[key] !== undefined) {
      diagnostics.push(diagnostic({
        code: "unsupported_transform",
        severity: "error",
        message: "AST patch planner readonly scan does not support transforms or rewrite utilities.",
        metadata: { key },
      }));
    }
  }

  const patternMetavariables = typeof pattern === "string"
    ? extractMetavariables(pattern)
    : [];
  const fixMetavariables = typeof fix === "string" ? extractMetavariables(fix) : [];
  const duplicatePatternVariable = firstDuplicate(patternMetavariables);
  if (duplicatePatternVariable) {
    diagnostics.push(diagnostic({
      code: "invalid_pattern",
      severity: "error",
      message: "AST patch planner MVP requires each pattern metavariable to appear once.",
      metadata: { metavariable: duplicatePatternVariable },
    }));
  }

  if (typeof pattern === "string" && pattern.trim() && isOverbroadPattern(pattern)) {
    diagnostics.push(diagnostic({
      code: "overbroad_pattern",
      severity: "error",
      message: "AST patch planner rejected an overbroad pattern.",
      metadata: { patternHash: digest(pattern) },
    }));
  }

  const patternVariableSet = new Set(patternMetavariables);
  for (const name of fixMetavariables) {
    if (!patternVariableSet.has(name)) {
      diagnostics.push(diagnostic({
        code: "unbound_metavariable",
        severity: "error",
        message: "AST patch planner fix references a metavariable that is not bound by the pattern.",
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
    ruleHash,
    language: language as AstPatchPlannerLanguage,
    patternMetavariables: unique(patternMetavariables),
    fixMetavariables: unique(fixMetavariables),
    diagnostics: boundedDiagnostics,
    evidenceRefs: [RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF],
  };
}

export function scanAstPatchPlannerReadonly(
  input: AstPatchPlannerReadonlyScanInput,
): AstPatchPlannerReadonlyScanResult {
  const flags = resolveRuntimeAstPatchPlannerFlags(input.config);
  const maxDiagnostics = normalizeLimit(input.maxDiagnostics, 32);
  const validation = validateAstPatchPlannerRule(input.rule, { maxDiagnostics });
  const base = (params: {
    status: AstPatchPlannerReadonlyScanResult["status"];
    matches?: AstPatchPlannerMatchEvidence[];
    diagnostics?: AstPatchPlannerDiagnostic[];
    previewDiff?: AstPatchPlannerPreviewDiff;
    checkpoint?: AstPatchPlannerCheckpoint;
  }): AstPatchPlannerReadonlyScanResult => {
    const diagnostics = limitDiagnostics([
      ...validation.diagnostics,
      ...(params.diagnostics ?? []),
    ], maxDiagnostics);
    const evidenceRefs = uniqueEvidenceRefs([
      RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF,
      ...validation.evidenceRefs,
      ...diagnostics.flatMap((item) => item.evidenceRefs),
      ...(params.matches ?? []).flatMap((match) => match.evidenceRefs),
    ]);
    return {
      schemaVersion: 1,
      source: "runtime.ast_patch_planner.readonly_scan",
      status: params.status,
      mode: "readonly_scan",
      flags,
      authority: AUTHORITY_BOUNDARY,
      validation,
      matches: params.matches ?? [],
      ...(params.previewDiff ? { previewDiff: params.previewDiff } : {}),
      ...(params.checkpoint ? { checkpoint: params.checkpoint } : {}),
      diagnostics,
      evidenceRefs,
    };
  };

  if (!flags.readonlyScan) {
    return base({
      status: "skipped",
      diagnostics: [
        diagnostic({
          code: "flag_disabled",
          severity: "info",
          message: "AST patch planner readonly scan requires explicit runtime.astPatchPlanner.readonlyScan opt-in.",
          metadata: { flags },
        }),
      ],
    });
  }

  if (validation.status === "rejected") {
    return base({ status: "invalid_rule" });
  }

  const targets = prepareTargetFiles(input.targetFiles, validation.language);
  if ("diagnostics" in targets) {
    return base({
      status: "invalid_input",
      diagnostics: targets.diagnostics,
    });
  }

  const preflightDiagnostics = preflightAstReadonlyScan({
    rule: input.rule as AstPatchPlannerRule,
    targets,
    maxTargetFiles: normalizeLimit(input.maxTargetFiles, DEFAULT_AST_PATCH_PLANNER_MAX_TARGET_FILES),
    maxSourceBytes: normalizeLimit(input.maxSourceBytes, DEFAULT_AST_PATCH_PLANNER_MAX_SOURCE_BYTES),
    maxEstimatedMatches: normalizeLimit(input.maxEstimatedMatches ?? input.maxMatches, 64),
  });
  if (preflightDiagnostics.length > 0) {
    return base({
      status: "review_required",
      diagnostics: preflightDiagnostics,
    });
  }

  const compiled = compilePattern(input.rule as AstPatchPlannerRule, validation);
  const parseDiagnostics = parseTargets(targets);
  if (parseDiagnostics.length > 0) {
    return base({
      status: "scan_failed",
      diagnostics: parseDiagnostics,
    });
  }

  const matches = findMatches(targets, compiled, input.rule as AstPatchPlannerRule);
  const orderedMatches = orderMatches(dedupeMatches(matches));
  const maxMatches = normalizeLimit(input.maxMatches, 64);
  if (orderedMatches.length > maxMatches) {
    const keptMatches = orderedMatches.slice(0, maxMatches);
    const checkpoint = buildCheckpoint(
      validation.ruleHash,
      targets,
      keptMatches,
      undefined,
    );
    return base({
      status: "review_required",
      matches: keptMatches,
      checkpoint,
      diagnostics: [
        diagnostic({
          code: "match_limit_exceeded",
          severity: "error",
          message: "AST patch planner match count exceeded the readonly scan safety limit.",
          metadata: { matchCount: orderedMatches.length, maxMatches },
        }),
      ],
    });
  }

  const fix = (input.rule as AstPatchPlannerRule).fix;
  if (fix === undefined) {
    const checkpoint = buildCheckpoint(validation.ruleHash, targets, orderedMatches, undefined);
    return base({
      status: "success",
      matches: orderedMatches,
      checkpoint,
      diagnostics: orderedMatches.length > 0
        ? [
            diagnostic({
              code: "unfixable_rule",
              severity: "info",
              message: "AST patch planner rule has no fix; readonly scan returned match evidence only.",
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
      matches: orderedMatches,
      checkpoint,
      diagnostics: [
        diagnostic({
          code: "overlapping_ranges",
          severity: "error",
          message: "AST patch planner detected overlapping match ranges and stopped at review diagnostics.",
          filePath: overlap.filePath,
          range: overlap.range,
          metadata: { firstMatchId: overlap.firstMatchId, secondMatchId: overlap.secondMatchId },
        }),
      ],
    });
  }

  if (!flags.previewDiff) {
    const checkpoint = buildCheckpoint(validation.ruleHash, targets, orderedMatches, undefined);
    return base({
      status: "success",
      matches: orderedMatches,
      checkpoint,
      diagnostics: [
        diagnostic({
          code: "preview_diff_disabled",
          severity: "info",
          message: "AST patch planner preview diff requires explicit runtime.astPatchPlanner.previewDiff opt-in.",
          metadata: { flags },
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
    matches: orderedMatches,
    previewDiff: preview.diff,
    checkpoint,
    diagnostics: preview.diagnostics,
  });
}

export function checkAstPatchPlannerResumeDrift(
  input: AstPatchPlannerResumeDriftInput,
): AstPatchPlannerResumeDriftResult {
  const scan = scanAstPatchPlannerReadonly({
    rule: input.rule,
    targetFiles: input.targetFiles,
    config: input.config,
    maxMatches: input.maxMatches,
    maxDiagnostics: input.maxDiagnostics,
    maxPreviewDiffBytes: input.maxPreviewDiffBytes,
  });
  const diagnostics: AstPatchPlannerDiagnostic[] = [];
  const nextCheckpoint = scan.checkpoint;

  if (!nextCheckpoint) {
    diagnostics.push(diagnostic({
      code: "match_range_drift",
      severity: "error",
      message: "AST patch planner resume check could not rebuild readonly checkpoint data.",
      metadata: { scanStatus: scan.status },
    }));
    return resumeResult("invalid", scan, diagnostics);
  }

  if (input.checkpoint.ruleHash !== nextCheckpoint.ruleHash) {
    diagnostics.push(diagnostic({
      code: "rule_hash_drift",
      severity: "error",
      message: "AST patch planner rule hash changed since checkpoint.",
    }));
  }
  if (stableStringify(input.checkpoint.targetFiles) !== stableStringify(nextCheckpoint.targetFiles)) {
    diagnostics.push(diagnostic({
      code: "target_files_drift",
      severity: "error",
      message: "AST patch planner target file set changed since checkpoint.",
    }));
  }
  if (stableStringify(input.checkpoint.sourceFileHashes) !== stableStringify(nextCheckpoint.sourceFileHashes)) {
    diagnostics.push(diagnostic({
      code: "source_hash_drift",
      severity: "error",
      message: "AST patch planner source file hashes changed since checkpoint.",
    }));
  }
  if (input.checkpoint.matchCount !== nextCheckpoint.matchCount) {
    diagnostics.push(diagnostic({
      code: "match_count_drift",
      severity: "error",
      message: "AST patch planner match count changed since checkpoint.",
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
      message: "AST patch planner match ranges changed since checkpoint.",
    }));
  }
  if (input.checkpoint.previewDiffHash !== nextCheckpoint.previewDiffHash) {
    diagnostics.push(diagnostic({
      code: "preview_diff_hash_drift",
      severity: "error",
      message: "AST patch planner preview diff hash changed since checkpoint.",
    }));
  }

  return resumeResult(diagnostics.length > 0 ? "review_required" : "stable", scan, diagnostics);
}

function rejectedRule(
  ruleHash: string,
  diagnostics: AstPatchPlannerDiagnostic[],
  maxDiagnostics: number | undefined,
): Extract<AstPatchPlannerRuleValidationResult, { status: "rejected" }> {
  return {
    status: "rejected",
    ruleHash,
    diagnostics: limitDiagnostics(diagnostics, maxDiagnostics),
    evidenceRefs: [RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF],
  };
}

function prepareTargetFiles(
  targetFiles: readonly AstPatchPlannerTargetFile[],
  ruleLanguage: AstPatchPlannerLanguage,
): PreparedTarget[] | { diagnostics: AstPatchPlannerDiagnostic[] } {
  const diagnostics: AstPatchPlannerDiagnostic[] = [];
  if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
    diagnostics.push(diagnostic({
      code: "invalid_target_files",
      severity: "error",
      message: "AST patch planner readonly scan requires explicit target files.",
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
        message: "AST patch planner target files must have explicit filePath and content.",
      }));
      return [];
    }

    const detectedLanguage = file.language ?? languageFromFilePath(file.filePath);
    if (!detectedLanguage) {
      diagnostics.push(diagnostic({
        code: "invalid_target_files",
        severity: "error",
        message: "AST patch planner target files must be TypeScript or TSX files.",
        filePath: file.filePath,
      }));
      return [];
    }
    if (detectedLanguage !== ruleLanguage) {
      diagnostics.push(diagnostic({
        code: "target_language_mismatch",
        severity: "error",
        message: "AST patch planner target language must match the rule language.",
        filePath: file.filePath,
        metadata: { ruleLanguage, targetLanguage: detectedLanguage },
      }));
      return [];
    }

    return [{
      ...file,
      language: detectedLanguage,
      filePath: normalizeFilePath(file.filePath),
      sourceHash: digest(file.content),
      sourceByteLength: byteLength(file.content),
      lineStarts: computeLineStarts(file.content),
    }];
  });

  return diagnostics.length > 0
    ? { diagnostics }
    : prepared.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function preflightAstReadonlyScan(params: {
  rule: AstPatchPlannerRule;
  targets: PreparedTarget[];
  maxTargetFiles: number;
  maxSourceBytes: number;
  maxEstimatedMatches: number;
}): AstPatchPlannerDiagnostic[] {
  const sourceBytes = sumNumbers(params.targets.map((target) => target.sourceByteLength));
  const estimatedMatches = estimateReadonlyCandidateMatches(params.rule, params.targets);
  const exceeded = [
    params.targets.length > params.maxTargetFiles ? "target_files" : undefined,
    sourceBytes > params.maxSourceBytes ? "source_bytes" : undefined,
    estimatedMatches > params.maxEstimatedMatches ? "estimated_matches" : undefined,
  ].filter((item): item is string => item !== undefined);

  if (exceeded.length === 0) {
    return [];
  }

  return [diagnostic({
    code: "preflight_budget_exceeded",
    severity: "error",
    message: "AST patch planner preflight rejected an oversized readonly scan before parsing target sources.",
    metadata: {
      exceeded,
      targetFileCount: params.targets.length,
      maxTargetFiles: params.maxTargetFiles,
      sourceBytes,
      maxSourceBytes: params.maxSourceBytes,
      estimatedMatches,
      maxEstimatedMatches: params.maxEstimatedMatches,
      suggestedBatchCount: Math.max(
        1,
        Math.ceil(estimatedMatches / Math.max(1, params.maxEstimatedMatches)),
        Math.ceil(params.targets.length / Math.max(1, params.maxTargetFiles)),
        Math.ceil(sourceBytes / Math.max(1, params.maxSourceBytes)),
      ),
    },
  })];
}

function estimateReadonlyCandidateMatches(
  rule: AstPatchPlannerRule,
  targets: readonly PreparedTarget[],
): number {
  const anchor = strongestLiteralAnchor(rule.pattern);
  if (!anchor) {
    return Number.POSITIVE_INFINITY;
  }
  return sumNumbers(targets.map((target) => countOccurrences(target.content, anchor)));
}

function strongestLiteralAnchor(pattern: string): string | undefined {
  return pattern
    .split(METAVARIABLE_RE)
    .map((part) => part.trim())
    .filter((part) => /[A-Za-z0-9_]/u.test(part))
    .sort((left, right) => right.length - left.length)[0];
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    const index = value.indexOf(needle, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + Math.max(1, needle.length);
  }
  return count;
}

function parseTargets(targets: PreparedTarget[]): AstPatchPlannerDiagnostic[] {
  return targets.flatMap((target) => {
    const sourceFile = createSourceFile(target) as SourceFileWithParseDiagnostics;
    return (sourceFile.parseDiagnostics ?? []).slice(0, 8).map((item) => {
      const start = typeof item.start === "number" ? item.start : 0;
      const end = start + (typeof item.length === "number" ? item.length : 0);
      return diagnostic({
        code: "parse_error",
        severity: "error",
        message: ts.flattenDiagnosticMessageText(item.messageText, "\n"),
        filePath: target.filePath,
        range: rangeForOffsets(target, start, end),
      });
    });
  });
}

function compilePattern(
  rule: AstPatchPlannerRule,
  validation: Extract<AstPatchPlannerRuleValidationResult, { status: "accepted" }>,
): CompiledPattern {
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of rule.pattern.matchAll(METAVARIABLE_RE)) {
    parts.push(compileLiteral(rule.pattern.slice(lastIndex, match.index)));
    parts.push(`(?<${match[1]}>[\\s\\S]+?)`);
    lastIndex = match.index + match[0].length;
  }
  parts.push(compileLiteral(rule.pattern.slice(lastIndex)));
  const regex = new RegExp(`^${parts.join("")}$`, "u");
  const diagnostics: AstPatchPlannerDiagnostic[] = [];
  const constraints = parseConstraintMatchers(
    recordFrom(rule).constraints,
    new Set(validation.patternMetavariables),
    diagnostics,
  );
  return { regex, variables: validation.patternMetavariables, constraints };
}

function findMatches(
  targets: PreparedTarget[],
  compiled: CompiledPattern,
  rule: AstPatchPlannerRule,
): AstPatchPlannerMatchEvidence[] {
  const matches: AstPatchPlannerMatchEvidence[] = [];
  for (const target of targets) {
    const sourceFile = createSourceFile(target);
    const visit = (node: ts.Node) => {
      if (node.kind !== ts.SyntaxKind.SourceFile) {
        const candidate = trimmedNodeText(target, sourceFile, node);
        const match = compiled.regex.exec(candidate.text);
        if (match?.groups && constraintsPass(match.groups, compiled.constraints)) {
          const replacement = typeof rule.fix === "string"
            ? renderReplacement(rule.fix, match.groups)
            : undefined;
          const matchIndex = matches.length + 1;
          matches.push({
            matchId: `match_${String(matchIndex).padStart(4, "0")}`,
            filePath: target.filePath,
            language: target.language,
            astKind: String(ts.SyntaxKind[node.kind]),
            range: rangeForOffsets(target, candidate.start, candidate.end),
            excerpt: boundText(candidate.text),
            excerptHash: digest(candidate.text),
            metavariables: bindingsFromGroups(match.groups),
            ...(replacement === undefined
              ? {}
              : {
                  replacementPreview: boundText(replacement),
                  replacementHash: digest(replacement),
                }),
            evidenceRefs: [RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF],
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return matches;
}

function orderMatches(matches: AstPatchPlannerMatchEvidence[]): AstPatchPlannerMatchEvidence[] {
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

function dedupeMatches(matches: AstPatchPlannerMatchEvidence[]): AstPatchPlannerMatchEvidence[] {
  const byRange = new Map<string, AstPatchPlannerMatchEvidence>();
  for (const match of matches) {
    const key = [
      match.filePath,
      match.range.start,
      match.range.end,
      match.excerptHash,
      match.replacementHash ?? "",
    ].join(":");
    const existing = byRange.get(key);
    if (!existing || preferDuplicate(match, existing)) {
      byRange.set(key, match);
    }
  }
  return [...byRange.values()];
}

function preferDuplicate(
  candidate: AstPatchPlannerMatchEvidence,
  existing: AstPatchPlannerMatchEvidence,
): boolean {
  if (existing.astKind === "JsxAttributes" && candidate.astKind === "JsxAttribute") {
    return true;
  }
  return candidate.astKind.length < existing.astKind.length;
}

function buildPreviewDiff(
  targets: PreparedTarget[],
  matches: AstPatchPlannerMatchEvidence[],
  maxPreviewDiffBytes: number,
): { diff: AstPatchPlannerPreviewDiff; diagnostics: AstPatchPlannerDiagnostic[] } {
  const diagnostics: AstPatchPlannerDiagnostic[] = [];
  const targetByPath = new Map(targets.map((target) => [target.filePath, target]));
  const replacementsByPath = new Map<string, Replacement[]>();

  for (const match of matches) {
    if (match.replacementPreview === undefined) {
      continue;
    }
    replacementsByPath.set(match.filePath, [
      ...(replacementsByPath.get(match.filePath) ?? []),
      {
        matchId: match.matchId,
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
            replacementCount: replacements.length,
          }]
        : [];
    });

  const fullText = fileDiffs.map((item) => item.text).join("\n");
  const fullByteLength = byteLength(fullText);
  const truncated = fullByteLength > maxPreviewDiffBytes;
  const filePreviewBudget = Math.max(
    AST_PATCH_PLANNER_MIN_FILE_PREVIEW_BYTES,
    Math.floor(maxPreviewDiffBytes / Math.max(1, fileDiffs.length)),
  );
  if (truncated) {
    diagnostics.push(diagnostic({
      code: "preview_diff_truncated",
      severity: "warning",
      message: "AST patch planner preview diff was bounded for diagnostics.",
      metadata: { fullByteLength, maxPreviewDiffBytes },
    }));
  }

  return {
    diff: {
      text: truncated ? truncateByBytes(fullText, maxPreviewDiffBytes) : fullText,
      hash: digest(fullText),
      fullByteLength,
      truncated,
      files: fileDiffs.map(({ filePath, diffHash, byteLength: fileByteLength, replacementCount, text }) => {
        const fileTruncated = fileByteLength > filePreviewBudget;
        const previewText = fileTruncated ? truncateByBytes(text, filePreviewBudget) : text;
        return {
          filePath,
          diffHash,
          byteLength: fileByteLength,
          previewText,
          previewTextByteLength: byteLength(previewText),
          truncated: fileTruncated,
          replacementCount,
        };
      }),
    },
    diagnostics,
  };
}

function buildCheckpoint(
  ruleHash: string,
  targets: PreparedTarget[],
  matches: AstPatchPlannerMatchEvidence[],
  previewDiff: AstPatchPlannerPreviewDiff | undefined,
): AstPatchPlannerCheckpoint {
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

function resumeResult(
  status: AstPatchPlannerResumeDriftResult["status"],
  scan: AstPatchPlannerReadonlyScanResult,
  diagnostics: AstPatchPlannerDiagnostic[],
): AstPatchPlannerResumeDriftResult {
  return {
    schemaVersion: 1,
    source: "runtime.ast_patch_planner.resume_drift",
    status,
    authority: AUTHORITY_BOUNDARY,
    scan,
    diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF,
      ...scan.evidenceRefs,
      ...diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
  };
}

function parseConstraintMatchers(
  raw: unknown,
  patternVariables: Set<string>,
  diagnostics: AstPatchPlannerDiagnostic[],
): ConstraintMatcher[] {
  if (raw === undefined) {
    return [];
  }
  const constraints = recordFrom(raw);
  if (constraints !== raw) {
    diagnostics.push(diagnostic({
      code: "invalid_constraint",
      severity: "error",
      message: "AST patch planner constraints must be an object.",
    }));
    return [];
  }

  return Object.entries(constraints).flatMap(([key, value]) => {
    const variable = key.startsWith("$") ? key.slice(1) : key;
    if (!patternVariables.has(variable)) {
      diagnostics.push(diagnostic({
        code: "unbound_metavariable",
        severity: "error",
        message: "AST patch planner constraint references a metavariable that is not bound by the pattern.",
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
        message: "AST patch planner constraints require regex strings.",
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
        message: "AST patch planner constraint regex is invalid.",
        metadata: { metavariable: variable },
      }));
      return [];
    }
  });
}

function constraintsPass(
  groups: Record<string, string>,
  constraints: readonly ConstraintMatcher[],
): boolean {
  return constraints.every((constraint) => constraint.regex.test(groups[constraint.variable] ?? ""));
}

function renderReplacement(fix: string, groups: Record<string, string>): string {
  return fix.replace(METAVARIABLE_RE, (_match, name: string) => groups[name] ?? "");
}

function bindingsFromGroups(
  groups: Record<string, string>,
): Record<string, AstPatchPlannerMetavariableBinding> {
  return Object.fromEntries(Object.entries(groups).map(([name, text]) => [
    name,
    {
      text: boundText(text),
      textHash: digest(text),
    },
  ]));
}

function createSourceFile(target: PreparedTarget): ts.SourceFile {
  return ts.createSourceFile(
    target.filePath,
    target.content,
    ts.ScriptTarget.Latest,
    true,
    target.language === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function trimmedNodeText(
  target: PreparedTarget,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { start: number; end: number; text: string } {
  let start = node.getStart(sourceFile, false);
  let end = node.getEnd();
  while (start < end && /\s/u.test(target.content[start] ?? "")) start += 1;
  while (end > start && /\s/u.test(target.content[end - 1] ?? "")) end -= 1;
  return { start, end, text: target.content.slice(start, end) };
}

function rangeForOffsets(
  target: PreparedTarget,
  start: number,
  end: number,
): AstPatchPlannerRange {
  const startPosition = positionForOffset(target.lineStarts, start);
  const endPosition = positionForOffset(target.lineStarts, end);
  return {
    start,
    end,
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column,
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

function compileLiteral(value: string): string {
  return escapeRegExp(value).replace(/[ \t\r\n]+/gu, "\\s+");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractMetavariables(value: string): string[] {
  return [...value.matchAll(METAVARIABLE_RE)].map((match) => match[1]);
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

function languageFromFilePath(filePath: string): AstPatchPlannerLanguage | undefined {
  if (filePath.endsWith(".tsx")) {
    return "tsx";
  }
  if (filePath.endsWith(".ts")) {
    return "typescript";
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionForOffset(lineStarts: readonly number[], offset: number): { line: number; column: number } {
  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] <= offset) {
      lineIndex = index;
    } else {
      break;
    }
  }
  return {
    line: lineIndex + 1,
    column: offset - lineStarts[lineIndex] + 1,
  };
}

function findFirstOverlap(matches: readonly AstPatchPlannerMatchEvidence[]):
  { filePath: string; range: AstPatchPlannerRange; firstMatchId: string; secondMatchId: string } | undefined {
  const byFile = new Map<string, AstPatchPlannerMatchEvidence[]>();
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
}

function hashRuleConfig(rule: unknown): string {
  return digest(stableStringify(rule));
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
  diagnostics: AstPatchPlannerDiagnostic[],
  maxDiagnostics: number | undefined,
): AstPatchPlannerDiagnostic[] {
  const limit = normalizeLimit(maxDiagnostics, 32);
  if (diagnostics.length <= limit) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, limit - 1)),
    diagnostic({
      code: "diagnostics_truncated",
      severity: "warning",
      message: "AST patch planner diagnostics were bounded.",
      metadata: { diagnosticCount: diagnostics.length, maxDiagnostics: limit },
    }),
  ];
}

function diagnostic(params: {
  code: AstPatchPlannerDiagnosticCode;
  severity: AstPatchPlannerDiagnostic["severity"];
  message: string;
  filePath?: string;
  range?: AstPatchPlannerRange;
  metadata?: RuntimeCoreJsonObject;
}): AstPatchPlannerDiagnostic {
  return {
    code: params.code,
    severity: params.severity,
    message: params.message,
    ...(params.filePath ? { filePath: params.filePath } : {}),
    ...(params.range ? { range: params.range } : {}),
    evidenceRefs: [RUNTIME_AST_PATCH_PLANNER_EVIDENCE_REF],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = recordFrom(value);
  const runtime = recordFrom(record.runtime);
  if (Object.keys(runtime).length > 0) {
    return runtime;
  }
  const config = recordFrom(record.config);
  const nestedRuntime = recordFrom(config.runtime);
  return Object.keys(nestedRuntime).length > 0 ? nestedRuntime : undefined;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
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
