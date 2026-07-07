import type { RuntimeEventLogControlledDualReadReport } from "./event-log-controlled-dual-read-resume-pilot.js";
import type { RuntimeEventLogLimitedAuthorityReport } from "./event-log-limited-authority-cutover-pilot.js";

export const RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SCHEMA_VERSION =
  1 as const;
export const RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SOURCE =
  "runtime.event_log.limited_authority.explicit_internal_wiring_readiness" as const;

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringDecision =
  | "blocked_before_explicit_internal_wiring"
  | "needs_more_internal_wiring_evidence"
  | "ready_for_explicit_internal_wiring_review";

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringCouplingStatus =
  | "healthy"
  | "acceptable_with_constraints"
  | "too_coupled_blocked";

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringRisk =
  | "low"
  | "medium"
  | "high";

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticCode =
  | "explicit_invocation_required"
  | "caller_provided_inputs_required"
  | "controlled_dual_read_report_not_ready"
  | "limited_authority_cutover_report_not_ready"
  | "scorecard_missing"
  | "thresholds_missing"
  | "scorecard_hard_veto"
  | "score_below_threshold"
  | "diagnostic_grouping_summary_missing"
  | "authority_boundary_drift"
  | "bounded_output";

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic = {
  code: RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringThresholds = {
  minScore: number;
  hardVetoCount: number;
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringScorecard = {
  score: number;
  metrics: {
    hardVetoCount: number;
  };
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticGroup = {
  family: string;
  diagnosticCount: number;
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput = {
  explicitInvocation?: boolean;
  callerProvidedInputs?: boolean;
  controlledDualReadReport?: RuntimeEventLogControlledDualReadReport;
  limitedAuthorityReport?: RuntimeEventLogLimitedAuthorityReport;
  internalOptimizationScorecard?: RuntimeEventLogLimitedAuthorityExplicitInternalWiringScorecard;
  thresholds?: RuntimeEventLogLimitedAuthorityExplicitInternalWiringThresholds;
  diagnosticGroupingSummary?: readonly RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticGroup[];
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringOptions = {
  maxDiagnostics?: number;
  maxDiagnosticGroups?: number;
};

export type RuntimeEventLogLimitedAuthorityExplicitInternalWiringReport = {
  schemaVersion: typeof RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SCHEMA_VERSION;
  source: typeof RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SOURCE;
  decision: RuntimeEventLogLimitedAuthorityExplicitInternalWiringDecision;
  explicitInvocation: boolean;
  callerProvidedInputs: boolean;
  component: {
    layer: "runtime-core";
    integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness";
    runtimeBehaviorWiring: false;
    taskLoopDefaultDecisionWiring: false;
    gatewayOrUiSurface: false;
    persistenceSurface: false;
  };
  consumedInputs: {
    controlledDualReadReport: boolean;
    limitedAuthorityCutoverReport: boolean;
    internalOptimizationScorecard: boolean;
    thresholds: boolean;
    diagnosticGroupingSummary: boolean;
  };
  diagnosticGroupingSummary: {
    groupCount: number;
    reportedGroupCount: number;
    truncated: boolean;
    groups: RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticGroup[];
  };
  hardVetoSummary: {
    count: number;
    reasons: string[];
  };
  couplingAssessment: {
    couplingStatus: RuntimeEventLogLimitedAuthorityExplicitInternalWiringCouplingStatus;
    integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness";
    consumedInputs: string[];
    forbiddenDependencies: string[];
    authorityRisk: RuntimeEventLogLimitedAuthorityExplicitInternalWiringRisk;
    redundancyRisk: RuntimeEventLogLimitedAuthorityExplicitInternalWiringRisk;
    maintenanceRisk: RuntimeEventLogLimitedAuthorityExplicitInternalWiringRisk;
    decisionImpact: string;
    nextAllowedStep: string;
  };
  authorityBoundary: {
    checkpointAuthority: "long_task_checkpoints";
    legacyCheckpointsDefaultAuthoritative: true;
    resumeAuthorityChanged: false;
    defaultEventLogEnabled: false;
    eventLogDefaultAuthority: false;
    runtimeBehaviorChanged: false;
    taskLoopDecisionChanged: false;
    gatewayChanged: false;
    uiChanged: false;
    apiChanged: false;
    schemaChanged: false;
    providerChanged: false;
    transportCalled: false;
  };
  completionProof: {
    readinessDecisionIsCompletionProof: false;
    helperReportsAreCompletionProof: false;
    diagnosticsAreCompletionProof: false;
  };
  diagnostics: RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic[];
};

const DEFAULT_MAX_DIAGNOSTICS = 8;
const DEFAULT_MAX_DIAGNOSTIC_GROUPS = 8;

const CONSUMED_INPUTS = [
  "controlled dual-read report",
  "limited-authority cutover report",
  "internal optimization scorecard",
  "internal optimization thresholds",
  "diagnostic grouping summary",
] as const;

const FORBIDDEN_DEPENDENCIES = [
  "resume authority changes",
  "default event-log enablement",
  "TaskLoop default decisions",
  "Gateway transport",
  "Electron IPC",
  "renderer UI",
  "host-api or api-client contracts",
  "shared transport contracts",
  "provider transport",
  "schema table index migration",
  "DB JSON JSONL TXT sidecar writes",
  "service listener daemon server exporter collector",
  "replay side effects",
  "prompt model-message provider-ordering retry approval tool-policy",
  "completion proof from helper reports",
] as const;

export function buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
  input: RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput = {},
  options: RuntimeEventLogLimitedAuthorityExplicitInternalWiringOptions = {},
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringReport {
  const limits = {
    maxDiagnostics: normalizeLimit(options.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS),
    maxDiagnosticGroups: normalizeLimit(
      options.maxDiagnosticGroups,
      DEFAULT_MAX_DIAGNOSTIC_GROUPS,
    ),
  };
  const hardVetoReasons = hardVetoReasonsFor(input);
  const evidenceGaps = evidenceGapsFor(input);
  const allDiagnostics = [
    ...hardVetoReasons.map(reasonToErrorDiagnostic),
    ...evidenceGaps.map(reasonToWarningDiagnostic),
  ];
  const diagnostics = boundedDiagnostics(allDiagnostics, limits.maxDiagnostics);
  const couplingStatus = couplingStatusFor(hardVetoReasons, evidenceGaps);
  const allGroups = [...(input.diagnosticGroupingSummary ?? [])];
  const groups = allGroups
    .slice(0, limits.maxDiagnosticGroups)
    .map((group) => ({
      family: safeLabel(group.family, "diagnostic_group"),
      diagnosticCount: nonNegativeInt(group.diagnosticCount),
    }));

  return {
    schemaVersion: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SCHEMA_VERSION,
    source: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_EXPLICIT_INTERNAL_WIRING_SOURCE,
    decision: decisionFor(hardVetoReasons, evidenceGaps),
    explicitInvocation: input.explicitInvocation === true,
    callerProvidedInputs: input.callerProvidedInputs === true,
    component: {
      layer: "runtime-core",
      integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness",
      runtimeBehaviorWiring: false,
      taskLoopDefaultDecisionWiring: false,
      gatewayOrUiSurface: false,
      persistenceSurface: false,
    },
    consumedInputs: {
      controlledDualReadReport: input.controlledDualReadReport !== undefined,
      limitedAuthorityCutoverReport: input.limitedAuthorityReport !== undefined,
      internalOptimizationScorecard: input.internalOptimizationScorecard !== undefined,
      thresholds: input.thresholds !== undefined,
      diagnosticGroupingSummary: input.diagnosticGroupingSummary !== undefined,
    },
    diagnosticGroupingSummary: {
      groupCount: allGroups.length,
      reportedGroupCount: groups.length,
      truncated: groups.length < allGroups.length,
      groups,
    },
    hardVetoSummary: {
      count: hardVetoReasons.length,
      reasons: hardVetoReasons,
    },
    couplingAssessment: {
      couplingStatus,
      integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness",
      consumedInputs: [...CONSUMED_INPUTS],
      forbiddenDependencies: [...FORBIDDEN_DEPENDENCIES],
      authorityRisk: couplingStatus === "healthy" ? "low" : "high",
      redundancyRisk: "low",
      maintenanceRisk: couplingStatus === "too_coupled_blocked" ? "medium" : "low",
      decisionImpact: "review/spec progression only; runtime behavior remains unchanged",
      nextAllowedStep: nextAllowedStepFor(couplingStatus),
    },
    authorityBoundary: {
      checkpointAuthority: "long_task_checkpoints",
      legacyCheckpointsDefaultAuthoritative: true,
      resumeAuthorityChanged: false,
      defaultEventLogEnabled: false,
      eventLogDefaultAuthority: false,
      runtimeBehaviorChanged: false,
      taskLoopDecisionChanged: false,
      gatewayChanged: false,
      uiChanged: false,
      apiChanged: false,
      schemaChanged: false,
      providerChanged: false,
      transportCalled: false,
    },
    completionProof: {
      readinessDecisionIsCompletionProof: false,
      helperReportsAreCompletionProof: false,
      diagnosticsAreCompletionProof: false,
    },
    diagnostics,
  };
}

function hardVetoReasonsFor(
  input: RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput,
): string[] {
  return [
    ...(input.explicitInvocation === true ? [] : ["explicit invocation is required"]),
    ...(input.callerProvidedInputs === true ? [] : ["caller-provided inputs are required"]),
    ...(input.controlledDualReadReport?.decision === "ready_for_controlled_dual_read_pilot"
      ? []
      : ["controlled dual-read report is missing or not ready"]),
    ...(input.limitedAuthorityReport?.decision === "ready_for_explicit_limited_event_log_pilot"
      ? []
      : ["limited-authority cutover report is missing or not ready"]),
    ...scorecardHardVetoReasons(input),
    ...(authorityBoundaryIsPreserved(input) ? [] : ["authority boundary drift detected"]),
  ];
}

function scorecardHardVetoReasons(
  input: RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput,
): string[] {
  if (!input.internalOptimizationScorecard) {
    return ["internal optimization scorecard is missing"];
  }
  if (!input.thresholds) {
    return ["internal optimization thresholds are missing"];
  }
  return input.internalOptimizationScorecard.metrics.hardVetoCount <=
      input.thresholds.hardVetoCount
    ? []
    : ["scorecard hard veto count is non-zero"];
}

function evidenceGapsFor(
  input: RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput,
): string[] {
  if (!input.internalOptimizationScorecard || !input.thresholds) {
    return [];
  }
  return [
    ...(input.internalOptimizationScorecard.score >= input.thresholds.minScore
      ? []
      : ["internal optimization score is below threshold"]),
    ...((input.diagnosticGroupingSummary?.length ?? 0) > 0
      ? []
      : ["diagnostic grouping summary is missing"]),
  ];
}

function authorityBoundaryIsPreserved(
  input: RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput,
): boolean {
  const limitedAuthority = input.limitedAuthorityReport;
  if (!limitedAuthority) {
    return true;
  }
  const dualReadAuthority = input.controlledDualReadReport?.authority;
  return limitedAuthority.fallbackSource === "long_task_checkpoints" &&
    limitedAuthority.authority.legacyCheckpointsDefaultAuthoritative === true &&
    limitedAuthority.authority.legacyCheckpointsAuthoritativeOutsideExplicitPilot === true &&
    limitedAuthority.authority.defaultRuntimeBehaviorChanged === false &&
    limitedAuthority.authority.taskLoopDecisionChanged === false &&
    limitedAuthority.authority.replaySideEffects === false &&
    limitedAuthority.authority.schemaChanged === false &&
    limitedAuthority.authority.transportCalled === false &&
    limitedAuthority.authority.apiOrUiChanged === false &&
    limitedAuthority.authority.providerChanged === false &&
    limitedAuthority.completionProof.helperDecisionChangesRuntimeBehavior === false &&
    limitedAuthority.completionProof.diagnosticsAreCompletionProof === false &&
    limitedAuthority.completionProof.replayComparisonIsCompletionProof === false &&
    (
      dualReadAuthority === undefined ||
      (
        dualReadAuthority.legacyCheckpointStoreAuthoritative === true &&
        dualReadAuthority.eventLogCurrentAuthority === false &&
        dualReadAuthority.runtimeBehaviorChanged === false &&
        dualReadAuthority.taskLoopDecisionChanged === false &&
        dualReadAuthority.replaySideEffects === false &&
        dualReadAuthority.schemaChanged === false &&
        dualReadAuthority.persistenceWritten === false &&
        dualReadAuthority.transportCalled === false
      )
    );
}

function reasonToErrorDiagnostic(
  reason: string,
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic {
  const codes: Record<string, RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticCode> = {
    "explicit invocation is required": "explicit_invocation_required",
    "caller-provided inputs are required": "caller_provided_inputs_required",
    "controlled dual-read report is missing or not ready":
      "controlled_dual_read_report_not_ready",
    "limited-authority cutover report is missing or not ready":
      "limited_authority_cutover_report_not_ready",
    "internal optimization scorecard is missing": "scorecard_missing",
    "internal optimization thresholds are missing": "thresholds_missing",
    "scorecard hard veto count is non-zero": "scorecard_hard_veto",
    "authority boundary drift detected": "authority_boundary_drift",
  };
  return {
    code: codes[reason],
    severity: "error",
    message: reason,
  };
}

function reasonToWarningDiagnostic(
  reason: string,
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic {
  const codes: Record<string, RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnosticCode> = {
    "internal optimization score is below threshold": "score_below_threshold",
    "diagnostic grouping summary is missing": "diagnostic_grouping_summary_missing",
  };
  return {
    code: codes[reason],
    severity: "warning",
    message: reason,
  };
}

function boundedDiagnostics(
  diagnostics: RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic[],
  maxDiagnostics: number,
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringDiagnostic[] {
  if (diagnostics.length <= maxDiagnostics) {
    return diagnostics;
  }
  return [
    ...diagnostics.slice(0, Math.max(0, maxDiagnostics - 1)),
    {
      code: "bounded_output",
      severity: "warning",
      message: "explicit internal wiring readiness diagnostics were bounded",
    },
  ];
}

function couplingStatusFor(
  hardVetoReasons: readonly string[],
  evidenceGaps: readonly string[],
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringCouplingStatus {
  if (hardVetoReasons.length > 0) {
    return "too_coupled_blocked";
  }
  if (evidenceGaps.length > 0) {
    return "acceptable_with_constraints";
  }
  return "healthy";
}

function decisionFor(
  hardVetoReasons: readonly string[],
  evidenceGaps: readonly string[],
): RuntimeEventLogLimitedAuthorityExplicitInternalWiringDecision {
  if (hardVetoReasons.length > 0) {
    return "blocked_before_explicit_internal_wiring";
  }
  if (evidenceGaps.length > 0) {
    return "needs_more_internal_wiring_evidence";
  }
  return "ready_for_explicit_internal_wiring_review";
}

function nextAllowedStepFor(
  couplingStatus: RuntimeEventLogLimitedAuthorityExplicitInternalWiringCouplingStatus,
): string {
  if (couplingStatus === "too_coupled_blocked") {
    return "repair caller-provided evidence before any internal wiring review";
  }
  if (couplingStatus === "acceptable_with_constraints") {
    return "collect stronger caller-provided evidence before review";
  }
  return "Workflow Checkpoint Engine review of explicit internal wiring readiness; no direct runtime wiring";
}

function safeLabel(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:/ -]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 96);
  return normalized || fallback;
}

function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) {
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
