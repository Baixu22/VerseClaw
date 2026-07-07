import type { RuntimeCoreJsonObject } from "./types.js";

export const RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SCHEMA_VERSION = 1 as const;
export const RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SOURCE =
  "runtime.event_log.controlled_dual_read_resume_pilot" as const;

export const RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS = [
  "clean",
  "partial",
  "unreadable",
  "corrupt_row",
  "missing_table",
  "missing_checkpoint",
  "retention_pruned",
  "mismatch",
  "unsafe_side_effect_ambiguity",
] as const;

export const RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES = [
  "task_loop",
  "gateway",
  "provider_transport",
  "renderer",
  "electron_ipc",
  "host_api",
  "api_client",
  "shared_contract",
  "schema",
  "persistence_write",
  "sidecar",
  "background_process",
  "completion_gate",
] as const;

export type RuntimeEventLogControlledDualReadScenario =
  typeof RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS[number];

export type RuntimeEventLogControlledDualReadEvidenceSource =
  | "controlled_corpus"
  | "live_diagnostic_summary";

export type RuntimeEventLogControlledDualReadStatus =
  | "clean"
  | "partial"
  | "unreadable"
  | "missing_table";

export type RuntimeEventLogControlledDualReadComparisonStatus =
  | "matched"
  | "mismatch"
  | "not_run"
  | "waiting_verification"
  | "legacy_missing"
  | "event_log_unreadable";

export type RuntimeEventLogControlledDualReadPilotDecision =
  | "blocked_before_pilot"
  | "needs_more_live_evidence"
  | "ready_for_controlled_dual_read_pilot";

export type RuntimeEventLogControlledDualReadVetoGate =
  | "comparison_mismatch"
  | "resume_status_mismatch"
  | "partial_event_log_read"
  | "corrupt_event_log_rows"
  | "unreadable_event_log"
  | "missing_event_log_table"
  | "missing_legacy_checkpoint"
  | "missing_latest_checkpoint"
  | "unsafe_side_effect_ambiguity"
  | "retention_pruned_checkpoint_gap"
  | "unbounded_or_sensitive_input";

export type RuntimeEventLogControlledDualReadBoundarySurface =
  typeof RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES[number];

export type RuntimeEventLogControlledDualReadDiagnosticCode =
  | "explicit_invocation_required"
  | "pilot_disabled"
  | "diagnostic_only"
  | "legacy_checkpoint_store_remains_authoritative"
  | "matrix_case_missing"
  | "controlled_corpus_case_missing"
  | "live_evidence_contract_missing"
  | "live_evidence_contract_invalid"
  | "boundary_scan_missing"
  | "boundary_forbidden_surface_detected"
  | "rollback_requirement_missing"
  | "veto_gate_not_blocking"
  | "clean_case_blocked"
  | "bounded_output"
  | "sensitive_token_redacted";

