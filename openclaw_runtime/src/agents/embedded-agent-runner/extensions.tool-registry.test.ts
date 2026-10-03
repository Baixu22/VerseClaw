/**
 * DCS Stage 3 tool-registry extension wiring tests.
 *
 * Verifies that buildEmbeddedExtensionFactories wires the tool-registry adapter:
 * - The factory is omitted when no sink or no toolEntries are provided.
 * - The factory is omitted when the feature flag is off.
 * - The factory is omitted for empty toolEntries (safe no-write).
 * - The factory registers a before_agent_start handler that produces a
 *   tool_registry Block through ContextBlockSink with real mapped entries.
 * - The handler is best-effort: sink failure does not block agent start.
 * - Production mapping: mapToolsToToolRegistryEntries feeds toolEntries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  mapToolsToToolRegistryEntries,
  type ToolRegistryEntry,
} from "../../context-engine/handlers/tool-registry-handler.js";
import { buildEmbeddedExtensionFactories, type PrepareEmbeddedContext } from "./extensions.js";
import { endContextOrchestratorTurn } from "../../context-engine/context-orchestrator.js";
import { endTurnInjectionBudget } from "../../context-engine/turn-injection-budget.js";

type RegisteredHandler = (event: unknown, ctx: { cwd?: string }) => unknown;

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    on(event: string, handler: RegisteredHandler) {
      (handlers[event] ??= []).push(handler);
    },
  };
}

function baseFactoryParams(
  cfg: OpenClawConfig | undefined,
  sink?: ContextBlockSink,
  store?: Pick<BlockStoreApi, "query" | "upsert">,
  toolEntries?: ToolRegistryEntry[],
) {
  return {
    cfg,
    sessionManager: {} as SessionManager,
    provider: "test",
    modelId: "test-model",
    model: undefined as ProviderRuntimeModel | undefined,
    sessionId: "session-a",
    sessionKey: "agent:test:main",
    ...(sink ? { contextBlockSink: sink } : {}),
    ...(store ? { workingMemoryStore: store } : {}),
    ...(toolEntries ? { toolEntries } : {}),
  };
}

const toolEntries: ToolRegistryEntry[] = [
  { resourceId: "edit", kind: "toolset", title: "Edit", purpose: "Edit a file" },
  { resourceId: "write", kind: "toolset", title: "Write", purpose: "Write a file" },
];

const enabledCfg: OpenClawConfig = {
  runtime: { contextBlock: { "tool-registry": { enabled: true } } },
} as OpenClawConfig;

const disabledCfg: OpenClawConfig = {
  runtime: { contextBlock: { "tool-registry": { enabled: false } } },
} as OpenClawConfig;

beforeEach(() => {
  // Reset any global state between tests
});

describe("DCS Stage 3 tool-registry extension wiring", () => {
  it.each([false, true])(
    "shares precheck and before-start preparation without duplicate writes (killed=%s)",
    async (killed) => {
      vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", killed ? "1" : "0");
      const turnId = `tool-preparation-${killed}`;
      const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
      const store = {
        query: vi.fn(async () => []),
        upsert: vi.fn(async () => ({ accepted: true })),
      };
      const agent = createAgentRecorder();
      let prepare: PrepareEmbeddedContext | undefined;
      try {
        for (const factory of buildEmbeddedExtensionFactories({
          ...baseFactoryParams(enabledCfg, sink, store, toolEntries),
          injectionTurnId: turnId,
          registerContextPreparation: (callback) => {
            prepare = callback;
          },
        }))
          void factory(agent as unknown as ExtensionAPI);
        expect(prepare).toBeTypeOf("function");
        await prepare!([]);
        for (const handler of agent.handlers.before_agent_start ?? []) {
          await handler({ type: "before_agent_start", prompt: "test" }, {});
        }
        expect(sink).toHaveBeenCalledTimes(killed ? 0 : 1);
        if (killed) expect(store.query).not.toHaveBeenCalled();
      } finally {
        endContextOrchestratorTurn(turnId);
        endTurnInjectionBudget(turnId);
        vi.unstubAllEnvs();
      }
    },
  );

  it("omits the tool-registry factory when flag is off", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(disabledCfg, sink, store, toolEntries),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    // Invoke all before_agent_start handlers; none should call the sink with
    // a tool_registry Block because the tool-registry factory is omitted.
    // (The R3 task-state factory registers before_agent_start too, but for a
    // main session key it is a no-op and does not call the sink.)
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it("omits the tool-registry factory when no sink is provided even if flag is on", () => {
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    // Without a sink, tool-registry is omitted regardless of toolEntries.
    // Compare factory counts: providing toolEntries should not add a factory
    // when no sink is available.
    const factoriesWithToolEntries = buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, undefined, store, toolEntries),
    );
    const factoriesWithoutToolEntries = buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, undefined, store, undefined),
    );
    expect(factoriesWithToolEntries.length).toBe(factoriesWithoutToolEntries.length);
  });

  it("omits the tool-registry factory when no toolEntries are provided even if flag is on", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, sink, store, undefined),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    // Invoke all before_agent_start handlers; none should call the sink with
    // a tool_registry Block because toolEntries is absent.
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it("registers a before_agent_start handler that writes a tool_registry Block", async () => {
    const sink: ContextBlockSink = vi.fn(async (writes) => writes.map(() => ({ accepted: true })));
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, sink, store, toolEntries),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const handlers = agent.handlers.before_agent_start ?? [];
    // tool-registry registers before_agent_start; task-state may also register
    // one (no-op for main session). Invoke all handlers.
    expect(handlers.length).toBeGreaterThanOrEqual(1);
    for (const handler of handlers) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }

    // Verify the sink was called with a tool_registry Block
    expect(sink).toHaveBeenCalledTimes(1);
    const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      block: { block_type: string; source_system: string };
      admission: { significance: string; write_origin: string };
    }>;
    expect(writeArg[0].block.block_type).toBe("tool_registry");
    expect(writeArg[0].block.source_system).toBe("cvk");
    expect(writeArg[0].admission).toEqual({
      significance: "high",
      write_origin: "handler",
    });
  });

  it("best-effort: sink failure does not block agent start (handler returns undefined)", async () => {
    const sink: ContextBlockSink = vi.fn(async () => {
      throw new Error("sink failure");
    });
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, sink, store, toolEntries),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const handlers = agent.handlers.before_agent_start ?? [];
    // Invoke all handlers; the tool-registry handler should swallow sink
    // failures and not throw.
    const results: unknown[] = [];
    for (const handler of handlers) {
      results.push(await handler({ type: "before_agent_start", prompt: "test" }, {}));
    }
    // Should not throw, should return undefined
    expect(results.every((r) => r === undefined)).toBe(true);
  });

  it("omits the tool-registry factory when toolEntries is an empty array", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, sink, store, []),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it("flag on + mapped real agent tools writes tool_registry with those entries", async () => {
    const sink: ContextBlockSink = vi.fn(async (writes) => writes.map(() => ({ accepted: true })));
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    // Simulate production: map effective agent tools then pass toolEntries.
    const mapped = mapToolsToToolRegistryEntries([
      {
        name: "context_read",
        label: "Context Read",
        description: "Read full context blocks on demand",
        risk: "readonly",
        parameters: {
          type: "object",
          properties: { block_type: { type: "string" } },
        },
      },
      {
        name: "write",
        label: "Write",
        description: "Write a file",
        risk: "write",
      },
    ]);
    expect(mapped.map((e) => e.resourceId)).toEqual(["context_read", "write"]);

    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(enabledCfg, sink, store, mapped),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }

    expect(sink).toHaveBeenCalledTimes(1);
    const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      block: { block_type: string; full_content?: string };
    }>;
    expect(writeArg[0].block.block_type).toBe("tool_registry");
    const parsed = JSON.parse(writeArg[0].block.full_content ?? "{}") as {
      entries: ToolRegistryEntry[];
    };
    expect(parsed.entries.map((e) => e.resourceId)).toEqual(["context_read", "write"]);
    expect(parsed.entries[0]?.title).toBe("Context Read");
    expect(parsed.entries[0]?.purpose).toContain("context block");
  });

  it("flag off does not write even when real mapped toolEntries are provided", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const mapped = mapToolsToToolRegistryEntries([{ name: "edit", description: "Edit a file" }]);
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(disabledCfg, sink, store, mapped),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }
    expect(sink).not.toHaveBeenCalled();
  });
});
