import { describe, expect, it } from "vitest";
import {
  MAX_SEKB_SHADOW_METADATA_BYTES,
  evaluateSekbShadowV1,
  type SekbShadowEvaluationInput,
} from "./shadow-evaluator.js";

const baseInput: SekbShadowEvaluationInput = {
  outcome: "success",
  toolCallCount: 1,
  toolResultCount: 1,
  toolErrorCount: 1,
  errorSignaturePresent: true,
  priorMatchingErrorSignatureCount: 1,
};

describe("SEKB shadow evaluator", () => {
  it("is deterministic, bounded, and reports unavailable evidence explicitly", () => {
    const first = evaluateSekbShadowV1(baseInput);
    const second = evaluateSekbShadowV1(baseInput);

    expect(first).toStrictEqual(second);
    expect(first.captureQuality).toMatchObject({
      schema: "sekb-capture-quality-shadow.v1",
      score: 100,
      recommendation: "retain",
      factors: {
        terminalOutcome: 1,
        toolEvidence: 1,
        errorResolutionEvidence: 1,
        recurrenceEvidence: 1,
        validationEvidence: null,
        userConfirmationEvidence: null,
      },
      evidenceMissing: ["validation", "user_confirmation"],
    });
    expect(first.completionEvidence).toMatchObject({
      schema: "sekb-completion-evidence.v1",
      status: "supported",
      terminalOutcome: "success",
      validationObserved: false,
      explicitConfirmationObserved: false,
    });
    expect(JSON.stringify(first).length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThanOrEqual(MAX_SEKB_SHADOW_METADATA_BYTES);
  });

  it.each([
    ["success", 0, "supported"],
    ["partial", 0, "partial"],
    ["failure", 1, "unsupported"],
  ] as const)("maps %s terminal evidence without inspecting textual payloads", (outcome, toolErrorCount, status) => {
    const result = evaluateSekbShadowV1({
      ...baseInput,
      outcome,
      toolErrorCount,
      errorSignaturePresent: toolErrorCount > 0,
      priorMatchingErrorSignatureCount: 0,
    });

    expect(result.completionEvidence.status).toBe(status);
  });

  it("marks low-signal trajectories for review without excluding them", () => {
    const result = evaluateSekbShadowV1({
      outcome: "partial",
      toolCallCount: 0,
      toolResultCount: 0,
      toolErrorCount: 0,
      errorSignaturePresent: false,
      priorMatchingErrorSignatureCount: 0,
    });

    expect(result.captureQuality).toMatchObject({ score: 25, recommendation: "review_low_signal" });
    expect(result.captureQuality.evidenceMissing).toContain("validation");
  });
});
