import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
  evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent,
  type RuntimeFailureDestructiveOperationGuardPreflightCandidate,
} from "./failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.js";

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION =
  "runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.v1";

export type RuntimeFailureDestructiveOperationGuardInternalEvaluationDecision =
  | "continue_with_separate_accepted_spec"
  | "continue_hardening"
  | "freeze_active_pilot_expand_corpus"
  | "blocked_for_continuation";

export type RuntimeFailureDestructiveOperationGuardFalseBlockCategory =
  | "expected_edit"
  | "expected_deletion"
  | "normal_completed_repair"
  | "completed_test_repair"
  | "sanitized_or_inconclusive_touched_path"
  | "legitimate_fixture_mutation"
  | "slow_test_command"
  | "known_dev_server_like_long_running";

export type RuntimeFailureDestructiveOperationGuardTranscriptScanSummary = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION;
  sanitizedMetadataOnly: true;
  source: {
    transcriptRootRef?: string;
    transcriptRefs: string[];
    maxFiles: number;
    maxBytesPerFile: number;
  };
  totals: {
    transcriptsScanned: number;
    recordsParsed: number;
    parseErrors: number;
    toolInvocationCount: number;
    mutationCapableToolInvocationCount: number;
    unknownToolInvocationCount: number;
    candidateMetadataCount: number;
    wouldBlockCount: number;
    wouldAllowCount: number;
  };
  rates: {
    parseSuccessRate: number;
    mutationCapableToolRate: number;
    shadowBlockRate: number;
  };
  partialSignalCounts: {
    deletedTouchedPathMetadata: number;
    wrongFileEditScorecardFail: number;
    unnecessaryEditScorecardFail: number;
    phase5FutureBlockCandidate: number;
    falseBlockCorpusPassing: number;
  };
  metadataCounts: {
    usageMetadataCount: number;
    missingUsageMetadataCount: number;
  };
  feedbackStatus: "real_data_observed" | "insufficient_real_data" | "parse_failures_observed";
};

export type RuntimeFailureDestructiveOperationGuardInternalEvaluationInput = {
  falseBlockHoldouts: Array<{
    category: RuntimeFailureDestructiveOperationGuardFalseBlockCategory;
    passed: boolean;
  }>;
  triggerChecks: Array<{
    id: string;
    expected: "allow" | "block";
    actual: "allow" | "block";
  }>;
  boundary: {
    allowedActiveConsumerOnly: boolean;
    deniedRootHits: string[];
  };
  rollback: {
    flagOffLegacyAllow: boolean;
    omittedFlagLegacyAllow: boolean;
    schemaDefaultOff: boolean;
  };
  realData: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary;
  sanitization: {
    rawLeakDetected: boolean;
    secretLeakDetected: boolean;
    pathLeakDetected: boolean;
  };
};

export type RuntimeFailureDestructiveOperationGuardInternalEvaluationReport = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION;
  diagnosticsOnly: true;
  productionReady: false;
  activeRuntimeConsumer: false;
  aggregateScore: number;
  decision: RuntimeFailureDestructiveOperationGuardInternalEvaluationDecision;
  hardVetoes: Array<{
    id: "denied_root_consumer" | "raw_report_leak" | "secret_report_leak" | "path_report_leak";
    message: string;
  }>;
  dimensions: Array<{
    id:
      | "false_block_safety"
      | "trigger_correctness"
      | "owner_boundary_integrity"
      | "rollback_default_off"
      | "real_data_feedback_quality"
      | "sanitization_report_hygiene";
    label: string;
    score: number;
    maxScore: number;
    status: "pass" | "warning" | "fail" | "veto";
    reasons: string[];
    optimizationActions: string[];
  }>;
  realDataFeedback: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary;
  optimizationPlan: string[];
};

export type RuntimeFailureDestructiveOperationGuardSanitizationLeak =
  | "raw"
  | "secret"
  | "path"
  | "env";

export type RuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION;
  diagnosticsOnly: true;
  observationOnly: true;
  activeDecision: false;
  activeRuntimeConsumer: false;
  productionReady: false;
  allowedFutureCouplingOwner: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER;
  shadowTotals: {
    candidateMetadataCount: number;
    wouldBlockCount: number;
    wouldAllowCount: number;
    partialSignalCount: number;
    usageMetadataCount: number;
    missingUsageMetadataCount: number;
  };
  realDataFeedbackExplanation: RuntimeFailureDestructiveOperationGuardRealDataFeedbackExplanation;
};

