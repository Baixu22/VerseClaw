// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildCandidate,
  loadInputs,
  mineWeaknesses,
  runSelfHarnessNegativeControls,
  validateSelfHarness,
  writeSelfHarnessPack,
} from "../../scripts/rsi-tf0606-self-harness.mjs";

describe("TF-0606 Self-Harness research loop", () => {
  it("keeps all 24 tasks visible and selects an advisory SEKB candidate", () => {
    const inputs = loadInputs(process.cwd());
    const weaknesses = mineWeaknesses(inputs.corpus);
    const candidate = buildCandidate(inputs.corpus, weaknesses);
    expect(weaknesses).toHaveLength(24);
    expect(new Set(weaknesses.map((entry) => entry.caseId)).size).toBe(24);
    expect(candidate.surface).toBe("sekb-playbook");
    expect(candidate.autoMerge).toBe(false);
    expect(candidate.promotionReady).toBe(false);
    expect(candidate.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("reports No-Go without a held-out trial run", () => {
    const { report, validation, controls } = writeSelfHarnessPack(process.cwd());
    expect(report.status).toBe("insufficient-evidence");
    expect(report.evaluation.completeCaseCount).toBe(0);
    expect(report.evaluation.passK).toBeNull();
    expect(report.claims.promotionReady).toBe(false);
    expect(validation.passed).toBe(true);
    expect(controls).toHaveLength(7);
    expect(controls.every((control) => control.passed)).toBe(true);
  });

  it("rejects an unsafe surface, auto merge, self promotion and missing contrast", () => {
    const { report, validation, controls } = writeSelfHarnessPack(process.cwd());
    expect(validation.passed).toBe(true);
    expect(report.autoMerge).toBe(false);
    expect(report.promotionReady).toBe(false);
    expect(controls.map((control) => control.id)).toEqual(expect.arrayContaining(["unsafe-surface", "auto-merge", "self-promote", "missing-contrast"]));
  });

  it("fails closed when the delegated gate is not not-run", () => {
    const inputs = loadInputs(process.cwd());
    const weaknesses = mineWeaknesses(inputs.corpus);
    const candidate = buildCandidate(inputs.corpus, weaknesses);
    const report = { promotionReady: false, autoMerge: false } as never;
    const result = validateSelfHarness({ corpus: inputs.corpus, weaknesses, candidate, report, gateReport: { status: "complete", gate: "pass" } });
    expect(result.errors.map((entry) => entry.code)).toContain("gate-boundary");
  });
});