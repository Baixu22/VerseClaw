import { describe, expect, it } from "vitest";
import {
  RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES,
  buildRuntimeEventLogResumeCutoverReadinessReport,
  type RuntimeEventLogResumeCutoverCaseInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime event-log resume cutover readiness", () => {
  it("recommends only a limited future pilot proposal when matrix, vetoes, boundaries, and rollback are complete", () => {
    const report = buildRuntimeEventLogResumeCutoverReadinessReport({
      cases: completeMatrixCases(),
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "runtime.event_log.resume_cutover_readiness",
      recommendation: "ready_for_limited_future_pilot_proposal",
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
      evidenceUse: {
        eventLogDiagnosticsAreCompletionProof: false,
        replayComparisonIsCompletionProof: false,
        retentionSummaryIsCompletionProof: false,
        readinessReportIsCompletionProof: false,
        readinessReportEnablesCutover: false,
      },
      rollback: {
        ready: true,
        longTaskCheckpointsAuthoritative: true,
      },
    });
    expect(report.matrix.missingScenarios).toEqual([]);
    expect(report.boundary.cutoverDetectedSurfaces).toEqual([]);
    expect(report.vetoSummary.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scenario: "mismatch",
        gate: "comparison_mismatch",
        proposedGateBlocksCutover: true,
      }),
      expect.objectContaining({
        scenario: "unsafe_side_effect_ambiguity",
        gate: "unsafe_side_effect_ambiguity",
        proposedGateBlocksCutover: true,
      }),
    ]));
    expect(JSON.stringify(report)).not.toContain("cutover_enabled");
  });

  it("blocks readiness when a required veto case is not marked as blocking", () => {
    const cases = completeMatrixCases().map((item) =>
      item.scenario === "mismatch"
        ? { ...item, proposedGateBlocksCutover: false }
        : item
    );
    const report = buildRuntimeEventLogResumeCutoverReadinessReport({
      cases,
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    });

    expect(report.recommendation).toBe("blocked_for_cutover");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "veto_gate_not_blocking",
      severity: "error",
      scenario: "mismatch",
      gate: "comparison_mismatch",
    }));
    expect(report.legacyAuthoritative).toBe(true);
    expect(report.eventLogAuthoritative).toBe(false);
  });

  it("stays in needs_more_evidence when matrix, boundary scans, or rollback proof are incomplete", () => {
    const report = buildRuntimeEventLogResumeCutoverReadinessReport({
      cases: [cleanCase()],
      boundaryScans: [{ surface: "task_loop", clear: true }],
      rollback: { longTaskCheckpointsAuthoritative: true },
    });

    expect(report.recommendation).toBe("needs_more_evidence");
    expect(report.matrix.missingScenarios).toEqual(expect.arrayContaining([
      "partial",
      "unreadable",
      "missing_table",
      "missing_checkpoint",
    ]));
    expect(report.boundary.missingSurfaces).toContain("gateway");
    expect(report.rollback.ready).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "matrix_case_missing", severity: "warning" }),
      expect.objectContaining({ code: "boundary_scan_missing", severity: "warning" }),
      expect.objectContaining({ code: "rollback_requirement_missing", severity: "warning" }),
    ]));
  });

  it("blocks when boundary evidence reports a forbidden surface", () => {
    const scans = allClearBoundaryScans().map((scan) =>
      scan.surface === "gateway" ? { ...scan, clear: false } : scan
    );
    const report = buildRuntimeEventLogResumeCutoverReadinessReport({
      cases: completeMatrixCases(),
      boundaryScans: scans,
      rollback: readyRollback(),
    });

    expect(report.recommendation).toBe("blocked_for_cutover");
    expect(report.boundary.cutoverDetectedSurfaces).toEqual(["gateway"]);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "boundary_cutover_detected",
      severity: "error",
      surface: "gateway",
    }));
  });

  it("bounds and sanitizes matrix output without exposing raw details", () => {
    const sensitiveCase: RuntimeEventLogResumeCutoverCaseInput = {
      ...cleanCase(),
      caseId: "SECRET_CASE_process.env",
      scenario: "mismatch",
      comparisonStatus: "mismatch",
      proposedGateBlocksCutover: false,
      mismatchFields: [
        "checkpoint.payload.body",
        "toolOutput.raw",
        "status",
        "prompt.transcript",
      ],
      blockingDiagnosticCodes: ["apiKey", "state_mismatch"],
    };
    const report = buildRuntimeEventLogResumeCutoverReadinessReport({
      cases: [sensitiveCase, ...completeMatrixCases()],
      boundaryScans: allClearBoundaryScans(),
      rollback: readyRollback(),
    }, {
      maxCases: 1,
      maxDiagnostics: 8,
      maxTokensPerList: 2,
    });

    expect(report.matrix.truncated).toBe(true);
    expect(report.matrix.reportedCaseCount).toBe(1);
    expect(report.matrix.cases[0]).toMatchObject({
      caseId: "case",
      mismatchFields: ["redacted", "redacted"],
      blockingDiagnosticCodes: ["redacted", "state_mismatch"],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("SECRET_CASE");
    expect(serialized).not.toContain("process.env");
    expect(serialized).not.toContain("checkpoint.payload.body");
    expect(serialized).not.toContain("toolOutput");
    expect(serialized).not.toContain("prompt.transcript");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("cutover_enabled");
    expect(report.legacyAuthoritative).toBe(true);
    expect(report.eventLogAuthoritative).toBe(false);
  });
});

