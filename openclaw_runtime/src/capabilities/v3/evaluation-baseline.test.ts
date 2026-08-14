import { describe, expect, it } from "vitest";
import {
  CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES,
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
  evaluateCapabilityRegistryV3Baseline,
} from "./evaluation-baseline.js";

describe("Capability Registry V3 static evaluation baseline", () => {
  it("covers Skill, Tool, and Context metadata with a reproducible direct-projection baseline", () => {
    const baseline = evaluateCapabilityRegistryV3Baseline();

    expect(baseline.fixtureCount).toBeGreaterThanOrEqual(9);
    expect(baseline.descriptorCount).toBe(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS.length);
    expect(new Set(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS.map((entry) => entry.kind))).toEqual(
      new Set(["skill", "tool", "context"]),
    );
    expect(baseline.directProjectionCharacterCount).toBeGreaterThan(0);
    expect(baseline.directProjectionEstimatedTokens).toBeGreaterThan(0);
    expect(baseline.recallAt1).toEqual({
      categoryAt1: 1,
      workflowNamespaceAt1: 1,
      capabilityAt1: 1,
    });
  });

  it("is stable when the corpus and descriptor input order changes", () => {
    const first = evaluateCapabilityRegistryV3Baseline();
    const second = evaluateCapabilityRegistryV3Baseline(
      [...CAPABILITY_REGISTRY_V3_EVALUATION_FIXTURES].reverse(),
      [...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS].reverse(),
    );

    expect(second).toEqual(first);
  });

  it("measures the ranked first result instead of catalog membership", () => {
    const baseline = evaluateCapabilityRegistryV3Baseline([
      {
        id: "ranked-read",
        query: "Read the selected workspace file.",
        expected: {
          category: "engineering",
          workflowNamespace: "engineering.discovery",
          capabilityId: "tool:fixture:workspace-search",
        },
      },
    ]);

    expect(baseline.recallAt1).toEqual({
      categoryAt1: 1,
      workflowNamespaceAt1: 1,
      capabilityAt1: 0,
    });
  });
});
