import { describe, expect, it } from "vitest";
import {
  CapabilityRegistryV3RolloutController,
  type CapabilityRegistryV3RolloutPolicy,
  type CapabilityRegistryV3RolloutTarget,
} from "./rollout-control-v3.js";

const target: CapabilityRegistryV3RolloutTarget = {
  providerId: "provider-a",
  modelId: "model-a",
  workflowNamespace: "engineering.discovery",
};

function policy(
  overrides: Partial<CapabilityRegistryV3RolloutPolicy> = {},
): CapabilityRegistryV3RolloutPolicy {
  return {
    enabled: true,
    mode: "canary",
    killSwitch: false,
    allowlist: [target],
    canaryPercent: 25,
    cohortSalt: "rollout-test-v1",
    ...overrides,
  };
}

function request(requestId = "request-1") {
  return { requestId, target };
}

describe("Capability Registry V3 rollout controller", () => {
  it("keeps disabled, off, kill-switch, invalid, and allowlist-miss lanes inactive", () => {
    const controller = new CapabilityRegistryV3RolloutController(policy());
    for (const malformed of [null, undefined, 42, {}, []] as unknown[]) {
      expect(controller.decide(malformed as never)).toEqual(
        expect.objectContaining({ activate: false, observe: false, cohort: "none", reason: "invalid-request" }),
      );
    }
    expect(controller.decide({ requestId: 42, target } as never)).toEqual(
      expect.objectContaining({ activate: false, observe: false, cohort: "none", reason: "invalid-request" }),
    );
    expect(
      new CapabilityRegistryV3RolloutController(policy({ enabled: false })).decide(request()),
    ).toEqual(expect.objectContaining({ activate: false, observe: false, reason: "disabled" }));
    expect(
      new CapabilityRegistryV3RolloutController(policy({ mode: "off" })).decide(request()),
    ).toEqual(expect.objectContaining({ activate: false, observe: false, reason: "off" }));
    expect(
      new CapabilityRegistryV3RolloutController(policy({ killSwitch: true })).decide(request()),
    ).toEqual(expect.objectContaining({ activate: false, observe: false, reason: "kill-switch" }));
    expect(
      new CapabilityRegistryV3RolloutController(policy()).decide({
        requestId: "bad request id",
        target,
      }),
    ).toEqual(expect.objectContaining({ activate: false, observe: false, reason: "invalid-request" }));
    expect(
      new CapabilityRegistryV3RolloutController(policy()).decide({
        requestId: "request-invalid-target",
        target: { ...target, workflowNamespace: "Engineering.*" },
      }),
    ).toEqual(
      expect.objectContaining({ activate: false, observe: false, reason: "invalid-target" }),
    );
    expect(
      new CapabilityRegistryV3RolloutController(policy()).decide({
        requestId: "request-other-target",
        target: { ...target, modelId: "model-b" },
      }),
    ).toEqual(
      expect.objectContaining({ activate: false, observe: false, reason: "not-allowlisted" }),
    );
  });

  it("observes shadow traffic without authorizing execution", () => {
    const controller = new CapabilityRegistryV3RolloutController(policy({ mode: "shadow" }));

    expect(controller.decide(request())).toEqual(
      expect.objectContaining({
        mode: "shadow",
        observe: true,
        activate: false,
        cohort: "shadow",
        reason: "shadow-only",
      }),
    );
  });

  it("requires exact allowlisting and an explicit request in opt-in mode", () => {
    const controller = new CapabilityRegistryV3RolloutController(policy({ mode: "opt-in" }));

    expect(controller.decide(request("opt-in-control"))).toEqual(
      expect.objectContaining({
        observe: true,
        activate: false,
        cohort: "control",
        reason: "opt-in-required",
      }),
    );
    expect(
      controller.decide({ ...request("opt-in-treatment"), explicitOptIn: true }),
    ).toEqual(
      expect.objectContaining({
        observe: true,
        activate: true,
        cohort: "treatment",
        reason: "explicit-opt-in",
      }),
    );
    expect(
      controller.decide({
        requestId: "opt-in-wrong-model",
        target: { ...target, modelId: "model-a-extra" },
        explicitOptIn: true,
      }),
    ).toEqual(expect.objectContaining({ activate: false, reason: "not-allowlisted" }));
  });

  it("assigns stable canary buckets and applies only the percentage threshold", () => {
    const controller = new CapabilityRegistryV3RolloutController(policy({ canaryPercent: 25 }));
    const decisions = Array.from({ length: 200 }, (_, index) =>
      controller.decide(request(`canary-${index}`)),
    );
    const treatment = decisions.find((entry) => entry.cohort === "treatment");
    const control = decisions.find((entry) => entry.cohort === "control");

    expect(treatment).toEqual(
      expect.objectContaining({ activate: true, reason: "canary-treatment" }),
    );
    expect(control).toEqual(
      expect.objectContaining({ activate: false, reason: "canary-control" }),
    );
    expect(treatment?.bucketBasisPoints).toBeLessThan(2_500);
    expect(control?.bucketBasisPoints).toBeGreaterThanOrEqual(2_500);
    expect(controller.decide(request(treatment?.requestId))).toEqual(treatment);

    const zero = new CapabilityRegistryV3RolloutController(policy({ canaryPercent: 0 }));
    const full = new CapabilityRegistryV3RolloutController(policy({ canaryPercent: 100 }));
    expect(zero.decide(request("boundary"))).toEqual(
      expect.objectContaining({ activate: false, cohort: "control" }),
    );
    expect(full.decide(request("boundary"))).toEqual(
      expect.objectContaining({ activate: true, cohort: "treatment" }),
    );
  });

  it("validates policy bounds, exact targets, salts, and duplicates", () => {
    const cases: Array<[Partial<CapabilityRegistryV3RolloutPolicy>, string]> = [
      [{ mode: "invalid" as never }, "invalid-mode"],
      [{ canaryPercent: -1 }, "invalid-canary-percent"],
      [{ canaryPercent: 101 }, "invalid-canary-percent"],
      [{ cohortSalt: "" }, "invalid-cohort-salt"],
      [{ allowlist: [{ ...target, modelId: "*" }] }, "invalid-allowlist"],
      [{ allowlist: [target, { ...target }] }, "duplicate-allowlist-target"],
    ];
    for (const [overrides, code] of cases) {
      expect(() => new CapabilityRegistryV3RolloutController(policy(overrides))).toThrowError(
        expect.objectContaining({ code }),
      );
    }
  });

  it("clones policy input so later caller mutation cannot change a cohort", () => {
    const allowlist = [{ ...target }];
    const controller = new CapabilityRegistryV3RolloutController(policy({ allowlist }));
    const before = controller.decide(request("immutable-1"));

    allowlist[0]!.modelId = "mutated";
    allowlist.push({ ...target, modelId: "model-b" });

    expect(controller.decide(request("immutable-1"))).toEqual(before);
    expect(controller.policyHash()).toBe(before.policyHash);
  });
});