export type RuntimeFailureDestructiveOperationGuardRealDataFeedbackExplanation = {
  score: number;
  maxScore: 15;
  status: "pass" | "warning" | "fail";
  currentWeaknesses: string[];
  nextRoundTarget: {
    targetScore: 12;
    requiredSignals: string[];
  };
};

export type RuntimeFailureDestructiveOperationGuardRuntimeCouplingReadinessReport = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION;
  diagnosticsOnly: true;
  productionReady: false;
  activeRuntimeConsumerApproved: false;
  allowedFutureCouplingOwner: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER;
  status:
    | "ready_for_future_mutation_capable_preflight_owner_only"
    | "blocked_by_denied_root_consumer"
    | "blocked_by_owner_expansion";
  deniedRootHits: string[];
  ownerExpansionHits: string[];
  recommendations: string[];
};

const REQUIRED_FALSE_BLOCK_CATEGORIES: RuntimeFailureDestructiveOperationGuardFalseBlockCategory[] = [
  "expected_edit",
  "expected_deletion",
  "normal_completed_repair",
  "completed_test_repair",
  "sanitized_or_inconclusive_touched_path",
  "legitimate_fixture_mutation",
  "slow_test_command",
  "known_dev_server_like_long_running",
];

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_BYTES_PER_FILE = 512 * 1024;
const DENIED_RUNTIME_COUPLING_ROOTS = [
  "openclaw_runtime/src/agents/task-loop-controller.ts",
  "openclaw_runtime/src/acp/",
  "openclaw_runtime/src/gateway/",
  "openclaw_runtime/src/provider",
  "openclaw_runtime/src/auto-reply/",
  "openclaw_runtime/src/channels/",
  "openclaw_runtime/src/plugin-sdk/",
  "openclaw_runtime/src/tasks/",
  "electron/main/",
  "electron/services/",
  "electron/preload",
  "src/",
  "scripts/",
];

export function createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport(
  input: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput,
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport {
  const hardVetoes = [
    ...boundaryVetoes(input.boundary.deniedRootHits),
    ...sanitizationVetoes(input.sanitization),
  ];
  const dimensions = [
    scoreFalseBlockSafety(input.falseBlockHoldouts),
    scoreTriggerCorrectness(input.triggerChecks),
    scoreBoundary(input.boundary, hardVetoes.length > 0),
    scoreRollback(input.rollback),
    scoreRealData(input.realData),
    scoreSanitization(input.sanitization),
  ];
  const aggregateScore = hardVetoes.length > 0
    ? 0
    : clampScore(dimensions.reduce((total, dimension) => total + dimension.score, 0));
  const decision = hardVetoes.length > 0
    ? "blocked_for_continuation"
    : aggregateScore >= 85
      ? "continue_with_separate_accepted_spec"
      : aggregateScore >= 70
        ? "continue_hardening"
        : "freeze_active_pilot_expand_corpus";
  const optimizationPlan = dimensions
    .flatMap((dimension) => dimension.optimizationActions)
    .filter((value, index, values) => values.indexOf(value) === index);

  return {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION,
    diagnosticsOnly: true,
    productionReady: false,
    activeRuntimeConsumer: false,
    aggregateScore,
    decision,
    hardVetoes,
    dimensions,
    realDataFeedback: input.realData,
    optimizationPlan,
  };
}

export function parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl(
  content: string,
  options: {
    sourceRef?: string;
    transcriptRootRef?: string;
    maxBytes?: number;
  } = {},
): RuntimeFailureDestructiveOperationGuardTranscriptScanSummary {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES_PER_FILE;
  const text = content.slice(0, maxBytes);
  const summary = emptyTranscriptScanSummary({
    transcriptRootRef: options.transcriptRootRef,
    maxFiles: 1,
    maxBytesPerFile: maxBytes,
  });
  summary.source.transcriptRefs = [options.sourceRef ?? hashRef("transcript", text)];
  summary.totals.transcriptsScanned = 1;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
      summary.totals.recordsParsed += 1;
    } catch {
      summary.totals.parseErrors += 1;
      continue;
    }
    observeRecord(record, summary);
  }

  finalizeTranscriptScanSummary(summary);
  return summary;
}

