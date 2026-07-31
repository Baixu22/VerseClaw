import { describe, expect, it } from "vitest";
import {
  buildUas06RealCohortReport,
  digestUas06DiagnosticEvidence,
  UAS06_FROZEN_LOCKS,
  UAS06_LIVE_OBSERVATIONS_SCHEMA,
  validateUas06LiveEvidence,
  type Uas06DiagnosticEvidence,
  type Uas06LiveEvidenceRecord,
} from "./real-canary-evidence.js";
import {
  UAS06_ENGINEERING_SCENARIOS,
  type Uas06CanaryObservation,
} from "./single-plane-canary.js";

const digest = `sha256:${"a".repeat(64)}`;
const capturedAt = "2026-07-30T12:00:00.000Z";

function engineeringObservation(
  scenario: Uas06CanaryObservation["scenario"],
): Uas06CanaryObservation {
  return {
    observationId: `engineering-${scenario}`,
    source: "engineering",
    cohortId: "uas-06-engineering",
    cohortArm: "verseshell",
    scenario,
    eligibleLocal: true,
    executionHost: "verseshell",
    lifecycleOwner: "verseshell",
    nativeFallback: false,
    outcome: "completed",
    durationMs: 10,
    recoveryState:
      scenario === "cancel" || scenario === "timeout"
        ? "killed"
        : scenario === "restart"
          ? "lost"
          : "exited",
    unauthorizedExecutionCount: 0,
    duplicateProcessCount: 0,
    lostOutputBytes: 0,
    sensitiveOutputLeakCount: 0,
    ...(scenario === "rollback" ? { rollbackSucceeded: true } : {}),
  };
}

function liveRecord(params: {
  arm: "baseline" | "verseshell";
  scenario: Uas06CanaryObservation["scenario"];
  sequence: number;
  pairedTaskId?: string;
}): Uas06LiveEvidenceRecord {
  const isVerseShell = params.arm === "verseshell";
  const observation = {
    observationId: `live-${params.arm}-${params.scenario}-${params.sequence}`,
    source: "live" as const,
    cohortId: "cohort-01",
    cohortArm: params.arm,
    scenario: params.scenario,
    ...(params.pairedTaskId ? { pairedTaskId: params.pairedTaskId } : {}),
    eligibleLocal: isVerseShell,
    executionHost: isVerseShell ? ("verseshell" as const) : ("gateway" as const),
    lifecycleOwner: isVerseShell ? ("verseshell" as const) : ("native" as const),
    nativeFallback: false,
    outcome: "completed" as const,
    durationMs: 20,
    recoveryState: "exited" as const,
    unauthorizedExecutionCount: 0,
    duplicateProcessCount: 0,
    lostOutputBytes: 0,
    sensitiveOutputLeakCount: 0,
    ...(params.scenario === "rollback" ? { rollbackSucceeded: true } : {}),
    operatorReviewed: true as const,
    providerUsage: {
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.012,
      actual: true as const,
    },
    humanRecoveryMinutes: params.scenario === "rollback" ? 1 : 0,
  };
  const diagnosticBase: Omit<Uas06DiagnosticEvidence, "recordDigest"> = {
    source: "diagnostics.stability",
    capturedAt,
    window: { sinceSeq: params.sequence - 1, lastSeq: params.sequence, dropped: 0 },
    event: {
      seq: params.sequence,
      timestampMs: 1_760_000_000_000 + params.sequence,
      type: "exec.process.completed",
      target: "host",
      selectedHost: observation.executionHost,
      executionHost: observation.executionHost,
      lifecycleOwner: observation.lifecycleOwner,
      ...(isVerseShell ? { cohortRoute: "verseshell-single-plane" as const } : {}),
      nativeFallback: observation.nativeFallback,
      recoveryState: observation.recoveryState,
      outcome: observation.outcome,
      durationMs: observation.durationMs,
    },
  };
  return {
    observation,
    diagnostic: {
      ...diagnosticBase,
      recordDigest: digestUas06DiagnosticEvidence(diagnosticBase),
    },
    providerReceipt: {
      source: "provider-billing-export",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      receiptRef: `receipt-${params.sequence}`,
      capturedAt,
      receiptDigest: digest,
      usage: observation.providerUsage,
    },
    humanReview: {
      reviewerId: "operator-01",
      reviewedAt: capturedAt,
      humanRecoveryMinutes: observation.humanRecoveryMinutes,
      attestationDigest: digest,
    },
    ...(params.scenario === "rollback"
      ? {
          rollbackReview: {
            reviewerId: "operator-01",
            reviewedAt: capturedAt,
            killSwitchEngaged: true as const,
            priorHost: "gateway" as const,
            restoredHost: "gateway" as const,
            attestationDigest: digest,
          },
        }
      : {}),
  };
}

