import type { RuntimeCoreJsonObject } from "./types.js";

export const RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SCHEMA_VERSION = 1 as const;
export const RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SOURCE =
  "runtime.event_log.resume_cutover_readiness" as const;

export const RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_SCENARIOS = [
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

export const RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES = [
  "task_loop",
  "gateway",
  "provider_transport",
  "renderer",
  "electron_ipc",
  "host_api",
  "api_client",
  "shared_contract",
  "schema",
  "default_on",
  "service_listener",
  "sidecar",
  "completion_gate",
] as const;

export type RuntimeEventLogResumeCutoverScenario =
  typeof RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_SCENARIOS[number];

export type RuntimeEventLogResumeCutoverReadStatus =
  | "clean"
  | "partial"
  | "unreadable"
  | "missing_table";

export type RuntimeEventLogResumeCutoverComparisonStatus =
  | "matched"
  | "mismatch"
  | "not_run"
  | "waiting_verification"
  | "legacy_missing"
  | "event_log_unreadable";

export type RuntimeEventLogResumeCutoverReadinessRecommendation =
  | "blocked_for_cutover"
  | "needs_more_evidence"
  | "ready_for_limited_future_pilot_proposal";

export type RuntimeEventLogResumeCutoverVetoGate =
  | "comparison_mismatch"
  | "corrupt_event_log_rows"
  | "unreadable_event_log"
  | "missing_event_log_table"
  | "missing_legacy_checkpoint"
  | "missing_latest_checkpoint"
  | "unsafe_side_effect_ambiguity"
  | "retention_pruned_checkpoint_gap";

export type RuntimeEventLogResumeCutoverBoundarySurface =
  typeof RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES[number];

export type RuntimeEventLogResumeCutoverReadinessDiagnosticCode =
  | "bounded_output"
  | "diagnostic_only"
  | "legacy_checkpoint_remains_authoritative"
  | "matrix_case_missing"
  | "boundary_scan_missing"
  | "boundary_cutover_detected"
  | "rollback_requirement_missing"
  | "veto_gate_not_blocking"
  | "clean_case_blocked"
  | "cutover_not_enabled";

export type RuntimeEventLogResumeCutoverReadinessDiagnostic = {
  code: RuntimeEventLogResumeCutoverReadinessDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  caseId?: string;
  scenario?: RuntimeEventLogResumeCutoverScenario;
  surface?: RuntimeEventLogResumeCutoverBoundarySurface;
  gate?: RuntimeEventLogResumeCutoverVetoGate;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeEventLogResumeCutoverCaseInput = {
  caseId: string;
  scenario: RuntimeEventLogResumeCutoverScenario;
  eventLogReadStatus: RuntimeEventLogResumeCutoverReadStatus;
  comparisonStatus: RuntimeEventLogResumeCutoverComparisonStatus;
  proposedGateBlocksCutover: boolean;
  legacyCheckpointPresent?: boolean;
  latestCheckpointPresent?: boolean;
  eventCount?: number;
  replayableEventCount?: number;
  corruptRowCount?: number;
  retentionPruned?: boolean;
  mismatchFields?: readonly string[];
  blockingDiagnosticCodes?: readonly string[];
  unsafeSideEffectAmbiguity?: boolean;
};

export type RuntimeEventLogResumeCutoverBoundaryScanInput = {
  surface: RuntimeEventLogResumeCutoverBoundarySurface;
  clear: boolean;
};

export type RuntimeEventLogResumeCutoverRollbackInput = {
  longTaskCheckpointsAuthoritative?: boolean;
  canDisableFuturePilot?: boolean;
  canReturnToLegacyCheckpoints?: boolean;
  noSchemaRollbackRequired?: boolean;
  noSidecarCleanupRequired?: boolean;
};

export type RuntimeEventLogResumeCutoverReadinessInput = {
  cases?: readonly RuntimeEventLogResumeCutoverCaseInput[];
  boundaryScans?: readonly RuntimeEventLogResumeCutoverBoundaryScanInput[];
  rollback?: RuntimeEventLogResumeCutoverRollbackInput;
};

export type RuntimeEventLogResumeCutoverReadinessOptions = {
  maxCases?: number;
  maxDiagnostics?: number;
  maxTokensPerList?: number;
};

export type RuntimeEventLogResumeCutoverCaseSummary = {
  caseId: string;
  scenario: RuntimeEventLogResumeCutoverScenario;
  eventLogReadStatus: RuntimeEventLogResumeCutoverReadStatus;
  comparisonStatus: RuntimeEventLogResumeCutoverComparisonStatus;
  proposedGateBlocksCutover: boolean;
  legacyCheckpointPresent: boolean;
  latestCheckpointPresent: boolean;
  eventCount: number;
  replayableEventCount: number;
  corruptRowCount: number;
  retentionPruned: boolean;
  mismatchFields: string[];
  blockingDiagnosticCodes: string[];
  vetoGates: RuntimeEventLogResumeCutoverVetoGate[];
};

export type RuntimeEventLogResumeCutoverReadinessReport = {
  schemaVersion: typeof RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SCHEMA_VERSION;
  source: typeof RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SOURCE;
  recommendation: RuntimeEventLogResumeCutoverReadinessRecommendation;
  legacyAuthoritative: true;
  eventLogAuthoritative: false;
  authority: {
    diagnosticOnly: true;
    readonly: true;
    legacyCheckpointStoreAuthoritative: true;
    eventLogCurrentAuthority: false;
    defaultOn: false;
    configFlagAdded: false;
    runtimeBehaviorChanged: false;
    taskLoopDecisionChanged: false;
  };
  matrix: {
    requiredScenarios: RuntimeEventLogResumeCutoverScenario[];
    coveredScenarios: RuntimeEventLogResumeCutoverScenario[];
    missingScenarios: RuntimeEventLogResumeCutoverScenario[];
    caseCount: number;
    reportedCaseCount: number;
    truncated: boolean;
    cases: RuntimeEventLogResumeCutoverCaseSummary[];
  };
  vetoSummary: {
    gateCount: number;
    gates: {
      caseId: string;
      scenario: RuntimeEventLogResumeCutoverScenario;
      gate: RuntimeEventLogResumeCutoverVetoGate;
      proposedGateBlocksCutover: boolean;
    }[];
  };
  boundary: {
    requiredSurfaces: RuntimeEventLogResumeCutoverBoundarySurface[];
    clearSurfaces: RuntimeEventLogResumeCutoverBoundarySurface[];
    missingSurfaces: RuntimeEventLogResumeCutoverBoundarySurface[];
    cutoverDetectedSurfaces: RuntimeEventLogResumeCutoverBoundarySurface[];
  };
  rollback: {
    longTaskCheckpointsAuthoritative: boolean;
    canDisableFuturePilot: boolean;
    canReturnToLegacyCheckpoints: boolean;
    noSchemaRollbackRequired: boolean;
    noSidecarCleanupRequired: boolean;
    ready: boolean;
  };
  evidenceUse: {
    eventLogDiagnosticsAreCompletionProof: false;
    replayComparisonIsCompletionProof: false;
    retentionSummaryIsCompletionProof: false;
    readinessReportIsCompletionProof: false;
    readinessReportEnablesCutover: false;
  };
  diagnostics: RuntimeEventLogResumeCutoverReadinessDiagnostic[];
};

const DEFAULT_MAX_CASES = 50;
const DEFAULT_MAX_DIAGNOSTICS = 50;
const DEFAULT_MAX_TOKENS_PER_LIST = 12;
const SENSITIVE_TOKEN_PATTERN =
  /(secret|api[_-]?key|authorization|password|passwd|process\.env|tool(output|args?)|record[_-]?json|raw|payload|transcript|prompt)/i;

export function buildRuntimeEventLogResumeCutoverReadinessReport(
  input: RuntimeEventLogResumeCutoverReadinessInput = {},
  options: RuntimeEventLogResumeCutoverReadinessOptions = {},
): RuntimeEventLogResumeCutoverReadinessReport {
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
  const missingScenarios = RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_SCENARIOS
    .filter((scenario) => !coveredScenarios.includes(scenario));
  const vetoGates = reportedCases.flatMap((item) =>
    item.vetoGates.map((gate) => ({
      caseId: item.caseId,
      scenario: item.scenario,
      gate,
      proposedGateBlocksCutover: item.proposedGateBlocksCutover,
    }))
  );
  const boundary = boundarySummary(input.boundaryScans ?? []);
  const rollback = rollbackSummary(input.rollback);
  const diagnostics = boundedDiagnostics([
    diagnostic({
      code: "diagnostic_only",
      severity: "info",
      message: "Runtime Event Log cutover readiness output is diagnostic-only.",
    }),
    diagnostic({
      code: "legacy_checkpoint_remains_authoritative",
      severity: "info",
      message: "long_task_checkpoints remains authoritative for current resume behavior.",
    }),
    diagnostic({
      code: "cutover_not_enabled",
      severity: "info",
      message: "This readiness report does not enable cutover.",
    }),
    ...boundedOutputDiagnostics(allCases.length, reportedCases.length),
    ...missingScenarios.map((scenario) =>
      diagnostic({
        code: "matrix_case_missing",
        severity: "warning",
        message: "A required controlled matrix scenario is missing.",
        scenario,
      })
    ),
    ...vetoDiagnostics(reportedCases),
    ...boundaryDiagnostics(boundary),
    ...rollbackDiagnostics(rollback),
  ], limits.maxDiagnostics);

  return {
    schemaVersion: RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SCHEMA_VERSION,
    source: RUNTIME_EVENT_LOG_RESUME_CUTOVER_READINESS_SOURCE,
    recommendation: recommendationFor(diagnostics),
    legacyAuthoritative: true,
    eventLogAuthoritative: false,
    authority: {
      diagnosticOnly: true,
      readonly: true,
      legacyCheckpointStoreAuthoritative: true,
      eventLogCurrentAuthority: false,
      defaultOn: false,
      configFlagAdded: false,
      runtimeBehaviorChanged: false,
      taskLoopDecisionChanged: false,
    },
    matrix: {
      requiredScenarios: [...RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_SCENARIOS],
      coveredScenarios,
      missingScenarios,
      caseCount: allCases.length,
      reportedCaseCount: reportedCases.length,
      truncated: allCases.length > reportedCases.length,
      cases: reportedCases,
    },
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
      readinessReportIsCompletionProof: false,
      readinessReportEnablesCutover: false,
    },
    diagnostics,
  };
}

function caseSummary(
  input: RuntimeEventLogResumeCutoverCaseInput,
  maxTokensPerList: number,
): RuntimeEventLogResumeCutoverCaseSummary {
  const legacyCheckpointPresent = input.legacyCheckpointPresent !== false;
  const latestCheckpointPresent = input.latestCheckpointPresent !== false;
  return {
    caseId: safeToken(input.caseId, "case"),
    scenario: input.scenario,
    eventLogReadStatus: input.eventLogReadStatus,
    comparisonStatus: input.comparisonStatus,
    proposedGateBlocksCutover: input.proposedGateBlocksCutover,
    legacyCheckpointPresent,
    latestCheckpointPresent,
    eventCount: nonNegativeInt(input.eventCount),
    replayableEventCount: nonNegativeInt(input.replayableEventCount),
    corruptRowCount: nonNegativeInt(input.corruptRowCount),
    retentionPruned: input.retentionPruned === true,
    mismatchFields: safeTokenList(input.mismatchFields ?? [], maxTokensPerList),
    blockingDiagnosticCodes: safeTokenList(input.blockingDiagnosticCodes ?? [], maxTokensPerList),
    vetoGates: vetoGatesFor({
      scenario: input.scenario,
      eventLogReadStatus: input.eventLogReadStatus,
      comparisonStatus: input.comparisonStatus,
      legacyCheckpointPresent,
      latestCheckpointPresent,
      corruptRowCount: nonNegativeInt(input.corruptRowCount),
      retentionPruned: input.retentionPruned === true,
      mismatchFields: input.mismatchFields ?? [],
      blockingDiagnosticCodes: input.blockingDiagnosticCodes ?? [],
      unsafeSideEffectAmbiguity: input.unsafeSideEffectAmbiguity === true,
    }),
  };
}

function vetoGatesFor(input: {
  scenario: RuntimeEventLogResumeCutoverScenario;
  eventLogReadStatus: RuntimeEventLogResumeCutoverReadStatus;
  comparisonStatus: RuntimeEventLogResumeCutoverComparisonStatus;
  legacyCheckpointPresent: boolean;
  latestCheckpointPresent: boolean;
  corruptRowCount: number;
  retentionPruned: boolean;
  mismatchFields: readonly string[];
  blockingDiagnosticCodes: readonly string[];
  unsafeSideEffectAmbiguity: boolean;
}): RuntimeEventLogResumeCutoverVetoGate[] {
  const gates = new Set<RuntimeEventLogResumeCutoverVetoGate>();
  if (
    input.scenario === "mismatch" ||
    input.comparisonStatus === "mismatch" ||
    input.mismatchFields.length > 0
  ) {
    gates.add("comparison_mismatch");
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
  if (input.retentionPruned && !input.latestCheckpointPresent) {
    gates.add("retention_pruned_checkpoint_gap");
  }
  return [...gates].sort((left, right) => left.localeCompare(right));
}

function boundarySummary(
  scans: readonly RuntimeEventLogResumeCutoverBoundaryScanInput[],
): RuntimeEventLogResumeCutoverReadinessReport["boundary"] {
  const known = new Map(scans.map((scan) => [scan.surface, scan.clear]));
  return {
    requiredSurfaces: [...RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES],
    clearSurfaces: RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => known.get(surface) === true),
    missingSurfaces: RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => !known.has(surface)),
    cutoverDetectedSurfaces: RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES
      .filter((surface) => known.get(surface) === false),
  };
}

