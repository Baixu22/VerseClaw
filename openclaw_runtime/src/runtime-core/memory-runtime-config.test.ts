import { describe, expect, it } from "vitest";
import { createMemoryRuntimeConfig } from "./memory-runtime-config.js";

describe("memory runtime config", () => {
  it("merges a partial feature flag override with every canonical default", () => {
    const config = createMemoryRuntimeConfig({
      featureFlags: {
        enablePreReplyRetrieval: true,
      },
    });

    expect(config).toEqual({
      featureFlags: {
        enableEntityResolverInBridge: false,
        enableWeightedTraversalInExpansion: false,
        enableEvidenceDiscipline: false,
        enableSessionStatePage: false,
        enablePreReplyRetrieval: true,
        enableUDecisionRanking: false,
        enableCostAwareEvictionV2: false,
        enableConfigVersionTree: false,
      },
      eventLogHashAlg: "sha256",
    });
  });
});