describe("UAS-06 reviewed live evidence", () => {
  it("keeps the empty template non-qualifying", () => {
    const validation = validateUas06LiveEvidence({
      schema: UAS06_LIVE_OBSERVATIONS_SCHEMA,
      observations: [],
    });
    expect(validation.issues).toEqual([]);
    expect(validation.document).toBeDefined();
  });

  it("requires matching undropped diagnostics and reviewed billing evidence", () => {
    const baseline = liveRecord({
      arm: "baseline",
      scenario: "short",
      sequence: 11,
      pairedTaskId: "pair-01",
    });
    const verseshell = liveRecord({
      arm: "verseshell",
      scenario: "short",
      sequence: 12,
      pairedTaskId: "pair-01",
    });
    const rollback = liveRecord({ arm: "verseshell", scenario: "rollback", sequence: 13 });
    const document = {
      schema: UAS06_LIVE_OBSERVATIONS_SCHEMA,
      cohortId: "cohort-01",
      observations: [baseline, verseshell, rollback],
    };

    expect(validateUas06LiveEvidence(document).issues).toEqual([]);
    const report = buildUas06RealCohortReport({
      document,
      engineeringObservations: UAS06_ENGINEERING_SCENARIOS.map(engineeringObservation),
      generatedAt: capturedAt,
      liveObservationsSha256: "a".repeat(64),
      engineeringReportSha256: "b".repeat(64),
      sourceInventory: [],
    });
    expect(report.summary.status).toBe("eligible-for-closeout-review");
    expect(report.evidenceCounts).toMatchObject({
      liveObservations: 3,
      diagnosticsWindows: 3,
      providerReceipts: 3,
      humanReviews: 3,
      reviewedRollbackDrills: 1,
    });
    expect(report.closeout).toEqual({
      eligibleForTaskForestReview: true,
      taskForestCloseoutAuthorized: false,
      productGraduationAuthorized: false,
      requiredNextAction: "independent evidence review and explicit Task Forest closeout confirmation",
    });
    expect(report.frozenLocks).toEqual(UAS06_FROZEN_LOCKS);
  });

  it("rejects a dropped or mismatched diagnostic window before report generation", () => {
    const record = liveRecord({ arm: "verseshell", scenario: "short", sequence: 21 });
    const dropped = structuredClone(record);
    dropped.diagnostic.window.dropped = 1;
    expect(
      validateUas06LiveEvidence({
        schema: UAS06_LIVE_OBSERVATIONS_SCHEMA,
        cohortId: "cohort-01",
        observations: [dropped],
      }).issues,
    ).toContain("observations.0.diagnostic.window.dropped");

    const mismatched = structuredClone(record);
    mismatched.providerReceipt.usage = { ...mismatched.providerReceipt.usage };
    mismatched.providerReceipt.usage.inputTokens += 1;
    expect(
      validateUas06LiveEvidence({
        schema: UAS06_LIVE_OBSERVATIONS_SCHEMA,
        cohortId: "cohort-01",
        observations: [mismatched],
      }).issues,
    ).toContain("observations.0.providerReceipt.usageMismatch");
  });
});