function rollbackSummary(
  rollback: RuntimeEventLogResumeCutoverRollbackInput | undefined,
): RuntimeEventLogResumeCutoverReadinessReport["rollback"] {
  const summary = {
    longTaskCheckpointsAuthoritative: rollback?.longTaskCheckpointsAuthoritative === true,
    canDisableFuturePilot: rollback?.canDisableFuturePilot === true,
    canReturnToLegacyCheckpoints: rollback?.canReturnToLegacyCheckpoints === true,
    noSchemaRollbackRequired: rollback?.noSchemaRollbackRequired === true,
    noSidecarCleanupRequired: rollback?.noSidecarCleanupRequired === true,
  };
  return {
    ...summary,
    ready: Object.values(summary).every(Boolean),
  };
}

function recommendationFor(
  diagnostics: readonly RuntimeEventLogResumeCutoverReadinessDiagnostic[],
): RuntimeEventLogResumeCutoverReadinessRecommendation {
  if (diagnostics.some((item) => item.severity === "error")) {
    return "blocked_for_cutover";
  }
  if (diagnostics.some((item) => item.severity === "warning")) {
    return "needs_more_evidence";
  }
  return "ready_for_limited_future_pilot_proposal";
}

function boundedOutputDiagnostics(
  total: number,
  reported: number,
): RuntimeEventLogResumeCutoverReadinessDiagnostic[] {
  if (total <= reported) {
    return [];
  }
  return [diagnostic({
    code: "bounded_output",
    severity: "warning",
    message: "Runtime Event Log readiness matrix output was bounded.",
    metadata: {
      caseCount: total,
      reportedCaseCount: reported,
    },
  })];
}