export async function scanRuntimeFailureDestructiveOperationGuardTranscriptRoot(
  options: {
    transcriptRoot?: string;
    maxFiles?: number;
    maxBytesPerFile?: number;
  } = {},
): Promise<RuntimeFailureDestructiveOperationGuardTranscriptScanSummary> {
  const transcriptRoot = options.transcriptRoot ?? join(homedir(), ".openclaw");
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const rootRef = hashRef("transcript-root", transcriptRoot.toLowerCase());
  const aggregate = emptyTranscriptScanSummary({
    transcriptRootRef: rootRef,
    maxFiles,
    maxBytesPerFile,
  });
  const files = await listTranscriptFiles(transcriptRoot, maxFiles);
  for (const file of files) {
    let content = "";
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    mergeTranscriptScanSummary(aggregate, parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl(content, {
      sourceRef: hashRef("transcript", `${basename(file)}:${content.length}`),
      transcriptRootRef: rootRef,
      maxBytes: maxBytesPerFile,
    }));
  }
  finalizeTranscriptScanSummary(aggregate);
  return aggregate;
}

export function assertRuntimeFailureDestructiveOperationGuardReportSanitized(value: unknown): {
  ok: boolean;
  leaks: RuntimeFailureDestructiveOperationGuardSanitizationLeak[];
} {
  const payload = JSON.stringify(value);
  const leaks: RuntimeFailureDestructiveOperationGuardSanitizationLeak[] = [];
  if (/\b(?:raw|prompt|providerPayload|provider_payload|provider payload|toolArgs|tool_args|tool args|toolResult|tool_result|tool result|stdout|stderr|process\.env|rawChat|raw chat|message\.content|workspace content)\b/i.test(payload)) {
    leaks.push("raw");
  }
  if (/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_]{10,}\b|api[_-]?key|authorization|password|bearer\s+[A-Za-z0-9._-]{10,}/i.test(payload)) {
    leaks.push("secret");
  }
  if (/[A-Za-z]:(?:\\|\\\\)(?:(?!(?:\\|\\\\|\s)).)+(?:\\|\\\\)|(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/.test(payload)) {
    leaks.push("path");
  }
  if (/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s"',;]{4,}|\b(?:process\.env|env|environment|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN)\b/i.test(payload)) {
    leaks.push("env");
  }
  return { ok: leaks.length === 0, leaks };
}

export function explainRuntimeFailureDestructiveOperationGuardRealDataFeedback(
  realData: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): RuntimeFailureDestructiveOperationGuardRealDataFeedbackExplanation {
  const dimension = scoreRealData(realData);
  const currentWeaknesses = [
    ...(realData.totals.transcriptsScanned === 0 ? ["No sanitized local transcript metadata was observed."] : []),
    ...(realData.totals.toolInvocationCount === 0 ? ["No tool invocation metadata was observed."] : []),
    ...(realData.totals.candidateMetadataCount === 0 ? ["No destructive_operation_guard candidate metadata was observed."] : []),
    ...(realData.metadataCounts.missingUsageMetadataCount > 0 ? ["Some tool/candidate records lack usage metadata."] : []),
    ...(realData.totals.parseErrors > 0 ? ["Malformed JSONL records were observed and skipped."] : []),
  ];
  return {
    score: dimension.score,
    maxScore: 15,
    status: dimension.status === "pass" ? "pass" : dimension.status === "warning" ? "warning" : "fail",
    currentWeaknesses: currentWeaknesses.length > 0
      ? currentWeaknesses
      : ["Current sanitized transcript metadata reaches the 12+/15 target shape."],
    nextRoundTarget: {
      targetScore: 12,
      requiredSignals: [
        "sanitized records with parseSuccessRate near 1.0",
        "code_mode_exec or other mutation-capable tool observations",
        "destructive_operation_guard candidate metadata",
        "would-block and would-allow shadow outcome counts",
        "usage metadata when present, with missing usage counted rather than inferred",
      ],
    },
  };
}

