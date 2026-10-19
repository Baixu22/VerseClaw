import { describe, expect, it, vi } from "vitest";
import { createRequestAttemptBudget, runWithRequestAttemptBudget } from "../agents/request-attempt-budget.js";
import { retryAsync } from "./retry.js";

describe("retryAsync shared attempt budget", () => {
  it("counts physical attempts across separate retryAsync calls", async () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "req-retry", maxPhysicalAttempts: 3 });
    const first = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue("first-ok");
    await expect(
      retryAsync(first, { attempts: 2, minDelayMs: 0, maxDelayMs: 0, attemptBudget: budget, attemptLayer: "sdk" }),
    ).resolves.toBe("first-ok");

    expect(budget.snapshot()).toMatchObject({
      used: 2,
      remaining: 1,
      attempts: [
        { physicalAttempt: 1, layer: "sdk", outcome: "failure" },
        { physicalAttempt: 2, layer: "sdk", outcome: "success" },
      ],
    });
  });

  it("consumes the ambient logical-request budget without an explicit option", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 2 });
    const fn = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue("ambient-ok");
    await expect(
      runWithRequestAttemptBudget(budget, () =>
        retryAsync(fn, { attempts: 2, minDelayMs: 0, maxDelayMs: 0, attemptLayer: "ambient-retry" }),
      ),
    ).resolves.toBe("ambient-ok");
    expect(budget.snapshot()).toMatchObject({
      used: 2,
      remaining: 0,
      attempts: [
        { physicalAttempt: 1, layer: "ambient-retry", outcome: "failure" },
        { physicalAttempt: 2, layer: "ambient-retry", outcome: "success" },
      ],
    });
  });

  it("stops without invoking the operation once the shared budget is consumed", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
    budget.recordAttempt({ layer: "agent-auto-retry", outcome: "failure" });
    const fn = vi.fn().mockResolvedValue("must-not-run");
    await expect(
      retryAsync(fn, { attempts: 3, minDelayMs: 0, maxDelayMs: 0, attemptBudget: budget }),
    ).rejects.toThrow("attempt budget");
    expect(fn).not.toHaveBeenCalled();
  });

  it("preserves a finite Retry-After lower bound in the shared budget", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 3 });
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue("ok");

    await expect(
      retryAsync(fn, {
        attempts: 3,
        minDelayMs: 0,
        maxDelayMs: 1000,
        jitter: 0.5,
        retryAfterMs: () => 7.4,
        onRetry,
        attemptBudget: budget,
      }),
    ).resolves.toBe("ok");

    expect(budget.getRetryAfterMs()).toBe(7.4);
    expect(onRetry).toHaveBeenCalledTimes(2);
    for (const [info] of onRetry.mock.calls) {
      expect(info.delayMs).toBeGreaterThanOrEqual(8);
    }
  });

  it("stops when a satisfiable lower bound exceeds the local cap", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 3 });
    const fn = vi.fn().mockRejectedValue(new Error("timeout"));
    const onRetry = vi.fn();
    await expect(
      retryAsync(fn, {
        attempts: 3,
        minDelayMs: 0,
        maxDelayMs: 50,
        retryAfterMs: () => 5000,
        onRetry,
        attemptBudget: budget,
      }),
    ).rejects.toThrow("timeout");
    expect(fn).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
    expect(budget.getRetryAfterMs()).toBe(5000);
    expect(budget.snapshot().used).toBe(1);
  });
});
