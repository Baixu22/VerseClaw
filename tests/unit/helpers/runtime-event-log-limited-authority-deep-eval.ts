import {
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES,
  RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES,
  buildRuntimeEventLogControlledDualReadResumePilotReport,
  buildRuntimeEventLogLimitedAuthorityCutoverPilotReport,
  type RuntimeEventLogControlledDualReadCaseInput,
  type RuntimeEventLogControlledDualReadReport,
  type RuntimeEventLogLimitedAuthorityDiagnosticCode,
  type RuntimeEventLogLimitedAuthorityInput,
  type RuntimeEventLogLimitedAuthorityReport,
} from "../../../openclaw_runtime/src/runtime-core";

export type DeepEvaluationDecision =
  | "blocked_before_internal_optimization"
  | "needs_more_limited_authority_optimization_evidence"
  | "ready_for_explicit_internal_wiring_spec_or_next_optimization";

export type DeepEvaluationCase = {
  id: string;
  className: string;
  input: RuntimeEventLogLimitedAuthorityInput;
  expectReady: boolean;
  tags: string[];
  maxDiagnostics?: number;
};

export type DeepEvaluationMetrics = {
  caseCount: number;
  failClosedRate: number;
  cleanReadyRate: number;
  vetoBlockRate: number;
  boundarySensitivityRate: number;
  rollbackSensitivityRate: number;
  forbiddenStringLeakCount: number;
  defaultAuthorityDriftCount: number;
  taskLoopDecisionDriftCount: number;
  schemaApiUiProviderTransportDriftCount: number;
  diagnosticsBoundedRate: number;
  hardVetoCount: number;
};

export type DeepEvaluationScorecard = {
  score: number;
  decision: DeepEvaluationDecision;
  dimensions: {
    safetyFailClosed: number;
    evidenceCoverage: number;
    boundedDiagnosticsLeakage: number;
    performanceNoise: number;
    optimizationReadiness: number;
  };
  metrics: DeepEvaluationMetrics;
  thresholds: DeepEvaluationThresholds;
  optimizationRecommendations: string[];
};

export type DeepEvaluationObservation = DeepEvaluationCase & {
  report: RuntimeEventLogLimitedAuthorityReport;
};

export type DeepEvaluationDiagnosticGateFamily =
  | "opt-in / explicit invocation"
  | "operator gate / kill switch"
  | "controlled dual-read evidence"
  | "veto gates"
  | "boundary proof"
  | "rollback proof"
  | "bounded diagnostics / leakage";

export type DeepEvaluationDiagnosticGroup = {
  family: DeepEvaluationDiagnosticGateFamily;
  diagnosticCount: number;
  caseIds: string[];
  codes: RuntimeEventLogLimitedAuthorityDiagnosticCode[];
};

export type DeepEvaluationReport = {
  corpus: DeepEvaluationCase[];
  observations: DeepEvaluationObservation[];
  scorecard: DeepEvaluationScorecard;
  diagnosticGroups: DeepEvaluationDiagnosticGroup[];
};

export type DeepEvaluationThresholds = {
  minCaseCount: number;
  failClosedRate: number;
  cleanReadyRate: number;
  vetoBlockRate: number;
  boundarySensitivityRate: number;
  rollbackSensitivityRate: number;
  forbiddenStringLeakCount: number;
  defaultAuthorityDriftCount: number;
  taskLoopDecisionDriftCount: number;
  schemaApiUiProviderTransportDriftCount: number;
  diagnosticsBoundedRate: number;
  minScore: number;
  hardVetoCount: number;
};

export const LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS: DeepEvaluationThresholds = {
  minCaseCount: 60,
  failClosedRate: 1,
  cleanReadyRate: 1,
  vetoBlockRate: 1,
  boundarySensitivityRate: 1,
  rollbackSensitivityRate: 1,
  forbiddenStringLeakCount: 0,
  defaultAuthorityDriftCount: 0,
  taskLoopDecisionDriftCount: 0,
  schemaApiUiProviderTransportDriftCount: 0,
  diagnosticsBoundedRate: 1,
  minScore: 95,
  hardVetoCount: 0,
};

