import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreakerSnapshot,
} from "../../openclaw_runtime/src/infra/circuit-breaker";

describe("CircuitBreaker", () => {
  it("executes calls in closed state", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(breaker.getState()).toBe("closed");
    const result = breaker.execute(() => 42);
    expect(result).toBe(42);
    const snapshot = breaker.getSnapshot();
    expect(snapshot.successCount).toBe(1);
    expect(snapshot.failureCount).toBe(0);
  });

  it("counts failures but stays closed below threshold", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(2);
  });

  it("opens after reaching failure threshold", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    for (let i = 0; i < 3; i += 1) {
      expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    }
    expect(breaker.getState()).toBe("open");
    expect(breaker.getSnapshot().failureCount).toBe(3);
  });

  it("rejects calls with CircuitBreakerOpenError when open", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(() => breaker.execute(() => 1)).toThrow(CircuitBreakerOpenError);
  });

  it("transitions to half-open after resetTimeoutMs", () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(breaker.getState()).toBe("open");
    now += 499;
    expect(breaker.getState()).toBe("open");
    now += 1;
    expect(breaker.getState()).toBe("half-open");
  });

  it("closes after a successful half-open probe", () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    now += 500;
    expect(breaker.getState()).toBe("half-open");
    const result = breaker.execute(() => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("re-opens after a failed half-open probe", () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    now += 500;
    expect(breaker.getState()).toBe("half-open");
    expect(() => breaker.execute(() => { throw new Error("still bad"); })).toThrow("still bad");
    expect(breaker.getState()).toBe("open");
  });

  it("limits concurrent half-open calls", () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      halfOpenMaxCalls: 2,
      now: () => now,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    now += 500;
    expect(breaker.getState()).toBe("half-open");
    let firstInProgress = false;
    const first = breaker.execute(() => {
      firstInProgress = true;
      return "first";
    });
    expect(first).toBe("first");
    expect(firstInProgress).toBe(true);
  });

  it("resets consecutive failures on success in closed state", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(2);
    breaker.execute(() => "ok");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("reset() forces return to closed state", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(breaker.getState()).toBe("open");
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("rejects invalid constructor options", () => {
    expect(
      () => new CircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 100, halfOpenMaxCalls: 1 }),
    ).toThrow();
    expect(
      () => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0, halfOpenMaxCalls: 1 }),
    ).toThrow();
    expect(
      () => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, halfOpenMaxCalls: 0 }),
    ).toThrow();
  });

  it("CircuitBreakerOpenError carries the snapshot", () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      halfOpenMaxCalls: 1,
    });
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    try {
      breaker.execute(() => 1);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CircuitBreakerOpenError);
      const err = error as CircuitBreakerOpenError;
      expect(err.snapshot.state).toBe("open");
      expect(err.snapshot.failureCount).toBe(1);
    }
  });

  it("tracks total success and failure counts across state transitions", () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 500,
      halfOpenMaxCalls: 1,
      now: () => now,
    });
    breaker.execute(() => "ok1");
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    expect(() => breaker.execute(() => { throw new Error("boom"); })).toThrow("boom");
    now += 500;
    breaker.execute(() => "ok2");
    const snapshot: CircuitBreakerSnapshot = breaker.getSnapshot();
    expect(snapshot.successCount).toBe(2);
    expect(snapshot.failureCount).toBe(2);
  });
});