export type RuntimeEventLogControlledDualReadDiagnostic = {
  code: RuntimeEventLogControlledDualReadDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  caseId?: string;
  scenario?: RuntimeEventLogControlledDualReadScenario;
  surface?: RuntimeEventLogControlledDualReadBoundarySurface;
  gate?: RuntimeEventLogControlledDualReadVetoGate;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeEventLogControlledDualReadCaseInput = {
  caseId: string;
  scenario: RuntimeEventLogControlledDualReadScenario;
  evidenceSource?: RuntimeEventLogControlledDualReadEvidenceSource;
  eventLogReadStatus: RuntimeEventLogControlledDualReadStatus;
  comparisonStatus: RuntimeEventLogControlledDualReadComparisonStatus;
  pilotGateBlocksResumeChange: boolean;
  legacyCheckpointPresent?: boolean;
  latestCheckpointPresent?: boolean;
  legacyCheckpointToken?: string;
  eventLogCheckpointToken?: string;
  legacyResumeStatus?: string;
  eventLogResumeStatus?: string;
  eventCount?: number;
  replayableEventCount?: number;
  corruptRowCount?: number;
  retentionPruned?: boolean;
  retentionGapCanHideCheckpointState?: boolean;
  mismatchFields?: readonly string[];
  blockingDiagnosticCodes?: readonly string[];
  unsafeSideEffectAmbiguity?: boolean;
};

export type RuntimeEventLogControlledDualReadBoundaryScanInput = {
  surface: RuntimeEventLogControlledDualReadBoundarySurface;
  clear: boolean;
};

export type RuntimeEventLogControlledDualReadRollbackInput = {
  longTaskCheckpointsAuthoritative?: boolean;
  canDisablePilot?: boolean;
  canReturnToLegacyCheckpoints?: boolean;
  noSchemaRollbackRequired?: boolean;
  noSidecarCleanupRequired?: boolean;
  noGatewayUiApiRollbackRequired?: boolean;
  noProviderRollbackRequired?: boolean;
  noTaskLoopBehaviorRollbackRequired?: boolean;
};

export type RuntimeEventLogControlledDualReadLiveEvidenceContractInput = {
  explicitConsent?: boolean;
  bounded?: boolean;
  sanitized?: boolean;
  callerProvided?: boolean;
  rawDetailsExcluded?: boolean;
};

export type RuntimeEventLogControlledDualReadInput = {
  explicitInvocation?: boolean;
  explicitPilotEnabled?: boolean;
  cases?: readonly RuntimeEventLogControlledDualReadCaseInput[];
  boundaryScans?: readonly RuntimeEventLogControlledDualReadBoundaryScanInput[];
  rollback?: RuntimeEventLogControlledDualReadRollbackInput;
  liveEvidenceContract?: RuntimeEventLogControlledDualReadLiveEvidenceContractInput;
};

export type RuntimeEventLogControlledDualReadOptions = {
  maxCases?: number;
  maxDiagnostics?: number;
  maxTokensPerList?: number;
};

export type RuntimeEventLogControlledDualReadCaseSummary = {
  caseId: string;
  scenario: RuntimeEventLogControlledDualReadScenario;
  evidenceSource: RuntimeEventLogControlledDualReadEvidenceSource;
  eventLogReadStatus: RuntimeEventLogControlledDualReadStatus;
  comparisonStatus: RuntimeEventLogControlledDualReadComparisonStatus;
  pilotGateBlocksResumeChange: boolean;
  legacyCheckpointPresent: boolean;
  latestCheckpointPresent: boolean;
  legacyCheckpointToken?: string;
  eventLogCheckpointToken?: string;
  legacyResumeStatus?: string;
  eventLogResumeStatus?: string;
  eventCount: number;
  replayableEventCount: number;
  corruptRowCount: number;
  retentionPruned: boolean;
  retentionGapCanHideCheckpointState: boolean;
  mismatchFields: string[];
  blockingDiagnosticCodes: string[];
  unsafeSideEffectAmbiguity: boolean;
  vetoGates: RuntimeEventLogControlledDualReadVetoGate[];
  sanitization: {
    redactedTokenCount: number;
  };
};

export type RuntimeEventLogControlledDualReadReport = {
  schemaVersion: typeof RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SCHEMA_VERSION;
  source: typeof RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SOURCE;
  decision: RuntimeEventLogControlledDualReadPilotDecision;
  legacyAuthoritative: true;
  eventLogAuthoritative: false;
  explicitInvocation: boolean;
  explicitPilotEnabled: boolean;
  authority: {
    diagnosticOnly: true;
    readonly: true;
    legacyCheckpointStoreAuthoritative: true;
    eventLogCurrentAuthority: false;
    runtimeBehaviorChanged: false;
    taskLoopDecisionChanged: false;
    replaySideEffects: false;
    schemaChanged: false;
    persistenceWritten: false;
    transportCalled: false;
  };
  matrix: {
    requiredScenarios: RuntimeEventLogControlledDualReadScenario[];
    coveredScenarios: RuntimeEventLogControlledDualReadScenario[];
    missingScenarios: RuntimeEventLogControlledDualReadScenario[];
    controlledCorpusCoveredScenarios: RuntimeEventLogControlledDualReadScenario[];
    controlledCorpusMissingScenarios: RuntimeEventLogControlledDualReadScenario[];
    liveCoveredScenarios: RuntimeEventLogControlledDualReadScenario[];
    caseCount: number;
    reportedCaseCount: number;
    truncated: boolean;
    cases: RuntimeEventLogControlledDualReadCaseSummary[];
  };
  liveEvidence: {
    used: boolean;
    explicitConsent: boolean;
    bounded: boolean;
    sanitized: boolean;
    callerProvided: boolean;
    rawDetailsExcluded: boolean;
    valid: boolean;
  };
  vetoSummary: {
    gateCount: number;
    gates: {
      caseId: string;
      scenario: RuntimeEventLogControlledDualReadScenario;
      gate: RuntimeEventLogControlledDualReadVetoGate;
      pilotGateBlocksResumeChange: boolean;
    }[];
  };
  boundary: {
    requiredSurfaces: RuntimeEventLogControlledDualReadBoundarySurface[];
    clearSurfaces: RuntimeEventLogControlledDualReadBoundarySurface[];
    missingSurfaces: RuntimeEventLogControlledDualReadBoundarySurface[];
    forbiddenDetectedSurfaces: RuntimeEventLogControlledDualReadBoundarySurface[];
  };
  rollback: {
    longTaskCheckpointsAuthoritative: boolean;
    canDisablePilot: boolean;
    canReturnToLegacyCheckpoints: boolean;
    noSchemaRollbackRequired: boolean;
    noSidecarCleanupRequired: boolean;
    noGatewayUiApiRollbackRequired: boolean;
    noProviderRollbackRequired: boolean;
    noTaskLoopBehaviorRollbackRequired: boolean;
    ready: boolean;
  };
  evidenceUse: {
    eventLogDiagnosticsAreCompletionProof: false;
    replayComparisonIsCompletionProof: false;
    retentionSummaryIsCompletionProof: false;
    pilotDecisionIsCompletionProof: false;
    pilotDecisionChangesRuntimeBehavior: false;
  };
  diagnostics: RuntimeEventLogControlledDualReadDiagnostic[];
};

const DEFAULT_MAX_CASES = 50;
const DEFAULT_MAX_DIAGNOSTICS = 60;
const DEFAULT_MAX_TOKENS_PER_LIST = 12;
const SENSITIVE_TOKEN_PATTERN =
  /(secret|api[_-]?key|authorization|password|passwd|process\.env|tool(output|args?)|record[_-]?json|raw|payload|transcript|prompt|env|auth)/i;

export function buildRuntimeEventLogControlledDualReadResumePilotReport(
  input: RuntimeEventLogControlledDualReadInput = {},
  options: RuntimeEventLogControlledDualReadOptions = {},
): RuntimeEventLogControlledDualReadReport {
  const limits = {
    maxCases: normalizeLimit(options.maxCases, DEFAULT_MAX_CASES),
    maxDiagnostics: normalizeLimit(options.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS),
    maxTokensPerList: normalizeLimit(options.maxTokensPerList, DEFAULT_MAX_TOKENS_PER_LIST),
  };
  const allCases = [...(input.cases ?? [])];
  const reportedCases = allCases
    .slice(0, limits.maxCases)
    .map((item) => caseSummary(item, limits.maxTokensPerList));
  const coveredScenarios = uniqueSorted(allCases.map((item) => item.scenario));
  const missingScenarios = missingRequiredScenarios(coveredScenarios);
  const controlledCorpusCoveredScenarios = uniqueSorted(allCases
    .filter((item) => evidenceSourceFor(item) === "controlled_corpus")
    .map((item) => item.scenario));
  const controlledCorpusMissingScenarios =
    missingRequiredScenarios(controlledCorpusCoveredScenarios);
  const liveCoveredScenarios = uniqueSorted(allCases
    .filter((item) => evidenceSourceFor(item) === "live_diagnostic_summary")
    .map((item) => item.scenario));
  const liveEvidence = liveEvidenceSummary(
    liveCoveredScenarios.length > 0,
    input.liveEvidenceContract,
  );
  const vetoGates = reportedCases.flatMap((item) =>
    item.vetoGates.map((gate) => ({
      caseId: item.caseId,
      scenario: item.scenario,
      gate,
      pilotGateBlocksResumeChange: item.pilotGateBlocksResumeChange,
    }))
  );
  const boundary = boundarySummary(input.boundaryScans ?? []);
  const rollback = rollbackSummary(input.rollback);
  const allDiagnostics = [
    ...explicitInvocationDiagnostics(input),
    diagnostic({
      code: "diagnostic_only",
      severity: "info",
      message: "Runtime Event Log controlled dual-read output is diagnostic-only.",
    }),
    diagnostic({
      code: "legacy_checkpoint_store_remains_authoritative",
      severity: "info",
      message: "long_task_checkpoints remains authoritative for current checkpoint behavior.",
    }),
    ...boundedOutputDiagnostics(allCases.length, reportedCases.length),
    ...missingScenarios.map((scenario) =>
      diagnostic({
        code: "matrix_case_missing",
        severity: "warning",
        message: "A required dual-read matrix scenario is missing.",
        scenario,
      })
    ),
    ...controlledCorpusMissingScenarios.map((scenario) =>
      diagnostic({
        code: "controlled_corpus_case_missing",
        severity: "warning",
        message: "A required controlled corpus scenario is missing.",
        scenario,
      })
    ),
    ...liveEvidenceDiagnostics(liveEvidence),
    ...vetoDiagnostics(reportedCases),
    ...sensitiveTokenDiagnostics(reportedCases),
    ...boundaryDiagnostics(boundary),
    ...rollbackDiagnostics(rollback),
  ];
  const decision = decisionFor(allDiagnostics);

  return {
    schemaVersion: RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SCHEMA_VERSION,
    source: RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SOURCE,
    decision,
    legacyAuthoritative: true,
    eventLogAuthoritative: false,
    explicitInvocation: input.explicitInvocation === true,
    explicitPilotEnabled: input.explicitPilotEnabled === true,
    authority: {
      diagnosticOnly: true,
      readonly: true,
      legacyCheckpointStoreAuthoritative: true,
      eventLogCurrentAuthority: false,
      runtimeBehaviorChanged: false,
      taskLoopDecisionChanged: false,
      replaySideEffects: false,
      schemaChanged: false,
      persistenceWritten: false,
      transportCalled: false,
    },
    matrix: {
      requiredScenarios: [...RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS],
      coveredScenarios,
      missingScenarios,
      controlledCorpusCoveredScenarios,
      controlledCorpusMissingScenarios,
      liveCoveredScenarios,
      caseCount: allCases.length,
      reportedCaseCount: reportedCases.length,
      truncated: allCases.length > reportedCases.length,
      cases: reportedCases,
    },
    liveEvidence,
    vetoSummary: {
      gateCount: vetoGates.length,
      gates: vetoGates,
    },
    boundary,
    rollback,
    evidenceUse: {
      eventLogDiagnosticsAreCompletionProof: false,
      replayComparisonIsCompletionProof: false,
      retentionSummaryIsCompletionProof: false,
      pilotDecisionIsCompletionProof: false,
      pilotDecisionChangesRuntimeBehavior: false,
    },
    diagnostics: boundedDiagnostics(allDiagnostics, limits.maxDiagnostics),
  };
}

function caseSummary(
  input: RuntimeEventLogControlledDualReadCaseInput,
  maxTokensPerList: number,
): RuntimeEventLogControlledDualReadCaseSummary {
  const legacyCheckpointPresent = input.legacyCheckpointPresent !== false;
  const latestCheckpointPresent = input.latestCheckpointPresent !== false;
  const legacyCheckpointToken = optionalSafeToken(
    input.legacyCheckpointToken,
    "legacy_checkpoint",
  );
  const eventLogCheckpointToken = optionalSafeToken(
    input.eventLogCheckpointToken,
    "event_log_checkpoint",
  );
  const legacyResumeStatus = optionalSafeToken(
    input.legacyResumeStatus,
    "legacy_status",
  );
  const eventLogResumeStatus = optionalSafeToken(
    input.eventLogResumeStatus,
    "event_log_status",
  );
  const mismatchFields = safeTokenList(input.mismatchFields ?? [], maxTokensPerList);
  const blockingDiagnosticCodes = safeTokenList(
    input.blockingDiagnosticCodes ?? [],
    maxTokensPerList,
  );
  const redactedTokenCount =
    Number(legacyCheckpointToken.redacted) +
    Number(eventLogCheckpointToken.redacted) +
    Number(legacyResumeStatus.redacted) +
    Number(eventLogResumeStatus.redacted) +
    mismatchFields.redactedCount +
    blockingDiagnosticCodes.redactedCount;
  const summary = {
    caseId: safeToken(input.caseId, "case").value,
    scenario: input.scenario,
    evidenceSource: evidenceSourceFor(input),
    eventLogReadStatus: input.eventLogReadStatus,
    comparisonStatus: input.comparisonStatus,
    pilotGateBlocksResumeChange: input.pilotGateBlocksResumeChange,
    legacyCheckpointPresent,
    latestCheckpointPresent,
    ...(legacyCheckpointToken.value
      ? { legacyCheckpointToken: legacyCheckpointToken.value }
      : {}),
    ...(eventLogCheckpointToken.value
      ? { eventLogCheckpointToken: eventLogCheckpointToken.value }
      : {}),
    ...(legacyResumeStatus.value ? { legacyResumeStatus: legacyResumeStatus.value } : {}),
    ...(eventLogResumeStatus.value
      ? { eventLogResumeStatus: eventLogResumeStatus.value }
      : {}),
    eventCount: nonNegativeInt(input.eventCount),
    replayableEventCount: nonNegativeInt(input.replayableEventCount),
    corruptRowCount: nonNegativeInt(input.corruptRowCount),
    retentionPruned: input.retentionPruned === true,
    retentionGapCanHideCheckpointState: input.retentionGapCanHideCheckpointState === true,
    mismatchFields: mismatchFields.values,
    blockingDiagnosticCodes: blockingDiagnosticCodes.values,
    unsafeSideEffectAmbiguity: input.unsafeSideEffectAmbiguity === true,
    sanitization: {
      redactedTokenCount,
    },
  };
  return {
    ...summary,
    vetoGates: vetoGatesFor(summary),
  };
}

function evidenceSourceFor(
  input: RuntimeEventLogControlledDualReadCaseInput,
): RuntimeEventLogControlledDualReadEvidenceSource {
  return input.evidenceSource ?? "controlled_corpus";
}

function vetoGatesFor(input: {
  scenario: RuntimeEventLogControlledDualReadScenario;
  eventLogReadStatus: RuntimeEventLogControlledDualReadStatus;
  comparisonStatus: RuntimeEventLogControlledDualReadComparisonStatus;
  legacyCheckpointPresent: boolean;
  latestCheckpointPresent: boolean;
  legacyCheckpointToken?: string;
  eventLogCheckpointToken?: string;
  legacyResumeStatus?: string;
  eventLogResumeStatus?: string;
  corruptRowCount: number;
  retentionPruned: boolean;
  retentionGapCanHideCheckpointState: boolean;
  mismatchFields: readonly string[];
  blockingDiagnosticCodes: readonly string[];
  unsafeSideEffectAmbiguity: boolean;
  sanitization: {
    redactedTokenCount: number;
  };
}): RuntimeEventLogControlledDualReadVetoGate[] {
  const gates = new Set<RuntimeEventLogControlledDualReadVetoGate>();
  if (
    input.scenario === "mismatch" ||
    input.comparisonStatus === "mismatch" ||
    input.mismatchFields.length > 0 ||
    tokensDiffer(input.legacyCheckpointToken, input.eventLogCheckpointToken)
  ) {
    gates.add("comparison_mismatch");
  }
  if (tokensDiffer(input.legacyResumeStatus, input.eventLogResumeStatus)) {
    gates.add("resume_status_mismatch");
  }
  if (input.scenario === "partial" || input.eventLogReadStatus === "partial") {
    gates.add("partial_event_log_read");
  }
  if (input.scenario === "corrupt_row" || input.corruptRowCount > 0) {
    gates.add("corrupt_event_log_rows");
  }
  if (
    input.scenario === "unreadable" ||
    input.eventLogReadStatus === "unreadable" ||
    input.comparisonStatus === "event_log_unreadable"
  ) {
    gates.add("unreadable_event_log");
  }
  if (input.scenario === "missing_table" || input.eventLogReadStatus === "missing_table") {
    gates.add("missing_event_log_table");
  }
  if (
    input.scenario === "missing_checkpoint" ||
    input.comparisonStatus === "legacy_missing" ||
    !input.legacyCheckpointPresent
  ) {
    gates.add("missing_legacy_checkpoint");
  }
  if (!input.latestCheckpointPresent) {
    gates.add("missing_latest_checkpoint");
  }
  if (
    input.scenario === "unsafe_side_effect_ambiguity" ||
    input.comparisonStatus === "waiting_verification" ||
    input.unsafeSideEffectAmbiguity ||
    input.blockingDiagnosticCodes.some((code) =>
      code === "ambiguous_mutating_tool_result" ||
      code === "missing_mutating_tool_result"
    )
  ) {
    gates.add("unsafe_side_effect_ambiguity");
  }
  if (
    input.retentionPruned &&
    (input.retentionGapCanHideCheckpointState || !input.latestCheckpointPresent)
  ) {
    gates.add("retention_pruned_checkpoint_gap");
  }
  if (input.sanitization.redactedTokenCount > 0) {
    gates.add("unbounded_or_sensitive_input");
  }
  return [...gates].sort((left, right) => left.localeCompare(right));
}

function tokensDiffer(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left !== right;
}

function liveEvidenceSummary(
  used: boolean,
  contract: RuntimeEventLogControlledDualReadLiveEvidenceContractInput | undefined,
): RuntimeEventLogControlledDualReadReport["liveEvidence"] {
  const summary = {
    used,
    explicitConsent: contract?.explicitConsent === true,
    bounded: contract?.bounded === true,
    sanitized: contract?.sanitized === true,
    callerProvided: contract?.callerProvided === true,
    rawDetailsExcluded: contract?.rawDetailsExcluded === true,
  };
  return {
    ...summary,
    valid: !used || (
      summary.explicitConsent &&
      summary.bounded &&
      summary.sanitized &&
      summary.callerProvided &&
      summary.rawDetailsExcluded
    ),
  };
}

function boundarySummary(
  scans: readonly RuntimeEventLogControlledDualReadBoundaryScanInput[],
): RuntimeEventLogControlledDualReadReport["boundary"] {
  const known = new Map(scans.map((scan) => [scan.surface, scan.clear]));
  return {
    requiredSurfaces: [...RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES],
    clearSurfaces: RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => known.get(surface) === true),
    missingSurfaces: RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => !known.has(surface)),
    forbiddenDetectedSurfaces: RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => known.get(surface) === false),
  };
}