export function createRuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary(
  realData: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): RuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary {
  return {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION,
    diagnosticsOnly: true,
    observationOnly: true,
    activeDecision: false,
    activeRuntimeConsumer: false,
    productionReady: false,
    allowedFutureCouplingOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
    shadowTotals: {
      candidateMetadataCount: realData.totals.candidateMetadataCount,
      wouldBlockCount: realData.totals.wouldBlockCount,
      wouldAllowCount: realData.totals.wouldAllowCount,
      partialSignalCount: Object.values(realData.partialSignalCounts).reduce((total, count) => total + count, 0),
      usageMetadataCount: realData.metadataCounts.usageMetadataCount,
      missingUsageMetadataCount: realData.metadataCounts.missingUsageMetadataCount,
    },
    realDataFeedbackExplanation: explainRuntimeFailureDestructiveOperationGuardRealDataFeedback(realData),
  };
}

export function evaluateRuntimeFailureDestructiveOperationGuardRuntimeCouplingReadiness(input: {
  futureCouplingOwner: string;
  activeConsumerRefs: string[];
}): RuntimeFailureDestructiveOperationGuardRuntimeCouplingReadinessReport {
  const deniedRootHits = input.activeConsumerRefs
    .map((ref) => normalizePathRef(ref))
    .filter((ref) => DENIED_RUNTIME_COUPLING_ROOTS.some((root) => ref === root.replace(/\/$/, "") || ref.startsWith(root)));
  const ownerExpansionHits = input.futureCouplingOwner === RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER
    ? []
    : [safeRef(input.futureCouplingOwner)];
  const status = deniedRootHits.length > 0
    ? "blocked_by_denied_root_consumer"
    : ownerExpansionHits.length > 0
      ? "blocked_by_owner_expansion"
      : "ready_for_future_mutation_capable_preflight_owner_only";
  return {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION,
    diagnosticsOnly: true,
    productionReady: false,
    activeRuntimeConsumerApproved: false,
    allowedFutureCouplingOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
    status,
    deniedRootHits: [...new Set(deniedRootHits.map(safeRef))],
    ownerExpansionHits,
    recommendations: status === "ready_for_future_mutation_capable_preflight_owner_only"
      ? ["Future coupling may be designed only through mutation-capable tool invocation preflight and still requires a separate accepted spec."]
      : ["Remove denied-root consumers or owner expansion before claiming runtime coupling readiness."],
  };
}

function observeRecord(
  record: unknown,
  summary: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): void {
  if (!isPlainObject(record)) {
    return;
  }
  const toolObservations = extractToolObservations(record);
  const candidate = extractCandidate(record);
  const hasUsage = hasUsageMetadata(record);
  if (toolObservations.length > 0 || candidate) {
    if (hasUsage) {
      summary.metadataCounts.usageMetadataCount += 1;
    } else {
      summary.metadataCounts.missingUsageMetadataCount += 1;
    }
  }
  for (const observation of toolObservations) {
    summary.totals.toolInvocationCount += 1;
    if (observation.mutationCapable) {
      summary.totals.mutationCapableToolInvocationCount += 1;
    }
    if (!observation.name) {
      summary.totals.unknownToolInvocationCount += 1;
    }
  }

  if (!candidate) {
    return;
  }
  summary.totals.candidateMetadataCount += 1;
  observeCandidateSignals(candidate, summary);
  const toolName = normalizeToolName(
    firstString(record.toolName, record.name, readPath(record, ["tool", "name"])) ?? candidate.toolName,
  );
  const toolKind = firstString(record.toolKind, readPath(record, ["tool", "kind"]));
  const mutationCapable = toolKind === "code_mode_exec" || toolName === "code_mode_exec";
  const decision = evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent({
    config: {
      runtime: {
        toolGovernance: {
          destructiveOperationGuard: {
            preflight: { enabled: true },
          },
        },
      },
    },
    tool: {
      name: toolName || "unknown_tool",
      ...(toolKind ? { kind: toolKind } : {}),
      mutationCapable,
    },
    candidate,
  }).decision;
  if (decision.action === "block") {
    summary.totals.wouldBlockCount += 1;
  } else {
    summary.totals.wouldAllowCount += 1;
  }
}

