import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  BlockStoreApi,
  ContextBlock,
  ContextBlockSink,
  ContextBlockWrite,
} from "../../context-engine/block.js";
import {
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
} from "../../context-engine/turn-injection-budget.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";
import { ReceiptStore } from "../receipt-store.js";
import { getRc03SealPlan, resetRc03SealPlansForTest } from "../../context-engine/rc03-seal-hook.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";

type RegisteredHandler = (event: unknown, ctx: { cwd?: string }) => unknown;

describe("DCS Stage 1 embedded working-memory extension", () => {
  it("does not register working-memory handlers when the feature flag is omitted", () => {
    const agent = createAgentRecorder();

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(undefined))) {
      void factory(agent as unknown as ExtensionAPI);
    }

    expect(agent.events).not.toContain("context");
    expect(agent.events.filter((event) => event === "tool_result")).toHaveLength(1);
  });

  it("dispatches only explicit high/medium working-memory envelopes to contextBlockSink", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(cfg, sink))) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const toolResultHandlers = agent.handlers.tool_result ?? [];
    expect(toolResultHandlers.length).toBeGreaterThan(1);
    for (const handler of toolResultHandlers) {
      await handler(
        {
          type: "tool_result",
          toolName: "write",
          details: {
            working_memory: {
              result_summary: "Updated config",
              significance: "high",
            },
          },
        },
        {},
      );
      await handler(
        {
          type: "tool_result",
          toolName: "read",
          details: {
            working_memory: {
              result_summary: "Observed small detail",
              significance: "low",
            },
          },
        },
        {},
      );
      await handler(
        {
          type: "tool_result",
          toolName: "grep",
          details: {
            working_memory: {
              result_summary: "Missing significance",
            },
          },
        },
        {},
      );
    }

    expect(sink).toHaveBeenCalledTimes(1);
    const sinkMock = sink as unknown as { mock: { calls: [readonly ContextBlockWrite[]][] } };
    const firstWrites = sinkMock.mock.calls[0]?.[0] ?? [];
    expect(firstWrites).toHaveLength(1);
    expect(firstWrites[0]?.admission).toEqual({
      significance: "high",
      write_origin: "handler",
    });
    expect(firstWrites[0]?.block.block_type).toBe("working_memory");
  });

  it("registers a context handler that awaits assembler injection", async () => {
    const turnId = "extension-working-memory-turn";
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };
    const messages = [{ role: "user" as const, content: "next" }];

    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(cfg, undefined, {
        query: async () => [
          {
            block_id: "working-memory:agent:alpha:main",
            block_type: "working_memory" as const,
            source_system: "working-memory" as const,
            session_id: "agent:alpha:main",
            presence: { always_on: false, background: true },
            entities: [],
            valid_at: new Date("2026-07-10T00:00:00.000Z"),
            mutability: "system_managed" as const,
            summary: "Recent actions",
            full_content: JSON.stringify({
              actions: [{ tool: "write", result_summary: "Updated docs", significance: "high" }],
            }),
            compression_depth: 0 as const,
            entity_extraction_status: "empty" as const,
          },
        ],
        upsert: async () => ({ accepted: true }),
      }),
      injectionTurnId: turnId,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    try {
      expect(agent.handlers.context).toHaveLength(1);
      const resultPromise = agent.handlers.context?.[0]?.({ type: "context", messages }, {});
      await expect(resultPromise).resolves.toEqual({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("## Recent Actions") }),
        ]),
      });
      const result = await resultPromise as { messages?: Array<{ content?: unknown }> };
      const injected = result.messages?.find((message) =>
        typeof message.content === "string" && /^## Recent Actions$/m.test(message.content),
      )?.content as string | undefined;
      const ledger = getTurnInjectionBudget(turnId);
      expect(ledger).toBeDefined();
      expect(summarizeTurnInjection(ledger!).byChannel.working_memory?.applied)
        .toBe(injected?.length);
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });
});

