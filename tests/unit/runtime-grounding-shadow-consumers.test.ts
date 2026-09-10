import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_CONTEXT_PROVIDER_ID,
  createAgentMapContextProvider,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  createRuntimeMemoryContextProvider,
  RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  runTestContextProviderRegistry,
} from "./helpers/context-provider-registry";
import {
  createSymbolContextProvider,
  SYMBOL_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/symbol-context-provider";
import {
  createRuntimeTraceContextProvider,
  RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/trace-context-provider";
import {
  buildAgentMapResultFixture,
  buildGroundingRefFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeSymbolOverview,
  buildRuntimeTraceSpanFixture,
  createRuntimeTraceSpanStore,
  createAgentMapGroundingShadowSummary,
  createGroundingShadowConsumerSummary,
  createRuntimeMemoryGroundingShadowSummary,
  createRuntimeTraceGroundingShadowSummary,
  createSymbolGroundingShadowSummary,
  groundingRefsFromAgentMapResult,
  groundingRefsFromMemoryFact,
  groundingRefsFromRuntimeTraceSpan,
  groundingRefsFromSymbolNode,
  isGroundingShadowConsumerSummary,
  isRuntimeContextProviderResult,
  type GroundingRef,
  type GroundingShadowConsumerSummary,
  type RuntimeCoreJsonObject,
  type RuntimeContextProviderResult,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_SENTINEL = "RAW_SHADOW_CONSUMER_METADATA_SHOULD_NOT_SURVIVE";
const DRIFT_GUARD_RAW_SENTINEL =
  "RAW_DRIFT_GUARD_GROUNDING_METADATA_SHOULD_NOT_SURVIVE";
const AUTHORITY_GRANT_SENTINELS = [
  "runtimeAuthority:true",
  "runtimeAuthority=yes",
  "runtimeAuthority=grant",
  "completionAuthority:true",
  "providerOrderingAuthority:true",
  "providerOrderingAuthority:yes",
  "promptAuthority:true",
  "durableFactAuthority:true",
  "memoryPromotionAuthority:true",
  "factAcceptanceAuthority:true",
  "episodeWriteAuthority:true",
  "memoryPersistenceAuthority:true",
  "patchMutationAuthority:true",
  "symbolMutationAuthority:true",
] as const;

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

describe("grounding shadow consumer summaries", () => {
  it("keeps explicit disable diagnostic-only with disabled parity", () => {
    const summary = createGroundingShadowConsumerSummary([
      buildGroundingRefFixture({ id: "default_off_ref" }),
    ], {
      consumerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      enabled: false,
    });

    expect(isGroundingShadowConsumerSummary(summary)).toBe(true);
    expect(summary).toMatchObject({
      readonly: true,
      localOnly: true,
      shadowOnly: true,
      diagnosticOnly: true,
      summaryOnly: true,
      nonAuthoritative: true,
      authority: "none",
      rawRetained: false,
      noRuntimeAuthority: true,
      noCompletionAuthority: true,
      noProviderOrderingAuthority: true,
      noMemoryPromotionAuthority: true,
      noPatchMutationAuthority: true,
      items: [],
      metadata: expect.objectContaining({
        enabled: false,
        skipped: true,
        reason: "flag_disabled",
        acceptedRefCount: 0,
      }),
    });
    expect(summary).not.toHaveProperty("refs");
  });

  it("returns bounded summary-only output and excludes untrusted refs by default", () => {
    const trusted = buildGroundingRefFixture({
      id: "trusted_shadow_ref",
      canonicalKey: "trace:trusted_shadow_ref",
      ref: "trace:trusted_shadow_ref",
      summary: `Trusted summary ${"x".repeat(120)}`,
      metadata: { safe: "kept" },
    });
    const untrusted = buildGroundingRefFixture({
      id: "untrusted_shadow_ref",
      canonicalKey: "trace:untrusted_shadow_ref",
      ref: "trace:untrusted_shadow_ref",
      trust: "untrusted",
      metadata: {
        safe: "untrusted",
        rawChat: RAW_SENTINEL,
      } as never,
    });

    const summary = createGroundingShadowConsumerSummary([untrusted, trusted], {
      enabled: true,
      consumerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      limit: 1,
      tokenBudget: 4,
      query: { readonly: true, includeRaw: true } as never,
      metadata: {
        safe: "kept",
        rawTrace: RAW_SENTINEL,
        secrets: { apiKey: RAW_SENTINEL },
      } as never,
    });

    expect(isGroundingShadowConsumerSummary(summary)).toBe(true);
    expect(summary.query.includeRaw).toBe(false);
    expect(summary.query.includeUntrusted).toBe(false);
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]?.trust).not.toBe("untrusted");
    expect(summary.items[0]?.authority).toBe("none");
    expect(summary.items[0]?.summary.length).toBeLessThanOrEqual(16);
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expect(summary.metadata).toEqual(expect.objectContaining({
      enabled: true,
      untrustedInputRefCount: 1,
      untrustedExcluded: true,
      rawRetained: false,
      noRuntimeAuthority: true,
    }));
    expect(JSON.stringify(summary)).not.toContain(RAW_SENTINEL);
    expect(JSON.stringify(summary)).not.toContain("rawChat");
    expect(JSON.stringify(summary)).not.toContain("apiKey");
  });

  it("summarizes explicit Runtime Memory, AgentMap, Symbol, and Trace grounding refs", () => {
    const memorySummary = createRuntimeMemoryGroundingShadowSummary(
      groundingRefsFromMemoryFact(buildRuntimeMemoryTemporalFactFixture()),
      { enabled: true, limit: 3 },
    );
    const agentMapSummary = createAgentMapGroundingShadowSummary(
      groundingRefsFromAgentMapResult(buildAgentMapResultFixture()),
      { enabled: true, limit: 3 },
    );
    const symbolOverview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols: [
        {
          name: "Dashboard",
          kind: "Function",
          range: range(0, 0, 10, 1),
        },
      ],
    });
    const symbolSummary = createSymbolGroundingShadowSummary(
      groundingRefsFromSymbolNode(symbolOverview.symbols[0]),
      { enabled: true, limit: 3 },
    );
    const traceSummary = createRuntimeTraceGroundingShadowSummary(
      groundingRefsFromRuntimeTraceSpan(buildRuntimeTraceSpanFixture({
        traceId: "trace_shadow_consumer",
        spanId: "span_shadow_consumer",
        attributes: { "task.id": "task_shadow_consumer" },
      })),
      { enabled: true, limit: 3 },
    );
    const summaries = [
      memorySummary,
      agentMapSummary,
      symbolSummary,
      traceSummary,
    ];

    expect(summaries.map((summary) => summary.consumerId)).toEqual([
      RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      AGENT_MAP_CONTEXT_PROVIDER_ID,
      SYMBOL_CONTEXT_PROVIDER_ID,
      RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
    ]);
    expect(summaries.every(isGroundingShadowConsumerSummary)).toBe(true);
    expect(summaries.every((summary) => summary.items.length > 0)).toBe(true);
    for (const summary of summaries) {
      expectShadowSummaryBoundary(summary);
      expect(summary.items.every((item) => item.authority === "none")).toBe(true);
    }
  });

  it("does not register providers or change default context provider ordering", () => {
    const registry = createTestContextProviderRegistry();
    const before = registry.listManifests().map((manifest) => manifest.id);

    createRuntimeMemoryGroundingShadowSummary(
      groundingRefsFromMemoryFact(buildRuntimeMemoryTemporalFactFixture()),
      { enabled: true },
    );
    createAgentMapGroundingShadowSummary(
      groundingRefsFromAgentMapResult(buildAgentMapResultFixture()),
      { enabled: true },
    );
    createSymbolGroundingShadowSummary([
      buildGroundingRefFixture({
        kind: "symbol",
        id: "symbol_shadow",
        canonicalKey: "symbol:shadow",
        ref: "symbol:shadow",
      }),
    ], { enabled: true });

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(before);
    expect(before).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(registry.resolve(RUNTIME_MEMORY_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(registry.resolve(AGENT_MAP_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(registry.resolve(SYMBOL_CONTEXT_PROVIDER_ID)).toBeUndefined();
    expect(registry.resolve(RUNTIME_TRACE_CONTEXT_PROVIDER_ID)).toBeUndefined();
  });

  it("keeps memory promotion and source anchor boundaries visible in summaries", () => {
    const memorySummary = createRuntimeMemoryGroundingShadowSummary(
      groundingRefsFromMemoryFact(buildRuntimeMemoryTemporalFactCandidateFixture()),
      { enabled: true, limit: 4 },
    );
    const symbolOverview = buildRuntimeSymbolOverview({
      file: "src/Panel.tsx",
      symbols: [
        {
          name: "Panel",
          kind: "Function",
          range: range(1, 0, 3, 1),
        },
      ],
    });
    const symbolSummary = createSymbolGroundingShadowSummary(
      groundingRefsFromSymbolNode(symbolOverview.symbols[0]),
      { enabled: true, limit: 4 },
    );

    expectShadowSummaryBoundary(memorySummary);
    expect(memorySummary.metadata).toMatchObject({
      noMemoryPromotionAuthority: true,
    });
    expect(JSON.stringify(memorySummary)).toContain(
      "noDurableFactPromotionFromGrounding",
    );
    expectShadowSummaryBoundary(symbolSummary);
    expect(symbolSummary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceRefsAreRelevanceLinksOnly: true,
          noProviderOrderingAuthority: true,
        }),
      }),
    ]));
  });

  it("keeps diagnostics metadata invariants aligned across Registry, Trace, Symbol, AgentMap, and Runtime Memory", async () => {
    const registryMetadata = await registryGroundingMetadata();
    const traceResult = await traceGroundingResult();
    const symbolResult = await symbolGroundingResult();
    const agentMapResult = await agentMapGroundingResult();
    const memoryResult = await memoryGroundingResult();
    const providerMetadatas = [
      traceResult.metadata?.groundingDiagnostics as never,
      symbolResult.metadata?.groundingDiagnostics as never,
      agentMapResult.metadata?.groundingDiagnostics as never,
      memoryResult.metadata?.groundingDiagnostics as never,
    ] as RuntimeCoreJsonObject[];
    const allMetadatas = [registryMetadata, ...providerMetadatas];

    for (const metadata of allMetadatas) {
      expect(metadata).toEqual(expect.objectContaining({
        diagnosticsOnly: true,
        metadataOnly: true,
        readonly: true,
        localOnly: true,
        shadowOnly: true,
        summaryOnly: true,
        diagnosticOnly: true,
        nonAuthoritative: true,
        authority: "none",
        rawRetained: false,
        noRuntimeAuthority: true,
        noCompletionAuthority: true,
        noProviderOrderingAuthority: true,
        noMemoryPromotionAuthority: true,
        noPatchMutationAuthority: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        itemCount: 1,
      }));
      expect(metadata.query).toEqual(expect.objectContaining({
        readonly: true,
        includeRaw: false,
        includeUntrusted: false,
      }));
      expect(metadata.items).toEqual([
        expect.objectContaining({
          authority: "none",
          trust: "supplied",
        }),
      ]);
    }

    expect(registryMetadata).toEqual(expect.objectContaining({
      runtimeGroundingShadowPilot: true,
      consumerId: CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
    }));
    expect(providerMetadatas).toEqual([
      expect.objectContaining({
        runtimeTraceGroundingDiagnostics: true,
        consumerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
      }),
      expect.objectContaining({
        symbolGroundingDiagnostics: true,
        consumerId: SYMBOL_CONTEXT_PROVIDER_ID,
        noSymbolMutationAuthority: true,
      }),
      expect.objectContaining({
        agentMapGroundingDiagnostics: true,
        consumerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        noPromptAuthority: true,
      }),
      expect.objectContaining({
        runtimeMemoryGroundingDiagnostics: true,
        consumerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
      }),
    ]);
    expect(traceResult.contextItems).toHaveLength(1);
    expect(symbolResult.contextItems).toHaveLength(1);
    expect(agentMapResult.contextItems.length).toBeGreaterThan(0);
    expect(memoryResult.contextItems).toHaveLength(1);
  });

  it("keeps hostile grounding diagnostics metadata non-authoritative across all consumers", async () => {
    const registry = createTestContextProviderRegistry();
    const registryOrder = registry.listManifests().map((manifest) => manifest.id);
    const registryResult = await runTestContextProviderRegistry({
      config: {
        runtime: {
          registryPilot: { enabled: true },
          providerRegistry: { shadow: true },
          contextProviders: { registryPilot: true },
        },
      },
      sessionId: "line-c-drift-guard-registry",
      groundingShadow: hostileGroundingDiagnosticsOptions("registry_drift_guard") as never,
    });
    const registryMetadata = metadataOrThrow(
      registryResult.diagnostics.find((item) =>
        item.providerId === CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID
      )?.metadata,
      "registry drift guard metadata",
    );

    const traceStore = createRuntimeTraceSpanStore();
    traceStore.append(buildRuntimeTraceSpanFixture({
      traceId: "trace_drift_guard",
      spanId: "span_drift_guard",
      attributes: { "task.id": "task_drift_guard" },
    }));
    const traceInput = {
      taskId: "task_drift_guard",
      metadata: { traceId: "trace_drift_guard" },
    };
    const traceBaseline = providerResultOrThrow(
      await createRuntimeTraceContextProvider({
        store: traceStore,
        config: { runtime: { traceContext: { provider: true } } },
      }).getContext(traceInput),
      "trace drift guard baseline",
    );
    const traceResult = providerResultOrThrow(
      await createRuntimeTraceContextProvider({
        store: traceStore,
        config: { runtime: { traceContext: { provider: true } } },
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("trace_drift_guard") as never,
      }).getContext(traceInput),
      "trace drift guard diagnostics",
    );

    const symbolOverview = buildRuntimeSymbolOverview({
      file: "src/DriftGuard.ts",
      symbols: [
        {
          name: "DriftGuard",
          kind: "Function",
          range: range(0, 0, 4, 1),
        },
      ],
    });
    const symbolInput = { taskId: "task_drift_guard" };
    const symbolBaseline = providerResultOrThrow(
      await createSymbolContextProvider({ overviews: [symbolOverview] })
        .getContext(symbolInput),
      "symbol drift guard baseline",
    );
    const symbolResult = providerResultOrThrow(
      await createSymbolContextProvider({
        overviews: [symbolOverview],
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("symbol_drift_guard") as never,
      }).getContext(symbolInput),
      "symbol drift guard diagnostics",
    );

    const agentMapInput = { taskId: "task_drift_guard" };
    const agentMapProviderOptions = {
      result: buildAgentMapResultFixture(),
      config: { runtime: { agentMap: { provider: true } } },
    };
    const agentMapBaseline = providerResultOrThrow(
      await createAgentMapContextProvider(agentMapProviderOptions)
        .getContext(agentMapInput),
      "AgentMap drift guard baseline",
    );
    const agentMapResult = providerResultOrThrow(
      await createAgentMapContextProvider({
        ...agentMapProviderOptions,
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("agent_map_drift_guard") as never,
      }).getContext(agentMapInput),
      "AgentMap drift guard diagnostics",
    );

    const memoryInput = { taskId: "task_drift_guard" };
    const memoryProviderOptions = {
      facts: [
        buildRuntimeMemoryTemporalFactFixture({
          factId: "fact_drift_guard",
          taskId: "task_drift_guard",
        }),
      ],
      config: { runtime: { memory: { provider: true } } },
    };
    const memoryBaseline = providerResultOrThrow(
      await createRuntimeMemoryContextProvider(memoryProviderOptions)
        .getContext(memoryInput),
      "Runtime Memory drift guard baseline",
    );
    const memoryResult = providerResultOrThrow(
      await createRuntimeMemoryContextProvider({
        ...memoryProviderOptions,
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("memory_drift_guard") as never,
      }).getContext(memoryInput),
      "Runtime Memory drift guard diagnostics",
    );

    const providerPairs = [
      [traceBaseline, traceResult],
      [symbolBaseline, symbolResult],
      [agentMapBaseline, agentMapResult],
      [memoryBaseline, memoryResult],
    ] as const;
    for (const [baseline, result] of providerPairs) {
      expect(result.contextItems).toEqual(baseline.contextItems);
      expect(result.evidenceRefs).toEqual(baseline.evidenceRefs);
      expect(result.diagnostics).toHaveLength(baseline.diagnostics.length + 1);
    }
    expect(registryResult.contextItems).toEqual([]);
    expect(registryResult.providerResults).toEqual([]);
    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(registryOrder);
    expect(registryOrder).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);

    const metadatas = [
      registryMetadata,
      metadataOrThrow(
        traceResult.metadata?.groundingDiagnostics as never,
        "trace drift guard metadata",
      ),
      metadataOrThrow(
        symbolResult.metadata?.groundingDiagnostics as never,
        "symbol drift guard metadata",
      ),
      metadataOrThrow(
        agentMapResult.metadata?.groundingDiagnostics as never,
        "AgentMap drift guard metadata",
      ),
      metadataOrThrow(
        memoryResult.metadata?.groundingDiagnostics as never,
        "Runtime Memory drift guard metadata",
      ),
    ];

    for (const metadata of metadatas) {
      expect(metadata).toEqual(expect.objectContaining({
        diagnosticsOnly: true,
        metadataOnly: true,
        readonly: true,
        localOnly: true,
        shadowOnly: true,
        summaryOnly: true,
        diagnosticOnly: true,
        nonAuthoritative: true,
        authority: "none",
        rawRetained: false,
        noRuntimeAuthority: true,
        noCompletionAuthority: true,
        noProviderOrderingAuthority: true,
        noMemoryPromotionAuthority: true,
        noPatchMutationAuthority: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        itemCount: 1,
      }));
      expect(metadata.query).toEqual(expect.objectContaining({
        readonly: true,
        includeRaw: false,
        includeUntrusted: false,
      }));
      expect(metadata.items).toEqual([
        expect.objectContaining({
          authority: "none",
          trust: "supplied",
          metadata: expect.objectContaining({
            sourceRefsAreEvidenceLinksOnly: true,
            sourceRefsAreRelevanceLinksOnly: true,
            noDurableFactAuthority: true,
            noMemoryFactPromotionAuthority: true,
            noFactAcceptanceAuthority: true,
            noEpisodeWriteAuthority: true,
            noMemoryPersistenceAuthority: true,
            noPatchMutationAuthority: true,
          }),
        }),
      ]);
      expect(JSON.stringify(metadata)).not.toContain(DRIFT_GUARD_RAW_SENTINEL);
      expect(JSON.stringify(metadata)).not.toContain("rawTrace");
      expect(JSON.stringify(metadata)).not.toContain("apiKey");
      for (const sentinel of AUTHORITY_GRANT_SENTINELS) {
        expect(JSON.stringify(metadata)).not.toContain(sentinel);
      }
    }

    expect(metadatas[0]).toEqual(expect.objectContaining({
      runtimeGroundingShadowPilot: true,
    }));
    expect(metadatas[1]).toEqual(expect.objectContaining({
      runtimeTraceGroundingDiagnostics: true,
    }));
    expect(metadatas[2]).toEqual(expect.objectContaining({
      symbolGroundingDiagnostics: true,
      noSymbolMutationAuthority: true,
    }));
    expect(metadatas[3]).toEqual(expect.objectContaining({
      agentMapGroundingDiagnostics: true,
      noPromptAuthority: true,
      noProviderOrderingAuthority: true,
    }));
    expect(metadatas[4]).toEqual(expect.objectContaining({
      runtimeMemoryGroundingDiagnostics: true,
      noPromptAuthority: true,
      noProviderOrderingAuthority: true,
      noDurableFactAuthority: true,
      noMemoryFactPromotionAuthority: true,
      noFactAcceptanceAuthority: true,
      noEpisodeWriteAuthority: true,
      noMemoryPersistenceAuthority: true,
    }));
  });
});

