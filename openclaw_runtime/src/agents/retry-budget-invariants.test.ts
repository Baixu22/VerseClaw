import { describe, expect, it } from "vitest";
import { createRequestAttemptBudget } from "./request-attempt-budget.js";

describe("retry budget invariants", () => {
  it("keeps unique identities when a success releases budget", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 3 });
    const first = budget.tryRecordAttempt({ layer: "provider-transport" })!;
    budget.completeAttempt(first, "success");
    const second = budget.tryRecordAttempt({ layer: "provider-transport" })!;
    expect(second).not.toBe(first);
    expect(budget.snapshot()).toMatchObject({ used: 1, remaining: 2 });
  });

  it("allows a third physical attempt after two failures in a four-slot budget", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 4 });
    for (let index = 0; index < 2; index += 1) {
      const attempt = budget.tryRecordAttempt({ layer: "provider-transport", outcome: "failure" })!;
      budget.completeAttempt(attempt, "failure");
    }
    const third = budget.tryRecordAttempt({ layer: "provider-transport" })!;
    budget.completeAttempt(third, "success");
    expect(budget.snapshot()).toMatchObject({
      used: 2,
      remaining: 2,
      attempts: [
        { physicalAttempt: 1, outcome: "failure" },
        { physicalAttempt: 2, outcome: "failure" },
        { physicalAttempt: 3, outcome: "success" },
      ],
    });
  });

  it("fails closed at the exact budget boundary", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
    budget.tryRecordAttempt({ layer: "provider-transport", outcome: "failure" });
    expect(budget.tryRecordAttempt({ layer: "provider-transport" })).toBeUndefined();
    expect(budget.snapshot()).toMatchObject({ used: 1, remaining: 0 });
  });

  it("does not double-release a repeated success completion", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 2 });
    const attempt = budget.tryRecordAttempt({ layer: "provider-transport" })!;
    budget.completeAttempt(attempt, "success");
    budget.completeAttempt(attempt, "success");
    expect(budget.snapshot()).toMatchObject({ used: 0, remaining: 2 });
  });

  it("records non-charging layer decisions without consuming budget", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 2 });
    budget.noteAttemptDecision({ layer: "agent-auto-retry", reason: "retryable_error" });
    budget.noteAttemptDecision({ layer: "model-fallback", reason: "candidate:1" });
    expect(budget.snapshot()).toMatchObject({
      used: 0,
      remaining: 2,
      attempts: [],
      decisions: [
        { layer: "agent-auto-retry", reason: "retryable_error" },
        { layer: "model-fallback", reason: "candidate:1" },
      ],
    });
  });
});
