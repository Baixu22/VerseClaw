import { AuthStorage } from "../sessions/auth-storage.js";
import { ModelRegistry } from "../sessions/model-registry.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerAgentHarness, clearAgentHarnesses } from "./registry.js";
import type { AgentHarnessAttemptParams } from "./types.js";
import type { ContextEngine } from "../../context-engine/types.js";
import type { AgentMessage } from "../runtime/index.js";
let { runAgentHarnessAttempt } = await import("./selection.js");
let { getTurnInjectionBudget, resetTurnInjectionBudgetsForTests } =
  await import("../../context-engine/turn-injection-budget.js");
let { getContextOrchestratorCollection } =
  await import("../../context-engine/context-orchestrator.js");
let { assembleHarnessContextEngine } = await import("../../plugin-sdk/agent-harness-runtime.js");
let { runWithHarnessContextBudget } = await import("./context-engine-lifecycle.js");

function attemptDefaults() {
  const authStorage = AuthStorage.inMemory();
  return {
    sessionFile: "fixture-session.jsonl", workspaceDir: ".", prompt: "fixture", timeoutMs: 1000,
    provider: "fixture", modelId: "fixture", thinkLevel: "off" as const,
    authStorage, authProfileStore: { version: 1, profiles: {} },
    modelRegistry: ModelRegistry.inMemory(authStorage),
    model: {
      id: "fixture", name: "fixture", api: "openai-completions" as const, provider: "fixture",
      baseUrl: "https://example.invalid", reasoning: false, input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
    },
  };
}

vi.mock("./builtin-openclaw.js", () => ({
  createOpenClawAgentHarness: () => ({ id: "openclaw", label: "builtin", runAttempt: vi.fn() }),
}));

beforeEach(async () => {
  // The separate-SDK case resets the module cache. Refresh each owner so later
  // lazy attempts and their assertions observe the same budget collections.
  ({ runAgentHarnessAttempt } = await import("./selection.js"));
  ({ getTurnInjectionBudget, resetTurnInjectionBudgetsForTests } =
    await import("../../context-engine/turn-injection-budget.js"));
  ({ getContextOrchestratorCollection } =
    await import("../../context-engine/context-orchestrator.js"));
  ({ assembleHarnessContextEngine } =
    await import("../../plugin-sdk/agent-harness-runtime.js"));
  ({ runWithHarnessContextBudget } = await import("./context-engine-lifecycle.js"));
});

afterEach(() => {
  clearAgentHarnesses();
  resetTurnInjectionBudgetsForTests();
  vi.unstubAllEnvs();
});

it("keeps a separately loaded SDK on the original attempt's ledger", async () => {
  // Plugin loading may cross a source/built boundary. Reloading the SDK gives
  // it distinct module-local collections, just as the built plugin has.
  vi.resetModules();
  const sdk = await import("../../plugin-sdk/agent-harness-runtime.js");
  vi.stubEnv("OPENCLAW_COMPASS_DISABLE", "0");
  vi.stubEnv("OPENCLAW_COMPASS_SSP", "1");
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
  const params = {
    ...attemptDefaults(),
    sessionId: "separate-sdk",
    runId: "separate-sdk",
    compassContext: {
      sessionKey: "separate-sdk",
      injection: { sspString: "S".repeat(5000), iFrameRefreshed: false },
      candidateFactIds: [],
      appliedFactIds: [],
    },
  } satisfies AgentHarnessAttemptParams;
  const engine: ContextEngine = {
    ingest: async () => ({ ingested: false }),
    compact: async () => ({ ok: true, compacted: false }),
    info: { id: "separate-sdk", name: "separate SDK" },
    assemble: async () => ({
      messages: [],
      estimatedTokens: 1,
      systemPromptAddition: "E".repeat(2000),
    }),
  };
  await runWithHarnessContextBudget(params, true, async () => {
    const input = {
      contextEngine: engine,
      messages: [],
      sessionId: params.sessionId,
      modelId: "fixture",
    };
    const first = await sdk.assembleHarnessContextEngine(input);
    expect(first!.systemPromptAddition!.length).toBeLessThanOrEqual(1000);
    const ledger = getTurnInjectionBudget("harness:separate-sdk:separate-sdk:0")!;
    expect(
      ledger.entries.some((entry) => entry.channel === "cvk_addition" && entry.charsApplied > 0),
    ).toBe(true);
    const charged = ledger.entries.reduce((sum, entry) => sum + entry.charsApplied, 0);
    expect(await sdk.assembleHarnessContextEngine(input)).toEqual(first);
    expect(ledger.entries.reduce((sum, entry) => sum + entry.charsApplied, 0)).toBe(charged);
    return {} as never;
  });
  expect(getTurnInjectionBudget("harness:separate-sdk:separate-sdk:0")).toBeUndefined();
});