function expectShadowSummaryBoundary(
  summary: GroundingShadowConsumerSummary,
): void {
  expect(summary).toMatchObject({
    readonly: true,
    localOnly: true,
    shadowOnly: true,
    diagnosticOnly: true,
    summaryOnly: true,
    nonAuthoritative: true,
    authority: "none",
    rawRetained: false,
    noRuntimeAuthority: true,
    noCompletionAuthority: true,
    noProviderOrderingAuthority: true,
    noMemoryPromotionAuthority: true,
    noPatchMutationAuthority: true,
    metadata: expect.objectContaining({
      shadowOnly: true,
      diagnosticOnly: true,
      summaryOnly: true,
      noRuntimeAuthority: true,
      noProviderOrderingAuthority: true,
      noMemoryPromotionAuthority: true,
    }),
  });
}

async function registryGroundingMetadata(): Promise<RuntimeCoreJsonObject> {
  const result = await runTestContextProviderRegistry({
    config: {
      runtime: {
        registryPilot: { enabled: true },
        providerRegistry: { shadow: true },
        contextProviders: { registryPilot: true },
      },
    },
    sessionId: "line-c-cross-consumer-registry",
    groundingShadow: groundingDiagnosticsOptions("registry_cross_consumer"),
  });
  const diagnostic = result.diagnostics.find((item) =>
    item.providerId === CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID
  );
  return metadataOrThrow(diagnostic?.metadata, "registry grounding shadow");
}