function rollbackSummary(
  rollback: RuntimeEventLogControlledDualReadRollbackInput | undefined,
): RuntimeEventLogControlledDualReadReport["rollback"] {
  const summary = {
    longTaskCheckpointsAuthoritative: rollback?.longTaskCheckpointsAuthoritative === true,
    canDisablePilot: rollback?.canDisablePilot === true,
    canReturnToLegacyCheckpoints: rollback?.canReturnToLegacyCheckpoints === true,
    noSchemaRollbackRequired: rollback?.noSchemaRollbackRequired === true,
    noSidecarCleanupRequired: rollback?.noSidecarCleanupRequired === true,
    noGatewayUiApiRollbackRequired: rollback?.noGatewayUiApiRollbackRequired === true,
    noProviderRollbackRequired: rollback?.noProviderRollbackRequired === true,
    noTaskLoopBehaviorRollbackRequired:
      rollback?.noTaskLoopBehaviorRollbackRequired === true,
  };
  return {
    ...summary,
    ready: Object.values(summary).every(Boolean),
  };
}

function explicitInvocationDiagnostics(
  input: RuntimeEventLogControlledDualReadInput,
): RuntimeEventLogControlledDualReadDiagnostic[] {
  return [
    ...(input.explicitInvocation === true
      ? []
      : [diagnostic({
          code: "explicit_invocation_required",
          severity: "error",
          message: "Controlled dual-read comparison requires explicit invocation.",
        })]),
    ...(input.explicitPilotEnabled === true
      ? []
      : [diagnostic({
          code: "pilot_disabled",
          severity: "error",
          message: "Controlled dual-read comparison is disabled unless explicitly enabled.",
        })]),
  ];
}