function vetoDiagnostics(
  cases: readonly RuntimeEventLogResumeCutoverCaseSummary[],
): RuntimeEventLogResumeCutoverReadinessDiagnostic[] {
  return cases.flatMap((item) => {
    if (item.vetoGates.length === 0 && item.proposedGateBlocksCutover) {
      return [diagnostic({
        code: "clean_case_blocked",
        severity: "warning",
        message: "A clean readiness case is still marked as blocked by the proposed gate.",
        caseId: item.caseId,
        scenario: item.scenario,
      })];
    }
    if (item.vetoGates.length === 0 || item.proposedGateBlocksCutover) {
      return [];
    }
    return item.vetoGates.map((gate) =>
      diagnostic({
        code: "veto_gate_not_blocking",
        severity: "error",
        message: "A required veto gate is not marked as blocking cutover.",
        caseId: item.caseId,
        scenario: item.scenario,
        gate,
      })
    );
  });
}

function boundaryDiagnostics(
  boundary: RuntimeEventLogResumeCutoverReadinessReport["boundary"],
): RuntimeEventLogResumeCutoverReadinessDiagnostic[] {
  return [
    ...boundary.missingSurfaces.map((surface) =>
      diagnostic({
        code: "boundary_scan_missing",
        severity: "warning",
        message: "A required boundary scan result is missing.",
        surface,
      })
    ),
    ...boundary.cutoverDetectedSurfaces.map((surface) =>
      diagnostic({
        code: "boundary_cutover_detected",
        severity: "error",
        message: "Boundary evidence reports a forbidden cutover surface.",
        surface,
      })
    ),
  ];
}

