// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkTf0609Evidence,
  evaluateTf0609,
  loadTf0609Inputs,
  runTf0609Controls,
} from "../../scripts/rsi-tf0609-code-self-modification.mjs";

describe("TF-0609 code self-modification Go/No-Go gate", () => {
  it("issues fail-closed No-Go without generating or executing a code candidate", () => {
    const inputs = loadTf0609Inputs(process.cwd());
    const report = evaluateTf0609(inputs, "codex/tf0609-test-reviewer");
    expect(report.decision).toBe("no-go");
    expect(report.go).toBe(false);
    expect(report.codeCandidateGenerated).toBe(false);
    expect(report.codeCandidateExecuted).toBe(false);
    expect(report.claims.realHuman).toBe(false);
    expect(report.claims.promotionReady).toBe(false);
    expect(report.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "baseline-floor",
      "candidate-trials-incomplete",
      "held-out-unsealed",
      "independent-verdict-not-ready",
      "behavioral-rollback-missing",
      "cost-safety-evidence-missing",
    ]));
  });

  it("rejects all eight fabricated or unsafe eligibility mutations", () => {
    const controls = runTf0609Controls(loadTf0609Inputs(process.cwd()));
    expect(controls).toHaveLength(8);
    expect(controls.every((control) => control.passed)).toBe(true);
  });

  it("recomputes the saved pack and exact manifests from disk", () => {
    const result = checkTf0609Evidence(process.cwd());
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    if (!result.report) throw new Error("expected saved eligibility report");
    expect(result.report.decision).toBe("no-go");
    expect(result.controls).toHaveLength(8);
  });
});