function liveEvidenceDiagnostics(
  liveEvidence: RuntimeEventLogControlledDualReadReport["liveEvidence"],
): RuntimeEventLogControlledDualReadDiagnostic[] {
  if (!liveEvidence.used) {
    return [];
  }
  const requirements: [keyof typeof liveEvidence, string][] = [
    ["explicitConsent", "Live evidence requires explicit caller consent."],
    ["bounded", "Live evidence must be bounded before comparison."],
    ["sanitized", "Live evidence must be sanitized before comparison."],
    ["callerProvided", "Live evidence must be caller-provided diagnostic summary input."],
    ["rawDetailsExcluded", "Live evidence must exclude raw details."],
  ];
  const missing = requirements.filter(([key]) => liveEvidence[key] !== true);
  if (missing.length === requirements.length) {
    return [diagnostic({
      code: "live_evidence_contract_missing",
      severity: "error",
      message: "Live evidence was provided without a valid bounded input contract.",
    })];
  }
  return missing.map(([key, message]) =>
    diagnostic({
      code: "live_evidence_contract_invalid",
      severity: "error",
      message,
      metadata: { requirement: key },
    })
  );
}

function vetoDiagnostics(
  cases: readonly RuntimeEventLogControlledDualReadCaseSummary[],
): RuntimeEventLogControlledDualReadDiagnostic[] {
  return cases.flatMap((item) => {
    if (item.vetoGates.length === 0 && item.pilotGateBlocksResumeChange) {
      return [diagnostic({
        code: "clean_case_blocked",
        severity: "warning",
        message: "A clean controlled dual-read case is still marked as blocked.",
        caseId: item.caseId,
        scenario: item.scenario,
      })];
    }
    if (item.vetoGates.length === 0 || item.pilotGateBlocksResumeChange) {
      return [];
    }
    return item.vetoGates.map((gate) =>
      diagnostic({
        code: "veto_gate_not_blocking",
        severity: "error",
        message: "A required veto gate is not marked as blocking pilot readiness.",
        caseId: item.caseId,
        scenario: item.scenario,
        gate,
      })
    );
  });
}

