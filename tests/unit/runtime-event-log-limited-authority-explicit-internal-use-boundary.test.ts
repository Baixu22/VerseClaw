import { describe, expect, it } from "vitest";
import {
  buildRuntimeEventLogLimitedAuthorityDeepEvaluation,
  type DeepEvaluationScorecard,
} from "./helpers/runtime-event-log-limited-authority-deep-eval";
import type {
  RuntimeEventLogControlledDualReadReport,
  RuntimeEventLogLimitedAuthorityReport,
} from "../../openclaw_runtime/src/runtime-core";

type CouplingStatus = "healthy" | "acceptable_with_constraints" | "too_coupled_blocked";
type CouplingRisk = "low" | "medium" | "high";
type BoundaryDecision =
  | "blocked_before_internal_use_boundary"
  | "needs_more_coupling_evidence"
  | "ready_for_explicit_internal_wiring_spec_or_next_boundary_hardening";

type ExplicitInternalUseBoundaryAssessment = {
  couplingStatus: CouplingStatus;
  integrationPoint: string;
  consumedInputs: string[];
  forbiddenDependencies: string[];
  authorityRisk: CouplingRisk;
  redundancyRisk: CouplingRisk;
  maintenanceRisk: CouplingRisk;
  decisionImpact: string;
  nextAllowedStep: string;
  hardVetoSummary: {
    count: number;
    reasons: string[];
  };
  decision: BoundaryDecision;
};

describe("runtime event-log limited authority explicit internal use boundary", () => {
  it("keeps the boundary as Workflow Checkpoint Engine readiness review, not runtime wiring", () => {
    const evaluation = buildRuntimeEventLogLimitedAuthorityDeepEvaluation();
    const readyObservation = evaluation.observations.find((item) => item.id === "clean-ready-1");
    const readyCase = evaluation.corpus.find((item) => item.id === "clean-ready-1");
    const dualReadReport = readyCase?.input.controlledDualReadReport;

    expect(readyObservation).toBeDefined();
    expect(dualReadReport).toBeDefined();

    const assessment = buildExplicitInternalUseBoundaryAssessment({
      controlledDualReadReport: dualReadReport as RuntimeEventLogControlledDualReadReport,
      limitedAuthorityReport: readyObservation?.report as RuntimeEventLogLimitedAuthorityReport,
      scorecard: evaluation.scorecard,
    });

    expect(assessment).toEqual({
      couplingStatus: "healthy",
      integrationPoint: "Workflow Checkpoint Engine explicit internal readiness boundary",
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
        "fresh explicit internal wiring spec or continued boundary hardening; no direct wiring",
      hardVetoSummary: {
        count: 0,
        reasons: [],
      },
      decision: "ready_for_explicit_internal_wiring_spec_or_next_boundary_hardening",
    });
  });

  it("blocks before internal use when caller-provided reports are not ready", () => {
    const evaluation = buildRuntimeEventLogLimitedAuthorityDeepEvaluation();
    const blockedObservation = evaluation.observations.find(
      (item) => item.id === "missing-dual-read-1",
    );

    expect(blockedObservation).toBeDefined();

    const assessment = buildExplicitInternalUseBoundaryAssessment({
      controlledDualReadReport: undefined,
      limitedAuthorityReport: blockedObservation?.report as RuntimeEventLogLimitedAuthorityReport,
      scorecard: {
        ...evaluation.scorecard,
        metrics: {
          ...evaluation.scorecard.metrics,
          hardVetoCount: 1,
        },
      },
    });

    expect(assessment.couplingStatus).toBe("too_coupled_blocked");
    expect(assessment.hardVetoSummary).toEqual({
      count: 3,
      reasons: [
        "controlled dual-read report is missing or not ready",
        "limited-authority cutover report is not ready",
        "scorecard hard veto count is non-zero",
      ],
    });
    expect(assessment.decision).toBe("blocked_before_internal_use_boundary");
    expect(assessment.nextAllowedStep).toBe("repair caller-provided reports before any fresh spec");
  });
});

function buildExplicitInternalUseBoundaryAssessment(input: {
  controlledDualReadReport: RuntimeEventLogControlledDualReadReport | undefined;
  limitedAuthorityReport: RuntimeEventLogLimitedAuthorityReport;
  scorecard: DeepEvaluationScorecard;
}): ExplicitInternalUseBoundaryAssessment {
  const vetoReasons = [
    ...(input.controlledDualReadReport?.decision === "ready_for_controlled_dual_read_pilot"
      ? []
      : ["controlled dual-read report is missing or not ready"]),
    ...(input.limitedAuthorityReport.decision === "ready_for_explicit_limited_event_log_pilot"
      ? []
      : ["limited-authority cutover report is not ready"]),
    ...(input.scorecard.metrics.hardVetoCount === 0
      ? []
      : ["scorecard hard veto count is non-zero"]),
    ...(input.scorecard.score >= input.scorecard.thresholds.minScore
      ? []
      : ["scorecard is below threshold"]),
  ];
  const healthy = vetoReasons.length === 0 &&
    input.limitedAuthorityReport.fallbackSource === "long_task_checkpoints" &&
    input.limitedAuthorityReport.authority.defaultRuntimeBehaviorChanged === false &&
    input.limitedAuthorityReport.authority.taskLoopDecisionChanged === false &&
    input.limitedAuthorityReport.authority.schemaChanged === false &&
    input.limitedAuthorityReport.authority.transportCalled === false &&
    input.limitedAuthorityReport.authority.apiOrUiChanged === false &&
    input.limitedAuthorityReport.authority.providerChanged === false &&
    input.limitedAuthorityReport.completionProof.helperDecisionChangesRuntimeBehavior === false;

  return {
    couplingStatus: healthy ? "healthy" : "too_coupled_blocked",
    integrationPoint: "Workflow Checkpoint Engine explicit internal readiness boundary",
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
    authorityRisk: healthy ? "low" : "high",
    redundancyRisk: "low",
    maintenanceRisk: healthy ? "low" : "medium",
    decisionImpact: "review/spec progression only; runtime behavior remains unchanged",
    nextAllowedStep: healthy
      ? "fresh explicit internal wiring spec or continued boundary hardening; no direct wiring"
      : "repair caller-provided reports before any fresh spec",
    hardVetoSummary: {
      count: vetoReasons.length,
      reasons: vetoReasons,
    },
    decision: healthy
      ? "ready_for_explicit_internal_wiring_spec_or_next_boundary_hardening"
      : "blocked_before_internal_use_boundary",
  };
}
