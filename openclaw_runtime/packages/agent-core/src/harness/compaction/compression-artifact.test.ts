import { describe, expect, it } from "vitest";
import type { CompressionTelemetry } from "./compression-planner.js";
import {
  buildDeterministicCompressionArtifact,
  type CompressionArtifactInput,
} from "./compression-artifact.js";
import { renderCompactionSummaryShape } from "./summary-contract.js";

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

  it("extracts recovery fields from the canonical compaction contract", () => {
    const summary = renderCompactionSummaryShape({
      "## Goal and Progress": "Unify the summary contract.",
      "## Attempts and Failures": "(none)",
      "## Key Decisions and Constraints": "- Keep the quality gate shadow-only.",
      "## Current State": [
        "### Done",
        "- Shared the canonical section list.",
        "### In Progress",
        "- Verify the artifact adapter.",
        "### Blocked",
        "- (none)",
      ].join("\n"),
      "## Key Decisions": "- Use agent-core as the source of truth.",
      "## Files Touched": "- src/agents/compaction.ts",
      "## Tests": "- pnpm test:dcs",
      "## Next Actions": "1. Review the generated evidence.",
    });

    const artifact = buildDeterministicCompressionArtifact({ messages: [], summary });

    expect(artifact.objective).toContain("Unify the summary contract");
    expect(artifact.constraints.map((item) => item.text)).toContain(
      "Keep the quality gate shadow-only.",
    );
    expect(artifact.decisions.map((item) => item.text)).toContain(
      "Use agent-core as the source of truth.",
    );
    expect(artifact.nextAction).toContain("Review the generated evidence");
  });
});