function sensitiveTokenDiagnostics(
  cases: readonly RuntimeEventLogControlledDualReadCaseSummary[],
): RuntimeEventLogControlledDualReadDiagnostic[] {
  return cases.flatMap((item) =>
    item.sanitization.redactedTokenCount > 0
      ? [diagnostic({
          code: "sensitive_token_redacted",
          severity: "error",
          message: "A comparison summary included unbounded or sensitive-looking tokens.",
          caseId: item.caseId,
          scenario: item.scenario,
          metadata: { redactedTokenCount: item.sanitization.redactedTokenCount },
        })]
      : []
  );
}

function boundaryDiagnostics(
  boundary: RuntimeEventLogControlledDualReadReport["boundary"],
): RuntimeEventLogControlledDualReadDiagnostic[] {
  return [
    ...boundary.missingSurfaces.map((surface) =>
      diagnostic({
        code: "boundary_scan_missing",
        severity: "warning",
        message: "A required boundary scan result is missing.",
        surface,
      })
    ),
    ...boundary.forbiddenDetectedSurfaces.map((surface) =>
      diagnostic({
        code: "boundary_forbidden_surface_detected",
        severity: "error",
        message: "Boundary evidence reports a forbidden surface.",
        surface,
      })
    ),
  ];
}

function rollbackDiagnostics(
  rollback: RuntimeEventLogControlledDualReadReport["rollback"],
): RuntimeEventLogControlledDualReadDiagnostic[] {
  const requirements: [keyof typeof rollback, string][] = [
    ["longTaskCheckpointsAuthoritative", "long_task_checkpoints must remain authoritative."],
    ["canDisablePilot", "Pilot rollback must be disable-only."],
    ["canReturnToLegacyCheckpoints", "Rollback must return to legacy checkpoints."],
    ["noSchemaRollbackRequired", "Rollback must not depend on schema rollback."],
    ["noSidecarCleanupRequired", "Rollback must not depend on sidecar cleanup."],
    ["noGatewayUiApiRollbackRequired", "Rollback must not depend on Gateway/UI/API rollback."],
    ["noProviderRollbackRequired", "Rollback must not depend on provider rollback."],
    ["noTaskLoopBehaviorRollbackRequired", "Rollback must not depend on TaskLoop behavior rollback."],
  ];
  return requirements.flatMap(([key, message]) =>
    rollback[key] === true
      ? []
      : [diagnostic({
          code: "rollback_requirement_missing",
          severity: "warning",
          message,
          metadata: { requirement: key },
        })]
  );
}

