import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES,
  RUNTIME_EVENT_LOG_LIMITED_AUTHORITY_REQUIRED_BOUNDARIES,
  buildRuntimeEventLogControlledDualReadResumePilotReport,
  buildRuntimeEventLogLimitedAuthorityCutoverPilotReport,
  type RuntimeEventLogControlledDualReadCaseInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime event-log limited authority cutover pilot", () => {
  it("defaults to legacy checkpoints with no explicit opt-in", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport();

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.event_log.limited_authority_cutover_pilot",
      decision: "use_legacy_checkpoints",
      explicitInvocation: false,
      explicitPilotEnabled: false,
      operatorGateOpen: false,
      killSwitchActive: false,
      selectedSource: "long_task_checkpoints",
      fallbackSource: "long_task_checkpoints",
      authority: {
        legacyCheckpointsDefaultAuthoritative: true,
        legacyCheckpointsAuthoritativeOutsideExplicitPilot: true,
        pilotMayUseEventLogSource: false,
        defaultRuntimeBehaviorChanged: false,
        taskLoopDecisionChanged: false,
        replaySideEffects: false,
        schemaChanged: false,
        transportCalled: false,
        apiOrUiChanged: false,
        providerChanged: false,
      },
    });
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "explicit_invocation_required", severity: "error" }),
      expect.objectContaining({ code: "pilot_disabled", severity: "error" }),
      expect.objectContaining({ code: "operator_gate_closed", severity: "error" }),
      expect.objectContaining({ code: "dual_read_report_missing", severity: "error" }),
    ]));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("fails closed when the operator gate is closed", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: false,
      controlledDualReadReport: readyDualReadReport(),
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.selectedSource).toBe("long_task_checkpoints");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "operator_gate_closed",
      severity: "error",
    }));
    expect(report.authority.pilotMayUseEventLogSource).toBe(false);
    expectForbiddenOutputStringsAbsent(report);
  });

  it("fails closed when the kill switch is active", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      killSwitchActive: true,
      controlledDualReadReport: readyDualReadReport(),
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.selectedSource).toBe("long_task_checkpoints");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "kill_switch_active",
      severity: "error",
    }));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("requires bounded controlled dual-read evidence", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.evidence).toMatchObject({
      controlledDualReadReportPresent: false,
      controlledDualReadReportReady: false,
      controlledDualReadReportValid: false,
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "dual_read_report_missing",
      severity: "error",
    }));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("rejects parity mismatch vetoes that are not blocking", () => {
    const cases = completeControlledCorpusCases().map((item) =>
      item.scenario === "mismatch"
        ? { ...item, pilotGateBlocksResumeChange: false }
        : item
    );
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      controlledDualReadReport: dualReadReportForCases(cases),
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.evidence.vetoesBlocking).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dual_read_report_not_ready", severity: "error" }),
      expect.objectContaining({ code: "dual_read_veto_not_blocking", severity: "error" }),
    ]));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("rejects unsafe side-effect and retention gap vetoes that are not blocking", () => {
    const cases = completeControlledCorpusCases().map((item) =>
      item.scenario === "unsafe_side_effect_ambiguity" ||
      item.scenario === "retention_pruned"
        ? { ...item, pilotGateBlocksResumeChange: false }
        : item
    );
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      controlledDualReadReport: dualReadReportForCases(cases),
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.evidence.vetoesBlocking).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "dual_read_veto_not_blocking",
      severity: "error",
    }));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("allows only a fully explicit, gated, rollback-proven pilot candidate", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      controlledDualReadReport: readyDualReadReport(),
      boundaries: allClearLimitedAuthorityBoundaries(),
      rollback: readyLimitedAuthorityRollback(),
    });

    expect(report.decision).toBe("ready_for_explicit_limited_event_log_pilot");
    expect(report.selectedSource).toBe("runtime_task_event_log_explicit_pilot");
    expect(report.fallbackSource).toBe("long_task_checkpoints");
    expect(report.authority).toMatchObject({
      legacyCheckpointsDefaultAuthoritative: true,
      legacyCheckpointsAuthoritativeOutsideExplicitPilot: true,
      pilotMayUseEventLogSource: true,
      defaultRuntimeBehaviorChanged: false,
      taskLoopDecisionChanged: false,
      replaySideEffects: false,
      schemaChanged: false,
      transportCalled: false,
      apiOrUiChanged: false,
      providerChanged: false,
    });
    expect(report.evidence).toMatchObject({
      controlledDualReadReportPresent: true,
      controlledDualReadReportReady: true,
      controlledDualReadReportValid: true,
      requiredScenariosCovered: true,
      parityMatched: true,
      vetoesBlocking: true,
      liveEvidenceValid: true,
    });
    expect(report.boundaries.missing).toEqual([]);
    expect(report.boundaries.forbidden).toEqual([]);
    expect(report.rollback.ready).toBe(true);
    expect(report.completionProof).toMatchObject({
      diagnosticsAreCompletionProof: false,
      replayComparisonIsCompletionProof: false,
      helperDecisionChangesRuntimeBehavior: false,
    });
    expect(report.diagnostics.every((item) => item.severity !== "error")).toBe(true);
    expect(report.diagnostics.every((item) => item.severity !== "warning")).toBe(true);
    expectForbiddenOutputStringsAbsent(report);
  });

  it("withholds pilot readiness when boundary or rollback proof is incomplete", () => {
    const report = buildRuntimeEventLogLimitedAuthorityCutoverPilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      operatorGateOpen: true,
      controlledDualReadReport: readyDualReadReport(),
      boundaries: [{ boundary: "default_off", clear: true }],
      rollback: { longTaskCheckpointsFallbackVerified: true },
    });

    expect(report.decision).toBe("use_legacy_checkpoints");
    expect(report.selectedSource).toBe("long_task_checkpoints");
    expect(report.boundaries.missing).toContain("no_task_loop_change");
    expect(report.rollback.ready).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "boundary_missing", severity: "warning" }),
      expect.objectContaining({ code: "rollback_proof_missing", severity: "warning" }),
    ]));
    expectForbiddenOutputStringsAbsent(report);
  });
});