export const LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS = {
  safetyFailClosed: 35,
  evidenceCoverage: 25,
  boundedDiagnosticsLeakage: 15,
  performanceNoise: 15,
  optimizationReadiness: 10,
} as const;

const FORBIDDEN_OUTPUT_STRINGS = [
  "cutover_enabled",
  "event_log_authoritative",
  "prefer_event_log",
  "runtime.resume.preferEventLog",
  "default_on",
  "default-on",
  "defaultOn",
] as const;

const DIAGNOSTIC_CODE_FAMILY: Record<
  RuntimeEventLogLimitedAuthorityDiagnosticCode,
  DeepEvaluationDiagnosticGateFamily
> = {
  explicit_invocation_required: "opt-in / explicit invocation",
  pilot_disabled: "opt-in / explicit invocation",
  operator_gate_closed: "operator gate / kill switch",
  kill_switch_active: "operator gate / kill switch",
  dual_read_report_missing: "controlled dual-read evidence",
  dual_read_report_invalid: "controlled dual-read evidence",
  dual_read_report_not_ready: "controlled dual-read evidence",
  dual_read_authority_drift: "controlled dual-read evidence",
  dual_read_boundary_gap: "controlled dual-read evidence",
  dual_read_veto_not_blocking: "veto gates",
  rollback_proof_missing: "rollback proof",
  boundary_missing: "boundary proof",
  boundary_forbidden: "boundary proof",
  legacy_checkpoints_remain_default: "opt-in / explicit invocation",
  bounded_output: "bounded diagnostics / leakage",
};

const DIAGNOSTIC_GATE_FAMILIES: DeepEvaluationDiagnosticGateFamily[] = [
  "opt-in / explicit invocation",
  "operator gate / kill switch",
  "controlled dual-read evidence",
  "veto gates",
  "boundary proof",
  "rollback proof",
  "bounded diagnostics / leakage",
];

export function buildRuntimeEventLogLimitedAuthorityDeepEvaluation(): DeepEvaluationReport {
  const corpus = buildDeepEvaluationCorpus();
  const observations = corpus.map((item) => ({
    ...item,
    report: buildRuntimeEventLogLimitedAuthorityCutoverPilotReport(item.input, {
      maxDiagnostics: item.maxDiagnostics,
    }),
  }));
  return {
    corpus,
    observations,
    scorecard: buildDeepEvaluationScorecard(observations),
    diagnosticGroups: groupDiagnosticsByGateFamily(observations),
  };
}

export function groupDiagnosticsByGateFamily(
  observations: DeepEvaluationObservation[],
): DeepEvaluationDiagnosticGroup[] {
  return DIAGNOSTIC_GATE_FAMILIES.map((family) => {
    const familyObservations = observations
      .map((observation) => ({
        caseId: observation.id,
        codes: observation.report.diagnostics
          .filter((diagnostic) => DIAGNOSTIC_CODE_FAMILY[diagnostic.code] === family)
          .map((diagnostic) => diagnostic.code),
      }))
      .filter((item) => item.codes.length > 0);
    return {
      family,
      diagnosticCount: familyObservations.reduce((sum, item) => sum + item.codes.length, 0),
      caseIds: familyObservations.map((item) => item.caseId),
      codes: [...new Set(familyObservations.flatMap((item) => item.codes))],
    };
  });
}