async function traceGroundingResult(): Promise<RuntimeContextProviderResult> {
  const store = createRuntimeTraceSpanStore();
  store.append(buildRuntimeTraceSpanFixture({
    traceId: "trace_cross_consumer",
    spanId: "span_cross_consumer",
    attributes: { "task.id": "task_cross_consumer" },
  }));
  const result = await createRuntimeTraceContextProvider({
    store,
    config: { runtime: { traceContext: { provider: true } } },
    groundingDiagnostics: groundingDiagnosticsOptions("trace_cross_consumer"),
  }).getContext({
    taskId: "task_cross_consumer",
    metadata: { traceId: "trace_cross_consumer" },
  });
  return providerResultOrThrow(result, "trace grounding diagnostics");
}

async function symbolGroundingResult(): Promise<RuntimeContextProviderResult> {
  const overview = buildRuntimeSymbolOverview({
    file: "src/CrossConsumer.ts",
    symbols: [
      {
        name: "CrossConsumer",
        kind: "Function",
        range: range(0, 0, 4, 1),
      },
    ],
  });
  const result = await createSymbolContextProvider({
    overviews: [overview],
    groundingDiagnostics: groundingDiagnosticsOptions("symbol_cross_consumer"),
  }).getContext({ taskId: "task_cross_consumer" });
  return providerResultOrThrow(result, "symbol grounding diagnostics");
}

