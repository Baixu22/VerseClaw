import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import { selectAgentHarness } from "../../openclaw_runtime/src/agents/harness/selection.js";
import { clearAgentHarnesses } from "../../openclaw_runtime/src/agents/harness/registry.js";
import { MissingAgentHarnessError, isMissingAgentHarnessError } from "../../openclaw_runtime/src/agents/harness/errors.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "harness/specs/fixtures/harness-codex-product-integration";

describe("TF-0567 product integration evidence", () => {
  afterEach(() => clearAgentHarnesses());

  it("retains an agent-driven acceptance receipt with honest not-run entries", () => {
    const receipt = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "acceptance.json"), "utf8"));
    expect(receipt.schemaVersion).toBe("HarnessCodexProductIntegrationAcceptance/v1");
    expect(receipt.driven_by).toBe("agent");
    expect(receipt.actor).toBeTruthy();
    expect(receipt.node).toBe("TF-0567");
    expect(receipt.implementation.harnessAxis).toBe(true);
    expect(receipt.implementation.newSelector).toBe(false);
    expect(receipt.implementation.newScheduler).toBe(false);
    expect(receipt.validation.length).toBeGreaterThanOrEqual(6);
    expect(receipt.validation.every((entry: { exitCode: number }) => entry.exitCode === 0)).toBe(true);
    expect(receipt.electronE2E.status).toBe("passed");
    expect(receipt.electronE2E.finalRuns.policySurface.tests).toBe(1);
    expect(receipt.electronE2E.finalRuns.chatTurns.success).toBe(1);
    expect(receipt.electronE2E.finalRuns.chatTurns.failedOrAborted).toBe(2);
    expect(receipt.productBoundary.defaultPathChanged).toBe(false);
    expect(receipt.productBoundary.productApproved).toBe(false);
    expect(receipt.productBoundary.releaseApproved).toBe(false);
    expect(receipt.productBoundary.realHumanEvidence).toBe(false);
  });

  it("fails closed for an explicitly requested but missing Codex harness", () => {
    expect(() => selectAgentHarness({
      provider: "openai",
      modelId: "gpt-5.4",
      agentHarnessRuntimeOverride: "codex",
    })).toThrow(MissingAgentHarnessError);
    try {
      selectAgentHarness({
        provider: "openai",
        modelId: "gpt-5.4",
        agentHarnessRuntimeOverride: "codex",
      });
    } catch (error) {
      expect(isMissingAgentHarnessError(error)).toBe(true);
      expect((error as { harnessId?: string }).harnessId).toBe("codex");
    }
  });

  it("keeps the report aligned with the actual implementation boundary", () => {
    const report = readFileSync(resolve(ROOT, FIXTURE, "REPORT.md"), "utf8");
    expect(report).toContain("Agent-driven evidence");
    expect(report).toContain("Electron E2E");
    expect(report).toContain("not-run");
    expect(report).toContain("No Settings runtime selector");
    expect(report).toContain("no real-human evidence");
  });
});