function extractToolObservations(record: Record<string, unknown>): Array<{ name?: string; mutationCapable: boolean }> {
  const observations: Array<{ name?: string; mutationCapable: boolean }> = [];
  const directName = normalizeToolName(firstString(record.toolName, record.name, readPath(record, ["tool", "name"])) ?? "");
  const directKind = firstString(record.toolKind, readPath(record, ["tool", "kind"]));
  if (directName || directKind) {
    observations.push({
      ...(directName ? { name: directName } : {}),
      mutationCapable: directName === "code_mode_exec" || directKind === "code_mode_exec",
    });
  }

  const messageToolCalls = readPath(record, ["message", "tool_calls"]);
  if (Array.isArray(messageToolCalls)) {
    for (const call of messageToolCalls) {
      const callName = normalizeToolName(firstString(
        readPath(call, ["function", "name"]),
        readPath(call, ["name"]),
      ) ?? "");
      observations.push({
        ...(callName ? { name: callName } : {}),
        mutationCapable: callName === "code_mode_exec",
      });
    }
  }
  return observations;
}

function extractCandidate(record: Record<string, unknown>): RuntimeFailureDestructiveOperationGuardPreflightCandidate | undefined {
  const value = readPath(record, ["toolGovernance", "destructiveOperationGuard", "preflightCandidate"])
    ?? readPath(record, ["destructiveOperationGuardPreflightCandidate"]);
  if (!isPlainObject(value)) {
    return undefined;
  }
  const ruleId = value.ruleId;
  const toolName = value.toolName;
  const futureActiveCandidate = value.futureActiveCandidate;
  const signals = value.signals;
  const provenance = value.provenance;
  if (
    ruleId !== "destructive_operation_guard"
    || typeof toolName !== "string"
    || !isPlainObject(futureActiveCandidate)
    || futureActiveCandidate.action !== "block"
    || futureActiveCandidate.requiresAcceptedSpec !== true
    || !isPlainObject(signals)
    || !isPlainObject(provenance)
  ) {
    return undefined;
  }
  return {
    ruleId: "destructive_operation_guard",
    toolName,
    ...(typeof value.toolCallId === "string" ? { toolCallId: safeRef(value.toolCallId) } : {}),
    futureActiveCandidate: {
      action: "block",
      requiresAcceptedSpec: true,
    },
    signals: {
      deletedTouchedPathMetadata: signals.deletedTouchedPathMetadata === true,
      wrongFileEditScorecardFail: signals.wrongFileEditScorecardFail === true,
      unnecessaryEditScorecardFail: signals.unnecessaryEditScorecardFail === true,
      phase5FutureBlockCandidate: signals.phase5FutureBlockCandidate === true,
      falseBlockCorpusPassing: signals.falseBlockCorpusPassing === true,
    },
    provenance: {
      replayRefs: safeRefs(provenance.replayRefs),
      scorecardRefs: safeRefs(provenance.scorecardRefs),
      touchedPathRefs: safeRefs(provenance.touchedPathRefs),
      failureRefs: safeRefs(provenance.failureRefs),
      evidenceRefs: safeRefs(provenance.evidenceRefs),
      phase5FindingRefs: safeRefs(provenance.phase5FindingRefs),
    },
  };
}

function observeCandidateSignals(
  candidate: RuntimeFailureDestructiveOperationGuardPreflightCandidate,
  summary: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): void {
  if (candidate.signals.deletedTouchedPathMetadata) summary.partialSignalCounts.deletedTouchedPathMetadata += 1;
  if (candidate.signals.wrongFileEditScorecardFail) summary.partialSignalCounts.wrongFileEditScorecardFail += 1;
  if (candidate.signals.unnecessaryEditScorecardFail) summary.partialSignalCounts.unnecessaryEditScorecardFail += 1;
  if (candidate.signals.phase5FutureBlockCandidate) summary.partialSignalCounts.phase5FutureBlockCandidate += 1;
  if (candidate.signals.falseBlockCorpusPassing) summary.partialSignalCounts.falseBlockCorpusPassing += 1;
}

