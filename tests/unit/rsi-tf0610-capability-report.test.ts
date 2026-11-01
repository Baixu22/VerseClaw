// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCapabilityEvidence,
  validateCapabilityEvidence,
} from "../../scripts/rsi-tf0610-capability-report.mjs";

const report = buildCapabilityEvidence(process.cwd());

describe("TF-0610 final RSI capability evidence", () => {
  it("separates engineering closure from capability and benefit evidence", () => {
    expect(report.overall).toMatchObject({
      engineeringClosure: "complete",
      rsiCapability: "not-complete",
      evidenceDecision: "insufficient-evidence",
      codeSelfModification: "no-go",
    });
    expect(report.executionSummary.taskForestBaselineCompleteCases).toBe(0);
    expect(report.executionSummary.heldOutDigest).toBeNull();
    expect(report.executionSummary.codeCandidateGenerated).toBe(false);
    expect(report.executionSummary.codeCandidateExecuted).toBe(false);
    expect(report.executionSummary.systemTrialKind).toContain("not RSI-model benefit");
  });
  it("keeps every automated and product claim false", () => {
    expect(report.claims).toEqual({
      completeRsiImplementation: false,
      rsiBenefit: false,
      realHuman: false,
      liveProvider: false,
      promotionReady: false,
      productLocksChanged: false,
    });
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });
  it("retains owned residual triggers and recomputes the saved report", () => {
    const result = validateCapabilityEvidence(process.cwd());
    expect(result.passed).toBe(true);
    if (!result.report) throw new Error("expected capability report");
    expect(result.report.residuals.length).toBeGreaterThanOrEqual(6);
    expect(result.report.residuals.every((entry) => entry.code && entry.owner.includes("agent") && entry.reviewTrigger)).toBe(true);
  });
  it('TF-0604 gate reads the measured system run and keeps the verdict fail', () => {
    const gate = report.gates.find((entry: { id: string }) => entry.id === 'TF-0604');
    expect(gate).toMatchObject({ status: 'fail', verdict: 'fail' });
    expect(gate?.evidence).toMatchObject({ completeCaseCount: 20, passK: 0.15, passAtK: 0.35 });
    expect(report.executionSummary.systemRunPairedDiffStatus).toBe('computed');
    expect(report.executionSummary.systemRunPairedDiff).toBe(0);
  });
});