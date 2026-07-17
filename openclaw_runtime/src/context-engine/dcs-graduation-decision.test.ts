import { describe, expect, it } from "vitest";
import {
  applyProductApprovalHardRules,
  assertPackagingDefaultsUnchanged,
  assertProductApprovalHardRules,
  buildGraduationDecision,
} from "./dcs-graduation-decision.js";

describe("dcs-graduation-decision hard rules", () => {
  it("productApproved!==true - meetsGate=false and recommendation not default-on", () => {
    const hard = applyProductApprovalHardRules({
      productApproved: false,
      metricsGate: true,
      liveReady: true,
      desiredRecommendation: "default-on",
      packagingPath: true,
    });
    expect(hard.meetsGate).toBe(false);
    expect(hard.recommendation).not.toBe("default-on");
    expect(hard.defaultsUnchanged).toBe(true);

    const decision = buildGraduationDecision({
      flagId: "runtime.coding.viewTools",
      metricsGate: true,
      metrics: { reductionFactor: 6 },
      productApproved: false,
      liveReady: false,
      desiredRecommendation: "default-on",
      howToEnable: "opt-in env only",
      killSwitch: "unset env / leave default false",
      packagingPath: true,
    });
    expect(decision.meetsGate).toBe(false);
    expect(decision.recommendation).not.toBe("default-on");
    expect(decision.productApproved).toBe(false);
    expect(decision.defaultsUnchanged).toBe(true);
    assertProductApprovalHardRules(decision);
  });

  it("packaging path always reports defaultsUnchanged=true", () => {
    const decision = buildGraduationDecision({
      flagId: "runtime.coding.viewTools",
      metricsGate: true,
      metrics: {},
      productApproved: true,
      liveReady: true,
      desiredRecommendation: "default-on",
      howToEnable: "out of band",
      killSwitch: "config false",
      packagingPath: true,
    });
    expect(decision.defaultsUnchanged).toBe(true);
    // Packaging still never meetsGate for auto default flip
    expect(decision.meetsGate).toBe(false);
    expect(decision.recommendation).not.toBe("default-on");
    assertPackagingDefaultsUnchanged(decision);
  });

  it("assertProductApprovalHardRules throws on violation", () => {
    expect(() =>
      assertProductApprovalHardRules({
        productApproved: false,
        meetsGate: true,
        recommendation: "keep-off",
      }),
    ).toThrow(/meetsGate/);
    expect(() =>
      assertProductApprovalHardRules({
        productApproved: false,
        meetsGate: false,
        recommendation: "default-on",
      }),
    ).toThrow(/default-on/);
  });

  it("assertPackagingDefaultsUnchanged throws when falsey", () => {
    expect(() =>
      assertPackagingDefaultsUnchanged({ defaultsUnchanged: true }),
    ).not.toThrow();
    expect(() =>
      assertPackagingDefaultsUnchanged({
        defaultsUnchanged: false as unknown as true,
      }),
    ).toThrow(/defaultsUnchanged/);
  });
});