function boundedOutputDiagnostics(
  total: number,
  reported: number,
): RuntimeEventLogControlledDualReadDiagnostic[] {
  if (total <= reported) {
    return [];
  }
  return [diagnostic({
    code: "bounded_output",
    severity: "warning",
    message: "Controlled dual-read matrix output was bounded.",
    metadata: {
      caseCount: total,
      reportedCaseCount: reported,
    },
  })];
}

function decisionFor(
  diagnostics: readonly RuntimeEventLogControlledDualReadDiagnostic[],
): RuntimeEventLogControlledDualReadPilotDecision {
  if (diagnostics.some((item) => item.severity === "error")) {
    return "blocked_before_pilot";
  }
  if (diagnostics.some((item) => item.severity === "warning")) {
    return "needs_more_live_evidence";
  }
  return "ready_for_controlled_dual_read_pilot";
}

function boundedDiagnostics(
  diagnostics: RuntimeEventLogControlledDualReadDiagnostic[],
  maxDiagnostics: number,
): RuntimeEventLogControlledDualReadDiagnostic[] {
  if (diagnostics.length <= maxDiagnostics) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, maxDiagnostics - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "Controlled dual-read diagnostics were bounded.",
      metadata: {
        diagnosticCount: diagnostics.length,
        maxDiagnostics,
      },
    }),
  ];
}

