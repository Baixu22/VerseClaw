import { describe, expect, it } from "vitest";

import { classifyComplexity, type ComplexityGateInput } from "../../openclaw_runtime/src/agents/complexity-gate.js";

describe("ComplexityGate", () => {
  it.each([
    [{ task: "rename this variable" }, "single-agent"],
    [{ task: "explain this function", capabilityHints: ["analysis"] }, "role-routed"],
    [
      {
        task: "review auth and payment changes",
        fileHints: ["auth.ts", "billing.ts"],
        riskHints: ["security"],
      },
      "team-orchestrated",
    ],
    [
      {
        task: "fix failing test suite after repeated failures",
        priorFailureCount: 2,
        capabilityHints: ["testing", "implementation"],
      },
      "runbook-orchestrated",
    ],
    [{ task: "explain this function", explicitTeamRequested: true }, "team-orchestrated"],
    [{ task: "repair this flaky spec", explicitRunbookId: "test-repair" }, "runbook-orchestrated"],
  ] as const)("classifies %# as %s", (input, mode) => {
    const decision = classifyComplexity(input);

    expect(decision.mode).toBe(mode);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.signals.length).toBeGreaterThan(0);
  });

  it("keeps explicit team selection as a warning-backed decision instead of blocking it", () => {
    const decision = classifyComplexity({
      task: "explain this helper",
      explicitTeamRequested: true,
    });

    expect(decision.mode).toBe("team-orchestrated");
    expect(decision.reasons).toContain("explicit-team-requested");
    expect(decision.warnings).toContain("team orchestration may add cost for a simple task");
  });

  it("records structured signal summaries for routing decisions", () => {
    const input: ComplexityGateInput = {
      task: "review security-sensitive auth, billing, and migration changes",
      fileHints: ["auth.ts", "billing.ts", "migration.ts"],
      riskHints: ["security"],
      capabilityHints: ["security-review", "implementation", "testing"],
      toolHints: ["grep", "bash"],
    };

    const decision = classifyComplexity(input);

    expect(decision.signals).toEqual(
      expect.arrayContaining([
        { name: "fileHintCount", value: 3 },
        { name: "riskHintCount", value: 1 },
        { name: "capabilityFamilyCount", value: 3 },
      ]),
    );
    expect(decision.reasons).toEqual(expect.arrayContaining(["multi-file-scope", "risk-hints"]));
  });
});
