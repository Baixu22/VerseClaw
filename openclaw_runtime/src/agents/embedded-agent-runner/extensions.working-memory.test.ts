import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink, ContextBlockWrite } from "../../context-engine/block.js";
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
    const agent = createAgentRecorder();
    const cfg: OpenClawConfig = {
      runtime: { contextBlock: { "working-memory": { enabled: true } } },
    };
    const messages = [{ role: "user" as const, content: "next" }];

    for (const factory of buildEmbeddedExtensionFactories(baseFactoryParams(cfg, undefined, {
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
      }))) {
      void factory(agent as unknown as ExtensionAPI);
    }

    expect(agent.handlers.context).toHaveLength(1);
    await expect(agent.handlers.context?.[0]?.({ type: "context", messages }, {})).resolves.toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("## Recent Actions") }),
      ]),
    });
  });
});

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