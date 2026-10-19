// @vitest-environment node
// NET-E (TF-0442): the gateway-process logical deadline.
import { describe, expect, it } from "vitest";

import {
  clampRequestTimeoutToDeadline,
  getRequestDeadline,
  getRequestDeadlineAtMs,
  isRequestDeadlineExpired,
  remainingRequestBudgetMs,
  RequestDeadlineExceededError,
  resolveRequestDeadlineGate,
  runWithRequestDeadline,
} from "./request-deadline.js";

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("request deadline context", () => {
  it("is inert without an ambient deadline", () => {
    expect(getRequestDeadline()).toBeUndefined();
    expect(getRequestDeadlineAtMs()).toBeUndefined();
    expect(remainingRequestBudgetMs()).toBeUndefined();
    expect(isRequestDeadlineExpired()).toBe(false);
    expect(clampRequestTimeoutToDeadline(30_000)).toBe(30_000);
    expect(clampRequestTimeoutToDeadline(undefined)).toBeUndefined();
  });

  it("propagates the deadline across awaits and clears it afterwards", async () => {
    const deadlineAtMs = Date.now() + 5_000;
    const observed = await runWithRequestDeadline(deadlineAtMs, async () => {
      await tick();
      return getRequestDeadlineAtMs();
    });
    expect(observed).toBe(deadlineAtMs);
    expect(getRequestDeadlineAtMs()).toBeUndefined();
  });

  it("ignores unusable deadline values instead of throwing", () => {
    for (const value of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(runWithRequestDeadline(value, () => getRequestDeadlineAtMs())).toBeUndefined();
    }
  });

  it("computes the remaining budget and expiry against the ambient clock", () => {
    const c = clock();
    runWithRequestDeadline(4_000, () => {
      expect(remainingRequestBudgetMs(c.now)).toBe(3_000);
      c.advance(3_000);
      expect(remainingRequestBudgetMs(c.now)).toBe(0);
      expect(isRequestDeadlineExpired(c.now)).toBe(true);
    });
  });

  it("clamps provider timeouts to what remains (never sums)", () => {
    const c = clock();
    runWithRequestDeadline(10_000, () => {
      expect(clampRequestTimeoutToDeadline(30_000, c.now)).toBe(9_000);
      expect(clampRequestTimeoutToDeadline(2_000, c.now)).toBe(2_000);
      // No configured provider timeout: the remaining budget becomes the cap.
      expect(clampRequestTimeoutToDeadline(undefined, c.now)).toBe(9_000);
      c.advance(9_500);
      expect(clampRequestTimeoutToDeadline(30_000, c.now)).toBe(0);
    });
  });
});

describe("gateway deadline gate", () => {
  const now = () => 10_000;

  it("admits requests without a propagated deadline", () => {
    expect(resolveRequestDeadlineGate({ deadlineAtMs: undefined, now })).toEqual({ ok: true });
    expect(resolveRequestDeadlineGate({ deadlineAtMs: "soon", now })).toEqual({ ok: true });
    expect(resolveRequestDeadlineGate({ deadlineAtMs: 0, now })).toEqual({ ok: true });
  });

  it("admits a live deadline and reports it", () => {
    expect(resolveRequestDeadlineGate({ deadlineAtMs: 25_000, now })).toEqual({
      ok: true,
      deadlineAtMs: 25_000,
    });
  });

  it("carries stage, budget, elapsed time and the local correlation id on the typed error", () => {
    const error = new RequestDeadlineExceededError({
      deadlineAtMs: 10_000,
      stage: "provider",
      requestId: "req-provider",
      now: () => 11_500,
    });
    expect(error).toMatchObject({
      code: "E_REQUEST_DEADLINE_EXCEEDED",
      stage: "provider",
      requestId: "req-provider",
    });
    expect(error.details).toEqual({
      stage: "provider",
      deadlineMs: 0,
      elapsedMs: 1_500,
      requestId: "req-provider",
      deadlineAtMs: 10_000,
    });
  });

  it("exposes the correlation id to nested work through the ambient context", () => {
    runWithRequestDeadline(
      9_000,
      () => {
        expect(getRequestDeadline()).toMatchObject({
          deadlineAtMs: 9_000,
          stage: "gateway",
          requestId: "req-ctx",
        });
      },
      { stage: "gateway", requestId: "req-ctx" },
    );
  });

  it("fails closed with structured details once the deadline is spent", () => {
    const gate = resolveRequestDeadlineGate({
      deadlineAtMs: 9_000,
      requestId: "req-1",
      now,
    });
    expect(gate).toEqual({
      ok: false,
      deadlineAtMs: 9_000,
      details: {
        stage: "gateway",
        deadlineMs: 0,
        elapsedMs: 1_000,
        requestId: "req-1",
        deadlineAtMs: 9_000,
      },
    });
  });
});