describe("DCS Stage 1 S1-B same-session tool_result serialization", () => {
  it("merges overlapping same-session callbacks in callback-entry order without lost updates", async () => {
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [];
      },
      upsert: async () => ({ accepted: true }),
    };

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(cfg, sink, store))) {
      void factory(agent as unknown as ExtensionAPI);
    }
    const handler = workingMemoryToolResultHandler(agent);

    const first = handler(
      workingMemoryEvent("write", "Wrote config file", "high"),
      {},
    );
    const second = handler(
      workingMemoryEvent("edit", "Edited helper module", "medium"),
      {},
    );
    await Promise.all([first, second]);

    const sinkMock = sink as unknown as { mock: { calls: [readonly ContextBlockWrite[]][] } };
    expect(sinkMock.mock.calls.length).toBe(2);
    const lastWrites = sinkMock.mock.calls.at(-1)?.[0] ?? [];
    const actions = parsedActions(lastWrites[0]?.block.full_content);
    expect(actions.map((action) => [action.tool, action.significance])).toEqual([
      ["write", "high"],
      ["edit", "medium"],
    ]);
  });

  it("context callback waits for queued tool_result writes before querying BlockStore", async () => {
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };
    let releaseBaseline!: () => void;
    const baselineGate = new Promise<void>((resolve) => {
      releaseBaseline = resolve;
    });
    let gated = false;
    const savedBlocks: Parameters<BlockStoreApi["upsert"]>[0][] = [];
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async () => {
        if (!gated) {
          gated = true;
          await baselineGate;
        }
        return savedBlocks.slice(-1);
      },
      upsert: async (block) => {
        savedBlocks.push(block);
        return { accepted: true };
      },
    };

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(cfg, undefined, store))) {
      void factory(agent as unknown as ExtensionAPI);
    }
    const toolResult = workingMemoryToolResultHandler(agent)(
      workingMemoryEvent("apply_patch", "Applied refactor patch", "high"),
      {},
    );
    const contextResult = agent.handlers.context?.[0]?.(
      { type: "context", messages: [{ role: "user", content: "next step" }] },
      {},
    ) as Promise<{ messages: Array<{ content?: unknown }> } | undefined>;

    releaseBaseline();
    await toolResult;
    const result = await contextResult;

    const joined = (result?.messages ?? [])
      .map((message) => (typeof message.content === "string" ? message.content : ""))
      .join("\n");
    expect(joined).toContain("## Recent Actions");
    expect(joined).toContain("Applied refactor patch");
  });

  it("keeps the last accepted Block as merge baseline when a sink write is rejected", async () => {
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };
    const sink: ContextBlockSink = vi
      .fn<ContextBlockSink>()
      .mockResolvedValueOnce([{ accepted: false, reason: "rejected" }])
      .mockResolvedValue([{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async () => [],
      upsert: async () => ({ accepted: true }),
    };

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(cfg, sink, store))) {
      void factory(agent as unknown as ExtensionAPI);
    }
    const handler = workingMemoryToolResultHandler(agent);
    await handler(workingMemoryEvent("write", "Rejected write", "high"), {});
    await handler(workingMemoryEvent("edit", "Accepted edit", "medium"), {});

    const sinkMock = sink as unknown as { mock: { calls: [readonly ContextBlockWrite[]][] } };
    expect(sinkMock.mock.calls.length).toBe(2);
    const actions = parsedActions(sinkMock.mock.calls[1]?.[0]?.[0]?.block.full_content);
    expect(actions.map((action) => action.result_summary)).toEqual(["Accepted edit"]);
  });
});