it.each([
  { name: "admitted", compass: 100, added: 100, killed: false },
  { name: "atomic drop", compass: 100, added: 7000, killed: false },
  { name: "shared exhaustion", compass: 8000, added: 100, killed: false },
  { name: "history only", compass: 0, added: 0, killed: false },
  { name: "kill switch", compass: 100, added: 100, killed: true },
])("native assembly shares the attempt budget: $name", async ({ compass, added, killed }) => {
  vi.stubEnv("OPENCLAW_COMPASS_DISABLE", "0");
  vi.stubEnv("OPENCLAW_COMPASS_SSP", "1");
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
  const history: Extract<AgentMessage, { role: "user" }>[] = [{ role: "user", content: "H".repeat(9000), timestamp: 1 }];
  const injected: AgentMessage = { role: "user", content: "N".repeat(added), timestamp: 2 };
  const assemble = vi.fn(async ({ messages }: Parameters<ContextEngine["assemble"]>[0]) => ({
    messages: added ? [...messages, injected] : messages,
    estimatedTokens: 20,
    systemPromptAddition: "ENGINE:" + "E".repeat(100),
    contextProjection: { mode: "thread_bootstrap" as const, epoch: "1", fingerprint: "full" },
  }));
  const engine: ContextEngine = {
    ingest: async () => ({ ingested: false }),
    compact: async () => ({ ok: true, compacted: false }),
    info: { id: "native-engine", name: "native engine" },
    assemble,
  };
  const turnId = "harness:agent:main:native:native-run:0";
  registerAgentHarness({
    id: "native-fixture",
    label: "native fixture",
    supports: () => ({ supported: true }),
    runAttempt: async (params) => {
      const input = {
        contextEngine: params.contextEngine,
        messages: history,
        sessionId: params.sessionId,
        modelId: "fixture",
      };
      const first = await assembleHarnessContextEngine(input);
      const ledger = getTurnInjectionBudget(turnId)!;
      const charged = ledger.entries.reduce((sum, entry) => sum + entry.charsApplied, 0);
      const second = await assembleHarnessContextEngine(input);
      expect(second).toEqual(first);
      expect(ledger.entries.reduce((sum, entry) => sum + entry.charsApplied, 0)).toBe(charged);
      expect(charged).toBeLessThanOrEqual(6000);
      const admitted = !killed && added > 0 && compass < 6000 && added < 6000;
      expect(first!.messages).toEqual(admitted ? [...history, injected] : history);
      if (killed || compass >= 6000) expect(first!.systemPromptAddition).toBeUndefined();
      else expect(first!.systemPromptAddition).toContain("ENGINE:");
      if (killed || (added > 0 && !admitted)) expect(first!.contextProjection).toBeUndefined();
      else expect(first!.contextProjection?.fingerprint).toBe("full");
      if (!killed && added > 0) {
        expect(
          getContextOrchestratorCollection(turnId)!.lineage.some(
            (entry) =>
              entry.sourceId === "cvk-messages" &&
              entry.reason === (admitted ? "applied" : "budget-drop"),
          ),
        ).toBe(true);
      }
      return {} as never;
    },
  });
  await runAgentHarnessAttempt({
    ...attemptDefaults(),
    agentHarnessId: "native-fixture",
    provider: "fixture",
    modelId: "fixture",
    runId: "native-run",
    sessionId: "native-session",
    sessionKey: "agent:main:native",
    contextEngine: engine,
    config: { runtime: { contextEnhancement: { killSwitch: killed } } },
    compassContext: {
      sessionKey: "agent:main:native",
      injection: { sspString: "S".repeat(compass), iFrameRefreshed: false },
      candidateFactIds: [],
      appliedFactIds: [],
    },
  } satisfies AgentHarnessAttemptParams);
  expect(assemble).toHaveBeenCalledTimes(killed ? 0 : 2);
  expect(history[0]!.content).toBe("H".repeat(9000));
  expect(getTurnInjectionBudget(turnId)).toBeUndefined();
  expect(getContextOrchestratorCollection(turnId)).toBeUndefined();
});

