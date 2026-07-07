import type {
  RuntimeEventLogControlledDualReadReport,
} from "./event-log-controlled-dual-read-resume-pilot.js";
import {
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS,
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SCHEMA_VERSION,
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SOURCE,
} from "./event-log-controlled-dual-read-resume-pilot.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export const RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SCHEMA_VERSION = 1 as const;
export const RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SOURCE =
  "runtime.event_log.limited_authority_cutover_pilot" as const;

export const RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES = [
  "fresh_implementation_spec",
  "explicit_operator_gate",
  "default_off",
  "disable_only_rollback",
  "legacy_checkpoint_fallback",
  "no_schema_change",
  "no_transport_change",
  "no_api_or_ui_change",
  "no_task_loop_change",
  "no_provider_change",
  "no_replay_side_effects",
] as const;

export type RuntimeEventLogLimitedAuthorityBoundary =
  typeof RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES[number];

export type RuntimeEventLogLimitedAuthorityDecision =
  | "use_legacy_checkpoints"
  | "ready_for_explicit_limited_event_log_pilot";

export type RuntimeEventLogLimitedAuthorityDiagnosticCode =
  | "explicit_invocation_required"
  | "pilot_disabled"
  | "operator_gate_closed"
  | "kill_switch_active"
  | "dual_read_report_missing"
  | "dual_read_report_invalid"
  | "dual_read_report_not_ready"
  | "dual_read_authority_drift"
  | "dual_read_boundary_gap"
  | "dual_read_veto_not_blocking"
  | "rollback_proof_missing"
  | "boundary_missing"
  | "boundary_forbidden"
  | "legacy_checkpoints_remain_default"
  | "bounded_output";

