import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness, clearAgentHarnesses } from "./registry.js";
import { runAgentHarnessAttempt } from "./selection.js";
import type { AgentHarnessAttemptParams } from "./types.js";
import { resetTurnInjectionBudgetsForTests } from "../../context-engine/turn-injection-budget.js";

vi.mock("./builtin-openclaw.js", () => ({
  createOpenClawAgentHarness: () => ({ id: "openclaw", label: "builtin", runAttempt: vi.fn() }),
}));

afterEach(() => {
  clearAgentHarnesses();
  resetTurnInjectionBudgetsForTests();
  vi.unstubAllEnvs();
});

it.each([false, true])("native harness receives budgeted COMPASS with kill=%s", async (killed) => {
  vi.stubEnv("OPENCLAW_COMPASS_DISABLE", "0");
  vi.stubEnv("OPENCLAW_COMPASS_SSP", "1");
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
  const runAttempt = vi.fn(async (_params: AgentHarnessAttemptParams) => ({}) as never);
  registerAgentHarness({
    id: "native-fixture",
    label: "native fixture",
    supports: () => ({ supported: true }),
    runAttempt,
  });
  await runAgentHarnessAttempt({
    agentHarnessId: "native-fixture",
    provider: "fixture",
    modelId: "fixture-model",
    runId: "native-run",
    sessionId: "native-session",
    sessionKey: "agent:main:native",
    config: { runtime: { contextEnhancement: { killSwitch: killed } } },
    extraSystemPrompt: "base",
    compassContext: {
      sessionKey: "agent:main:native",
      injection: { sspString: "NATIVE-COMPASS:" + "S".repeat(8000), iFrameRefreshed: false },
      candidateFactIds: [],
      appliedFactIds: [],
    },
  } as AgentHarnessAttemptParams);
  expect(runAttempt).toHaveBeenCalledOnce();
  const delivered = runAttempt.mock.calls[0]![0];
  expect(delivered.compassContext).toBeUndefined();
  expect(delivered.extraSystemPrompt).toContain("base");
  if (killed) expect(delivered.extraSystemPrompt).toBe("base");
  else {
    expect(delivered.extraSystemPrompt).toContain("NATIVE-COMPASS:");
    expect(delivered.extraSystemPrompt!.length).toBeLessThanOrEqual(6006);
  }
});
