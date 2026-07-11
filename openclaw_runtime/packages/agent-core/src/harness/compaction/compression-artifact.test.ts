import { describe, expect, it } from "vitest";
import type { CompressionTelemetry } from "./compression-planner.js";
import {
  buildDeterministicCompressionArtifact,
  type CompressionArtifactInput,
} from "./compression-artifact.js";

describe("compression artifact telemetry", () => {
  it("preserves compression telemetry and normalizes capability activation kinds", () => {
    const telemetry: CompressionTelemetry = {
      tier: "tier2",
      strategy: "token-pruning",
      pressure: 0.82,
      tokensBefore: 10_000,
      tokensAfter: 4_000,
      compressionRatio: 0.4,
      warnings: ["causal anchor retained"],
      staleExcludedCount: 2,
      causalAnchorCount: 5,
      rehydratedFiles: ["src/runtime.ts"],
    };
    const input = {
      messages: [],
      telemetry,
      contextRuntimeKit: {
        capabilityActivations: [
          { kind: "skill", name: "systematic-debugging" },
          { kind: "unexpected", name: "legacy-activation" },
        ],
      },
    } as CompressionArtifactInput & { telemetry: CompressionTelemetry };

    const artifact = buildDeterministicCompressionArtifact(input);

    expect(artifact.telemetry).toEqual(telemetry);
    expect(artifact.capabilityActivations).toEqual([
      { kind: "skill", name: "systematic-debugging" },
      { kind: "other", name: "legacy-activation" },
    ]);
  });
});
