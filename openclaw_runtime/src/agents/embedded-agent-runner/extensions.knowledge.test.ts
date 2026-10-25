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
import type { BlockStoreApi, ContextBlock, ContextBlockSink } from "../../context-engine/block.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
} from "../../context-engine/turn-injection-budget.js";
import {
  collectContextOrchestratorCandidate,
  endContextOrchestratorTurn,
  getContextOrchestratorCollection,
} from "../../context-engine/context-orchestrator.js";
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

function sinkBlockWrites(
  sink: ContextBlockSink,
): Array<{ block: ContextBlock }> {
  return (sink as ReturnType<typeof vi.fn>).mock.calls.flatMap(
    ([writes]) => writes as Array<{ block: ContextBlock }>,
  );
}

describe("DCS Stage 4 knowledge extension wiring", () => {
  it("compass flag on: registers the shared context projection factory", () => {
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { compass: { enabled: true } } },
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

  it("role-memory projection keeps an existing memory candidate in the same pass", async () => {
    const turnId = "extension-role-memory-preserves-provider";
    const roleMemoryCfg: OpenClawConfig = {
      runtime: { contextBlock: { "role-memory": { enabled: true } } },
    } as OpenClawConfig;
    const roleBlock: ContextBlock = {
      block_id: "knowledge:role-memory:agent:test:worker",
      block_type: "knowledge",
      source_system: "role-memory",
      session_id: "agent:test:subagent:worker",
      presence: { always_on: false, background: true },
      entities: [],
      valid_at: new Date("2026-07-28T00:00:00.000Z"),
      mutability: "system_managed",
      summary: "Role memory",
      full_content: "role provider context",
      compression_depth: 0,
      entity_extraction_status: "empty",
    };
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async (params: { block_types?: string[]; source_systems?: string[] }) =>
        !params.block_types ? [roleBlock] :
        params.block_types?.includes("knowledge") && params.source_systems?.includes("role-memory")
          ? [roleBlock]
          : [],
      ),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: "memory-provider-runtime",
      authorityVersion: "v1",
      sourceId: "memory-inject-pilot:runtime-memory",
      channel: "memory_pilot",
      target: "system_prompt",
      text: "runtime memory candidate",
    });

    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(roleMemoryCfg, sink, store),
      sessionKey: "agent:test:subagent:worker",
      injectionTurnId: turnId,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    try {
      for (const handler of agent.handlers.before_agent_start ?? []) {
        await handler({ type: "before_agent_start", systemPrompt: "base" }, {});
      }
      const result = (await agent.handlers.context?.[0]?.(
        { type: "context", messages: [{ role: "user", content: "next" }] },
        {},
      )) as { messages?: Array<{ content?: unknown }> };
      expect(getContextOrchestratorCollection(turnId)?.lineage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceId: "memory-inject-pilot:runtime-memory", charsApplied: expect.any(Number) }),
          expect.objectContaining({ sourceId: "context-block:role-memory:knowledge", charsApplied: expect.any(Number) }),
        ]),
      );
      expect(result.messages?.some((message) => message.content === "## Knowledge\nrole provider context")).toBe(true);
      const roleWrite = sinkBlockWrites(sink).find(
        (write) => write.block.source_system === "role-memory",
      );
      expect(roleWrite?.block.full_content).toBeTruthy();
      expect(roleWrite?.block.session_id).toBe("agent:test:subagent:worker");
    } finally {
      endContextOrchestratorTurn(turnId);
      endTurnInjectionBudget(turnId);
    }
  });

  it("passes compass projection and injectionTurnId into the shared ledger", async () => {
    const turnId = "extension-knowledge-turn";
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { compass: { enabled: true } } },
    } as OpenClawConfig;
    const content = "objective: test the production projection path";
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async (params: { block_types?: string[]; source_systems?: string[] }) =>
        (!params.block_types || (params.block_types.includes("knowledge") && params.source_systems?.includes("compass")))
          ? [
              {
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
              },
            ]
          : [],
      ),
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
      const result = (await agent.handlers.context?.[0]?.(
        { type: "context", messages: [{ role: "user", content: "next" }] },
        {},
      )) as { messages?: Array<{ content?: unknown }> };
      const injected = result.messages?.find(
        (message) => typeof message.content === "string" && /^## Knowledge$/m.test(message.content),
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

  it("compass flag on + sink: retired pre-reply input cannot become knowledge content", async () => {
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { compass: { enabled: true } } },
    } as OpenClawConfig;
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(compassCfg, sink, store),
      objective: "build the production bridge",
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const result = (await agent.handlers.context?.[0]?.(
      { type: "context", messages: [{ role: "user", content: "next" }] },
      {},
    )) as { messages?: Array<{ content?: unknown }> };

    const compassWrite = sinkBlockWrites(sink).find(
      (write) => write.block.source_system === "compass",
    );
    expect(compassWrite).toBeDefined();
    expect(compassWrite?.block.full_content).toBeUndefined();
    expect(compassWrite?.block.summary).toContain("context_search");
    expect(compassWrite?.block.presence.on_demand?.expand_tool).toBe("context_search");
    expect(result.messages?.some((message) =>
      typeof message.content === "string" && message.content.includes("build the production bridge"),
    )).toBe(false);
  });

  it("compass flag on + sink: no before_agent_start handler writes a knowledge Block (assembler owns production)", async () => {
    const compassCfg: OpenClawConfig = {
      runtime: { contextBlock: { compass: { enabled: true } } },
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

  it("finalizes Memory or VToken candidates even when every DCS projection flag is off", async () => {
    const turnId = "uas-02-static-only-provider-boundary";
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async () => []),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: "vtoken-static-only",
      authorityVersion: "v1",
      sourceId: "vtoken-assembly",
      channel: "vtoken",
      target: "system_prompt",
      text: "static vtoken addition",
    });
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams({} as OpenClawConfig, undefined, store),
      injectionTurnId: turnId,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    try {
      const beforeResults = [];
      for (const handler of agent.handlers.before_agent_start ?? []) {
        beforeResults.push(
          await handler({ type: "before_agent_start", prompt: "next", systemPrompt: "base" }, {}),
        );
      }
      expect(beforeResults).toContainEqual({
        systemPrompt: "base\n\nstatic vtoken addition",
      });
      expect(store.query).not.toHaveBeenCalled();
      expect(getContextOrchestratorCollection(turnId)?.lineage).toEqual([
        expect.objectContaining({ channel: "knowledge", reason: "flag-off" }),
        expect.objectContaining({ channel: "working_memory", reason: "flag-off" }),
        expect.objectContaining({ channel: "tool_registry", reason: "flag-off" }),
        expect.objectContaining({ channel: "vtoken", reason: "applied" }),
      ]);
    } finally {
      endContextOrchestratorTurn(turnId);
      endTurnInjectionBudget(turnId);
    }
  });

  it("finalizes knowledge, working memory, tools, CVK, VToken, and Memory in one deterministic pass", async () => {
    const turnId = "uas-02-combined-provider-boundary";
    const validAt = new Date("2026-07-30T00:00:00.000Z");
    const knowledgeText = "## Knowledge\nobjective: keep one context authority";
    const blocks: ContextBlock[] = [
      {
        block_id: "knowledge:compass:combined",
        block_type: "knowledge" as const,
        source_system: "compass" as const,
        session_id: "agent:test:main",
        presence: { always_on: false, background: true },
        entities: [],
        valid_at: validAt,
        mutability: "system_managed" as const,
        summary: "Combined knowledge",
        full_content: "objective: keep one context authority",
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
      {
        block_id: "working-memory:combined",
        block_type: "working_memory" as const,
        source_system: "working-memory" as const,
        session_id: "agent:test:main",
        presence: { always_on: false, background: true },
        entities: [],
        valid_at: validAt,
        mutability: "system_managed" as const,
        summary: "Recent actions",
        full_content: JSON.stringify({
          actions: [{ tool: "edit", result_summary: "Unified context", significance: "high" }],
        }),
        compression_depth: 0 as const,
        entity_extraction_status: "empty" as const,
      },
    ];
    const store: Pick<BlockStoreApi, "query" | "upsert"> = {
      query: vi.fn(async (params: { block_types?: string[]; source_systems?: string[] }) =>
        blocks.filter(
          (block) =>
            (params.block_types?.includes(block.block_type) ?? true) &&
            (params.source_systems?.includes(block.source_system) ?? true),
        ),
      ),
      upsert: vi.fn(async () => ({ accepted: true })),
    };
    const sink: ContextBlockSink = vi.fn(async (writes: Parameters<ContextBlockSink>[0]) => {
      blocks.push(...writes.map((write) => write.block));
      return writes.map(() => ({ accepted: true }));
    });
    const cfg: OpenClawConfig = {
      runtime: {
        contextBlock: {
          compass: { enabled: true },
          "working-memory": { enabled: true },
          "tool-registry": { enabled: true },
        },
      },
    } as OpenClawConfig;

    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: "cvk-engine",
      authorityVersion: "v1",
      sourceId: "cvk-context-engine",
      channel: "cvk_addition",
      target: "system_prompt",
      text: "cvk addition",
    });
    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: "vtoken-pack",
      authorityVersion: "v1",
      sourceId: "vtoken-assembly",
      channel: "vtoken",
      target: "system_prompt",
      text: "vtoken addition",
    });
    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: "memory-pilot",
      authorityVersion: "v1",
      sourceId: "memory-inject-pilot",
      channel: "memory_pilot",
      target: "system_prompt",
      text: "memory addition",
    });
    collectContextOrchestratorCandidate(turnId, {
      authorityObjectId: blocks[0]!.block_id,
      authorityVersion: `${validAt.toISOString()}:compression-0`,
      sourceId: "vtoken-duplicate-projection",
      channel: "vtoken",
      target: "system_prompt",
      text: knowledgeText,
    });

    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      ...baseFactoryParams(cfg, sink, store),
      injectionTurnId: turnId,
      toolEntries: [
        { resourceId: "read", kind: "toolset", title: "Read", purpose: "Read" },
      ],
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    try {
      let projectedSystemPrompt = "base";
      for (const handler of agent.handlers.before_agent_start ?? []) {
        const beforeResult = (await handler(
          {
            type: "before_agent_start",
            prompt: "next",
            systemPrompt: projectedSystemPrompt,
          },
          {},
        )) as { systemPrompt?: string } | undefined;
        projectedSystemPrompt = beforeResult?.systemPrompt ?? projectedSystemPrompt;
      }
      const result = (await agent.handlers.context?.[0]?.(
        { type: "context", messages: [{ role: "user", content: "next" }] },
        {},
      )) as { messages?: Array<{ content?: unknown }> };
      const additions = (result.messages ?? []).slice(1).map((message) => message.content);
      expect(additions).toEqual([
        knowledgeText,
        expect.stringContaining("## Recent Actions"),
        expect.stringContaining("## Tools"),
      ]);
      expect(projectedSystemPrompt).toBe(
        "base\n\ncvk addition\n\nvtoken addition\n\n## Knowledge\nobjective: keep one context authority\n\nmemory addition",
      );
      // Tool-registry and compass are both real producers when their flags and
      // inputs are present; each writes through the shared sink once.
      expect(sink).toHaveBeenCalledTimes(2);
      expect(getContextOrchestratorCollection(turnId)?.diagnostics).toMatchObject({
        finalized: true,
        collected: 7,
        unique: 7,
        duplicates: 0,
      });
      const ledger = getTurnInjectionBudget(turnId);
      expect(ledger).toBeDefined();
      const accounting = summarizeTurnInjection(ledger!);
      expect(Object.keys(accounting.byChannel)).toEqual([
        "knowledge",
        "working_memory",
        "tool_registry",
        "cvk_addition",
        "vtoken",
        "memory_pilot",
      ]);
      expect(accounting.charsApplied).toBe(
        getContextOrchestratorCollection(turnId)?.lineage.reduce(
          (total, entry) => total + entry.charsApplied,
          0,
        ),
      );
      expect(
        getContextOrchestratorCollection(turnId)?.lineage.map((entry) => entry.channel),
      ).toEqual([
        "knowledge",
        "working_memory",
        "tool_registry",
        "cvk_addition",
        "vtoken",
        "vtoken",
        "memory_pilot",
      ]);
    } finally {
      endContextOrchestratorTurn(turnId);
      endTurnInjectionBudget(turnId);
    }
  });
});
