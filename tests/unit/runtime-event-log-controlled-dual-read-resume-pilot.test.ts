import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES,
  buildRuntimeEventLogControlledDualReadResumePilotReport,
  type RuntimeEventLogControlledDualReadCaseInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime event-log controlled dual-read resume pilot", () => {
  it("defaults closed and keeps runtime authority with legacy checkpoints", () => {
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport();

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.event_log.controlled_dual_read_resume_pilot",
      decision: "blocked_before_pilot",
      legacyAuthoritative: true,
      eventLogAuthoritative: false,
      explicitInvocation: false,
      explicitPilotEnabled: false,
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
      evidenceUse: {
        eventLogDiagnosticsAreCompletionProof: false,
        replayComparisonIsCompletionProof: false,
        retentionSummaryIsCompletionProof: false,
        pilotDecisionIsCompletionProof: false,
        pilotDecisionChangesRuntimeBehavior: false,
      },
    });
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "explicit_invocation_required", severity: "error" }),
      expect.objectContaining({ code: "pilot_disabled", severity: "error" }),
    ]));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("returns ready only when controlled corpus, boundaries, rollback, and veto gates are complete", () => {
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      cases: completeControlledCorpusCases(),
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    });

    expect(report.decision).toBe("ready_for_controlled_dual_read_pilot");
    expect(report.matrix.missingScenarios).toEqual([]);
    expect(report.matrix.controlledCorpusMissingScenarios).toEqual([]);
    expect(report.matrix.liveCoveredScenarios).toEqual([]);
    expect(report.liveEvidence).toMatchObject({ used: false, valid: true });
    expect(report.boundary.forbiddenDetectedSurfaces).toEqual([]);
    expect(report.rollback.ready).toBe(true);
    expect(report.vetoSummary.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scenario: "mismatch",
        gate: "comparison_mismatch",
        pilotGateBlocksResumeChange: true,
      }),
      expect.objectContaining({
        scenario: "mismatch",
        gate: "resume_status_mismatch",
        pilotGateBlocksResumeChange: true,
      }),
      expect.objectContaining({
        scenario: "unsafe_side_effect_ambiguity",
        gate: "unsafe_side_effect_ambiguity",
        pilotGateBlocksResumeChange: true,
      }),
    ]));
    expect(report.diagnostics.every((item) => item.severity !== "error")).toBe(true);
    expect(report.diagnostics.every((item) => item.severity !== "warning")).toBe(true);
    expectForbiddenOutputStringsAbsent(report);
  });

  it("stays in needs_more_live_evidence when corpus, boundary, or rollback evidence is incomplete", () => {
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      cases: [cleanCase()],
      boundaryScans: [{ surface: "task_loop", clear: true }],
      rollback: { longTaskCheckpointsAuthoritative: true },
    });

    expect(report.decision).toBe("needs_more_live_evidence");
    expect(report.matrix.missingScenarios).toContain("mismatch");
    expect(report.matrix.controlledCorpusMissingScenarios).toContain("unsafe_side_effect_ambiguity");
    expect(report.boundary.missingSurfaces).toContain("gateway");
    expect(report.rollback.ready).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "matrix_case_missing", severity: "warning" }),
      expect.objectContaining({ code: "controlled_corpus_case_missing", severity: "warning" }),
      expect.objectContaining({ code: "boundary_scan_missing", severity: "warning" }),
      expect.objectContaining({ code: "rollback_requirement_missing", severity: "warning" }),
    ]));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("blocks when a veto case is not marked as blocking pilot readiness", () => {
    const cases = completeControlledCorpusCases().map((item) =>
      item.scenario === "mismatch"
        ? { ...item, pilotGateBlocksResumeChange: false }
        : item
    );
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      cases,
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    });

    expect(report.decision).toBe("blocked_before_pilot");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "veto_gate_not_blocking",
      severity: "error",
      scenario: "mismatch",
      gate: "comparison_mismatch",
    }));
    expect(report.authority.legacyCheckpointStoreAuthoritative).toBe(true);
    expect(report.authority.eventLogCurrentAuthority).toBe(false);
    expect(report.legacyAuthoritative).toBe(true);
    expect(report.eventLogAuthoritative).toBe(false);
    expectForbiddenOutputStringsAbsent(report);
  });

  it("requires live evidence summaries to be explicit, bounded, sanitized, and caller-provided", () => {
    const liveCase: RuntimeEventLogControlledDualReadCaseInput = {
      ...cleanCase(),
      caseId: "live-clean",
      evidenceSource: "live_diagnostic_summary",
    };
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      cases: [...completeControlledCorpusCases(), liveCase],
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
      liveEvidenceContract: {
        explicitConsent: true,
        bounded: true,
        sanitized: false,
        callerProvided: true,
        rawDetailsExcluded: true,
      },
    });

    expect(report.decision).toBe("blocked_before_pilot");
    expect(report.liveEvidence).toMatchObject({
      used: true,
      explicitConsent: true,
      bounded: true,
      sanitized: false,
      callerProvided: true,
      rawDetailsExcluded: true,
      valid: false,
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "live_evidence_contract_invalid",
      severity: "error",
      metadata: { requirement: "sanitized" },
    }));
    expectForbiddenOutputStringsAbsent(report);
  });

  it("bounds and sanitizes comparison output without leaking raw details", () => {
    const sensitiveCase: RuntimeEventLogControlledDualReadCaseInput = {
      ...cleanCase(),
      caseId: "SECRET_CASE_process.env",
      scenario: "mismatch",
      comparisonStatus: "mismatch",
      pilotGateBlocksResumeChange: true,
      legacyCheckpointToken: "checkpoint.payload.body",
      eventLogCheckpointToken: "record_json.raw",
      legacyResumeStatus: "completed",
      eventLogResumeStatus: "prompt.transcript",
      mismatchFields: [
        "checkpoint.payload.body",
        "toolOutput.raw",
        "status",
        "prompt.transcript",
      ],
      blockingDiagnosticCodes: ["apiKey", "state_mismatch"],
    };
    const report = buildRuntimeEventLogControlledDualReadResumePilotReport({
      explicitInvocation: true,
      explicitPilotEnabled: true,
      cases: [sensitiveCase, ...completeControlledCorpusCases()],
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    }, {
      maxCases: 1,
      maxDiagnostics: 8,
      maxTokensPerList: 2,
    });

    expect(report.decision).toBe("blocked_before_pilot");
    expect(report.matrix.truncated).toBe(true);
    expect(report.matrix.reportedCaseCount).toBe(1);
    expect(report.matrix.cases[0]).toMatchObject({
      caseId: "case",
      legacyCheckpointToken: "legacy_checkpoint",
      eventLogCheckpointToken: "event_log_checkpoint",
      eventLogResumeStatus: "event_log_status",
      mismatchFields: ["redacted", "redacted"],
      blockingDiagnosticCodes: ["redacted", "state_mismatch"],
      sanitization: { redactedTokenCount: 6 },
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "sensitive_token_redacted",
      severity: "error",
      caseId: "case",
    }));

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("SECRET_CASE");
    expect(serialized).not.toContain("process.env");
    expect(serialized).not.toContain("checkpoint.payload.body");
    expect(serialized).not.toContain("record_json");
    expect(serialized).not.toContain("toolOutput");
    expect(serialized).not.toContain("prompt.transcript");
    expect(serialized).not.toContain("apiKey");
    expectForbiddenOutputStringsAbsent(report);
  });
});

