import { describe, expect, it } from "vitest";
import {
  CODING_AB_FIXTURES,
  evaluateAbGate,
  simulateAbArm,
} from "./coding-ab-fixtures.js";
import { codingObservability } from "./coding-observability.js";

describe("coding A/B fixtures (C1-2)", () => {
  it("has ≥10 navigation fixtures covering all categories ≥2", () => {
    expect(CODING_AB_FIXTURES.length).toBeGreaterThanOrEqual(10);
    const cats = ["impact_callers", "impact_radius", "understand", "reuse", "verify"] as const;
    for (const c of cats) {
      expect(CODING_AB_FIXTURES.filter((f) => f.category === c).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("factstore arm meets ≥5x reduction gate vs baseline", () => {
    codingObservability.reset();
    const results = CODING_AB_FIXTURES.flatMap((f) => [
      simulateAbArm(f, "baseline"),
      simulateAbArm(f, "factstore"),
      simulateAbArm(f, "mcp_control"),
    ]);
    for (const r of results) {
      codingObservability.recordReplayTask({
        dupToolCalls: r.toolCalls,
        tokenCost: r.tokenCost,
        passed: r.passed,
        routingCorrect: r.routingCorrect,
      });
    }
    const report = evaluateAbGate(results);
    expect(report.fixtureCount).toBeGreaterThanOrEqual(10);
    expect(report.reductionFactor).toBeGreaterThanOrEqual(5);
    expect(report.meetsGate).toBe(true);
    expect(report.factstorePassRate).toBeGreaterThanOrEqual(report.baselinePassRate);
  });
});
