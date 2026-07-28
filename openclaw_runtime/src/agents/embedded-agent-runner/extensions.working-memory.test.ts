import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink, ContextBlockWrite } from "../../context-engine/block.js";
import {
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
} from "../../context-engine/turn-injection-budget.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";

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
