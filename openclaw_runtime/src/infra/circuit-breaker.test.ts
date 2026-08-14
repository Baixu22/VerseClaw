import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker async execution", () => {
  it("records rejected promises as failures and opens at the configured threshold", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1_000,
      halfOpenMaxCalls: 1,
      now: () => 10,
    });

    await expect(breaker.executeAsync(async () => await Promise.reject(new Error("one")))).rejects.toThrow("one");
    await expect(breaker.executeAsync(async () => await Promise.reject(new Error("two")))).rejects.toThrow("two");
    await expect(breaker.executeAsync(async () => "unreachable")).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(breaker.getSnapshot()).toEqual(expect.objectContaining({ state: "open", failureCount: 2 }));
  });

  it("limits half-open probes and closes cleanly after one succeeds", async () => {
    let now = 10;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 100,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    await expect(breaker.executeAsync(async () => await Promise.reject(new Error("open")))).rejects.toThrow(
      "open",
    );
    now = 110;

    let resolveProbe!: (value: string) => void;
    const pendingProbe = new Promise<string>((resolve) => {
      resolveProbe = resolve;
    });
    const probe = breaker.executeAsync(async () => await pendingProbe);
    expect(breaker.getSnapshot()).toEqual(
      expect.objectContaining({ state: "half-open", halfOpenCalls: 1 }),
    );
    await expect(breaker.executeAsync(async () => "blocked")).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );

    resolveProbe("recovered");
    await expect(probe).resolves.toBe("recovered");
    expect(breaker.getSnapshot()).toEqual(
      expect.objectContaining({ state: "closed", halfOpenCalls: 0, successCount: 1 }),
    );
  });
});
