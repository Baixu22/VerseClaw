// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mcnemarExact, parseAnswer, passAtK, wilson } from "../../scripts/context-inline-spill-benefit-scoring.mjs";

describe("inline-spill benefit scoring", () => {
  it("parses strict value answers and tolerates surrounding prose", () => {
    expect(parseAnswer('{"value":"TOKEN_1"}')).toEqual({ ok: true, value: "TOKEN_1" });
    expect(parseAnswer('Here it is: {"value":null} -- done')).toEqual({ ok: true, value: null });
    expect(parseAnswer('{"value":42}')).toEqual({ ok: false, value: null });
    expect(parseAnswer("no json here")).toEqual({ ok: false, value: null });
  });

  it("computes Wilson 95% intervals at the extremes", () => {
    const [lo0, hi0] = wilson(0, 6);
    expect(lo0).toBeCloseTo(0, 10);
    expect(hi0).toBeGreaterThan(0);
    expect(hi0).toBeLessThan(0.5);
    const [lo1, hi1] = wilson(6, 6);
    expect(lo1).toBeGreaterThan(0.5);
    expect(hi1).toBe(1);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("computes exact McNemar p-values over discordant pairs", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(6, 0)).toBeCloseTo(0.03125, 10);
    expect(mcnemarExact(0, 6)).toBeCloseTo(0.03125, 10);
    expect(mcnemarExact(4, 0)).toBeCloseTo(0.125, 10);
    expect(mcnemarExact(1, 1)).toBe(1);
  });

  it("computes pass^k only for tasks whose every repetition passed", () => {
    expect(passAtK([[true, true], [true, false], [false]])).toBeCloseTo(1 / 3, 10);
    expect(passAtK([])).toBe(0);
  });
});