function rollbackDiagnostics(
  rollback: RuntimeEventLogResumeCutoverReadinessReport["rollback"],
): RuntimeEventLogResumeCutoverReadinessDiagnostic[] {
  const requirements: [keyof typeof rollback, string][] = [
    ["longTaskCheckpointsAuthoritative", "long_task_checkpoints must remain authoritative."],
    ["canDisableFuturePilot", "Future pilot rollback must be disable-only."],
    ["canReturnToLegacyCheckpoints", "Rollback must return to legacy checkpoints."],
    ["noSchemaRollbackRequired", "Rollback must not depend on schema rollback."],
    ["noSidecarCleanupRequired", "Rollback must not depend on sidecar cleanup."],
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

function boundedDiagnostics(
  diagnostics: RuntimeEventLogResumeCutoverReadinessDiagnostic[],
  maxDiagnostics: number,
): RuntimeEventLogResumeCutoverReadinessDiagnostic[] {
  if (diagnostics.length <= maxDiagnostics) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, maxDiagnostics - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "Runtime Event Log readiness diagnostics were bounded.",
      metadata: {
        diagnosticCount: diagnostics.length,
        maxDiagnostics,
      },
    }),
  ];
}

function diagnostic(
  input: RuntimeEventLogResumeCutoverReadinessDiagnostic,
): RuntimeEventLogResumeCutoverReadinessDiagnostic {
  return {
    ...input,
    ...(input.caseId ? { caseId: safeToken(input.caseId, "case") } : {}),
  };
}

function safeTokenList(values: readonly string[], limit: number): string[] {
  return values
    .slice(0, limit)
    .map((value) => safeToken(value, "redacted"));
}

function safeToken(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  if (!normalized || SENSITIVE_TOKEN_PATTERN.test(normalized)) {
    return fallback;
  }
  return normalized;
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
