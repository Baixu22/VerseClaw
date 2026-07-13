import { describe, expect, it } from "vitest";
import {
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
} from "../../openclaw_runtime/src/agents/loop-context-pack";
import {
  CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  createTestContextProviderRegistry,
  createLegacyContextEngineProvider,
  createLoopContextPackProvider,
  runTestContextProviderRegistry,
} from "./helpers/context-provider-registry";
import {
  AGENT_MAP_CONTEXT_PROVIDER_ID,
  createAgentMapContextProvider,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  SYMBOL_CONTEXT_PROVIDER_ID,
  createSymbolContextProvider,
} from "../../openclaw_runtime/src/context-engine/symbol-context-provider";
import { RUNTIME_MEMORY_CONTEXT_PROVIDER_ID } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  buildAgentMapResultFixture,
  buildGroundingRefFixture,
  buildRuntimeContextProviderManifestFixture,
  buildRuntimeSymbolOverview,
  collectRuntimeRegistryDiagnostics,
  isContextItem,
  isGroundingShadowConsumerSummary,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
  type RuntimeContextProvider,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    registryPilot: { enabled: true },
    providerRegistry: { shadow: true },
    contextProviders: { registryPilot: true },
  },
};

const RAW_GROUNDING_SENTINEL = "RAW_GROUNDING_SHADOW_PILOT_SHOULD_NOT_SURVIVE";

const agentMapProviderEnabledConfig = {
  runtime: {
    ...enabledConfig.runtime,
    agentMap: { provider: true },
  },
};

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

