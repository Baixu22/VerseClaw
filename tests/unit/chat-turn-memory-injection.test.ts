import { describe, expect, it, vi } from "vitest";
import {
  assembleChatTurnMemoryInjection,
  computeMemoryExtraSystemPrompt,
  DEFAULT_MEMORY_INJECT_PILOT_CONFIG,
  resolveMemoryInjectPilotConfig,
  shouldInjectChatTurnMemory,
  type ChatTurnMemoryInjectionQuery,
  type MemoryInjectPilotConfig,
} from "../../openclaw_runtime/src/context-engine/chat-turn-memory-injection";
import type {
  ContextItem,
  RuntimeContextProvider,
  RuntimeContextProviderResult,
} from "../../openclaw_runtime/src/runtime-core";

function makeProvider(
  id: string,
  result: RuntimeContextProviderResult | Error,
): RuntimeContextProvider {
  return {
    manifest: {
      id,
      kind: "context",
      title: `${id} provider`,
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
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function makeContextItems(providerId: string, count: number): ContextItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${providerId}-item-${i}`,
    kind: "memory" as const,
    text: `${providerId} memory item ${i}`,
    source: `${providerId}:bucket`,
    evidenceRefs: [],
    metadata: { providerId, bucket: "projectFacts" },
  }));
}

const enabledConfig: MemoryInjectPilotConfig = {
  enabled: true,
  providers: ["role-memory"],
  totalTokenBudget: 512,
  sessions: "main-only",
};

const mainSessionQuery: ChatTurnMemoryInjectionQuery = {
  goal: "test query",
  tokenBudget: 256,
  sessionKey: "agent:main:main",
};

describe("resolveMemoryInjectPilotConfig", () => {
  it("returns default-off config when no injectPilot section exists", () => {
    const config = resolveMemoryInjectPilotConfig({});
    expect(config).toEqual(DEFAULT_MEMORY_INJECT_PILOT_CONFIG);
    expect(config.enabled).toBe(false);
  });

  it("returns default-off config when injectPilot.enabled is not strictly true", () => {
    const config = resolveMemoryInjectPilotConfig({
      runtime: { memory: { injectPilot: { enabled: "true" } } },
    });
    expect(config.enabled).toBe(false);
  });

  it("resolves enabled config with all fields", () => {
    const config = resolveMemoryInjectPilotConfig({
      runtime: {
        memory: {
          injectPilot: {
            enabled: true,
            providers: ["role-memory", "runtime-memory"],
            totalTokenBudget: 1024,
            sessions: "all",
          },
        },
      },
    });
    expect(config).toEqual({
      enabled: true,
      providers: ["role-memory", "runtime-memory"],
      totalTokenBudget: 1024,
      sessions: "all",
    });
  });

  it("accepts config nested under a `config` key", () => {
    const config = resolveMemoryInjectPilotConfig({
      config: {
        runtime: {
          memory: { injectPilot: { enabled: true } },
        },
      },
    });
    expect(config.enabled).toBe(true);
  });

  it("filters out unknown provider ids and falls back to default", () => {
    const config = resolveMemoryInjectPilotConfig({
      runtime: {
        memory: { injectPilot: { enabled: true, providers: ["unknown"] } },
      },
    });
    expect(config.providers).toEqual(["role-memory"]);
  });

  it("rejects non-finite or non-positive token budgets", () => {
    const config = resolveMemoryInjectPilotConfig({
      runtime: {
        memory: { injectPilot: { enabled: true, totalTokenBudget: -1 } },
      },
    });
    expect(config.totalTokenBudget).toBe(
      DEFAULT_MEMORY_INJECT_PILOT_CONFIG.totalTokenBudget,
    );
  });

  it("defaults sessions to main-only for any non-'all' value", () => {
    const config = resolveMemoryInjectPilotConfig({
      runtime: {
        memory: { injectPilot: { enabled: true, sessions: "weird" } },
      },
    });
    expect(config.sessions).toBe("main-only");
  });
});

describe("shouldInjectChatTurnMemory", () => {
  it("returns false when pilot is disabled", () => {
    expect(
      shouldInjectChatTurnMemory(
        { ...enabledConfig, enabled: false },
        mainSessionQuery,
      ),
    ).toBe(false);
  });

  it("returns true for main session when pilot is enabled with main-only scope", () => {
    expect(shouldInjectChatTurnMemory(enabledConfig, mainSessionQuery)).toBe(true);
  });

  it("returns false for non-main session when scope is main-only", () => {
    expect(
      shouldInjectChatTurnMemory(enabledConfig, {
        ...mainSessionQuery,
        sessionKey: "agent:main:architect",
      }),
    ).toBe(false);
  });

  it("returns false when sessionKey is missing and scope is main-only", () => {
    expect(
      shouldInjectChatTurnMemory(enabledConfig, {
        goal: "test",
        tokenBudget: 256,
      }),
    ).toBe(false);
  });

  it("returns true for any session when scope is all", () => {
    expect(
      shouldInjectChatTurnMemory(
        { ...enabledConfig, sessions: "all" },
        { ...mainSessionQuery, sessionKey: "agent:main:architect" },
      ),
    ).toBe(true);
  });

  it("accepts cron-prefixed main sessions", () => {
    expect(
      shouldInjectChatTurnMemory(enabledConfig, {
        ...mainSessionQuery,
        sessionKey: "cron:daily:main",
      }),
    ).toBe(true);
  });
});

describe("assembleChatTurnMemoryInjection", () => {
  it("returns null when pilot is disabled", async () => {
    const provider = makeProvider("role-memory", {
      status: "success",
      contextItems: makeContextItems("role-memory", 2),
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [provider],
      { ...enabledConfig, enabled: false },
    );
    expect(result).toBeNull();
  });

  it("returns null when no providers match the configured provider list", async () => {
    const provider = makeProvider("role-memory", {
      status: "success",
      contextItems: makeContextItems("role-memory", 1),
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [provider],
      { ...enabledConfig, providers: ["runtime-memory"] },
    );
    expect(result).toBeNull();
  });

  it("returns null when all providers return fallback with no items", async () => {
    const provider = makeProvider("role-memory", {
      status: "fallback",
      contextItems: [],
      diagnostics: [
        {
          surface: "context",
          providerId: "role-memory",
          status: "skipped",
          reason: "no_result",
          message: "No cards.",
          evidenceRefs: [],
        },
      ],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [provider],
      enabledConfig,
    );
    expect(result).toBeNull();
  });

  it("returns text when a provider returns context items", async () => {
    const provider = makeProvider("role-memory", {
      status: "success",
      contextItems: makeContextItems("role-memory", 2),
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [provider],
      enabledConfig,
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Memory Context");
    expect(result!.text).toContain("role-memory memory item 0");
    expect(result!.metadata.totalItems).toBe(2);
  });

  it("isolates provider failures — a throwing provider does not abort the turn", async () => {
    const throwingProvider = makeProvider(
      "role-memory",
      new Error("store unavailable"),
    );
    const okProvider = makeProvider("runtime-memory", {
      status: "success",
      contextItems: makeContextItems("runtime-memory", 1),
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [throwingProvider, okProvider],
      { ...enabledConfig, providers: ["role-memory", "runtime-memory"] },
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("runtime-memory memory item 0");
    expect(result!.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "role-memory",
          status: "error",
          reason: "provider_exception",
        }),
      ]),
    );
  });

  it("returns null when every provider throws", async () => {
    const throwingProvider = makeProvider(
      "role-memory",
      new Error("store unavailable"),
    );
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [throwingProvider],
      enabledConfig,
    );
    expect(result).toBeNull();
  });

  it("skips injection for non-main sessions when scope is main-only", async () => {
    const provider = makeProvider("role-memory", {
      status: "success",
      contextItems: makeContextItems("role-memory", 1),
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      { ...mainSessionQuery, sessionKey: "agent:main:subagent" },
      [provider],
      enabledConfig,
    );
    expect(result).toBeNull();
  });

  it("groups context items by provider in the rendered text", async () => {
    const provider = makeProvider("role-memory", {
      status: "success",
      contextItems: [
        ...makeContextItems("role-memory", 1),
        ...makeContextItems("role-memory", 1),
      ],
      diagnostics: [],
      evidenceRefs: [],
    });
    const result = await assembleChatTurnMemoryInjection(
      mainSessionQuery,
      [provider],
      enabledConfig,
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("<!-- provider: role-memory -->");
  });
});

describe("computeMemoryExtraSystemPrompt (gateway wiring helper)", () => {
  const enabledCfg = {
    runtime: {
      memory: {
        injectPilot: {
          enabled: true,
          providers: ["role-memory"],
          totalTokenBudget: 512,
          sessions: "main-only",
        },
      },
    },
  };
  const disabledCfg = { runtime: { memory: { injectPilot: { enabled: false } } } };

  it("returns original extraSystemPrompt unchanged when pilot is off (byte-identical)", async () => {
    const factory = vi.fn(() => [] as RuntimeContextProvider[]);
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      disabledCfg,
      "agent:main:main",
      factory,
    );
    expect(result).toBe("original prompt");
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns undefined unchanged when pilot is off and no original prompt", async () => {
    const result = await computeMemoryExtraSystemPrompt(
      undefined,
      {},
      "agent:main:main",
      () => [],
    );
    expect(result).toBeUndefined();
  });

  it("appends memory context text when pilot is on and providers return items", async () => {
    const provider = makeProvider(
      "role-memory",
      makeContextItems("role-memory", 2) as unknown as RuntimeContextProviderResult,
    );
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      enabledCfg,
      "agent:main:main",
      () => [provider],
    );
    expect(result).toContain("original prompt");
    expect(result).toContain("## Memory Context");
    expect(result).toContain("role-memory memory item 0");
    expect(result).toContain("role-memory memory item 1");
  });

  it("returns just the memory text when no original extraSystemPrompt", async () => {
    const provider = makeProvider(
      "role-memory",
      makeContextItems("role-memory", 1) as unknown as RuntimeContextProviderResult,
    );
    const result = await computeMemoryExtraSystemPrompt(
      undefined,
      enabledCfg,
      "agent:main:main",
      () => [provider],
    );
    expect(result).toContain("## Memory Context");
    expect(result).not.toContain("undefined");
  });

  it("returns original when pilot is on but providers return no items", async () => {
    const provider = makeProvider("role-memory", {
      contextItems: [],
      status: "fallback",
      diagnostics: [],
    } as never);
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      enabledCfg,
      "agent:main:main",
      () => [provider],
    );
    expect(result).toBe("original prompt");
  });

  it("returns original when provider throws (error suppressed internally)", async () => {
    // Provider errors are isolated inside assembleChatTurnMemoryInjection —
    // they do NOT propagate to computeMemoryExtraSystemPrompt's catch block.
    // The throwing provider contributes 0 items → result is null → original preserved.
    const provider = makeProvider(
      "role-memory",
      new Error("provider explosion"),
    );
    const log = vi.fn();
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      enabledCfg,
      "agent:main:main",
      () => [provider],
      log,
    );
    expect(result).toBe("original prompt");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs and returns original when providerFactory throws", async () => {
    const log = vi.fn();
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      enabledCfg,
      "agent:main:main",
      () => {
        throw new Error("factory explosion");
      },
      log,
    );
    expect(result).toBe("original prompt");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[memory-inject-pilot]"),
      expect.objectContaining({ err: expect.stringContaining("factory explosion") }),
    );
  });

  it("does not call providerFactory when pilot is off", async () => {
    const factory = vi.fn(() => {
      throw new Error("should not be called");
    });
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      disabledCfg,
      "agent:main:main",
      factory,
    );
    expect(result).toBe("original prompt");
    expect(factory).not.toHaveBeenCalled();
  });

  it("skips injection for non-main session even when pilot is on", async () => {
    const provider = makeProvider(
      "role-memory",
      makeContextItems("role-memory", 1) as unknown as RuntimeContextProviderResult,
    );
    const result = await computeMemoryExtraSystemPrompt(
      "original prompt",
      enabledCfg,
      "agent:main:architect",
      () => [provider],
    );
    expect(result).toBe("original prompt");
  });
});
