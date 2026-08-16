/**
 * Refusal classification coverage: model safety refusals must classify as a
 * dedicated failover reason so configured model fallbacks can engage.
 */
import { describe, expect, it } from "vitest";
import {
  classifyFailoverReason,
  isFailoverAssistantError,
} from "./errors.js";

const REFUSAL_MESSAGE =
  "refusal: The model declined this request (stop_reason: refusal). Try rephrasing or using a different model.";

describe("model refusal failover classification", () => {
  it("classifies the stable refusal message as the refusal reason", () => {
    expect(classifyFailoverReason(REFUSAL_MESSAGE)).toBe("refusal");
    expect(
      classifyFailoverReason(
        "refusal: The model declined this request (stop_reason: sensitive).",
      ),
    ).toBe("refusal");
  });

  it("classifies raw stop_reason refusal text", () => {
    expect(classifyFailoverReason("provider error: stop_reason: refusal")).toBe("refusal");
  });

  it("flags refusal assistant errors for failover", () => {
    const message = {
      role: "assistant",
      stopReason: "error",
      errorMessage: REFUSAL_MESSAGE,
      provider: "anthropic",
    } as never;
    expect(isFailoverAssistantError(message)).toBe(true);
  });

  it("does not classify unrelated messages as refusals", () => {
    expect(classifyFailoverReason("An unknown error occurred")).not.toBe("refusal");
    expect(classifyFailoverReason("502 Bad Gateway")).not.toBe("refusal");
  });
});
