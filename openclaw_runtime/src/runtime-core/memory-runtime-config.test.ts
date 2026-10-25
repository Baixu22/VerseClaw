import { describe, expect, it } from "vitest";
import { createMemoryRuntimeConfig } from "./memory-runtime-config.js";

describe("memory runtime config", () => {
  it("merges a partial override with every canonical default and retires the injection flags", () => {
    const config = createMemoryRuntimeConfig({
      featureFlags: {
        // TF-0500: the parallel pre-reply injection flags are retired, so a caller
        // asking for them is accepted but the value can never become true.
        enablePreReplyRetrieval: true,
        enableSessionStatePage: true,
        enableEvidenceDiscipline: true,
      },
    });

    expect(config).toEqual({
      featureFlags: {
        enableEntityResolverInBridge: false,
        enableWeightedTraversalInExpansion: false,
        enableEvidenceDiscipline: true,
        enableSessionStatePage: false,
        enablePreReplyRetrieval: false,
        enableUDecisionRanking: false,
        enableCostAwareEvictionV2: false,
        enableConfigVersionTree: false,
      },
      eventLogHashAlg: "sha256",
    });
  });
});