function diagnostic(
  input: RuntimeEventLogControlledDualReadDiagnostic,
): RuntimeEventLogControlledDualReadDiagnostic {
  return {
    ...input,
    ...(input.caseId ? { caseId: safeToken(input.caseId, "case").value } : {}),
  };
}

function missingRequiredScenarios(
  coveredScenarios: readonly RuntimeEventLogControlledDualReadScenario[],
): RuntimeEventLogControlledDualReadScenario[] {
  return RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS
    .filter((scenario) => !coveredScenarios.includes(scenario));
}

function safeTokenList(values: readonly string[], limit: number): {
  values: string[];
  redactedCount: number;
} {
  const tokens = values.slice(0, limit).map((value) => safeToken(value, "redacted"));
  return {
    values: tokens.map((token) => token.value),
    redactedCount: tokens.filter((token) => token.redacted).length,
  };
}

function optionalSafeToken(value: string | undefined, fallback: string): {
  value?: string;
  redacted: boolean;
} {
  if (value === undefined) {
    return { redacted: false };
  }
  const token = safeToken(value, fallback);
  return {
    value: token.value,
    redacted: token.redacted,
  };
}

function safeToken(value: string, fallback: string): {
  value: string;
  redacted: boolean;
} {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  if (!normalized || SENSITIVE_TOKEN_PATTERN.test(normalized)) {
    return { value: fallback, redacted: true };
  }
  return { value: normalized, redacted: false };
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function nonNegativeInt(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}