async function agentMapGroundingResult(): Promise<RuntimeContextProviderResult> {
  const result = await createAgentMapContextProvider({
    result: buildAgentMapResultFixture(),
    config: { runtime: { agentMap: { provider: true } } },
    groundingDiagnostics: groundingDiagnosticsOptions("agent_map_cross_consumer"),
  }).getContext({ taskId: "task_cross_consumer" });
  return providerResultOrThrow(result, "AgentMap grounding diagnostics");
}

async function memoryGroundingResult(): Promise<RuntimeContextProviderResult> {
  const result = await createRuntimeMemoryContextProvider({
    facts: [
      buildRuntimeMemoryTemporalFactFixture({
        factId: "fact_cross_consumer",
        taskId: "task_cross_consumer",
      }),
    ],
    config: { runtime: { memory: { provider: true } } },
    groundingDiagnostics: groundingDiagnosticsOptions("memory_cross_consumer"),
  }).getContext({ taskId: "task_cross_consumer" });
  return providerResultOrThrow(result, "Runtime Memory grounding diagnostics");
}

function groundingDiagnosticsOptions(id: string): {
  enabled: true;
  refs: ReturnType<typeof buildGroundingRefFixture>[];
  limit: number;
  tokenBudget: number;
} {
  return {
    enabled: true,
    refs: [
      buildGroundingRefFixture({
        id,
        canonicalKey: `symbol:${id}`,
        kind: "symbol",
        ref: `src/CrossConsumer.ts#${id}`,
        summary: "Cross-consumer grounding diagnostics summary.",
        metadata: {
          safe: "kept",
          noDurableFactPromotionFromGrounding: true,
          sourceRefsAreRelevanceLinksOnly: true,
        },
      }),
    ],
    limit: 1,
    tokenBudget: 32,
  };
}