describe("context provider registry pilot", () => {
  it("keeps registry providers explicit and validates compatibility manifests", () => {
    const registry = createTestContextProviderRegistry();
    const legacy = registry.resolve(LEGACY_CONTEXT_ENGINE_PROVIDER_ID);
    const loop = registry.resolve(LOOP_CONTEXT_PACK_PROVIDER_ID);

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(legacy).toBeTruthy();
    expect(loop).toBeTruthy();
    expect(isRuntimeContextProviderManifest(legacy?.manifest)).toBe(true);
    expect(isRuntimeContextProviderManifest(loop?.manifest)).toBe(true);
    expect(registry.listByCapability("context.legacy").map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
    ]);
    expect(registry.listByCapability("context.loop-pack").map((manifest) => manifest.id)).toEqual([
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
  });

  it("returns flag-disabled diagnostics without changing legacy messages or prompt text", async () => {
    const messages = [
      { role: "user", content: "Keep legacy message identity." },
      { role: "assistant", content: "I will not reorder messages." },
    ] as never;
    const loopContextInput = {
      systemAppRules: ["System rule"],
      projectRules: ["Project rule"],
      initialConstraints: ["Initial constraint"],
    };
    const baselinePack = buildLoopContextPack(loopContextInput);
    const baselinePrompt = formatLoopContextPackForPrompt(baselinePack);

    const result = await runTestContextProviderRegistry({
      config: {},
      legacyMessages: messages,
      loopContextInput,
      sessionId: "session-flag-off",
    });

    expect(result.enabled).toBe(false);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        surface: "context",
        status: "skipped",
        reason: "flag_disabled",
        metadata: expect.objectContaining({ legacyAuthoritative: true }),
      }),
    ]);
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(messages[0]).toMatchObject({ content: "Keep legacy message identity." });
    expect(messages[1]).toMatchObject({ content: "I will not reorder messages." });
    expect(formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput))).toBe(
      baselinePrompt,
    );
  });

  it("does not execute explicit AgentMap or Symbol providers when flags are disabled", async () => {
    const agentMapProvider = createAgentMapContextProvider({
      getResult: () => {
        throw new Error("AgentMap provider should not run while flags are disabled.");
      },
    });
    const symbolProvider = createSymbolContextProvider({
      getOverviews: () => {
        throw new Error("Symbol provider should not run while flags are disabled.");
      },
    });

    const result = await runTestContextProviderRegistry({
      config: {},
      extraProviders: [agentMapProvider, symbolProvider],
      sessionId: "session-extra-flag-off",
    });

    expect(result.enabled).toBe(false);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([]);
    expect(result.registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
      AGENT_MAP_CONTEXT_PROVIDER_ID,
      SYMBOL_CONTEXT_PROVIDER_ID,
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "flag_disabled",
      }),
    ]);
  });

  it("runs AgentMap only when explicitly injected into the pilot registry", async () => {
    let agentMapRuns = 0;
    const agentMapProvider = createAgentMapContextProvider({
      getResult: () => {
        agentMapRuns += 1;
        return buildAgentMapResultFixture();
      },
    });

    const defaultResult = await runTestContextProviderRegistry({
      config: enabledConfig,
      legacyMessages: [{ role: "user", content: "Default providers only." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      sessionId: "session-default-only",
    });

    expect(defaultResult.enabled).toBe(true);
    expect(agentMapRuns).toBe(0);
    expect(defaultResult.registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(defaultResult.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([LEGACY_CONTEXT_ENGINE_PROVIDER_ID, LOOP_CONTEXT_PACK_PROVIDER_ID]);

    const explicitResult = await runTestContextProviderRegistry({
      config: agentMapProviderEnabledConfig,
      extraProviders: [agentMapProvider],
      extraProviderQueries: {
        [AGENT_MAP_CONTEXT_PROVIDER_ID]: { taskId: "session-agentmap-explicit" },
      },
      sessionId: "session-agentmap-explicit",
    });

    expect(agentMapRuns).toBe(1);
    expect(explicitResult.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([AGENT_MAP_CONTEXT_PROVIDER_ID]);
    expect(explicitResult.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringContaining(`${AGENT_MAP_CONTEXT_PROVIDER_ID}:symbol:`),
        metadata: expect.objectContaining({
          readonlyAgentMap: true,
          shadowOnly: true,
          noPromptAuthority: true,
        }),
      }),
    ]));
  });

  it("does not execute explicit AgentMap provider output unless the AgentMap provider flag is enabled", async () => {
    let agentMapRuns = 0;
    const result = await runTestContextProviderRegistry({
      config: enabledConfig,
      extraProviders: [
        createAgentMapContextProvider({
          getResult: () => {
            agentMapRuns += 1;
            return buildAgentMapResultFixture();
          },
        }),
      ],
      extraProviderQueries: {
        [AGENT_MAP_CONTEXT_PROVIDER_ID]: { taskId: "session-agentmap-provider-flag-off" },
      },
      sessionId: "session-agentmap-provider-flag-off",
    });

    expect(result.enabled).toBe(true);
    expect(agentMapRuns).toBe(0);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([
      expect.objectContaining({
        status: "fallback",
        contextItems: [],
        metadata: expect.objectContaining({
          providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
          enabled: false,
          legacyBehaviorUnaffected: true,
        }),
      }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "skipped",
        reason: "flag_disabled",
        metadata: expect.objectContaining({
          requiredFlag: "runtime.agentMap.provider",
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        }),
      }),
    ]);
  });


  it("emits shadow context items and diagnostics without changing prompt text or message order", async () => {
    const messages = [
      { role: "user", content: "Implement registry shadow only." },
      { role: "assistant", content: "Legacy messages stay authoritative." },
    ] as never;
    const loopContextInput = {
      systemAppRules: ["System rule"],
      projectRules: ["Project rule"],
      relevantKnowledge: ["knowledge ".repeat(120)],
      budget: {
        totalTokens: 35,
        sectionTokens: { relevantKnowledge: 5 },
      },
    };
    const baselinePrompt = formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput));

    const result = await runTestContextProviderRegistry({
      config: enabledConfig,
      legacyMessages: messages,
      loopContextInput,
      sessionId: "session-shadow",
    });

    expect(result.enabled).toBe(true);
    expect(result.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([LEGACY_CONTEXT_ENGINE_PROVIDER_ID, LOOP_CONTEXT_PACK_PROVIDER_ID]);
    expect(result.contextItems.length).toBeGreaterThan(0);
    expect(result.contextItems.every(isContextItem)).toBe(true);
    expect(result.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "legacy_context_engine:message:1",
        text: "Implement registry shadow only.",
      }),
      expect.objectContaining({
        id: "loop_context_pack:systemAppRules:systemAppRules:1",
        source: "system_app_rules",
      }),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          messagesIdentityPreserved: true,
          messageOrderPreserved: true,
        }),
      }),
      expect.objectContaining({
        providerId: LOOP_CONTEXT_PACK_PROVIDER_ID,
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          promptTextUnchanged: true,
          packHashUnchanged: true,
        }),
      }),
    ]));
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(messages.map((message) => message.content)).toEqual([
      "Implement registry shadow only.",
      "Legacy messages stay authoritative.",
    ]);
    expect(formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput))).toBe(
      baselinePrompt,
    );
  });

  it("feeds context provider diagnostics into the runtime-owned collector only when explicitly enabled", async () => {
    const result = await runTestContextProviderRegistry({
      config: enabledConfig,
      legacyMessages: [{ role: "user", content: "Collector stays shadow only." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      sessionId: "session-context-collector",
    });

    const disabled = collectRuntimeRegistryDiagnostics({
      contextDiagnostics: result.diagnostics,
    });
    expect(disabled.enabled).toBe(false);
    expect(disabled.diagnostics).toEqual([]);
    expect(disabled.omittedDiagnosticCount).toBe(result.diagnostics.length);

    const enabled = collectRuntimeRegistryDiagnostics({
      enabled: true,
      contextDiagnostics: result.diagnostics,
      metadata: {
        source: "context-provider-registry.test",
        shadowOnly: true,
      },
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.diagnostics).toEqual(result.diagnostics);
    expect(enabled.summary.contextDiagnosticCount).toBe(result.diagnostics.length);
    expect(enabled.summary.toolDiagnosticCount).toBe(0);
    expect(enabled.summary.byReason).toMatchObject({ legacy_authoritative: 2 });
  });

  it("keeps grounding shadow pilot absent and disabled behavior unchanged", async () => {
    const input = {
      config: enabledConfig,
      legacyMessages: [{ role: "user", content: "Grounding default-off." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      sessionId: "session-grounding-default-off",
    };
    const baseline = await runTestContextProviderRegistry(input);
    const disabled = await runTestContextProviderRegistry({
      ...input,
      groundingShadow: {
        enabled: false,
        refs: [buildGroundingRefFixture({ id: "grounding_disabled" })],
      },
    });

    expect(disabled).not.toHaveProperty("groundingShadowSummary");
    expect(disabled.enabled).toBe(baseline.enabled);
    expect(disabled.contextItems).toEqual(baseline.contextItems);
    expect(disabled.diagnostics).toEqual(baseline.diagnostics);
    expect(disabled.providerResults).toEqual(baseline.providerResults);
    expect(disabled.registry.listManifests().map((manifest) => manifest.id)).toEqual(
      baseline.registry.listManifests().map((manifest) => manifest.id),
    );
  });

  it("emits explicit grounding shadow diagnostics metadata without runtime cutover", async () => {
    const trusted = buildGroundingRefFixture({
      id: "grounding_shadow_trusted",
      canonicalKey: "symbol:grounding_shadow_trusted",
      kind: "symbol",
      ref: "src/runtime/pilot.ts#groundingShadowTrusted",
      label: "Trusted grounding shadow ref",
      summary: `Trusted grounding shadow summary ${"x".repeat(120)}`,
      metadata: {
        safe: "kept",
        sourceRefsAreRelevanceLinksOnly: true,
        noDurableFactPromotionFromGrounding: true,
      },
    });
    const untrusted = buildGroundingRefFixture({
      id: "grounding_shadow_untrusted",
      canonicalKey: "trace:grounding_shadow_untrusted",
      ref: "trace:grounding_shadow_untrusted",
      trust: "untrusted",
      metadata: {
        rawTrace: RAW_GROUNDING_SENTINEL,
      } as never,
    });

    const result = await runTestContextProviderRegistry({
      config: enabledConfig,
      sessionId: "session-grounding-shadow-pilot",
      groundingShadow: {
        enabled: true,
        refs: [untrusted, trusted],
        limit: 1,
        tokenBudget: 4,
        query: { readonly: true, includeRaw: true } as never,
        metadata: {
          safe: "kept",
          rawChat: RAW_GROUNDING_SENTINEL,
          secrets: { apiKey: RAW_GROUNDING_SENTINEL },
        } as never,
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([]);
    expect(result.registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(isGroundingShadowConsumerSummary(result.groundingShadowSummary)).toBe(true);
    expect(result.groundingShadowSummary).toMatchObject({
      consumerId: CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
      authority: "none",
      rawRetained: false,
      noRuntimeAuthority: true,
      noCompletionAuthority: true,
      noProviderOrderingAuthority: true,
      noMemoryPromotionAuthority: true,
      noPatchMutationAuthority: true,
    });
    expect(result.groundingShadowSummary?.query.includeRaw).toBe(false);
    expect(result.groundingShadowSummary?.query.includeUntrusted).toBe(false);
    expect(result.groundingShadowSummary?.items).toHaveLength(1);
    expect(result.groundingShadowSummary?.items[0]?.trust).not.toBe("untrusted");
    expect(result.groundingShadowSummary?.estimatedTokens)
      .toBeLessThanOrEqual(result.groundingShadowSummary?.tokenBudget ?? 0);

    const diagnostic = result.diagnostics.find((item) =>
      item.providerId === CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID
    );
    expect(diagnostic).toEqual(expect.objectContaining({
      status: "ok",
      reason: "registered",
      metadata: expect.objectContaining({
        runtimeGroundingShadowPilot: true,
        diagnosticsOnly: true,
        metadataOnly: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        authority: "none",
        rawRetained: false,
        noRuntimeAuthority: true,
        noProviderOrderingAuthority: true,
        noMemoryPromotionAuthority: true,
        noPatchMutationAuthority: true,
        itemCount: 1,
      }),
    }));
    expect(diagnostic?.metadata?.items).toEqual([
      expect.objectContaining({
        authority: "none",
        trust: "supplied",
        metadata: expect.objectContaining({
          noDurableFactPromotionFromGrounding: true,
          sourceRefsAreRelevanceLinksOnly: true,
        }),
      }),
    ]);
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(RAW_GROUNDING_SENTINEL);
    expect(JSON.stringify(result)).not.toContain("rawTrace");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("keeps provider ordering unchanged when runtime memory persistence is disabled", async () => {
    const result = await runTestContextProviderRegistry({
      config: {
        runtime: {
          ...enabledConfig.runtime,
          memory: { persist: false, provider: false },
        },
      },
      legacyMessages: [{ role: "user", content: "Provider order must stay stable." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      sessionId: "session-memory-persist-off",
    });

    expect(result.enabled).toBe(true);
    expect(result.registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(result.registry.resolve(RUNTIME_MEMORY_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(result.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([LEGACY_CONTEXT_ENGINE_PROVIDER_ID, LOOP_CONTEXT_PACK_PROVIDER_ID]);
  });

  it("runs explicit AgentMap and Symbol providers as shadow diagnostics after default providers", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const symbolOverview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols: [
        {
          name: "Dashboard",
          kind: "Function",
          detail: "Dashboard(): JSX.Element",
          range: range(0, 0, 10, 1),
          selectionRange: range(0, 16, 0, 25),
        },
      ],
    });

    const result = await runTestContextProviderRegistry({
      config: agentMapProviderEnabledConfig,
      legacyMessages: [{ role: "user", content: "Keep legacy prompt authoritative." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      extraProviders: [
        createAgentMapContextProvider(),
        createSymbolContextProvider(),
      ],
      extraProviderQueries: {
        [AGENT_MAP_CONTEXT_PROVIDER_ID]: {
          taskId: "session-extra-shadow",
          metadata: { agentMapResult: agentMapResult as never },
        },
        [SYMBOL_CONTEXT_PROVIDER_ID]: {
          taskId: "session-extra-shadow",
          metadata: { symbolOverviews: [symbolOverview] as never },
        },
      },
      sessionId: "session-extra-shadow",
    });

    expect(result.enabled).toBe(true);
    expect(result.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([
        LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
        LOOP_CONTEXT_PACK_PROVIDER_ID,
        AGENT_MAP_CONTEXT_PROVIDER_ID,
        SYMBOL_CONTEXT_PROVIDER_ID,
      ]);
    expect(result.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringContaining(`${AGENT_MAP_CONTEXT_PROVIDER_ID}:symbol:`),
        kind: "symbol",
        metadata: expect.objectContaining({
          readonlyAgentMap: true,
          noPromptAuthority: true,
        }),
      }),
      expect.objectContaining({
        id: `${SYMBOL_CONTEXT_PROVIDER_ID}:symbol:src/ui/Dashboard.tsx#Dashboard@1`,
        kind: "symbol",
        metadata: expect.objectContaining({
          readonlySymbolContext: true,
          noSymbolMutation: true,
        }),
      }),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        reason: "legacy_authoritative",
      }),
      expect.objectContaining({
        providerId: SYMBOL_CONTEXT_PROVIDER_ID,
        reason: "legacy_authoritative",
      }),
    ]));
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
  });

  it("keeps legacy providers successful when explicit AgentMap collection fails", async () => {
    const result = await runTestContextProviderRegistry({
      config: agentMapProviderEnabledConfig,
      legacyMessages: [{ role: "user", content: "Legacy remains authoritative." }] as never,
      loopContextInput: { systemAppRules: ["System rule"] },
      extraProviders: [
        createAgentMapContextProvider({
          getResult: () => {
            throw new Error("agent map collection boom");
          },
        }),
      ],
      extraProviderQueries: {
        [AGENT_MAP_CONTEXT_PROVIDER_ID]: { taskId: "session-agentmap-failure" },
      },
      sessionId: "session-agentmap-failure",
    });

    expect(result.enabled).toBe(true);
    expect(result.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([
        LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
        LOOP_CONTEXT_PACK_PROVIDER_ID,
        AGENT_MAP_CONTEXT_PROVIDER_ID,
      ]);
    expect(result.providerResults[0]).toEqual(expect.objectContaining({ status: "success" }));
    expect(result.providerResults[1]).toEqual(expect.objectContaining({ status: "success" }));
    expect(result.providerResults[2]).toEqual(expect.objectContaining({
      status: "error",
      contextItems: [],
      metadata: expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        providerFailureIsolated: true,
        legacyBehaviorUnaffected: true,
      }),
    }));
    expect(result.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "legacy_context_engine:message:1",
        text: "Legacy remains authoritative.",
      }),
      expect.objectContaining({
        id: "loop_context_pack:systemAppRules:systemAppRules:1",
      }),
    ]));
    expect(result.contextItems).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        }),
      }),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "error",
        reason: "provider_error",
        message: "agent map collection boom",
        metadata: expect.objectContaining({
          providerFailureIsolated: true,
          legacyBehaviorUnaffected: true,
        }),
      }),
    ]));
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
  });

  it("isolates explicit provider failures as diagnostics", async () => {
    const failingProvider: RuntimeContextProvider = {
      manifest: buildRuntimeContextProviderManifestFixture({
        id: "line-b-failing-context-provider",
        title: "Line B failing context provider",
        capabilities: ["context.line-b-failing"],
        priority: 90,
        order: 90,
        outputKinds: ["other"],
        evidenceRefs: [{ type: "other", ref: "line-b-failing-context-provider" }],
      }),
      getContext: () => {
        throw new Error("line-b provider boom");
      },
    };

    const result = await runTestContextProviderRegistry({
      config: enabledConfig,
      extraProviders: [failingProvider],
      extraProviderQueries: {
        "line-b-failing-context-provider": { taskId: "session-provider-failure" },
      },
      sessionId: "session-provider-failure",
    });

    expect(result.enabled).toBe(true);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([
      expect.objectContaining({
        status: "error",
        contextItems: [],
        metadata: expect.objectContaining({
          providerId: "line-b-failing-context-provider",
          providerFailureIsolated: true,
          legacyBehaviorUnaffected: true,
        }),
      }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        providerId: "line-b-failing-context-provider",
        status: "error",
        reason: "provider_error",
        message: "line-b provider boom",
        metadata: expect.objectContaining({
          providerFailureIsolated: true,
          legacyBehaviorUnaffected: true,
        }),
      }),
    ]);
  });

  it("wraps LegacyContextEngine and LoopContextPack as standalone compatibility providers", async () => {
    const legacyProvider = createLegacyContextEngineProvider();
    const loopProvider = createLoopContextPackProvider();

    const legacyResult = await legacyProvider.getContext({
      taskId: "session-provider",
      metadata: {
        messages: [{ role: "user", content: "Provider messages become ContextItems." }] as never,
      },
    });
    const loopResult = await loopProvider.getContext({
      taskId: "session-provider",
      metadata: {
        loopContextInput: {
          userInterventions: ["User changed scope."],
          taskLedgerState: ["Old plan."],
        } as never,
      },
    });

    expect(isRuntimeContextProviderResult(legacyResult)).toBe(true);
    expect(isRuntimeContextProviderResult(loopResult)).toBe(true);
    if (!Array.isArray(legacyResult) && !Array.isArray(loopResult)) {
      expect(legacyResult.contextItems[0]).toMatchObject({
        id: "legacy_context_engine:message:1",
        kind: "message",
      });
      expect(loopResult.contextItems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "instruction",
          text: "User changed scope.",
          metadata: expect.objectContaining({ sourceKind: "userInterventions" }),
        }),
      ]));
      expect(legacyResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
      expect(loopResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    }
  });
});
