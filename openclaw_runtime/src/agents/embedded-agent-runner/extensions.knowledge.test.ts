/**
 * DCS Stage 4 knowledge extension wiring tests.
 *
 * Verifies that buildEmbeddedExtensionFactories registers the shared context
 * projection factory for knowledge without adding another Block producer.
 *
 * The extension layer only needs to pass contextBlockSink through to the
 * Assembler so that compass/role-memory handlers can write knowledge Blocks.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type {
  BlockStoreApi,
  ContextBlockSink,
} from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
} from "../../context-engine/turn-injection-budget.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";

function createAgentRecorder() {
  const handlers: Record<string, Array<(event: unknown, ctx: { cwd?: string }) => unknown>> = {};
  return {
    handlers,
    on(event: string, handler: (event: unknown, ctx: { cwd?: string }) => unknown) {
      (handlers[event] ??= []).push(handler);
    },
  };
}

function baseFactoryParams(
  cfg: OpenClawConfig | undefined,
  sink?: ContextBlockSink,
  store?: Pick<BlockStoreApi, "query" | "upsert">,
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
  };
}

describe("DCS Stage 4 knowledge extension wiring", () => {
  it("compass flag on: registers the shared context projection factory", () => {
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { "compass": { enabled: true } } },
    } as OpenClawConfig;
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };

    const factoriesWithCompass = buildEmbeddedExtensionFactories(
      baseFactoryParams(compassCfg, sink, store),
    );
    const factoriesWithoutCompass = buildEmbeddedExtensionFactories(
      baseFactoryParams({} as OpenClawConfig, sink, store),
    );

    expect(factoriesWithCompass.length).toBe(factoriesWithoutCompass.length + 1);
  });

  it("role-memory flag on: registers the shared context projection factory", () => {
    const roleMemoryCfg: OpenClawConfig = {
      runtime: { contextBlock: { "role-memory": { enabled: true } } },
    } as OpenClawConfig;
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };

    const factoriesWithRoleMemory = buildEmbeddedExtensionFactories(
      baseFactoryParams(roleMemoryCfg, sink, store),
    );
    const factoriesWithoutRoleMemory = buildEmbeddedExtensionFactories(
      baseFactoryParams({} as OpenClawConfig, sink, store),
    );

    expect(factoriesWithRoleMemory.length).toBe(factoriesWithoutRoleMemory.length + 1);
  });

  it("passes compass projection and injectionTurnId into the shared ledger", async () => {
    const turnId = "extension-knowledge-turn";
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { "compass": { enabled: true } } },
    } as OpenClawConfig;
    const content = "objective: test the production projection path";
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async (params: { block_types?: string[]; source_systems?: string[] }) =>
        params.block_types?.includes("knowledge") && params.source_systems?.includes("compass")
          ? [{
              block_id: "knowledge:compass:agent:test:main",
              block_type: "knowledge" as const,
              source_system: "compass" as const,
              session_id: "agent:test:main",
              presence: { always_on: false, background: true },
              entities: [],
              valid_at: new Date("2026-07-28T00:00:00.000Z"),
              mutability: "system_managed" as const,
              summary: "Fixture knowledge",
              full_content: content,
              compression_depth: 0 as const,
              entity_extraction_status: "empty" as const,
            }]
          : []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(compassCfg, undefined, store),
      injectionTurnId: turnId,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    try {
      expect(agent.handlers.context).toHaveLength(1);
      const result = await agent.handlers.context?.[0]?.(
        { type: "context", messages: [{ role: "user", content: "next" }] },
        {},
      ) as { messages?: Array<{ content?: unknown }> };
      const injected = result.messages?.find((message) =>
        typeof message.content === "string" && /^## Knowledge$/m.test(message.content),
      )?.content as string | undefined;
      expect(injected).toBe(`## Knowledge\n${content}`);

      const ledger = getTurnInjectionBudget(turnId);
      expect(ledger).toBeDefined();
      const accounting = summarizeTurnInjection(ledger!);
      expect(accounting.byChannel.knowledge?.applied).toBe(injected?.length);
      expect(accounting.byChannel.working_memory).toBeUndefined();
      expect(accounting.byChannel.tool_registry).toBeUndefined();
    } finally {
      endTurnInjectionBudget(turnId);
    }
  });

  it("compass flag on + sink: no before_agent_start handler writes a knowledge Block (assembler owns production)", async () => {
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { "compass": { enabled: true } } },
    } as OpenClawConfig;
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories(
      baseFactoryParams(compassCfg, sink, store),
    )) {
      void factory(agent as unknown as ExtensionAPI);
    }
    // Invoke all before_agent_start handlers
    for (const handler of agent.handlers.before_agent_start ?? []) {
      await handler({ type: "before_agent_start", prompt: "test" }, {});
    }
    // knowledge Block production happens in the assembler (via contextBlockSink),
    // NOT in a before_agent_start handler. So the sink should not be called by
    // the extension layer for knowledge production.
    // (tool-registry factory may call the sink, but it's off in this test.)
    expect(sink).not.toHaveBeenCalled();
  });
});