function completeMatrixCases(): RuntimeEventLogResumeCutoverCaseInput[] {
  return [
    cleanCase(),
    {
      caseId: "partial-corrupt-row",
      scenario: "partial",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      proposedGateBlocksCutover: true,
      corruptRowCount: 1,
      eventCount: 12,
      replayableEventCount: 11,
    },
    {
      caseId: "unreadable-store",
      scenario: "unreadable",
      eventLogReadStatus: "unreadable",
      comparisonStatus: "event_log_unreadable",
      proposedGateBlocksCutover: true,
    },
    {
      caseId: "corrupt-row",
      scenario: "corrupt_row",
      eventLogReadStatus: "partial",
      comparisonStatus: "matched",
      proposedGateBlocksCutover: true,
      corruptRowCount: 1,
    },
    {
      caseId: "missing-table",
      scenario: "missing_table",
      eventLogReadStatus: "missing_table",
      comparisonStatus: "not_run",
      proposedGateBlocksCutover: true,
    },
    {
      caseId: "missing-checkpoint",
      scenario: "missing_checkpoint",
      eventLogReadStatus: "clean",
      comparisonStatus: "legacy_missing",
      proposedGateBlocksCutover: true,
      legacyCheckpointPresent: false,
      latestCheckpointPresent: false,
    },
    {
      caseId: "retention-pruned-with-anchor",
      scenario: "retention_pruned",
      eventLogReadStatus: "clean",
      comparisonStatus: "matched",
      proposedGateBlocksCutover: false,
      retentionPruned: true,
      latestCheckpointPresent: true,
      eventCount: 300,
      replayableEventCount: 80,
    },
    {
      caseId: "mismatch",
      scenario: "mismatch",
      eventLogReadStatus: "clean",
      comparisonStatus: "mismatch",
      proposedGateBlocksCutover: true,
      mismatchFields: ["status"],
    },
    {
      caseId: "unsafe-side-effect-ambiguity",
      scenario: "unsafe_side_effect_ambiguity",
      eventLogReadStatus: "clean",
      comparisonStatus: "waiting_verification",
      proposedGateBlocksCutover: true,
      unsafeSideEffectAmbiguity: true,
      blockingDiagnosticCodes: ["ambiguous_mutating_tool_result"],
    },
  ];
}

function cleanCase(): RuntimeEventLogResumeCutoverCaseInput {
  return {
    caseId: "clean-match",
    scenario: "clean",
    eventLogReadStatus: "clean",
    comparisonStatus: "matched",
    proposedGateBlocksCutover: false,
    legacyCheckpointPresent: true,
    latestCheckpointPresent: true,
    eventCount: 10,
    replayableEventCount: 10,
    corruptRowCount: 0,
  };
}

function allClearBoundaryScans() {
  return RUNTIME_EVENT_LOG_RESUME_CUTOVER_REQUIRED_BOUNDARY_SURFACES.map((surface) => ({
    surface,
    clear: true,
  }));
}

function readyRollback() {
  return {
    longTaskCheckpointsAuthoritative: true,
    canDisableFuturePilot: true,
    canReturnToLegacyCheckpoints: true,
    noSchemaRollbackRequired: true,
    noSidecarCleanupRequired: true,
  };
}