it("keeps concurrent native attempts separate and rechecks changed retry output", async () => {
  const assemble = vi.fn(async ({ prompt }: Parameters<ContextEngine["assemble"]>[0]) => ({
    messages: [],
    estimatedTokens: 1,
    systemPromptAddition: prompt!.repeat(4000),
  }));
  const engine: ContextEngine = {
    ingest: async () => ({ ingested: false }),
    compact: async () => ({ ok: true, compacted: false }),
    info: { id: "native-engine", name: "native engine" },
    assemble,
  };
  registerAgentHarness({
    id: "native-fixture",
    label: "native fixture",
    supports: () => ({ supported: true }),
    runAttempt: async (params) => {
      const input = {
        contextEngine: params.contextEngine,
        messages: [],
        sessionId: params.sessionId,
        modelId: "fixture",
        prompt: params.prompt,
      };
      const first = await assembleHarnessContextEngine(input);
      expect(first!.systemPromptAddition).toBe(params.prompt.repeat(4000));
      await runWithHarnessContextBudget(params, false, async () => {
        const embedded = await assembleHarnessContextEngine({ ...input, prompt: "E" });
        expect(embedded!.systemPromptAddition).toBe("E".repeat(4000));
        return {} as never;
      });
      const changed = await assembleHarnessContextEngine({ ...input, prompt: "C" });
      expect(changed!.systemPromptAddition!.length).toBeLessThanOrEqual(2000);
      expect(changed!.systemPromptAddition).not.toContain(params.prompt);
      return {} as never;
    },
  });
  await Promise.all(
    ["A", "B"].map((prompt) =>
      runAgentHarnessAttempt({
        ...attemptDefaults(),
    agentHarnessId: "native-fixture",
        provider: "fixture",
        modelId: "fixture",
        runId: prompt,
        sessionId: "parallel-session",
        prompt,
        contextEngine: engine,
      } satisfies AgentHarnessAttemptParams),
    ),
  );
  for (const id of ["A", "B"])
    expect(getTurnInjectionBudget(`harness:parallel-session:${id}:0`)).toBeUndefined();
});

it("isolates failed native assembly mutation and releases the budget on harness failure", async () => {
  const history: Extract<AgentMessage, { role: "user" }>[] = [{ role: "user", content: "original", timestamp: 1 }];
  const engine: ContextEngine = {
    ingest: async () => ({ ingested: false }),
    compact: async () => ({ ok: true, compacted: false }),
    info: { id: "native-engine", name: "native engine" },
    assemble: async ({ messages }: Parameters<ContextEngine["assemble"]>[0]) => {
      const first = messages[0];
      if (!first || first.role !== "user") throw new Error("expected user history");
      first.content = "corrupt";
      throw new Error("engine failed");
    },
  };
  registerAgentHarness({
    id: "native-fixture",
    label: "native fixture",
    supports: () => ({ supported: true }),
    runAttempt: async (params) => {
      await expect(
        assembleHarnessContextEngine({
          contextEngine: params.contextEngine,
          messages: history,
          sessionId: params.sessionId,
          modelId: "fixture",
        }),
      ).rejects.toThrow("engine failed");
      expect(history[0]!.content).toBe("original");
      throw new Error("harness failed");
    },
  });
  await expect(
    runAgentHarnessAttempt({
      ...attemptDefaults(),
    agentHarnessId: "native-fixture",
      provider: "fixture",
      modelId: "fixture",
      runId: "failure",
      sessionId: "native-session",
      contextEngine: engine,
    } satisfies AgentHarnessAttemptParams),
  ).rejects.toThrow("harness failed");
  expect(getTurnInjectionBudget("harness:native-session:failure:0")).toBeUndefined();
  expect(getContextOrchestratorCollection("harness:native-session:failure:0")).toBeUndefined();
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
    ...attemptDefaults(),
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
  } satisfies AgentHarnessAttemptParams);
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
