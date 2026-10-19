import { describe, expect, it, vi } from "vitest";
import { createRequestAttemptBudget } from "./request-attempt-budget.js";

describe("RequestAttemptBudget", () => {
  it("shares one physical-attempt budget across retry layers", () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "req-1", maxPhysicalAttempts: 3 });
    expect(budget.recordAttempt({ layer: "sdk", outcome: "failure" })).toBe(1);
    expect(budget.recordAttempt({ layer: "agent-auto-retry", outcome: "failure" })).toBe(2);
    expect(budget.recordAttempt({ layer: "model-fallback", outcome: "success" })).toBe(3);
    expect(budget.canRetry()).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      logicalRequestId: "req-1",
      maxPhysicalAttempts: 3,
      used: 3,
      remaining: 0,
      attempts: [
        { physicalAttempt: 1, layer: "sdk", outcome: "failure" },
        { physicalAttempt: 2, layer: "agent-auto-retry", outcome: "failure" },
        { physicalAttempt: 3, layer: "model-fallback", outcome: "success" },
      ],
    });
  });

  it("fails closed when a layer tries to exceed the budget", () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
    budget.recordAttempt({ layer: "sdk" });
    expect(() => budget.recordAttempt({ layer: "fallback" })).toThrow(
      "request attempt budget exhausted",
    );
    expect(budget.tryRecordAttempt({ layer: "fallback" })).toBeUndefined();
  });

  it("keeps finite non-negative Retry-After metadata as a lower bound", () => {
    const budget = createRequestAttemptBudget({
      maxPhysicalAttempts: 2,
      retryAfterMs: 1.4,
    });
    expect(budget.getRetryAfterMs()).toBe(1.4);
    budget.recordAttempt({ layer: "sdk", retryAfterMs: 2.6 });
    expect(budget.getRetryAfterMs()).toBe(2.6);
    expect(budget.snapshot().attempts[0]).toMatchObject({ retryAfterMs: 2.6 });
  });

  it("does not turn invalid Retry-After metadata into a delay", () => {
    const budget = createRequestAttemptBudget({
      maxPhysicalAttempts: 2,
      retryAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(budget.getRetryAfterMs()).toBeUndefined();
    budget.setRetryAfterMs(-1);
    expect(budget.getRetryAfterMs()).toBeUndefined();
  });

  it("rounds fractional and invalid maxima into a safe bounded budget", () => {
    expect(createRequestAttemptBudget({ maxPhysicalAttempts: 2.9 }).maxPhysicalAttempts).toBe(2);
    expect(createRequestAttemptBudget({ maxPhysicalAttempts: 0 }).maxPhysicalAttempts).toBe(1);
    expect(() => createRequestAttemptBudget({ maxPhysicalAttempts: Number.NaN })).toThrow();
  });

  it("never schedules retries by itself", async () => {
    vi.useFakeTimers();
    try {
      const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 2 });
      budget.recordAttempt({ layer: "sdk", outcome: "failure" });
      const timer = setTimeout(() => undefined, 60_000);
      expect(vi.getTimerCount()).toBe(1);
      expect(budget.canRetry()).toBe(true);
      clearTimeout(timer);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