export type RuntimeEventLogLimitedAuthorityDiagnostic = {
  code: RuntimeEventLogLimitedAuthorityDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  boundary?: RuntimeEventLogLimitedAuthorityBoundary;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeEventLogLimitedAuthorityBoundaryInput = {
  boundary: RuntimeEventLogLimitedAuthorityBoundary;
  clear: boolean;
};

export type RuntimeEventLogLimitedAuthorityRollbackInput = {
  longTaskCheckpointsFallbackVerified?: boolean;
  disableOnlyRollback?: boolean;
  noSchemaRollbackRequired?: boolean;
  noTransportRollbackRequired?: boolean;
  noApiUiRollbackRequired?: boolean;
  noTaskLoopRollbackRequired?: boolean;
  noProviderRollbackRequired?: boolean;
};

export type RuntimeEventLogLimitedAuthorityInput = {
  explicitInvocation?: boolean;
  explicitPilotEnabled?: boolean;
  operatorGateOpen?: boolean;
  killSwitchActive?: boolean;
  controlledDualReadReport?: RuntimeEventLogControlledDualReadReport;
  boundaries?: readonly RuntimeEventLogLimitedAuthorityBoundaryInput[];
  rollback?: RuntimeEventLogLimitedAuthorityRollbackInput;
};

export type RuntimeEventLogLimitedAuthorityOptions = {
  maxDiagnostics?: number;
};

export type RuntimeEventLogLimitedAuthorityReport = {
  schemaVersion: typeof RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SCHEMA_VERSION;
  source: typeof RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SOURCE;
  decision: RuntimeEventLogLimitedAuthorityDecision;
  explicitInvocation: boolean;
  explicitPilotEnabled: boolean;
  operatorGateOpen: boolean;
  killSwitchActive: boolean;
  selectedSource: "long_task_checkpoints" | "runtime_task_event_log_explicit_pilot";
  fallbackSource: "long_task_checkpoints";
  authority: {
    legacyCheckpointsDefaultAuthoritative: true;
    legacyCheckpointsAuthoritativeOutsideExplicitPilot: true;
    pilotMayUseEventLogSource: boolean;
    defaultRuntimeBehaviorChanged: false;
    taskLoopDecisionChanged: false;
    replaySideEffects: false;
    schemaChanged: false;
    transportCalled: false;
    apiOrUiChanged: false;
    providerChanged: false;
  };
  evidence: {
    controlledDualReadReportPresent: boolean;
    controlledDualReadReportReady: boolean;
    controlledDualReadReportValid: boolean;
    requiredScenariosCovered: boolean;
    parityMatched: boolean;
    vetoesBlocking: boolean;
    liveEvidenceValid: boolean;
  };
  boundaries: {
    required: RuntimeEventLogLimitedAuthorityBoundary[];
    clear: RuntimeEventLogLimitedAuthorityBoundary[];
    missing: RuntimeEventLogLimitedAuthorityBoundary[];
    forbidden: RuntimeEventLogLimitedAuthorityBoundary[];
  };
  rollback: {
    longTaskCheckpointsFallbackVerified: boolean;
    disableOnlyRollback: boolean;
    noSchemaRollbackRequired: boolean;
    noTransportRollbackRequired: boolean;
    noApiUiRollbackRequired: boolean;
    noTaskLoopRollbackRequired: boolean;
    noProviderRollbackRequired: boolean;
    ready: boolean;
  };
  completionProof: {
    diagnosticsAreCompletionProof: false;
    replayComparisonIsCompletionProof: false;
    helperDecisionChangesRuntimeBehavior: false;
  };
  diagnostics: RuntimeEventLogLimitedAuthorityDiagnostic[];
};

const DEFAULT_MAX_DIAGNOSTICS = 60;

export function buildRuntimeEventLogLimitedAuthorityCutoverPilotReport(
  input: RuntimeEventLogLimitedAuthorityInput = {},
  options: RuntimeEventLogLimitedAuthorityOptions = {},
): RuntimeEventLogLimitedAuthorityReport {
  const maxDiagnostics = normalizeLimit(options.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS);
  const dualRead = controlledDualReadEvidence(input.controlledDualReadReport);
  const boundaries = boundarySummary(input.boundaries ?? []);
  const rollback = rollbackSummary(input.rollback);
  const diagnostics = [
    ...gateDiagnostics(input),
    diagnostic({
      code: "legacy_checkpoints_remain_default",
      severity: "info",
      message: "long_task_checkpoints remains the default resume source.",
    }),
    ...dualRead.diagnostics,
    ...boundaryDiagnostics(boundaries),
    ...rollbackDiagnostics(rollback),
  ];
  const decision = diagnostics.some((item) => item.severity === "error" || item.severity === "warning")
    ? "use_legacy_checkpoints"
    : "ready_for_explicit_limited_event_log_pilot";

  return {
    schemaVersion: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SCHEMA_VERSION,
    source: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_CUTOVER_PILOT_SOURCE,
    decision,
    explicitInvocation: input.explicitInvocation === true,
    explicitPilotEnabled: input.explicitPilotEnabled === true,
    operatorGateOpen: input.operatorGateOpen === true,
    killSwitchActive: input.killSwitchActive === true,
    selectedSource: decision === "ready_for_explicit_limited_event_log_pilot"
      ? "runtime_task_event_log_explicit_pilot"
      : "long_task_checkpoints",
    fallbackSource: "long_task_checkpoints",
    authority: {
      legacyCheckpointsDefaultAuthoritative: true,
      legacyCheckpointsAuthoritativeOutsideExplicitPilot: true,
      pilotMayUseEventLogSource: decision === "ready_for_explicit_limited_event_log_pilot",
      defaultRuntimeBehaviorChanged: false,
      taskLoopDecisionChanged: false,
      replaySideEffects: false,
      schemaChanged: false,
      transportCalled: false,
      apiOrUiChanged: false,
      providerChanged: false,
    },
    evidence: dualRead.summary,
    boundaries,
    rollback,
    completionProof: {
      diagnosticsAreCompletionProof: false,
      replayComparisonIsCompletionProof: false,
      helperDecisionChangesRuntimeBehavior: false,
    },
    diagnostics: boundedDiagnostics(diagnostics, maxDiagnostics),
  };
}

function controlledDualReadEvidence(
  report: RuntimeEventLogControlledDualReadReport | undefined,
): {
  summary: RuntimeEventLogLimitedAuthorityReport["evidence"];
  diagnostics: RuntimeEventLogLimitedAuthorityDiagnostic[];
} {
  if (!report) {
    return {
      summary: {
        controlledDualReadReportPresent: false,
        controlledDualReadReportReady: false,
        controlledDualReadReportValid: false,
        requiredScenariosCovered: false,
        parityMatched: false,
        vetoesBlocking: false,
        liveEvidenceValid: false,
      },
      diagnostics: [diagnostic({
        code: "dual_read_report_missing",
        severity: "error",
        message: "A bounded controlled dual-read report is required.",
      })],
    };
  }

  const valid = report.schemaVersion === RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SCHEMA_VERSION &&
    report.source === RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_RESUME_PILOT_SOURCE &&
    report.legacyAuthoritative === true &&
    report.eventLogAuthoritative === false &&
    report.authority.diagnosticOnly === true &&
    report.authority.readonly === true &&
    report.authority.legacyCheckpointStoreAuthoritative === true &&
    report.authority.eventLogCurrentAuthority === false &&
    report.authority.runtimeBehaviorChanged === false &&
    report.authority.taskLoopDecisionChanged === false &&
    report.authority.replaySideEffects === false &&
    report.authority.schemaChanged === false &&
    report.authority.persistenceWritten === false &&
    report.authority.transportCalled === false &&
    report.evidenceUse.eventLogDiagnosticsAreCompletionProof === false &&
    report.evidenceUse.replayComparisonIsCompletionProof === false &&
    report.evidenceUse.retentionSummaryIsCompletionProof === false &&
    report.evidenceUse.pilotDecisionIsCompletionProof === false &&
    report.evidenceUse.pilotDecisionChangesRuntimeBehavior === false;
  const ready = report.decision === "ready_for_controlled_dual_read_pilot";
  const requiredScenariosCovered = RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_SCENARIOS
    .every((scenario) => report.matrix.controlledCorpusCoveredScenarios.includes(scenario));
  const parityMatched = report.matrix.cases
    .filter((item) => item.scenario === "clean")
    .every((item) => item.comparisonStatus === "matched" && item.vetoGates.length === 0);
  const vetoesBlocking = report.vetoSummary.gates
    .every((item) => item.pilotGateBlocksResumeChange);
  const noBoundaryGap =
    report.boundary.missingSurfaces.length === 0 &&
    report.boundary.forbiddenDetectedSurfaces.length === 0;
  const liveEvidenceValid = report.liveEvidence.valid === true;
  const summary = {
    controlledDualReadReportPresent: true,
    controlledDualReadReportReady: ready,
    controlledDualReadReportValid: valid,
    requiredScenariosCovered,
    parityMatched,
    vetoesBlocking,
    liveEvidenceValid,
  };
  const diagnostics = [
    ...(!valid
      ? [diagnostic({
          code: "dual_read_report_invalid",
          severity: "error",
          message: "Controlled dual-read report authority or evidence fields are invalid.",
        })]
      : []),
    ...(!ready
      ? [diagnostic({
          code: "dual_read_report_not_ready",
          severity: "error",
          message: "Controlled dual-read report is not ready.",
        })]
      : []),
    ...(!requiredScenariosCovered || !parityMatched || !liveEvidenceValid
      ? [diagnostic({
          code: "dual_read_authority_drift",
          severity: "error",
          message: "Controlled dual-read evidence is incomplete or not parity-clean.",
        })]
      : []),
    ...(!vetoesBlocking
      ? [diagnostic({
          code: "dual_read_veto_not_blocking",
          severity: "error",
          message: "A controlled dual-read veto is not blocking the pilot.",
        })]
      : []),
    ...(!noBoundaryGap
      ? [diagnostic({
          code: "dual_read_boundary_gap",
          severity: "error",
          message: "Controlled dual-read boundary evidence is missing or forbidden.",
        })]
      : []),
  ];
  return { summary, diagnostics };
}

function gateDiagnostics(
  input: RuntimeEventLogLimitedAuthorityInput,
): RuntimeEventLogLimitedAuthorityDiagnostic[] {
  return [
    ...(input.explicitInvocation === true
      ? []
      : [diagnostic({
          code: "explicit_invocation_required",
          severity: "error",
          message: "Limited authority pilot requires explicit invocation.",
        })]),
    ...(input.explicitPilotEnabled === true
      ? []
      : [diagnostic({
          code: "pilot_disabled",
          severity: "error",
          message: "Limited authority pilot is disabled unless explicitly enabled.",
        })]),
    ...(input.operatorGateOpen === true
      ? []
      : [diagnostic({
          code: "operator_gate_closed",
          severity: "error",
          message: "Limited authority pilot requires an open operator gate.",
        })]),
    ...(input.killSwitchActive === true
      ? [diagnostic({
          code: "kill_switch_active",
          severity: "error",
          message: "Limited authority pilot kill switch is active.",
        })]
      : []),
  ];
}

function boundarySummary(
  inputs: readonly RuntimeEventLogLimitedAuthorityBoundaryInput[],
): RuntimeEventLogLimitedAuthorityReport["boundaries"] {
  const known = new Map(inputs.map((item) => [item.boundary, item.clear]));
  return {
    required: [...RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES],
    clear: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES
      .filter((boundary) => known.get(boundary) === true),
    missing: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES
      .filter((boundary) => !known.has(boundary)),
    forbidden: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES
      .filter((boundary) => known.get(boundary) === false),
  };
}

function rollbackSummary(
  rollback: RuntimeEventLogLimitedAuthorityRollbackInput | undefined,
): RuntimeEventLogLimitedAuthorityReport["rollback"] {
  const summary = {
    longTaskCheckpointsFallbackVerified:
      rollback?.longTaskCheckpointsFallbackVerified === true,
    disableOnlyRollback: rollback?.disableOnlyRollback === true,
    noSchemaRollbackRequired: rollback?.noSchemaRollbackRequired === true,
    noTransportRollbackRequired: rollback?.noTransportRollbackRequired === true,
    noApiUiRollbackRequired: rollback?.noApiUiRollbackRequired === true,
    noTaskLoopRollbackRequired: rollback?.noTaskLoopRollbackRequired === true,
    noProviderRollbackRequired: rollback?.noProviderRollbackRequired === true,
  };
  return {
    ...summary,
    ready: Object.values(summary).every(Boolean),
  };
}

function boundaryDiagnostics(
  boundaries: RuntimeEventLogLimitedAuthorityReport["boundaries"],
): RuntimeEventLogLimitedAuthorityDiagnostic[] {
  return [
    ...boundaries.missing.map((boundary) =>
      diagnostic({
        code: "boundary_missing",
        severity: "warning",
        message: "A required limited authority boundary proof is missing.",
        boundary,
      })
    ),
    ...boundaries.forbidden.map((boundary) =>
      diagnostic({
        code: "boundary_forbidden",
        severity: "error",
        message: "A limited authority boundary reports forbidden drift.",
        boundary,
      })
    ),
  ];
}

function rollbackDiagnostics(
  rollback: RuntimeEventLogLimitedAuthorityReport["rollback"],
): RuntimeEventLogLimitedAuthorityDiagnostic[] {
  const requirements: [keyof typeof rollback, string][] = [
    ["longTaskCheckpointsFallbackVerified", "Fallback to long_task_checkpoints must be verified."],
    ["disableOnlyRollback", "Rollback must be disable-only."],
    ["noSchemaRollbackRequired", "Rollback must not require schema changes."],
    ["noTransportRollbackRequired", "Rollback must not require transport changes."],
    ["noApiUiRollbackRequired", "Rollback must not require API or UI changes."],
    ["noTaskLoopRollbackRequired", "Rollback must not require TaskLoop behavior changes."],
    ["noProviderRollbackRequired", "Rollback must not require provider changes."],
  ];
  return requirements.flatMap(([key, message]) =>
    rollback[key] === true
      ? []
      : [diagnostic({
          code: "rollback_proof_missing",
          severity: "warning",
          message,
          metadata: { requirement: key },
        })]
  );
}

function boundedDiagnostics(
  diagnostics: RuntimeEventLogLimitedAuthorityDiagnostic[],
  maxDiagnostics: number,
): RuntimeEventLogLimitedAuthorityDiagnostic[] {
  if (diagnostics.length <= maxDiagnostics) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, maxDiagnostics - 1)),
    diagnostic({
      code: "bounded_output",
      severity: "warning",
      message: "Limited authority diagnostics were bounded.",
      metadata: {
        diagnosticCount: diagnostics.length,
        maxDiagnostics,
      },
    }),
  ];
}

function diagnostic(
  input: RuntimeEventLogLimitedAuthorityDiagnostic,
): RuntimeEventLogLimitedAuthorityDiagnostic {
  return input;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}
