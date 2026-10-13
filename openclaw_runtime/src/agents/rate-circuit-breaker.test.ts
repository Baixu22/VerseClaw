// @vitest-environment node
// L05: finite-state rate circuit breaker (closed -> open -> half-open).
import { describe, expect, it } from "vitest";

import { RateCircuitBreaker } from "./rate-circuit-breaker.js";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function make(over: Partial<{ windowMs: number; maxFailuresPerWindow: number; cooldownMs: number }> = {}, start = 0) {
  const c = clock(start);
  const breaker = new RateCircuitBreaker({ windowMs: 1000, maxFailuresPerWindow: 10, cooldownMs: 2000, now: c.now, ...over });
  return { breaker, c };
}

describe("L05 rate circuit breaker", () => {
  it("never trips on a purely legal rate", () => {
    const { breaker, c } = make();
    for (let i = 0; i < 100; i++) {
      expect(breaker.allowsRequest()).toBe(true);
      expect(breaker.record(true)).toBe("closed");
      c.advance(10); // 100 requests over 1s
    }
    expect(breaker.getSnapshot()).toMatchObject({ state: "closed", trips: 0, failuresInWindow: 0 });
  });

  it("opens after crossing the failure threshold and refuses requests during cooldown", () => {
    const { breaker, c } = make();
    for (let i = 0; i < 10; i++) breaker.record(false);
    expect(breaker.getState()).toBe("open");
    expect(breaker.getSnapshot().trips).toBe(1);
    c.advance(1500);
    expect(breaker.allowsRequest()).toBe(false); // still cooling down: no further effect
  });

  it("admits exactly ONE half-open probe after the cooldown", () => {
    const { breaker, c } = make();
    for (let i = 0; i < 10; i++) breaker.record(false);
    c.advance(2000);
    expect(breaker.getState()).toBe("half-open");
    expect(breaker.allowsRequest()).toBe(true); // the single probe
    expect(breaker.allowsRequest()).toBe(false); // no second probe while one is in flight
    expect(breaker.getSnapshot().halfOpenProbeInFlight).toBe(true);
  });

  it("closes on a clean probe and re-opens with a fresh cooldown on a failed probe", () => {
    const { breaker, c } = make();
    for (let i = 0; i < 10; i++) breaker.record(false);
    c.advance(2000);
    breaker.allowsRequest();
    expect(breaker.record(true)).toBe("closed");
    expect(breaker.getSnapshot()).toMatchObject({ state: "closed", trips: 1 });

    // A second failure storm re-opens; a failed probe re-opens with a NEW cooldown.
    for (let i = 0; i < 10; i++) breaker.record(false);
    c.advance(2000);
    breaker.allowsRequest();
    expect(breaker.record(false)).toBe("open");
    expect(breaker.getSnapshot().trips).toBe(3);
    c.advance(1000);
    expect(breaker.allowsRequest()).toBe(false); // fresh 2s cooldown from the failed probe
    c.advance(1000);
    expect(breaker.allowsRequest()).toBe(true);
  });

  it("prunes old failures so a legal later window does not false-trip", () => {
    const { breaker, c } = make();
    for (let i = 0; i < 9; i++) breaker.record(false);
    expect(breaker.getState()).toBe("closed");
    c.advance(2000); // all prior failures fall out of the 1s window
    for (let i = 0; i < 9; i++) breaker.record(false);
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().trips).toBe(0);
  });

  it("is deterministic under the injected clock", () => {
    const a = make();
    const b = make();
    for (const { breaker } of [a, b]) { for (let i = 0; i < 10; i++) breaker.record(false); }
    expect(a.breaker.digest()).toBe(b.breaker.digest());
  });
});