function hostileGroundingDiagnosticsOptions(id: string): {
  enabled: true;
  refs: GroundingRef[];
  limit: number;
  tokenBudget: number;
  query: ReturnType<typeof hostileGroundingQuery>;
  metadata: RuntimeCoreJsonObject;
} {
  return {
    enabled: true,
    refs: hostileGroundingRefs(id),
    limit: 1,
    tokenBudget: 32,
    query: hostileGroundingQuery(),
    metadata: {
      safe: "kept",
      rawTrace: DRIFT_GUARD_RAW_SENTINEL,
      secrets: { apiKey: DRIFT_GUARD_RAW_SENTINEL },
      runtimeAuthorityAttempt: "runtimeAuthority:true",
      runtimeAuthorityYesAttempt: "runtimeAuthority=yes",
      runtimeAuthorityGrantAttempt: "runtimeAuthority=grant",
      completionAuthorityAttempt: "completionAuthority:true",
      providerSpecificAuthoritySentinel: "providerOrderingAuthority:yes",
      providerOrderingAuthorityAttempt: "providerOrderingAuthority:true",
      promptAuthorityAttempt: "promptAuthority:true",
      durableFactAuthorityAttempt: "durableFactAuthority:true",
      memoryPromotionAuthorityAttempt: "memoryPromotionAuthority:true",
      factAcceptanceAuthorityAttempt: "factAcceptanceAuthority:true",
      episodeWriteAuthorityAttempt: "episodeWriteAuthority:true",
      memoryPersistenceAuthorityAttempt: "memoryPersistenceAuthority:true",
      patchMutationAuthorityAttempt: "patchMutationAuthority:true",
      symbolMutationAuthorityAttempt: "symbolMutationAuthority:true",
      noRuntimeAuthority: true,
      noCompletionAuthority: true,
      noProviderOrderingAuthority: true,
      noMemoryPromotionAuthority: true,
      noPatchMutationAuthority: true,
    } as never,
  };
}

