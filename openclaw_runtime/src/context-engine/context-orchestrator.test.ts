/**
 * Context Orchestrator unit tests — flag matrix, kill switch, lineage, fail-closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeContextExtraSystemPrompt,
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
  getContextOrchestratorCollection,
  getLastContextOrchestratorLineage,
  resetContextOrchestratorLineageForTests,
} from "./context-orchestrator.js";
import { resetContextCandidateCollectionsForTests } from "./context-candidate.js";
import {
  endTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
} from "./turn-injection-budget.js";
import { dcsObservability } from "./dcs-observability.js";
import type { VtokenRpcClient } from "./vtoken-rpc-client.js";
import type { RuntimeContextProvider } from "../runtime-core/index.js";

function createMockVtokenClient(prompt = "packed working context"): VtokenRpcClient {
  return {
    pack: vi.fn(async () => ({
      schema: "VtokenPackResult/v1",
      prompt,
      estimatedTokens: 12,
      allowanceTokens: 600,
      estimateMethod: "chars_div_4",
      slot_breakdown: {},
      nodes_included: ["a"],
      nodes_evicted: [],
      dedup_count: 0,
      candidateCount: 1,
    })),
  } as unknown as VtokenRpcClient;
}

function createMemoryProvider(text = "role card memory"): RuntimeContextProvider {
  return {
    manifest: {
      id: "role-memory",
      kind: "context",
      title: "Role Memory",
      source: "runtime-core",
      capabilities: ["context.memory"],
      priority: 70,
      order: 70,
      permission: { decision: "allow", capability: "context.memory" },
      enabledByDefault: false,
      shadowOnly: false,
      fallbackReasons: ["flag_disabled", "no_result", "provider_error"],
      evidenceRefs: [],
      outputKinds: ["memory"],
      dependsOnIndexing: false,
    },
    async getContext() {
      return {
        status: "success",
        contextItems: [
          {
            id: "m1",
            kind: "memory",
            text,
            source: "role-memory:bucket",
            evidenceRefs: [],
            metadata: { providerId: "role-memory" },
          },
        ],
        diagnostics: [],
      };
    },
  } as unknown as RuntimeContextProvider;
}

describe("computeContextExtraSystemPrompt", () => {
  const prevAssembly = process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
  const prevKill = process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;

  beforeEach(() => {
    delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
    resetContextOrchestratorLineageForTests();
    resetContextCandidateCollectionsForTests();
    resetTurnInjectionBudgetsForTests();
    dcsObservability.reset();
  });

  afterEach(() => {
    if (prevAssembly === undefined) delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    else process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = prevAssembly;
    if (prevKill === undefined) delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH;
    else process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = prevKill;
    resetContextOrchestratorLineageForTests();
    resetContextCandidateCollectionsForTests();
    resetTurnInjectionBudgetsForTests();
    dcsObservability.reset();
  });

  it("flag-off matrix: zero injection, preserves base prompt bytes", async () => {
    const { extraSystemPrompt, lineage } = await computeContextExtraSystemPrompt(
      "base",
      {},
      {
        sessionKey: "agent:main:main",
        memoryProviderFactory: () => [createMemoryProvider()],
        vtokenClient: createMockVtokenClient(),
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        taskHint: "x",
      },
    );
    expect(extraSystemPrompt).toBe("base");
    expect(lineage.totalCharsAdded).toBe(0);
    expect(lineage.sources.every((s) => !s.applied)).toBe(true);
    expect(lineage.sources.map((s) => s.reason)).toEqual(["flag-off", "flag-off"]);
  });

  it("memory-only canary injects Memory Context", async () => {
    const provider = createMemoryProvider("remembered fact");
    const { extraSystemPrompt, lineage } = await computeContextExtraSystemPrompt(
      "base",
      { runtime: { memory: { injectPilot: { enabled: true } } } },
      {
        sessionKey: "agent:main:main",
        memoryProviderFactory: () => [provider],
      },
      { stages: ["memory"] },
    );
    expect(extraSystemPrompt).toContain("base");
    expect(extraSystemPrompt).toContain("## Memory Context");
    expect(extraSystemPrompt).toContain("remembered fact");
    expect(lineage.sources).toHaveLength(1);
    expect(lineage.sources[0]?.applied).toBe(true);
  });

  it("vtoken-only canary injects Working Context", async () => {
    const client = createMockVtokenClient("packed working context");
    const { extraSystemPrompt, lineage } = await computeContextExtraSystemPrompt(
      "base",
      { runtime: { vtoken: { assembly: { enabled: true } } } },
      {
        sessionKey: "agent:main:main",
        taskHint: "fix auth",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        vtokenClient: client,
      },
      { stages: ["vtoken"] },
    );
    expect(extraSystemPrompt).toContain("## Working Context");
    expect(extraSystemPrompt).toContain("packed working context");
    expect(lineage.sources[0]?.stage).toBe("vtoken");
    expect(lineage.sources[0]?.applied).toBe(true);
  });

  it("both flags on compose memory then vtoken", async () => {
    const client = createMockVtokenClient("vt packed");
    const { extraSystemPrompt, lineage } = await computeContextExtraSystemPrompt(
      "base",
      {
        runtime: {
          memory: { injectPilot: { enabled: true } },
          vtoken: { assembly: { enabled: true } },
        },
      },
      {
        sessionKey: "agent:main:main",
        taskHint: "x",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        memoryProviderFactory: () => [createMemoryProvider("mem A")],
        vtokenClient: client,
      },
    );
    expect(extraSystemPrompt).toContain("## Memory Context");
    expect(extraSystemPrompt).toContain("mem A");
    expect(extraSystemPrompt).toContain("## Working Context");
    expect(extraSystemPrompt).toContain("vt packed");
    expect(lineage.sources).toHaveLength(2);
    expect(lineage.sources.every((s) => s.applied)).toBe(true);
  });

  it("kill switch cuts both stages fail-closed", async () => {
    process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH = "1";
    const client = createMockVtokenClient();
    const { extraSystemPrompt, lineage } = await computeContextExtraSystemPrompt(
      "base",
      {
        runtime: {
          memory: { injectPilot: { enabled: true } },
          vtoken: { assembly: { enabled: true } },
        },
      },
      {
        sessionKey: "agent:main:main",
        taskHint: "x",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        memoryProviderFactory: () => [createMemoryProvider()],
        vtokenClient: client,
      },
    );
    expect(extraSystemPrompt).toBe("base");
    expect(lineage.killSwitchEngaged).toBe(true);
    expect(lineage.sources.every((s) => !s.applied)).toBe(true);
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).not.toHaveBeenCalled();
  });

  it("records lineage for diagnostics (session/run/sources/budget)", async () => {
    await computeContextExtraSystemPrompt(
      undefined,
      { runtime: { vtoken: { assembly: { enabled: true, budgetTokens: 400 } } } },
      {
        sessionKey: "agent:main:main",
        sessionId: "sess-1",
        runId: "run-9",
        requestId: "req-3",
        workspaceDir: "/tmp/ws",
        taskHint: "x",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        vtokenClient: createMockVtokenClient(),
      },
      { stages: ["vtoken"] },
    );
    const last = getLastContextOrchestratorLineage();
    expect(last?.sessionId).toBe("sess-1");
    expect(last?.runId).toBe("run-9");
    expect(last?.requestId).toBe("req-3");
    expect(last?.workspaceDir).toBe("/tmp/ws");
    expect(last?.budget.vtokenBudgetTokens).toBe(400);
    expect(last?.sources[0]?.id).toBe("vtoken-assembly");
    expect(dcsObservability.snapshot().contextOrchestratorCalls).toBe(1);
  });

  it("defers both stages, then projects declared precedence instead of lifecycle order", async () => {
    const turnId = "orchestrator-deferred-order";
    const { extraSystemPrompt } = await computeContextExtraSystemPrompt(
      "base",
      {
        runtime: {
          memory: { injectPilot: { enabled: true } },
          vtoken: { assembly: { enabled: true } },
        },
      },
      {
        turnId,
        deferProjection: true,
        sessionKey: "agent:main:main",
        taskHint: "x",
        markdownSources: [{ sourcePath: "AGENTS.md", text: "rules" }],
        memoryProviderFactory: () => [createMemoryProvider("memory candidate")],
        vtokenClient: createMockVtokenClient("vtoken candidate"),
      },
    );
    expect(extraSystemPrompt).toBe("base");
    expect(getContextOrchestratorCollection(turnId)?.diagnostics).toMatchObject({
      finalized: false,
      collected: 2,
    });
    expect(dcsObservability.snapshot().contextOrchestratorCalls).toBe(0);

    const finalized = finalizeContextOrchestratorTurn({ turnId, messages: [] });
    const addition = finalized.projection.systemPromptAddition ?? "";
    expect(addition.indexOf("## Working Context")).toBeLessThan(
      addition.indexOf("## Memory Context"),
    );
    expect(getLastContextOrchestratorLineage()).toMatchObject({
      turnId,
      candidateDiagnostics: { finalized: true, unique: 2 },
    });
    expect(dcsObservability.snapshot().contextOrchestratorCalls).toBe(1);
    expect(dcsObservability.snapshot().contextOrchestratorCharsAdded).toBe(
      finalized.projection.lineage.reduce((total, entry) => total + entry.charsApplied, 0),
    );
    endContextOrchestratorTurn(turnId);
    endTurnInjectionBudget(turnId);
  });

  it("does not query lazy VToken memory inputs while its flag is off", async () => {
    const turnId = "orchestrator-vtoken-off";
    const memoryEntriesFactory = vi.fn(async () => [{ id: "must-not-load" }]);
    const client = createMockVtokenClient();
    await computeContextExtraSystemPrompt(
      undefined,
      {},
      {
        turnId,
        deferProjection: true,
        memoryEntriesFactory,
        vtokenClient: client,
      },
      { stages: ["vtoken"] },
    );
    expect(memoryEntriesFactory).not.toHaveBeenCalled();
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).not.toHaveBeenCalled();
    expect(getContextOrchestratorCollection(turnId)?.lineage).toEqual([
      expect.objectContaining({
        sourceId: "vtoken-assembly",
        reason: "flag-off",
        charsApplied: 0,
      }),
    ]);
  });

  it("does not construct Memory providers or query VToken when the kill switch is on", async () => {
    const turnId = "orchestrator-killed-query-gate";
    const memoryProviderFactory = vi.fn(() => [createMemoryProvider()]);
    const memoryEntriesFactory = vi.fn(async () => [{ id: "must-not-load" }]);
    const client = createMockVtokenClient();
    await computeContextExtraSystemPrompt(
      undefined,
      {
        runtime: {
          contextEnhancement: { killSwitch: true },
          memory: { injectPilot: { enabled: true } },
          vtoken: { assembly: { enabled: true } },
        },
      },
      {
        turnId,
        deferProjection: true,
        memoryProviderFactory,
        memoryEntriesFactory,
        vtokenClient: client,
      },
    );
    expect(memoryProviderFactory).not.toHaveBeenCalled();
    expect(memoryEntriesFactory).not.toHaveBeenCalled();
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.pack).not.toHaveBeenCalled();
    expect(getContextOrchestratorCollection(turnId)?.lineage.map((entry) => entry.reason)).toEqual([
      "kill-switch",
      "kill-switch",
    ]);
  });
});
