/**
 * DCS Stage 4 knowledge extension wiring tests.
 *
 * Verifies that buildEmbeddedExtensionFactories does NOT register a separate
 * knowledge factory — knowledge Block production happens inside the Assembler
 * (via contextBlockSink) and injection happens via Assembler #appendKnowledge.
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
  it("compass flag on: does not register a separate knowledge factory (production in assembler)", () => {
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

    // compass/role-memory do not add a new factory; production is in assembler.
    expect(factoriesWithCompass.length).toBe(factoriesWithoutCompass.length);
  });

  it("role-memory flag on: does not register a separate knowledge factory", () => {
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

    expect(factoriesWithRoleMemory.length).toBe(factoriesWithoutRoleMemory.length);
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
