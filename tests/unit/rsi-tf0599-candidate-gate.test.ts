// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  baseEnvelope,
  buildCandidateGateReport,
  loadInputs,
  runNegativeControls,
  summarizeCandidateTrials,
  validateCandidateGate,
} from "../../scripts/rsi-tf0599-candidate-gate.mjs";

const ROOT = process.cwd();

describe("TF-0599 candidate evaluation gate", () => {
  it("binds the sealed 24-case TF-0604 corpus without inventing a baseline", () => {
    const inputs = loadInputs(ROOT);
    const envelope = baseEnvelope(inputs.corpus);
    expect(validateCandidateGate(inputs, envelope, ROOT).passed).toBe(true);
    const report = buildCandidateGateReport(inputs, envelope, ROOT);
    expect(report.status).toBe("not-run");
    expect(report.gate).toBe("insufficient-evidence");
    expect(report.aggregate.completeCaseCount).toBe(0);
    expect(report.aggregate.passK).toBeNull();
    expect(report.aggregate.passAtK).toBeNull();
    expect(report.claims.promotionReady).toBe(false);
  });

  it("rejects each gate-bypass mutation", () => {
    const inputs = loadInputs(ROOT);
    const envelope = baseEnvelope(inputs.corpus);
    const controls = runNegativeControls(inputs, envelope, ROOT);
    expect(controls).toHaveLength(10);
    expect(controls.every((control) => control.passed)).toBe(true);
  });

  it("keeps incomplete trials out of the denominator", () => {
    const inputs = loadInputs(ROOT);
    const envelope = baseEnvelope(inputs.corpus);
    const raw = structuredClone(inputs.raw);
    raw.cases[0].trials = ["pass", "skip", "pass"];
    const aggregate = summarizeCandidateTrials(inputs.corpus, raw, envelope);
    expect(aggregate.completeCaseCount).toBe(0);
    expect(aggregate.incomplete).toContainEqual({ caseId: inputs.corpus.cases[0].id, trialIndex: 1, outcome: "skip" });
  });

  it("requires distinct executor and verifier actors", () => {
    const inputs = loadInputs(ROOT);
    const envelope = baseEnvelope(inputs.corpus);
    envelope.verifierActor = envelope.executorActor;
    expect(validateCandidateGate(inputs, envelope, ROOT).errors.map((entry) => entry.code)).toContain("independent-verifier");
  });
});