function readyDualReadReport() {
  return dualReadReportForCases(completeControlledCorpusCases());
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
    {
      caseId: "partial",
      scenario: "partial",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      pilotGateBlocksResumeChange: true,
      corruptRowCount: 1,
      legacyCheckpointToken: "checkpoint-2",
      eventLogCheckpointToken: "checkpoint-2",
      legacyResumeStatus: "running",
      eventLogResumeStatus: "running",
    },
    {
      caseId: "unreadable",
      scenario: "unreadable",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "unreadable",
      comparisonStatus: "event_log_unreadable",
      pilotGateBlocksResumeChange: true,
    },
    {
      caseId: "corrupt-row",
      scenario: "corrupt_row",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      pilotGateBlocksResumeChange: true,
      corruptRowCount: 1,
    },
    {
      caseId: "missing-table",
      scenario: "missing_table",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "missing_table",
      comparisonStatus: "not_run",
      pilotGateBlocksResumeChange: true,
    },
    {
      caseId: "missing-checkpoint",
      scenario: "missing_checkpoint",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "clean",
      comparisonStatus: "legacy_missing",
      pilotGateBlocksResumeChange: true,
      legacyCheckpointPresent: false,
      latestCheckpointPresent: false,
    },
    {
      caseId: "retention-pruned-gap",
      scenario: "retention_pruned",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "clean",
      comparisonStatus: "matched",
      pilotGateBlocksResumeChange: true,
      retentionPruned: true,
      retentionGapCanHideCheckpointState: true,
      legacyCheckpointToken: "checkpoint-7",
      eventLogCheckpointToken: "checkpoint-7",
    },
    {
      caseId: "mismatch",
      scenario: "mismatch",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "clean",
      comparisonStatus: "mismatch",
      pilotGateBlocksResumeChange: true,
      legacyCheckpointToken: "checkpoint-8-legacy",
      eventLogCheckpointToken: "checkpoint-8-event-log",
      legacyResumeStatus: "running",
      eventLogResumeStatus: "completed",
      mismatchFields: ["checkpoint_id", "resume_status"],
    },
    {
      caseId: "unsafe-side-effect-ambiguity",
      scenario: "unsafe_side_effect_ambiguity",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "clean",
      comparisonStatus: "waiting_verification",
      pilotGateBlocksResumeChange: true,
      unsafeSideEffectAmbiguity: true,
      blockingDiagnosticCodes: ["ambiguous_mutating_tool_result"],
    },
  ];
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

function expectForbiddenOutputStringsAbsent(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("cutover_enabled");
  expect(serialized).not.toContain("event_log_authoritative");
  expect(serialized).not.toContain("prefer_event_log");
  expect(serialized).not.toContain("runtime.resume.preferEventLog");
  expect(serialized).not.toContain("default_on");
  expect(serialized).not.toContain("default-on");
  expect(serialized).not.toContain("defaultOn");
}
