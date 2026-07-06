import { describe, expect, it } from "vitest";
import {
  buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness,
  type RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildRuntimeEventLogLimitedAuthorityDeepEvaluation,
} from "./helpers/runtime-event-log-limited-authority-deep-eval";
import type {
  RuntimeEventLogControlledDualReadReport,
  RuntimeEventLogLimitedAuthorityReport,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime event-log limited authority explicit internal wiring readiness", () => {
  it("is a runtime-core readiness component with explicit caller-provided entry gates", () => {
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({});

    expect(assessment.source).toBe(
      "runtime.event_log.limited_authority.explicit_internal_wiring_readiness",
    );
    expect(assessment.component).toEqual({
      layer: "runtime-core",
      integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness",
      runtimeBehaviorWiring: false,
      taskLoopDefaultDecisionWiring: false,
      gatewayOrUiSurface: false,
      persistenceSurface: false,
    });
    expect(assessment.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(assessment.hardVetoSummary.reasons).toEqual([
      "explicit invocation is required",
      "caller-provided inputs are required",
      "controlled dual-read report is missing or not ready",
      "limited-authority cutover report is missing or not ready",
      "internal optimization scorecard is missing",
    ]);
  });

  it("returns ready for review when all caller-provided inputs are ready", () => {
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
      readyInput(),
    );

    expect(assessment.decision).toBe("ready_for_explicit_internal_wiring_review");
    expect(assessment.couplingAssessment).toEqual({
      couplingStatus: "healthy",
      integrationPoint: "Workflow Checkpoint Engine explicit internal wiring readiness",
      consumedInputs: [
        "controlled dual-read report",
        "limited-authority cutover report",
        "internal optimization scorecard",
        "internal optimization thresholds",
        "diagnostic grouping summary",
      ],
      forbiddenDependencies: [
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
      ],
      authorityRisk: "low",
      redundancyRisk: "low",
      maintenanceRisk: "low",
      decisionImpact: "review/spec progression only; runtime behavior remains unchanged",
      nextAllowedStep:
        "Workflow Checkpoint Engine review of explicit internal wiring readiness; no direct runtime wiring",
    });
    expect(assessment.hardVetoSummary).toEqual({ count: 0, reasons: [] });
    expect(assessment.consumedInputs).toEqual({
      controlledDualReadReport: true,
      limitedAuthorityCutoverReport: true,
      internalOptimizationScorecard: true,
      thresholds: true,
      diagnosticGroupingSummary: true,
    });
  });

  it("blocks when controlled dual-read report is missing or not ready", () => {
    const missingReport = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({
      ...readyInput(),
      controlledDualReadReport: undefined,
    });
    const nonReadyReport = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({
      ...readyInput(),
      controlledDualReadReport: {
        ...readyInput().controlledDualReadReport,
        decision: "blocked_before_pilot",
      } as RuntimeEventLogControlledDualReadReport,
    });

    expect(missingReport.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(nonReadyReport.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(missingReport.hardVetoSummary.reasons).toContain(
      "controlled dual-read report is missing or not ready",
    );
    expect(nonReadyReport.hardVetoSummary.reasons).toContain(
      "controlled dual-read report is missing or not ready",
    );
  });

  it("blocks when limited-authority cutover report is not ready", () => {
    const input = readyInput();
    const evaluation = buildRuntimeEventLogLimitedAuthorityDeepEvaluation();
    const blockedObservation = evaluation.observations.find(
      (item) => item.id === "missing-dual-read-1",
    );

    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({
      ...input,
      limitedAuthorityReport: blockedObservation?.report as RuntimeEventLogLimitedAuthorityReport,
    });

    expect(assessment.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(assessment.hardVetoSummary.reasons).toContain(
      "limited-authority cutover report is missing or not ready",
    );
  });

  it("blocks when scorecard hard veto count is non-zero", () => {
    const input = readyInput();
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({
      ...input,
      internalOptimizationScorecard: {
        ...input.internalOptimizationScorecard,
        metrics: {
          ...input.internalOptimizationScorecard?.metrics,
          hardVetoCount: 1,
        },
      },
    });

    expect(assessment.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(assessment.hardVetoSummary).toEqual({
      count: 1,
      reasons: ["scorecard hard veto count is non-zero"],
    });
  });

  it("asks for more evidence when score is below threshold without a hard veto", () => {
    const input = readyInput();
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness({
      ...input,
      internalOptimizationScorecard: {
        ...input.internalOptimizationScorecard,
        score: input.thresholds!.minScore - 1,
        metrics: {
          ...input.internalOptimizationScorecard!.metrics,
          hardVetoCount: 0,
        },
      },
    });

    expect(assessment.decision).toBe("needs_more_internal_wiring_evidence");
    expect(assessment.couplingAssessment.couplingStatus).toBe("acceptable_with_constraints");
    expect(assessment.hardVetoSummary).toEqual({ count: 0, reasons: [] });
  });

  it("bounds diagnostics and diagnostic groups while preserving fail-closed decision", () => {
    const input = readyInput();
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
      {
        ...input,
        controlledDualReadReport: undefined,
        limitedAuthorityReport: {
          ...input.limitedAuthorityReport,
          decision: "use_legacy_checkpoints",
        } as RuntimeEventLogLimitedAuthorityReport,
        internalOptimizationScorecard: {
          ...input.internalOptimizationScorecard,
          score: input.thresholds!.minScore - 1,
          metrics: {
            ...input.internalOptimizationScorecard!.metrics,
            hardVetoCount: 1,
          },
        },
        diagnosticGroupingSummary: [
          ...(input.diagnosticGroupingSummary ?? []),
          ...(input.diagnosticGroupingSummary ?? []),
        ],
      },
      { maxDiagnostics: 3, maxDiagnosticGroups: 2 },
    );

    expect(assessment.decision).toBe("blocked_before_explicit_internal_wiring");
    expect(assessment.diagnostics).toHaveLength(3);
    expect(assessment.diagnostics.at(-1)?.code).toBe("bounded_output");
    expect(assessment.diagnosticGroupingSummary.reportedGroupCount).toBe(2);
    expect(assessment.diagnosticGroupingSummary.truncated).toBe(true);
  });

  it("does not leak forbidden authority strings in output", () => {
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
      readyInput(),
    );
    const serialized = JSON.stringify(assessment);
    const forbiddenStrings = [
      "cutover_enabled",
      "event_log_authoritative",
      "prefer_event_log",
      "runtime.resume.preferEventLog",
      "default_on",
      "default-on",
      "defaultOn",
    ];

    expect(forbiddenStrings.filter((value) => serialized.includes(value))).toEqual([]);
  });

  it("keeps completion proof false and long_task_checkpoints authoritative", () => {
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
      readyInput(),
    );

    expect(assessment.completionProof).toEqual({
      readinessDecisionIsCompletionProof: false,
      helperReportsAreCompletionProof: false,
      diagnosticsAreCompletionProof: false,
    });
    expect(assessment.authorityBoundary.checkpointAuthority).toBe("long_task_checkpoints");
    expect(assessment.authorityBoundary.legacyCheckpointsDefaultAuthoritative).toBe(true);
  });

  it("keeps runtime behavior and transport surfaces unchanged", () => {
    const assessment = buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness(
      readyInput(),
    );

    expect(assessment.authorityBoundary).toMatchObject({
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
    });
  });
});

function readyInput(): RuntimeEventLogLimitedAuthorityExplicitInternalWiringInput {
  const evaluation = buildRuntimeEventLogLimitedAuthorityDeepEvaluation();
  const readyObservation = evaluation.observations.find((item) => item.id === "clean-ready-1");
  const readyCase = evaluation.corpus.find((item) => item.id === "clean-ready-1");
  return {
    explicitInvocation: true,
    callerProvidedInputs: true,
    controlledDualReadReport: readyCase?.input
      .controlledDualReadReport as RuntimeEventLogControlledDualReadReport,
    limitedAuthorityReport: readyObservation?.report as RuntimeEventLogLimitedAuthorityReport,
    internalOptimizationScorecard: evaluation.scorecard,
    thresholds: evaluation.scorecard.thresholds,
    diagnosticGroupingSummary: evaluation.diagnosticGroups,
  };
}