async function listTranscriptFiles(transcriptRoot: string, maxFiles: number): Promise<string[]> {
  const agentsRoot = join(transcriptRoot, "agents");
  const files: Array<{ path: string; mtimeMs: number }> = [];
  try {
    const agentEntries = await readdir(agentsRoot, { withFileTypes: true });
    for (const agent of agentEntries) {
      if (!agent.isDirectory()) continue;
      const sessionsDir = join(agentsRoot, agent.name, "sessions");
      let sessionEntries: Dirent<string>[];
      try {
        sessionEntries = await readdir(sessionsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of sessionEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const path = join(sessionsDir, entry.name);
        try {
          const fileStat = await stat(path);
          files.push({ path, mtimeMs: fileStat.mtimeMs });
        } catch {
          continue;
        }
      }
    }
  } catch {
    return [];
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((file) => file.path);
}

function emptyTranscriptScanSummary(params: {
  transcriptRootRef?: string;
  maxFiles: number;
  maxBytesPerFile: number;
}): RuntimeFailureDestructiveOperationGuardTranscriptScanSummary {
  return {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_INTERNAL_EVALUATION_SCHEMA_VERSION,
    sanitizedMetadataOnly: true,
    source: {
      ...(params.transcriptRootRef ? { transcriptRootRef: params.transcriptRootRef } : {}),
      transcriptRefs: [],
      maxFiles: params.maxFiles,
      maxBytesPerFile: params.maxBytesPerFile,
    },
    totals: {
      transcriptsScanned: 0,
      recordsParsed: 0,
      parseErrors: 0,
      toolInvocationCount: 0,
      mutationCapableToolInvocationCount: 0,
      unknownToolInvocationCount: 0,
      candidateMetadataCount: 0,
      wouldBlockCount: 0,
      wouldAllowCount: 0,
    },
    rates: {
      parseSuccessRate: 0,
      mutationCapableToolRate: 0,
      shadowBlockRate: 0,
    },
    partialSignalCounts: {
      deletedTouchedPathMetadata: 0,
      wrongFileEditScorecardFail: 0,
      unnecessaryEditScorecardFail: 0,
      phase5FutureBlockCandidate: 0,
      falseBlockCorpusPassing: 0,
    },
    metadataCounts: {
      usageMetadataCount: 0,
      missingUsageMetadataCount: 0,
    },
    feedbackStatus: "insufficient_real_data",
  };
}

function mergeTranscriptScanSummary(
  target: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
  source: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): void {
  target.source.transcriptRefs.push(...source.source.transcriptRefs);
  target.totals.transcriptsScanned += source.totals.transcriptsScanned;
  target.totals.recordsParsed += source.totals.recordsParsed;
  target.totals.parseErrors += source.totals.parseErrors;
  target.totals.toolInvocationCount += source.totals.toolInvocationCount;
  target.totals.mutationCapableToolInvocationCount += source.totals.mutationCapableToolInvocationCount;
  target.totals.unknownToolInvocationCount += source.totals.unknownToolInvocationCount;
  target.totals.candidateMetadataCount += source.totals.candidateMetadataCount;
  target.totals.wouldBlockCount += source.totals.wouldBlockCount;
  target.totals.wouldAllowCount += source.totals.wouldAllowCount;
  target.partialSignalCounts.deletedTouchedPathMetadata += source.partialSignalCounts.deletedTouchedPathMetadata;
  target.partialSignalCounts.wrongFileEditScorecardFail += source.partialSignalCounts.wrongFileEditScorecardFail;
  target.partialSignalCounts.unnecessaryEditScorecardFail += source.partialSignalCounts.unnecessaryEditScorecardFail;
  target.partialSignalCounts.phase5FutureBlockCandidate += source.partialSignalCounts.phase5FutureBlockCandidate;
  target.partialSignalCounts.falseBlockCorpusPassing += source.partialSignalCounts.falseBlockCorpusPassing;
  target.metadataCounts.usageMetadataCount += source.metadataCounts.usageMetadataCount;
  target.metadataCounts.missingUsageMetadataCount += source.metadataCounts.missingUsageMetadataCount;
  target.source.transcriptRefs = [...new Set(target.source.transcriptRefs)].slice(0, target.source.maxFiles);
}

function finalizeTranscriptScanSummary(summary: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary): void {
  const totalLines = summary.totals.recordsParsed + summary.totals.parseErrors;
  summary.rates.parseSuccessRate = ratio(summary.totals.recordsParsed, totalLines);
  summary.rates.mutationCapableToolRate = ratio(
    summary.totals.mutationCapableToolInvocationCount,
    summary.totals.toolInvocationCount,
  );
  summary.rates.shadowBlockRate = ratio(
    summary.totals.wouldBlockCount,
    summary.totals.wouldBlockCount + summary.totals.wouldAllowCount,
  );
  summary.feedbackStatus = summary.totals.transcriptsScanned === 0 || summary.totals.recordsParsed === 0
    ? "insufficient_real_data"
    : summary.totals.parseErrors > 0
      ? "parse_failures_observed"
      : "real_data_observed";
}

function scoreFalseBlockSafety(
  holdouts: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["falseBlockHoldouts"],
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  const passing = new Set(holdouts.filter((holdout) => holdout.passed).map((holdout) => holdout.category));
  const covered = REQUIRED_FALSE_BLOCK_CATEGORIES.filter((category) => passing.has(category));
  const score = roundScore((covered.length / REQUIRED_FALSE_BLOCK_CATEGORIES.length) * 30);
  const missing = REQUIRED_FALSE_BLOCK_CATEGORIES.filter((category) => !passing.has(category));
  return {
    id: "false_block_safety",
    label: "False-block safety",
    score,
    maxScore: 30,
    status: score === 30 ? "pass" : score >= 21 ? "warning" : "fail",
    reasons: [
      `${covered.length}/${REQUIRED_FALSE_BLOCK_CATEGORIES.length} required false-block categories pass.`,
      ...(missing.length > 0 ? [`Missing or failing categories: ${missing.join(", ")}.`] : []),
    ],
    optimizationActions: missing.length > 0
      ? ["Expand expected deletion, slow test, dev-server-like, and fixture mutation holdouts before broader pilots."]
      : ["Keep the false-block corpus in every continuation gate."],
  };
}

function scoreTriggerCorrectness(
  checks: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["triggerChecks"],
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  const correct = checks.filter((check) => check.expected === check.actual).length;
  const score = checks.length === 0 ? 0 : roundScore((correct / checks.length) * 20);
  return {
    id: "trigger_correctness",
    label: "Trigger correctness",
    score,
    maxScore: 20,
    status: score === 20 ? "pass" : score >= 14 ? "warning" : "fail",
    reasons: checks.length === 0
      ? ["No trigger checks were supplied."]
      : [`${correct}/${checks.length} trigger checks matched expected decisions.`],
    optimizationActions: score === 20
      ? ["Keep positive-control and partial-signal checks paired in follow-up specs."]
      : ["Add positive-control, deleted-path-alone, partial-signal, and false-block-corpus-failing checks."],
  };
}

function scoreBoundary(
  boundary: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["boundary"],
  hasHardVeto: boolean,
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  const score = boundary.deniedRootHits.length > 0 ? 0 : boundary.allowedActiveConsumerOnly ? 15 : 8;
  return {
    id: "owner_boundary_integrity",
    label: "Owner/boundary integrity",
    score,
    maxScore: 15,
    status: hasHardVeto || boundary.deniedRootHits.length > 0 ? "veto" : score === 15 ? "pass" : "warning",
    reasons: boundary.deniedRootHits.length > 0
      ? [`Denied root hits: ${boundary.deniedRootHits.map(safeRef).join(", ")}.`]
      : [boundary.allowedActiveConsumerOnly
        ? "Active consumer remains limited to mutation-capable preflight."
        : "Allowed consumer exclusivity was not fully proven."],
    optimizationActions: score === 15
      ? ["Keep automated denied-root scans in every continuation gate."]
      : ["Tighten boundary scans and remove any denied-root active consumer references."],
  };
}

function scoreRollback(
  rollback: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["rollback"],
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  const checks = [
    rollback.flagOffLegacyAllow,
    rollback.omittedFlagLegacyAllow,
    rollback.schemaDefaultOff,
  ];
  const passed = checks.filter(Boolean).length;
  const score = roundScore((passed / checks.length) * 15);
  return {
    id: "rollback_default_off",
    label: "Rollback/default-off proof",
    score,
    maxScore: 15,
    status: score === 15 ? "pass" : score >= 10 ? "warning" : "fail",
    reasons: [`${passed}/${checks.length} rollback/default-off checks pass.`],
    optimizationActions: score === 15
      ? ["Keep flag-off and omitted-flag regression checks in every continuation gate."]
      : ["Repair flag-off, omitted-flag, or schema-default-off rollback proof before continuation."],
  };
}

function scoreRealData(
  realData: RuntimeFailureDestructiveOperationGuardTranscriptScanSummary,
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  if (realData.totals.transcriptsScanned === 0 || realData.totals.recordsParsed === 0) {
    return {
      id: "real_data_feedback_quality",
      label: "Real-data feedback quality",
      score: 5,
      maxScore: 15,
      status: "warning",
      reasons: ["No local transcript metadata was available; this lowers confidence but is not a hard veto."],
      optimizationActions: ["Run the scorecard on a host with local OpenClaw transcripts or provide anonymized transcript fixtures."],
    };
  }
  const parseScore = realData.rates.parseSuccessRate * 6;
  const toolCoverageScore = Math.min(1, realData.totals.toolInvocationCount / realData.totals.recordsParsed) * 4;
  const candidateScore = realData.totals.candidateMetadataCount > 0 ? 3 : 1;
  const shadowScore = realData.totals.wouldBlockCount + realData.totals.wouldAllowCount > 0 ? 2 : 1;
  const score = roundScore(parseScore + toolCoverageScore + candidateScore + shadowScore);
  return {
    id: "real_data_feedback_quality",
    label: "Real-data feedback quality",
    score,
    maxScore: 15,
    status: score >= 12 ? "pass" : score >= 8 ? "warning" : "fail",
    reasons: [
      `${realData.totals.transcriptsScanned} transcripts scanned with parse success rate ${realData.rates.parseSuccessRate.toFixed(2)}.`,
      `${realData.totals.toolInvocationCount} tool observations and ${realData.totals.candidateMetadataCount} candidate metadata records observed.`,
    ],
    optimizationActions: score >= 12
      ? ["Expand real-data sampling and add observation-only shadow summaries in a separate accepted spec."]
      : ["Add transcript parse fixtures and increase sanitized real-data coverage before broader pilots."],
  };
}

function scoreSanitization(
  sanitization: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["sanitization"],
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["dimensions"][number] {
  const leaks = [
    sanitization.rawLeakDetected ? "raw" : undefined,
    sanitization.secretLeakDetected ? "secret" : undefined,
    sanitization.pathLeakDetected ? "path" : undefined,
  ].filter(Boolean);
  return {
    id: "sanitization_report_hygiene",
    label: "Sanitization/report hygiene",
    score: leaks.length > 0 ? 0 : 5,
    maxScore: 5,
    status: leaks.length > 0 ? "veto" : "pass",
    reasons: leaks.length > 0 ? [`Leak classes detected: ${leaks.join(", ")}.`] : ["No raw, secret, or path leak classes detected."],
    optimizationActions: leaks.length > 0
      ? ["Fix sanitizer leaks before any continuation."]
      : ["Keep report sanitization checks in every continuation gate."],
  };
}

function boundaryVetoes(deniedRootHits: string[]): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["hardVetoes"] {
  return deniedRootHits.length > 0
    ? [{
      id: "denied_root_consumer",
      message: `Denied active consumer roots were found: ${deniedRootHits.map(safeRef).join(", ")}.`,
    }]
    : [];
}

function sanitizationVetoes(
  sanitization: RuntimeFailureDestructiveOperationGuardInternalEvaluationInput["sanitization"],
): RuntimeFailureDestructiveOperationGuardInternalEvaluationReport["hardVetoes"] {
  return [
    ...(sanitization.rawLeakDetected ? [{ id: "raw_report_leak" as const, message: "Report contains raw prompt/tool/env-like content." }] : []),
    ...(sanitization.secretLeakDetected ? [{ id: "secret_report_leak" as const, message: "Report contains secret-like content." }] : []),
    ...(sanitization.pathLeakDetected ? [{ id: "path_report_leak" as const, message: "Report contains unredacted path-like content." }] : []),
  ];
}

function safeRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string").map(safeRef).filter(Boolean))].slice(0, 12)
    : [];
}

function safeRef(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]")
    .replace(/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]")
    .replace(/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]")
    .replace(/\b(?:api[_-]?key|authorization|password)=?[^\s"',;]*/gi, "[redacted-secret]")
    .slice(0, 160)
    .trim();
}

function normalizeToolName(value: string): string {
  return safeRef(value).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function hasUsageMetadata(record: Record<string, unknown>): boolean {
  return isPlainObject(record.usage) || isPlainObject(readPath(record, ["message", "usage"]));
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashRef(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function normalizePathRef(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, roundScore(value)));
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}