describe("F-01 model-call boundary: tool-produced working_memory enters the next model call", () => {
  const tempRoots: string[] = [];
  let stateDir = "";

  function newStore() {
    // The seal hook persists through the default state DB (no explicit
    // database option is passed from extensions), so read the same default.
    return new ReceiptStore({ env: process.env });
  }

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "f01-modelcall-"));
    tempRoots.push(root);
    stateDir = path.join(root, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.join(root, "home"), { recursive: true });
    process.env.OPENCLAW_HOME = path.join(root, "home");
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_RC03_SEAL = "1";
    resetRc03SealPlansForTest();
  });

  afterEach(() => {
    closeOpenClawStateDatabase();
    resetRc03SealPlansForTest();
    delete process.env.OPENCLAW_RC03_SEAL;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_STATE_DIR;
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function knowledgeBlock(): ContextBlock {
    return {
      block_id: "knowledge:compass:main",
      block_type: "knowledge" as const,
      source_system: "compass" as const,
      session_id: "agent:alpha:main",
      presence: { always_on: true, background: false },
      entities: [],
      valid_at: new Date("2026-07-10T00:00:00.000Z"),
      mutability: "system_managed" as const,
      summary: "Objective",
      full_content: "## Knowledge\nObjective: finish the backend health fix",
      compression_depth: 0 as const,
      entity_extraction_status: "empty" as const,
    };
  }

  function wmBlock(): ContextBlock {
    return {
      block_id: "working-memory:agent:alpha:main",
      block_type: "working_memory" as const,
      source_system: "working-memory" as const,
      session_id: "agent:alpha:main",
      presence: { always_on: false, background: true },
      entities: [],
      valid_at: new Date("2026-07-10T00:00:00.000Z"),
      mutability: "system_managed" as const,
      summary: "Recent actions",
      full_content: JSON.stringify({
        actions: [{ tool: "write", result_summary: "Wrote the F-01 fix", significance: "high" }],
      }),
      compression_depth: 0 as const,
      entity_extraction_status: "empty" as const,
    };
  }

  it("re-seals per model call: second context callback injects tool-produced working_memory once, without re-injecting knowledge, and receipts carry modelCallIndex 0 then 1", async () => {
    const turnId = "f01-model-call-turn";
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: {
        contextBlock: {
          "working-memory": { enabled: true },
          compass: { enabled: true },
        },
      },
    };
    const savedWmBlocks: Array<{ block: ContextBlock }> = [];
    let knowledgeWritten = true;
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (q: { block_types?: string[]; source_systems?: string[] }) => {
        if (q.block_types?.includes("knowledge")) {
          return knowledgeWritten ? [knowledgeBlock()] : [];
        }
        if (q.block_types?.includes("working_memory")) {
          return savedWmBlocks.length > 0 ? [savedWmBlocks.at(-1)!.block] : [];
        }
        return [];
      },
      upsert: async (block) => {
        savedWmBlocks.push({ block });
        return { accepted: true };
      },
    };

    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(cfg, undefined, store),
      injectionTurnId: turnId,
      attemptIndex: 3,
      runId: "f01-run",
      sessionKey: "agent:alpha:main",
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const contextHandler = agent.handlers.context?.[0];
    expect(contextHandler).toBeDefined();

    try {
      // 1) before_agent_start: first finalize seals nothing (its empty message
      //    list is never sent); it only derives the system-prompt addition.
      for (const handler of agent.handlers.before_agent_start ?? []) {
        await handler({ type: "before_agent_start", systemPrompt: "" }, {});
      }
      expect(getRc03SealPlan("f01-run", 0)).toBeUndefined();

      // 2) First model call: the projection sealed for model call 0 carries the
      //    knowledge block into the transcript.
      const first = (await contextHandler?.(
        { type: "context", messages: [{ role: "user", content: "first call" }] },
        {},
      )) as { messages?: Array<{ content?: unknown }> } | undefined;
      const firstInjected = (first?.messages ?? [])
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      expect(firstInjected).toContain("## Knowledge");
      expect(firstInjected).not.toContain("## Recent Actions");

      // 3) Tool result writes working_memory through the sink.
      for (const handler of agent.handlers.tool_result ?? []) {
        await handler(
          workingMemoryEvent("write", "Wrote the F-01 fix", "high"),
          {},
        );
      }
      expect(savedWmBlocks).toHaveLength(1);

      // 4) Second model call of the same attempt: working_memory must enter
      //    this call's projection; knowledge must NOT be injected twice.
      const second = (await contextHandler?.(
        { type: "context", messages: (first?.messages ?? []) as never },
        {},
      )) as { messages?: Array<{ content?: unknown }> } | undefined;
      const secondJoined = (second?.messages ?? [])
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      expect(secondJoined).toContain("## Recent Actions");
      expect(secondJoined).toContain("Wrote the F-01 fix");
      // Knowledge was projected once (model call 0) and must not be re-injected
      // for model call 1: the block content appears in exactly one message.
      const knowledgeMessages = (second?.messages ?? []).filter(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Objective: finish the backend health fix"),
      );
      expect(knowledgeMessages).toHaveLength(1);

      // 5) The shared turn ledger charged working_memory in this attempt.
      const ledger = getTurnInjectionBudget(turnId);
      expect(ledger).toBeDefined();
      const accounting = summarizeTurnInjection(ledger!);
      expect(accounting.byChannel.working_memory?.applied).toBeGreaterThan(0);
      expect(accounting.byChannel.knowledge?.applied).toBeGreaterThan(0);

      // 6) Two immutable ContextBundles were sealed for this run, one per
      //    model call, with the real modelCallIndex in the plan and receipt.
      const plan1 = getRc03SealPlan("f01-run", 1);
      expect(plan1).toBeDefined();
      expect(plan1!.callIndex.modelCallIndex).toBe(1);
      expect(plan1!.callIndex.attemptIndex).toBe(3);
      const receiptRows = newStore().list({ kind: "context", runId: "f01-run" });
      const indexes = receiptRows.map((row) => row.model_call_index).sort((a, b) => a - b);
      expect(indexes).toEqual([0, 1]);
      // F-02: the persisted budget is the real char summary, not silently omitted.
      const budgets = receiptRows
        .map((row) => row.budget_json)
        .filter((value): value is string => typeof value === "string");
      expect(budgets.length).toBe(2);
      for (const budget of budgets) {
        const parsed = JSON.parse(budget) as { unit: string; charsRequested: number; charsApplied: number };
        expect(parsed.unit).toBe("chars");
        expect(parsed.charsRequested).toBeGreaterThanOrEqual(parsed.charsApplied);
      }
      const firstCallReceipt = receiptRows.find((row) => row.model_call_index === 0);
      expect(firstCallReceipt).toBeDefined();
      const parsedFirstBudget = JSON.parse(firstCallReceipt!.budget_json ?? "{}") as {
        charsApplied: number;
      };
      expect(parsedFirstBudget.charsApplied).toBeGreaterThan(0);
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });

  it("skips already-injected channels only within the same attempt: a second context callback without new tool results stays stable", async () => {
    const turnId = "f01-stable-turn";
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: {
        contextBlock: {
          "working-memory": { enabled: true },
          compass: { enabled: true },
        },
      },
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: async (q: { block_types?: string[]; source_systems?: string[] }) => {
        if (q.block_types?.includes("knowledge")) return [knowledgeBlock()];
        return [];
      },
      upsert: async (write) => ({ accepted: true }),
    };

    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(cfg, undefined, store),
      injectionTurnId: turnId,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }
    const contextHandler = agent.handlers.context?.[0];
    expect(contextHandler).toBeDefined();

    try {
      for (const handler of agent.handlers.before_agent_start ?? []) {
        await handler({ type: "before_agent_start", systemPrompt: "" }, {});
      }
      const first = (await contextHandler?.(
        { type: "context", messages: [{ role: "user", content: "a" }] },
        {},
      )) as { messages?: Array<{ content?: unknown }> } | undefined;
      const second = (await contextHandler?.(
        { type: "context", messages: (first?.messages ?? []) as never },
        {},
      )) as { messages?: Array<{ content?: unknown }> } | undefined;
      const joined = (second?.messages ?? [])
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .join("\n");
      // No new blocks between the calls: knowledge still appears exactly once
      // and no duplicate projection is appended.
      const knowledgeMessages = (second?.messages ?? []).filter(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Objective: finish the backend health fix"),
      );
      expect(knowledgeMessages).toHaveLength(1);
      expect(joined).not.toContain("## Recent Actions");
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });
});