function completeControlledCorpusCases(): RuntimeEventLogControlledDualReadCaseInput[] {
  return [
    cleanCase(),
    {
      caseId: "partial-corrupt-row",
      scenario: "partial",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      pilotGateBlocksResumeChange: true,
      corruptRowCount: 1,
      eventCount: 12,
      replayableEventCount: 11,
      legacyCheckpointToken: "checkpoint-2",
      eventLogCheckpointToken: "checkpoint-2",
      legacyResumeStatus: "running",
      eventLogResumeStatus: "running",
    },
    {
      caseId: "unreadable-store",
      scenario: "unreadable",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "unreadable",
      comparisonStatus: "event_log_unreadable",
      pilotGateBlocksResumeChange: true,
      legacyCheckpointToken: "checkpoint-3",
      eventLogCheckpointToken: "checkpoint-3",
    },
    {
      caseId: "corrupt-row",
      scenario: "corrupt_row",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      pilotGateBlocksResumeChange: true,
      corruptRowCount: 1,
      legacyCheckpointToken: "checkpoint-4",
      eventLogCheckpointToken: "checkpoint-4",
    },
    {
      caseId: "missing-table",
      scenario: "missing_table",
      evidenceSource: "controlled_corpus",
      eventLogReadStatus: "missing_table",
      comparisonStatus: "not_run",
      pilotGateBlocksResumeChange: true,
      legacyCheckpointToken: "checkpoint-5",
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
      eventLogCheckpointToken: "checkpoint-6",
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
      eventCount: 300,
      replayableEventCount: 80,
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
      legacyCheckpointToken: "checkpoint-9",
      eventLogCheckpointToken: "checkpoint-9",
    },
  ];
}

function cleanCase(): RuntimeEventLogControlledDualReadCaseInput {
  return {
    caseId: "clean-match",
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
    eventCount: 10,
    replayableEventCount: 10,
    corruptRowCount: 0,
  };
}

function allClearBoundaryScans() {
  return RUNTIME_EVENT_LOG_CONTROLLED_DUAL_READ_REQUIRED_BOUNDARY_SURFACES.map((surface) => ({
    surface,
    clear: true,
  }));
}

function readyRollback() {
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

function expectForbiddenOutputStringsAbsent(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("cutover_enabled");
  expect(serialized).not.toContain("event_log_authoritative");
  expect(serialized).not.toContain("prefer_event_log");
  expect(serialized).not.toContain("runtime.resume.preferEventLog");
  expect(serialized).not.toContain("default_on");
  expect(serialized).not.toContain("default-on");
}