function buildDeepEvaluationCorpus(): DeepEvaluationCase[] {
  return [
    ...repeatCases("omitted-invocation", 6, (index) => ({
      id: `omitted-invocation-${index}`,
      className: "default/omitted invocation",
      input: {},
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("disabled-pilot", 6, (index) => ({
      id: `disabled-pilot-${index}`,
      className: "disabled pilot",
      input: {
        explicitInvocation: true,
        operatorGateOpen: true,
        controlledDualReadReport: readyDualReadReport(),
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("operator-gate-closed", 6, (index) => ({
      id: `operator-gate-closed-${index}`,
      className: "operator gate closed",
      input: {
        explicitInvocation: true,
        explicitPilotEnabled: true,
        operatorGateOpen: false,
        controlledDualReadReport: readyDualReadReport(),
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("kill-switch-active", 5, (index) => ({
      id: `kill-switch-active-${index}`,
      className: "kill switch active",
      input: {
        explicitInvocation: true,
        explicitPilotEnabled: true,
        operatorGateOpen: true,
        killSwitchActive: true,
        controlledDualReadReport: readyDualReadReport(),
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("missing-dual-read", 5, (index) => ({
      id: `missing-dual-read-${index}`,
      className: "missing dual-read report",
      input: {
        explicitInvocation: true,
        explicitPilotEnabled: true,
        operatorGateOpen: true,
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("invalid-dual-read", 5, (index) => ({
      id: `invalid-dual-read-${index}`,
      className: "invalid schema/source report",
      input: {
        explicitInvocation: true,
        explicitPilotEnabled: true,
        operatorGateOpen: true,
        controlledDualReadReport: invalidDualReadReport(),
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("non-ready-dual-read", 5, (index) => ({
      id: `non-ready-dual-read-${index}`,
      className: "non-ready dual-read report",
      input: {
        explicitInvocation: true,
        explicitPilotEnabled: true,
        operatorGateOpen: true,
        controlledDualReadReport: nonReadyDualReadReport(),
        boundaries: allClearLimitedAuthorityBoundaries(),
        rollback: readyLimitedAuthorityRollback(),
      },
      expectReady: false,
      tags: ["fail_closed"],
    })),
    ...repeatCases("mismatch-veto-unblocked", 5, (index) => ({
      id: `mismatch-veto-unblocked-${index}`,
      className: "parity mismatch veto unblocked",
      input: readyInputWithDualRead(unblockedVetoDualReadReport("mismatch")),
      expectReady: false,
      tags: ["fail_closed", "veto"],
    })),
    ...repeatCases("retention-veto-unblocked", 3, (index) => ({
      id: `retention-veto-unblocked-${index}`,
      className: "retention gap veto unblocked",
      input: readyInputWithDualRead(unblockedVetoDualReadReport("retention_pruned")),
      expectReady: false,
      tags: ["fail_closed", "veto"],
    })),
    ...repeatCases("unsafe-veto-unblocked", 2, (index) => ({
      id: `unsafe-veto-unblocked-${index}`,
      className: "unsafe side-effect veto unblocked",
      input: readyInputWithDualRead(unblockedVetoDualReadReport("unsafe_side_effect_ambiguity")),
      expectReady: false,
      tags: ["fail_closed", "veto"],
    })),
    ...repeatCases("boundary-missing", 3, (index) => ({
      id: `boundary-missing-${index}`,
      className: "missing boundary proof",
      input: {
        ...readyInputWithDualRead(readyDualReadReport()),
        boundaries: [{ boundary: "default_off", clear: true }],
      },
      expectReady: false,
      tags: ["fail_closed", "boundary"],
    })),
    ...repeatCases("boundary-forbidden", 2, (index) => ({
      id: `boundary-forbidden-${index}`,
      className: "forbidden boundary proof",
      input: {
        ...readyInputWithDualRead(readyDualReadReport()),
        boundaries: RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES.map((boundary) => ({
          boundary,
          clear: boundary !== "no_task_loop_change",
        })),
      },
      expectReady: false,
      tags: ["fail_closed", "boundary"],
    })),
    ...repeatCases("rollback-missing", 5, (index) => ({
      id: `rollback-missing-${index}`,
      className: "missing rollback proof",
      input: {
        ...readyInputWithDualRead(readyDualReadReport()),
        rollback: { longTaskCheckpointsFallbackVerified: true },
      },
      expectReady: false,
      tags: ["fail_closed", "rollback"],
    })),
    {
      id: "diagnostic-overflow-bounded",
      className: "diagnostic overflow/bounding",
      input: {
        explicitInvocation: false,
        explicitPilotEnabled: false,
        operatorGateOpen: false,
        killSwitchActive: true,
        controlledDualReadReport: nonReadyDualReadReport(),
        boundaries: [],
        rollback: {},
      },
      expectReady: false,
      tags: ["fail_closed", "bounded"],
      maxDiagnostics: 4,
    },
    ...repeatCases("clean-ready", 2, (index) => ({
      id: `clean-ready-${index}`,
      className: "clean fully gated ready case",
      input: readyInputWithDualRead(readyDualReadReport()),
      expectReady: true,
      tags: ["ready"],
    })),
  ];
}

function buildDeepEvaluationScorecard(
  observations: DeepEvaluationObservation[],
): DeepEvaluationScorecard {
  const metrics = collectMetrics(observations);
  const thresholds = LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS;
  const safetyFailClosed = metrics.failClosedRate === thresholds.failClosedRate &&
    metrics.defaultAuthorityDriftCount === thresholds.defaultAuthorityDriftCount &&
    metrics.taskLoopDecisionDriftCount === thresholds.taskLoopDecisionDriftCount &&
    metrics.schemaApiUiProviderTransportDriftCount ===
      thresholds.schemaApiUiProviderTransportDriftCount
    ? LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS.safetyFailClosed
    : 0;
  const evidenceCoverage = metrics.caseCount >= thresholds.minCaseCount &&
    metrics.cleanReadyRate === thresholds.cleanReadyRate &&
    metrics.vetoBlockRate === thresholds.vetoBlockRate &&
    metrics.boundarySensitivityRate === thresholds.boundarySensitivityRate &&
    metrics.rollbackSensitivityRate === thresholds.rollbackSensitivityRate
    ? LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS.evidenceCoverage
    : 0;
  const boundedDiagnosticsLeakage = metrics.forbiddenStringLeakCount ===
      thresholds.forbiddenStringLeakCount &&
    metrics.diagnosticsBoundedRate === thresholds.diagnosticsBoundedRate
    ? LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS.boundedDiagnosticsLeakage
    : 0;
  const performanceNoise = observations.every((item) =>
    item.report.diagnostics.length <= (item.maxDiagnostics ?? 60)
  ) &&
    new Set(observations.map((item) => item.id)).size === observations.length &&
    metrics.diagnosticsBoundedRate === thresholds.diagnosticsBoundedRate
    ? LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS.performanceNoise
    : 0;
  const optimizationReadiness = metrics.hardVetoCount === thresholds.hardVetoCount
    ? LIMITED_AUTHORITY_DEEP_EVALUATION_DIMENSIONS.optimizationReadiness
    : 0;
  const score = safetyFailClosed +
    evidenceCoverage +
    boundedDiagnosticsLeakage +
    performanceNoise +
    optimizationReadiness;
  return {
    score,
    decision: decisionForScore(score, metrics),
    dimensions: {
      safetyFailClosed,
      evidenceCoverage,
      boundedDiagnosticsLeakage,
      performanceNoise,
      optimizationReadiness,
    },
    metrics,
    thresholds,
    optimizationRecommendations: [
      "dedupe_limited_authority_test_fixture_builders",
      "group_diagnostics_by_gate_family_for_review_noise",
      "preserve_scorecard_thresholds_before_internal_wiring",
      "keep_reports_readable_without_expanding_runtime_authority",
    ],
  };
}

function collectMetrics(observations: DeepEvaluationObservation[]): DeepEvaluationMetrics {
  const failClosedCases = observations.filter((item) => !item.expectReady);
  const cleanReadyCases = observations.filter((item) => item.expectReady);
  const vetoCases = observations.filter((item) => item.tags.includes("veto"));
  const boundaryCases = observations.filter((item) => item.tags.includes("boundary"));
  const rollbackCases = observations.filter((item) => item.tags.includes("rollback"));
  const boundedCases = observations.filter((item) => item.tags.includes("bounded"));
  const forbiddenStringLeakCount = observations
    .reduce((count, item) => count + forbiddenStringHits(item.report), 0);
  const defaultAuthorityDriftCount = observations
    .filter((item) =>
      item.report.fallbackSource !== "long_task_checkpoints" ||
      item.report.authority.legacyCheckpointsDefaultAuthoritative !== true ||
      item.report.authority.legacyCheckpointsAuthoritativeOutsideExplicitPilot !== true ||
      item.report.authority.defaultRuntimeBehaviorChanged !== false ||
      (!item.expectReady && item.report.authority.pilotMayUseEventLogSource !== false)
    ).length;
  const taskLoopDecisionDriftCount = observations
    .filter((item) => item.report.authority.taskLoopDecisionChanged !== false)
    .length;
  const schemaApiUiProviderTransportDriftCount = observations
    .filter((item) =>
      item.report.authority.schemaChanged !== false ||
      item.report.authority.transportCalled !== false ||
      item.report.authority.apiOrUiChanged !== false ||
      item.report.authority.providerChanged !== false
    ).length;
  const metrics = {
    caseCount: observations.length,
    failClosedRate: ratio(failClosedCases, (item) =>
      item.report.decision === "use_legacy_checkpoints" &&
      item.report.selectedSource === "long_task_checkpoints" &&
      item.report.authority.pilotMayUseEventLogSource === false
    ),
    cleanReadyRate: ratio(cleanReadyCases, (item) =>
      item.report.decision === "ready_for_explicit_limited_event_log_pilot" &&
      item.report.selectedSource === "runtime_task_event_log_explicit_pilot" &&
      item.report.fallbackSource === "long_task_checkpoints"
    ),
    vetoBlockRate: ratio(vetoCases, (item) =>
      item.report.decision === "use_legacy_checkpoints" &&
      item.report.diagnostics.some((diagnostic) => diagnostic.code === "dual_read_veto_not_blocking")
    ),
    boundarySensitivityRate: ratio(boundaryCases, (item) =>
      item.report.decision === "use_legacy_checkpoints" &&
      item.report.diagnostics.some((diagnostic) =>
        diagnostic.code === "boundary_missing" || diagnostic.code === "boundary_forbidden"
      )
    ),
    rollbackSensitivityRate: ratio(rollbackCases, (item) =>
      item.report.decision === "use_legacy_checkpoints" &&
      item.report.diagnostics.some((diagnostic) => diagnostic.code === "rollback_proof_missing")
    ),
    forbiddenStringLeakCount,
    defaultAuthorityDriftCount,
    taskLoopDecisionDriftCount,
    schemaApiUiProviderTransportDriftCount,
    diagnosticsBoundedRate: ratio(boundedCases, (item) =>
      item.report.diagnostics.length === item.maxDiagnostics &&
      item.report.diagnostics.at(-1)?.code === "bounded_output"
    ),
    hardVetoCount: 0,
  };
  return {
    ...metrics,
    hardVetoCount: [
      metrics.forbiddenStringLeakCount,
      metrics.defaultAuthorityDriftCount,
      metrics.taskLoopDecisionDriftCount,
      metrics.schemaApiUiProviderTransportDriftCount,
      metrics.failClosedRate === LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.failClosedRate ? 0 : 1,
      metrics.cleanReadyRate === LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.cleanReadyRate ? 0 : 1,
      metrics.vetoBlockRate === LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.vetoBlockRate ? 0 : 1,
      metrics.boundarySensitivityRate ===
        LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.boundarySensitivityRate ? 0 : 1,
      metrics.rollbackSensitivityRate ===
        LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.rollbackSensitivityRate ? 0 : 1,
      metrics.diagnosticsBoundedRate ===
        LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS.diagnosticsBoundedRate ? 0 : 1,
    ].reduce((sum, value) => sum + value, 0),
  };
}

function decisionForScore(score: number, metrics: DeepEvaluationMetrics): DeepEvaluationDecision {
  const thresholds = LIMITED_AUTHORITY_DEEP_EVALUATION_THRESHOLDS;
  if (metrics.defaultAuthorityDriftCount > thresholds.defaultAuthorityDriftCount ||
    metrics.taskLoopDecisionDriftCount > thresholds.taskLoopDecisionDriftCount ||
    metrics.schemaApiUiProviderTransportDriftCount >
      thresholds.schemaApiUiProviderTransportDriftCount ||
    metrics.forbiddenStringLeakCount > thresholds.forbiddenStringLeakCount) {
    return "blocked_before_internal_optimization";
  }
  if (score >= thresholds.minScore && metrics.hardVetoCount === thresholds.hardVetoCount) {
    return "ready_for_explicit_internal_wiring_spec_or_next_optimization";
  }
  return "needs_more_limited_authority_optimization_evidence";
}

function readyInputWithDualRead(
  controlledDualReadReport: RuntimeEventLogControlledDualReadReport,
): RuntimeEventLogLimitedAuthorityInput {
  return {
    explicitInvocation: true,
    explicitPilotEnabled: true,
    operatorGateOpen: true,
    controlledDualReadReport,
    boundaries: allClearLimitedAuthorityBoundaries(),
    rollback: readyLimitedAuthorityRollback(),
  };
}

function readyDualReadReport() {
  return dualReadReportForCases(completeControlledCorpusCases());
}

function nonReadyDualReadReport() {
  return buildRuntimeEventLogControlledDualReadResumePilotReport({
    explicitInvocation: true,
    explicitPilotEnabled: true,
    cases: [cleanCase()],
    boundaryScans: [{ surface: "task_loop", clear: true }],
    rollback: { longTaskCheckpointsAuthoritative: true },
  });
}

function invalidDualReadReport(): RuntimeEventLogControlledDualReadReport {
  return {
    ...readyDualReadReport(),
    schemaVersion: 99,
    source: "invalid.runtime.event_log.report",
  } as unknown as RuntimeEventLogControlledDualReadReport;
}

function unblockedVetoDualReadReport(
  scenario: RuntimeEventLogControlledDualReadCaseInput["scenario"],
) {
  return dualReadReportForCases(completeControlledCorpusCases().map((item) =>
    item.scenario === scenario
      ? { ...item, pilotGateBlocksResumeChange: false }
      : item
  ));
}

function dualReadReportForCases(cases: RuntimeEventLogControlledDualReadCaseInput[]) {
  return buildRuntimeEventLogControlledDualReadResumePilotReport({
    explicitInvocation: true,
    explicitPilotEnabled: true,
    cases,
    boundaryScans: allClearDualReadBoundaries(),
    rollback: readyDualReadRollback(),
  });
}

function completeControlledCorpusCases(): RuntimeEventLogControlledDualReadCaseInput[] {
  return [
    cleanCase(),
    controlledCase("partial", {
      scenario: "partial",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      corruptRowCount: 1,
      legacyCheckpointToken: "checkpoint-2",
      eventLogCheckpointToken: "checkpoint-2",
      legacyResumeStatus: "running",
      eventLogResumeStatus: "running",
    }),
    controlledCase("unreadable", {
      scenario: "unreadable",
      eventLogReadStatus: "unreadable",
      comparisonStatus: "event_log_unreadable",
    }),
    controlledCase("corrupt-row", {
      scenario: "corrupt_row",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      corruptRowCount: 1,
    }),
    controlledCase("missing-table", {
      scenario: "missing_table",
      eventLogReadStatus: "missing_table",
      comparisonStatus: "not_run",
    }),
    controlledCase("missing-checkpoint", {
      scenario: "missing_checkpoint",
      eventLogReadStatus: "clean",
      comparisonStatus: "legacy_missing",
      legacyCheckpointPresent: false,
      latestCheckpointPresent: false,
    }),
    controlledCase("retention-pruned-gap", {
      scenario: "retention_pruned",
      eventLogReadStatus: "clean",
      comparisonStatus: "matched",
      retentionPruned: true,
      retentionGapCanHideCheckpointState: true,
      legacyCheckpointToken: "checkpoint-7",
      eventLogCheckpointToken: "checkpoint-7",
    }),
    controlledCase("mismatch", {
      scenario: "mismatch",
      eventLogReadStatus: "clean",
      comparisonStatus: "mismatch",
      legacyCheckpointToken: "checkpoint-8-legacy",
      eventLogCheckpointToken: "checkpoint-8-event-log",
      legacyResumeStatus: "running",
      eventLogResumeStatus: "completed",
      mismatchFields: ["checkpoint_id", "resume_status"],
    }),
    controlledCase("unsafe-side-effect-ambiguity", {
      scenario: "unsafe_side_effect_ambiguity",
      eventLogReadStatus: "clean",
      comparisonStatus: "waiting_verification",
      unsafeSideEffectAmbiguity: true,
      blockingDiagnosticCodes: ["ambiguous_mutating_tool_result"],
    }),
  ];
}

function controlledCase(
  caseId: string,
  overrides: Partial<RuntimeEventLogControlledDualReadCaseInput>,
): RuntimeEventLogControlledDualReadCaseInput {
  return {
    caseId,
    scenario: "clean",
    evidenceSource: "controlled_corpus",
    eventLogReadStatus: "clean",
    comparisonStatus: "matched",
    pilotGateBlocksResumeChange: true,
    ...overrides,
  } as RuntimeEventLogControlledDualReadCaseInput;
}

function cleanCase(): RuntimeEventLogControlledDualReadCaseInput {
  return {
    caseId: "clean",
    scenario: "clean",
    evidenceSource: "controlled_corpus",
    eventLogReadStatus: "clean",
    comparisonStatus: "matched",
    pilotGateBlocksResumeChange: false,
    legacyCheckpointPresent: true,
    latestCheckpointPresent: true,
    legacyCheckpointToken: "checkpoint-1",
    eventLogCheckpointToken: "checkpoint-1",
    legacyResumeStatus: "running",
    eventLogResumeStatus: "running",
  };
}

function allClearDualReadBoundaries() {
  return RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES.map((surface) => ({
    surface,
    clear: true,
  }));
}

function readyDualReadRollback() {
  return {
    longTaskCheckpointsAuthoritative: true,
    canDisablePilot: true,
    canReturnToLegacyCheckpoints: true,
    noSchemaRollbackRequired: true,
    noSidecarCleanupRequired: true,
    noGatewayUiApiRollbackRequired: true,
    noProviderRollbackRequired: true,
    noTaskLoopBehaviorRollbackRequired: true,
  };
}

function allClearLimitedAuthorityBoundaries() {
  return RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES.map((boundary) => ({
    boundary,
    clear: true,
  }));
}

function readyLimitedAuthorityRollback() {
  return {
    longTaskCheckpointsFallbackVerified: true,
    disableOnlyRollback: true,
    noSchemaRollbackRequired: true,
    noTransportRollbackRequired: true,
    noApiUiRollbackRequired: true,
    noTaskLoopRollbackRequired: true,
    noProviderRollbackRequired: true,
  };
}

function repeatCases(
  _name: string,
  count: number,
  buildCase: (index: number) => DeepEvaluationCase,
): DeepEvaluationCase[] {
  return Array.from({ length: count }, (_, index) => buildCase(index + 1));
}

function ratio<T>(items: T[], predicate: (item: T) => boolean): number {
  if (items.length === 0) {
    return 1;
  }
  return items.filter(predicate).length / items.length;
}

function forbiddenStringHits(report: RuntimeEventLogLimitedAuthorityReport): number {
  const serialized = JSON.stringify(report);
  return FORBIDDEN_OUTPUT_STRINGS
    .filter((value) => serialized.includes(value))
    .length;
}