function workingMemoryToolResultHandler(recorder: ReturnType<typeof createAgentRecorder>) {
  const handlers = recorder.handlers.tool_result ?? [];
  if (handlers.length === 0) {
    throw new Error("no tool_result handlers are registered");
  }
  return (event: unknown, ctx: { cwd?: string }) =>
    Promise.all(handlers.map((handler) => handler(event, ctx)));
}

function workingMemoryEvent(
  tool: string,
  resultSummary: string,
  significance: "high" | "medium" | "low",
) {
  return {
    type: "tool_result",
    toolName: tool,
    details: {
      working_memory: {
        result_summary: resultSummary,
        significance,
      },
    },
  };
}

function parsedActions(fullContent: string | undefined): Array<{
  tool: string;
  result_summary: string;
  significance: string;
}> {
  if (!fullContent) {
    return [];
  }
  const parsed = JSON.parse(fullContent) as {
    actions?: Array<{ tool: string; result_summary: string; significance: string }>;
  };
  return parsed.actions ?? [];
}

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    get events() {
      return Object.keys(handlers);
    },
    on(event: string, handler: RegisteredHandler) {
      handlers[event] ??= [];
      handlers[event]?.push(handler);
      return Promise.resolve();
    },
  };
}

function baseFactoryParams(
  cfg: OpenClawConfig | undefined,
  contextBlockSink?: ContextBlockSink,
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">,
): {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir: string;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
  sessionId: string;
  sessionKey: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
} {
  return {
    cfg,
    sessionManager: {} as SessionManager,
    workspaceDir: "C:/repo",
    provider: "openai",
    modelId: "gpt-test",
    model: undefined,
    sessionId: "runtime-session-id",
    sessionKey: "agent:alpha:main",
    contextBlockSink,
    workingMemoryStore,
  };
}