function hostileGroundingQuery(): {
  readonly: true;
  includeRaw: true;
  includeUntrusted: true;
} {
  return {
    readonly: true,
    includeRaw: true,
    includeUntrusted: true,
  };
}

function hostileGroundingRefs(id: string): GroundingRef[] {
  return [
    buildGroundingRefFixture({
      id: `${id}_untrusted`,
      canonicalKey: `trace:${id}_untrusted`,
      ref: `trace:${id}_untrusted`,
      trust: "untrusted",
      metadata: {
        rawTrace: DRIFT_GUARD_RAW_SENTINEL,
        secrets: { apiKey: DRIFT_GUARD_RAW_SENTINEL },
      } as never,
    }),
    buildGroundingRefFixture({
      id: `${id}_trusted`,
      canonicalKey: `symbol:${id}_trusted`,
      kind: "symbol",
      ref: `src/DriftGuard.ts#${id}`,
      summary: "Cross-consumer drift guard grounding diagnostics summary.",
      metadata: {
        safe: "kept",
        sourceRefsAreEvidenceLinksOnly: true,
        sourceRefsAreRelevanceLinksOnly: true,
        memoryRefsAreAnchorsOnly: true,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noPatchMutationAuthority: true,
        noSymbolMutationAuthority: true,
        providerSpecificNoAuthorityMarker: true,
        runtimeAuthorityAttempt: "runtimeAuthority:true",
        runtimeAuthorityYesAttempt: "runtimeAuthority=yes",
        runtimeAuthorityGrantAttempt: "runtimeAuthority=grant",
        completionAuthorityAttempt: "completionAuthority:true",
        providerOrderingAuthorityAttempt: "providerOrderingAuthority:true",
        promptAuthorityAttempt: "promptAuthority:true",
        durableFactAuthorityAttempt: "durableFactAuthority:true",
        memoryPromotionAuthorityAttempt: "memoryPromotionAuthority:true",
        factAcceptanceAuthorityAttempt: "factAcceptanceAuthority:true",
        episodeWriteAuthorityAttempt: "episodeWriteAuthority:true",
        memoryPersistenceAuthorityAttempt: "memoryPersistenceAuthority:true",
        patchMutationAuthorityAttempt: "patchMutationAuthority:true",
        symbolMutationAuthorityAttempt: "symbolMutationAuthority:true",
      },
    }),
  ];
}

function providerResultOrThrow(
  result: RuntimeContextProviderResult | RuntimeContextProviderResult["contextItems"],
  label: string,
): RuntimeContextProviderResult {
  if (Array.isArray(result) || !isRuntimeContextProviderResult(result)) {
    throw new Error(`${label} did not return a RuntimeContextProviderResult.`);
  }
  return result;
}

function metadataOrThrow(
  metadata: RuntimeContextProviderResult["metadata"],
  label: string,
): RuntimeCoreJsonObject {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${label} metadata was not emitted.`);
  }
  return metadata;
}
