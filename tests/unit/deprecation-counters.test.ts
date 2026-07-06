import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deprecationCounters,
  type DeprecationArea,
} from "../../openclaw_runtime/src/observability/deprecation-counters.js";

/**
 * Stage 4 / 4.1-4.4: per-area deprecation telemetry counters.
 * Stage 4 / 4.14: per-area budget violation response.
 */

describe("Stage 4 / 4.1: deprecation counters cover all 6 areas", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("snapshot() returns all 6 areas with zero counters initially", () => {
    const snap = deprecationCounters.snapshot();
    expect(Object.keys(snap).sort()).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(snap.a1.legacyFallbackCount).toBe(0);
    expect(snap.a6.volatileMislabelCount).toBe(0);
  });

  it("getArea() returns the correct area shape for each of the 6 areas", () => {
    const areas: DeprecationArea[] = ["a1", "a2", "a3", "a4", "a5", "a6"];
    for (const area of areas) {
      const c = deprecationCounters.getArea(area);
      expect(c, `area ${area} must return counters`).toBeDefined();
    }
  });
});

describe("Stage 4 / 4.2: A1 telemetry — legacy fallback count", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("incrementA1LegacyFallback increments the counter", () => {
    deprecationCounters.incrementA1LegacyFallback();
    deprecationCounters.incrementA1LegacyFallback();
    deprecationCounters.incrementA1LegacyFallback(5);

    const a1 = deprecationCounters.getArea("a1") as { legacyFallbackCount: number };
    expect(a1.legacyFallbackCount).toBe(7);
  });

  it("shadow success increments independently of legacy fallback", () => {
    deprecationCounters.incrementA1ShadowSuccess(10);
    deprecationCounters.incrementA1LegacyFallback(2);

    const snap = deprecationCounters.snapshot().a1;
    expect(snap.shadowSuccessCount).toBe(10);
    expect(snap.legacyFallbackCount).toBe(2);
  });

  it("declared-path violations are tracked separately", () => {
    deprecationCounters.incrementA1DeclaredPathViolation(3);
    const a1 = deprecationCounters.snapshot().a1;
    expect(a1.declaredPathViolationCount).toBe(3);
  });
});

describe("Stage 4 / 4.3: A2 telemetry — deferral agreement", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("records agreement and disagreement separately", () => {
    deprecationCounters.incrementA2DeferralAgreement(8);
    deprecationCounters.incrementA2DeferralDisagreement(2);

    const a2 = deprecationCounters.snapshot().a2;
    expect(a2.deferralAgreementCount).toBe(8);
    expect(a2.deferralDisagreementCount).toBe(2);
  });

  it("records deferred wave count", () => {
    deprecationCounters.incrementA2DeferredWave(3);
    expect(deprecationCounters.snapshot().a2.deferredWaveCount).toBe(3);
  });
});

describe("Stage 4 / 4.4: A6 telemetry — volatile mislabel detection (CRITICAL)", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("incrementA6VolatileMislabel increments the critical counter", () => {
    deprecationCounters.incrementA6VolatileMislabel();
    const a6 = deprecationCounters.getArea("a6") as { volatileMislabelCount: number };
    expect(a6.volatileMislabelCount).toBe(1);
  });

  it("volatile mislabel is critical — any non-zero value triggers budget violation (4.14)", () => {
    deprecationCounters.incrementA6VolatileMislabel(1);
    const result = deprecationCounters.checkBudgetViolation("a6");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.degrade).toBe("a6_volatile_mislabel");
      expect(result.action).toBe("degrade_to_full_reverification");
    }
  });

  it("verifier pass/fail are tracked", () => {
    deprecationCounters.incrementA6VerifierPass(95);
    deprecationCounters.incrementA6VerifierFail(2);
    const a6 = deprecationCounters.snapshot().a6;
    expect(a6.verifierPassCount).toBe(95);
    expect(a6.verifierFailCount).toBe(2);
  });
});

describe("Stage 4 / 4.14: per-area budget violation response", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("A1: legacy fallback rate > 5% → violated with degrade_to_legacy", () => {
    // 6 fallback out of 100 total = 6% > 5% threshold.
    deprecationCounters.incrementA1ShadowSuccess(94);
    deprecationCounters.incrementA1LegacyFallback(6);
    const result = deprecationCounters.checkBudgetViolation("a1");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_legacy");
    }
  });

  it("A1: legacy fallback rate ≤ 5% → not violated", () => {
    deprecationCounters.incrementA1ShadowSuccess(95);
    deprecationCounters.incrementA1LegacyFallback(5);
    expect(deprecationCounters.checkBudgetViolation("a1").violated).toBe(false);
  });

  it("A2: disagreement rate > 10% → violated", () => {
    deprecationCounters.incrementA2DeferralAgreement(89);
    deprecationCounters.incrementA2DeferralDisagreement(11);
    const result = deprecationCounters.checkBudgetViolation("a2");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_live_only");
    }
  });

  it("A3: anomaly rate > 20% → violated", () => {
    deprecationCounters.incrementA3MissionTicks(100);
    deprecationCounters.incrementA3AnomalyNonNull(21);
    const result = deprecationCounters.checkBudgetViolation("a3");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_default_decision");
    }
  });

  it("A4: low-quality rate > 10% → violated", () => {
    deprecationCounters.incrementA4AuditedDecisions(100);
    deprecationCounters.incrementA4LowQualityDecisions(11);
    const result = deprecationCounters.checkBudgetViolation("a4");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_audit_only");
    }
  });

  it("A5: plan ignored rate > 20% → violated", () => {
    deprecationCounters.incrementA5PlanAdopted(79);
    deprecationCounters.incrementA5PlanIgnored(21);
    const result = deprecationCounters.checkBudgetViolation("a5");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_default_budget");
    }
  });

  it("A6: verifier fail rate > 5% → violated", () => {
    deprecationCounters.incrementA6VerifierPass(94);
    deprecationCounters.incrementA6VerifierFail(6);
    const result = deprecationCounters.checkBudgetViolation("a6");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.action).toBe("degrade_to_full_reverification");
    }
  });

  it("no violation when all counters are within budget", () => {
    deprecationCounters.incrementA1ShadowSuccess(100);
    deprecationCounters.incrementA1LegacyFallback(1);
    deprecationCounters.incrementA2DeferralAgreement(100);
    deprecationCounters.incrementA2DeferralDisagreement(5);
    deprecationCounters.incrementA3MissionTicks(100);
    deprecationCounters.incrementA3AnomalyNonNull(10);
    deprecationCounters.incrementA4AuditedDecisions(100);
    deprecationCounters.incrementA4LowQualityDecisions(5);
    deprecationCounters.incrementA5PlanAdopted(100);
    deprecationCounters.incrementA5PlanIgnored(10);
    deprecationCounters.incrementA6VerifierPass(100);
    deprecationCounters.incrementA6VerifierFail(2);

    const areas: DeprecationArea[] = ["a1", "a2", "a3", "a4", "a5", "a6"];
    for (const area of areas) {
      const r = deprecationCounters.checkBudgetViolation(area);
      expect(r.violated, `area ${area} should not be violated`).toBe(false);
    }
  });

  it("reset() clears all counters", () => {
    deprecationCounters.incrementA1LegacyFallback(5);
    deprecationCounters.incrementA6VolatileMislabel(3);
    deprecationCounters.reset();
    const snap = deprecationCounters.snapshot();
    expect(snap.a1.legacyFallbackCount).toBe(0);
    expect(snap.a6.volatileMislabelCount).toBe(0);
  });
});
