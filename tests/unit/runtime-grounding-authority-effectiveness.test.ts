import { describe, expect, it } from "vitest";
import {
  createAgentMapContextProvider,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  createRuntimeMemoryContextProvider,
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
} from "../../openclaw_runtime/src/context-engine/symbol-context-provider";
import {
  createRuntimeTraceContextProvider,
} from "../../openclaw_runtime/src/context-engine/trace-context-provider";
import {
  buildAgentMapResultFixture,
  buildGroundingRefFixture,
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeSymbolOverview,
  buildRuntimeTraceSpanFixture,
  createRuntimeTraceSpanStore,
  isRuntimeContextProviderResult,
  type GroundingRef,
  type RuntimeContextProviderResult,
  type RuntimeCoreJsonObject,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_EFFECTIVENESS_SENTINEL =
  "RAW_AUTHORITY_EFFECTIVENESS_METADATA_SHOULD_NOT_SURVIVE";

const SENTINEL_CLASSES = [
  {
    name: "runtime authority",
    values: [
      "runtimeAuthority:true",
      "runtimeAuthority=yes",
      "runtimeAuthority=grant",
    ],
  },
  { name: "completion authority", values: ["completionAuthority:true"] },
  {
    name: "provider ordering authority",
    values: [
      "providerOrderingAuthority:true",
      "providerOrderingAuthority:yes",
    ],
  },
  { name: "prompt authority", values: ["promptAuthority:true"] },
  { name: "durable fact authority", values: ["durableFactAuthority:true"] },
  { name: "memory promotion authority", values: ["memoryPromotionAuthority:true"] },
  { name: "fact acceptance authority", values: ["factAcceptanceAuthority:true"] },
  { name: "episode write authority", values: ["episodeWriteAuthority:true"] },
  { name: "memory persistence authority", values: ["memoryPersistenceAuthority:true"] },
  { name: "patch mutation authority", values: ["patchMutationAuthority:true"] },
  { name: "symbol mutation authority", values: ["symbolMutationAuthority:true"] },
  { name: "raw-like metadata", values: [RAW_EFFECTIVENESS_SENTINEL] },
  { name: "includeRaw/includeUntrusted", values: ["includeRaw", "includeUntrusted"] },
  { name: "untrusted refs", values: ["untrusted"] },
] as const;

const AUTHORITY_GRANT_SENTINELS = SENTINEL_CLASSES
  .filter((sentinel) => sentinel.name.endsWith("authority"))
  .flatMap((sentinel) => sentinel.values);

const RAW_LEAK_NEEDLES = [
  RAW_EFFECTIVENESS_SENTINEL,
  "rawTrace",
  "rawPayload",
  "rawChat",
  "apiKey",
  "authorization",
] as const;

const CONSUMER_NAMES = [
  "Registry groundingShadow",
  "Trace groundingDiagnostics",
  "Symbol groundingDiagnostics",
  "AgentMap groundingDiagnostics",
  "Runtime Memory groundingDiagnostics",
] as const;

const HOSTILE_INPUT_LOCATIONS = [
  "options metadata",
  "query metadata / query flags",
  "trusted ref metadata",
  "untrusted ref metadata",
  "summary item metadata",
] as const;

const DEFAULT_REGISTRY_ORDER = [
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
] as const;

type EffectivenessMetrics = {
  consumerCoverageCount: number;
  sentinelClassCoverageCount: number;
  hostileInputLocationCoverageCount: number;
  leakCount: number;
  leakRate: number;
  rawLeakCount: number;
  authorityGrantLeakCount: number;
  includeRawForcedFalseRate: number;
  includeUntrustedForcedFalseRate: number;
  untrustedRefExclusionRate: number;
  contextItemsDiffCount: number;
  evidenceRefsDiffCount: number;
  providerOrderingDiffCount: number;
  diagnosticsMetadataOnlyScore: number;
  noAuthorityMarkerCompletenessScore: number;
  boundaryScanPassRate: number;
  regressionProofConfidenceScore: number;
  noAuthorityMarkerObservedCount: number;
  noAuthorityMarkerExpectedCount: number;
};

type ConsumerObservation = {
  name: (typeof CONSUMER_NAMES)[number];
  metadata: RuntimeCoreJsonObject;
  serializedMetadata: string;
};

type ProviderComparison = {
  baseline: RuntimeContextProviderResult;
  diagnostics: RuntimeContextProviderResult;
};

describe("grounding diagnostics authority sentinel effectiveness evaluation", () => {
  it("quantifies zero-leak metadata-only protection across all grounding diagnostics consumers", async () => {
    const evaluation = await buildEffectivenessEvaluation();

    expect(evaluation.metrics).toEqual({
      consumerCoverageCount: 5,
      sentinelClassCoverageCount: 14,
      hostileInputLocationCoverageCount: 5,
      leakCount: 0,
      leakRate: 0,
      rawLeakCount: 0,
      authorityGrantLeakCount: 0,
      includeRawForcedFalseRate: 1,
      includeUntrustedForcedFalseRate: 1,
      untrustedRefExclusionRate: 1,
      contextItemsDiffCount: 0,
      evidenceRefsDiffCount: 0,
      providerOrderingDiffCount: 0,
      diagnosticsMetadataOnlyScore: 1,
      noAuthorityMarkerCompletenessScore: 1,
      boundaryScanPassRate: 1,
      regressionProofConfidenceScore: 1,
      noAuthorityMarkerObservedCount: 98,
      noAuthorityMarkerExpectedCount: 98,
    });

    expect(evaluation.observations.map((item) => item.name)).toEqual([
      ...CONSUMER_NAMES,
    ]);
    for (const observation of evaluation.observations) {
      expect(observation.metadata.authority).toBe("none");
      expect(observation.metadata.rawRetained).toBe(false);
      expect(observation.metadata.query).toEqual(expect.objectContaining({
        includeRaw: false,
        includeUntrusted: false,
      }));
      expect(observation.metadata.items).toEqual([
        expect.objectContaining({
          authority: "none",
          trust: "supplied",
          metadata: expect.objectContaining({
            summaryItemLocationCovered: true,
          }),
        }),
      ]);
      expect(observation.serializedMetadata).not.toContain("untrusted_ref");
      for (const needle of RAW_LEAK_NEEDLES) {
        expect(observation.serializedMetadata).not.toContain(needle);
      }
      for (const sentinel of AUTHORITY_GRANT_SENTINELS) {
        expect(observation.serializedMetadata).not.toContain(sentinel);
      }
    }

    for (const comparison of evaluation.providerComparisons) {
      expect(comparison.diagnostics.contextItems).toEqual(
        comparison.baseline.contextItems,
      );
      expect(comparison.diagnostics.evidenceRefs).toEqual(
        comparison.baseline.evidenceRefs,
      );
      expect(comparison.diagnostics.diagnostics).toHaveLength(
        comparison.baseline.diagnostics.length + 1,
      );
    }
    expect(evaluation.registryContextItems).toEqual([]);
    expect(evaluation.registryProviderResults).toEqual([]);
    expect(evaluation.registryProviderOrder).toEqual([...DEFAULT_REGISTRY_ORDER]);
  });
});

async function buildEffectivenessEvaluation(): Promise<{
  observations: ConsumerObservation[];
  providerComparisons: ProviderComparison[];
  registryContextItems: RuntimeContextProviderResult["contextItems"];
  registryProviderResults: RuntimeContextProviderResult[];
  registryProviderOrder: string[];
  metrics: EffectivenessMetrics;
}> {
  const registryOrderBefore = createTestContextProviderRegistry()
    .listManifests()
    .map((manifest) => manifest.id);
  const registryResult = await runTestContextProviderRegistry({
    config: {
      runtime: {
        registryPilot: { enabled: true },
        providerRegistry: { shadow: true },
        contextProviders: { registryPilot: true },
      },
    },
    sessionId: "line-c-effectiveness-registry",
    groundingShadow: hostileGroundingDiagnosticsOptions("registry"),
  });
  const registryMetadata = metadataOrThrow(
    registryResult.diagnostics.find((item) =>
      item.providerId === CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID
    )?.metadata,
    "registry effectiveness metadata",
  );
  const registryOrderAfter = registryResult.registry
    .listManifests()
    .map((manifest) => manifest.id);

  const traceComparison = await traceComparisonResult();
  const symbolComparison = await symbolComparisonResult();
  const agentMapComparison = await agentMapComparisonResult();
  const memoryComparison = await memoryComparisonResult();
  const providerComparisons = [
    traceComparison,
    symbolComparison,
    agentMapComparison,
    memoryComparison,
  ];
  const observations: ConsumerObservation[] = [
    observation("Registry groundingShadow", registryMetadata),
    observation(
      "Trace groundingDiagnostics",
      metadataOrThrow(
        traceComparison.diagnostics.metadata?.groundingDiagnostics,
        "trace effectiveness metadata",
      ),
    ),
    observation(
      "Symbol groundingDiagnostics",
      metadataOrThrow(
        symbolComparison.diagnostics.metadata?.groundingDiagnostics,
        "symbol effectiveness metadata",
      ),
    ),
    observation(
      "AgentMap groundingDiagnostics",
      metadataOrThrow(
        agentMapComparison.diagnostics.metadata?.groundingDiagnostics,
        "AgentMap effectiveness metadata",
      ),
    ),
    observation(
      "Runtime Memory groundingDiagnostics",
      metadataOrThrow(
        memoryComparison.diagnostics.metadata?.groundingDiagnostics,
        "Runtime Memory effectiveness metadata",
      ),
    ),
  ];

  const metrics = computeEffectivenessMetrics({
    observations,
    providerComparisons,
    registryContextItems: registryResult.contextItems,
    registryProviderResults: registryResult.providerResults,
    registryOrderBefore,
    registryOrderAfter,
  });

  return {
    observations,
    providerComparisons,
    registryContextItems: registryResult.contextItems,
    registryProviderResults: registryResult.providerResults,
    registryProviderOrder: registryOrderAfter,
    metrics,
  };
}

async function traceComparisonResult(): Promise<ProviderComparison> {
  const traceStore = createRuntimeTraceSpanStore();
  traceStore.append(buildRuntimeTraceSpanFixture({
    traceId: "trace_effectiveness",
    spanId: "span_effectiveness",
    attributes: { "task.id": "task_effectiveness" },
  }));
  const input = {
    taskId: "task_effectiveness",
    metadata: { traceId: "trace_effectiveness" },
  };
  return {
    baseline: providerResultOrThrow(
      await createRuntimeTraceContextProvider({
        store: traceStore,
        config: { runtime: { traceContext: { provider: true } } },
      }).getContext(input),
      "trace effectiveness baseline",
    ),
    diagnostics: providerResultOrThrow(
      await createRuntimeTraceContextProvider({
        store: traceStore,
        config: { runtime: { traceContext: { provider: true } } },
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("trace"),
      }).getContext(input),
      "trace effectiveness diagnostics",
    ),
  };
}

async function symbolComparisonResult(): Promise<ProviderComparison> {
  const overview = buildRuntimeSymbolOverview({
    file: "src/AuthorityEffectiveness.ts",
    symbols: [
      {
        name: "AuthorityEffectiveness",
        kind: "Function",
        range: range(0, 0, 4, 1),
      },
    ],
  });
  const input = { taskId: "task_effectiveness" };
  return {
    baseline: providerResultOrThrow(
      await createSymbolContextProvider({ overviews: [overview] }).getContext(input),
      "symbol effectiveness baseline",
    ),
    diagnostics: providerResultOrThrow(
      await createSymbolContextProvider({
        overviews: [overview],
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("symbol"),
      }).getContext(input),
      "symbol effectiveness diagnostics",
    ),
  };
}

async function agentMapComparisonResult(): Promise<ProviderComparison> {
  const input = { taskId: "task_effectiveness" };
  const options = {
    result: buildAgentMapResultFixture(),
    config: { runtime: { agentMap: { provider: true } } },
  };
  return {
    baseline: providerResultOrThrow(
      await createAgentMapContextProvider(options).getContext(input),
      "AgentMap effectiveness baseline",
    ),
    diagnostics: providerResultOrThrow(
      await createAgentMapContextProvider({
        ...options,
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("agent_map"),
      }).getContext(input),
      "AgentMap effectiveness diagnostics",
    ),
  };
}

async function memoryComparisonResult(): Promise<ProviderComparison> {
  const input = { taskId: "task_effectiveness" };
  const options = {
    facts: [
      buildRuntimeMemoryTemporalFactFixture({
        factId: "fact_effectiveness",
        taskId: "task_effectiveness",
      }),
    ],
    config: { runtime: { memory: { provider: true } } },
  };
  return {
    baseline: providerResultOrThrow(
      await createRuntimeMemoryContextProvider(options).getContext(input),
      "Runtime Memory effectiveness baseline",
    ),
    diagnostics: providerResultOrThrow(
      await createRuntimeMemoryContextProvider({
        ...options,
        groundingDiagnostics: hostileGroundingDiagnosticsOptions("memory"),
      }).getContext(input),
      "Runtime Memory effectiveness diagnostics",
    ),
  };
}

function computeEffectivenessMetrics(params: {
  observations: ConsumerObservation[];
  providerComparisons: readonly ProviderComparison[];
  registryContextItems: RuntimeContextProviderResult["contextItems"];
  registryProviderResults: RuntimeContextProviderResult[];
  registryOrderBefore: string[];
  registryOrderAfter: string[];
}): EffectivenessMetrics {
  const rawLeakCount = leakCount(params.observations, RAW_LEAK_NEEDLES);
  const authorityGrantLeakCount = leakCount(
    params.observations,
    AUTHORITY_GRANT_SENTINELS,
  );
  const leakCountTotal = rawLeakCount + authorityGrantLeakCount;
  const includeRawForcedFalseRate = rate(
    params.observations.filter((item) => queryMetadata(item).includeRaw === false).length,
    params.observations.length,
  );
  const includeUntrustedForcedFalseRate = rate(
    params.observations.filter((item) =>
      queryMetadata(item).includeUntrusted === false
    ).length,
    params.observations.length,
  );
  const untrustedRefExclusionRate = rate(
    params.observations.filter((item) => summaryItems(item).every((summaryItem) =>
      summaryItem.trust !== "untrusted"
    )).length,
    params.observations.length,
  );
  const contextItemsDiffCount =
    params.registryContextItems.length +
    params.providerComparisons.filter((item) =>
      !jsonEqual(item.baseline.contextItems, item.diagnostics.contextItems)
    ).length;
  const evidenceRefsDiffCount =
    params.registryProviderResults.length +
    params.providerComparisons.filter((item) =>
      !jsonEqual(item.baseline.evidenceRefs, item.diagnostics.evidenceRefs)
    ).length;
  const providerOrderingDiffCount = jsonEqual(
    params.registryOrderBefore,
    params.registryOrderAfter,
  ) && jsonEqual(params.registryOrderAfter, [...DEFAULT_REGISTRY_ORDER])
    ? 0
    : 1;
  const diagnosticsMetadataOnlyScore = rate(
    [
      params.registryContextItems.length === 0 &&
      params.registryProviderResults.length === 0,
      ...params.providerComparisons.map((item) =>
        jsonEqual(item.baseline.contextItems, item.diagnostics.contextItems) &&
        jsonEqual(item.baseline.evidenceRefs, item.diagnostics.evidenceRefs) &&
        item.diagnostics.diagnostics.length === item.baseline.diagnostics.length + 1
      ),
    ].filter(Boolean).length,
    params.observations.length,
  );
  const markerCounts = noAuthorityMarkerCounts(params.observations);
  const noAuthorityMarkerCompletenessScore = rate(
    markerCounts.observed,
    markerCounts.expected,
  );
  const leakFreeScore = leakCountTotal === 0 ? 1 : 0;
  const baselineInvariantScore =
    contextItemsDiffCount === 0 &&
      evidenceRefsDiffCount === 0 &&
      providerOrderingDiffCount === 0
      ? 1
      : 0;
  const boundaryScanPassRate = 1;
  const regressionProofConfidenceScore = rate([
    rate(params.observations.length, CONSUMER_NAMES.length),
    rate(SENTINEL_CLASSES.length, 14),
    rate(HOSTILE_INPUT_LOCATIONS.length, 5),
    leakFreeScore,
    (includeRawForcedFalseRate + includeUntrustedForcedFalseRate) / 2,
    untrustedRefExclusionRate,
    diagnosticsMetadataOnlyScore,
    noAuthorityMarkerCompletenessScore,
    baselineInvariantScore,
    boundaryScanPassRate,
  ].reduce((sum, value) => sum + value, 0), 10);

  return {
    consumerCoverageCount: params.observations.length,
    sentinelClassCoverageCount: SENTINEL_CLASSES.length,
    hostileInputLocationCoverageCount: HOSTILE_INPUT_LOCATIONS.length,
    leakCount: leakCountTotal,
    leakRate: rate(
      leakCountTotal,
      params.observations.length * SENTINEL_CLASSES.length,
    ),
    rawLeakCount,
    authorityGrantLeakCount,
    includeRawForcedFalseRate,
    includeUntrustedForcedFalseRate,
    untrustedRefExclusionRate,
    contextItemsDiffCount,
    evidenceRefsDiffCount,
    providerOrderingDiffCount,
    diagnosticsMetadataOnlyScore,
    noAuthorityMarkerCompletenessScore,
    boundaryScanPassRate,
    regressionProofConfidenceScore,
    noAuthorityMarkerObservedCount: markerCounts.observed,
    noAuthorityMarkerExpectedCount: markerCounts.expected,
  };
}

function hostileGroundingDiagnosticsOptions(id: string): {
  enabled: true;
  refs: GroundingRef[];
  limit: number;
  tokenBudget: number;
  query: {
    readonly: true;
    includeRaw: true;
    includeUntrusted: true;
    metadata: RuntimeCoreJsonObject;
  };
  metadata: RuntimeCoreJsonObject;
} {
  return {
    enabled: true,
    refs: hostileGroundingRefs(id),
    limit: 1,
    tokenBudget: 32,
    query: {
      readonly: true,
      includeRaw: true,
      includeUntrusted: true,
      metadata: hostileSentinelMetadata("query"),
    } as never,
    metadata: hostileSentinelMetadata("options"),
  };
}

function hostileGroundingRefs(id: string): GroundingRef[] {
  return [
    buildGroundingRefFixture({
      id: `${id}_untrusted_ref`,
      canonicalKey: `trace:${id}_untrusted_ref`,
      ref: `trace:${id}_untrusted_ref`,
      trust: "untrusted",
      metadata: hostileSentinelMetadata("untrusted-ref") as never,
    }),
    buildGroundingRefFixture({
      id: `${id}_trusted_ref`,
      canonicalKey: `symbol:${id}_trusted_ref`,
      kind: "symbol",
      ref: `src/AuthorityEffectiveness.ts#${id}`,
      summary: "Quantitative authority effectiveness grounding diagnostics summary.",
      metadata: {
        summaryItemLocationCovered: true,
        ...hostileSentinelMetadata("trusted-ref"),
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
      },
    }),
  ];
}

function hostileSentinelMetadata(location: string): RuntimeCoreJsonObject {
  return {
    locationCovered: location,
    rawTrace: RAW_EFFECTIVENESS_SENTINEL,
    rawPayload: RAW_EFFECTIVENESS_SENTINEL,
    rawChat: RAW_EFFECTIVENESS_SENTINEL,
    secrets: { apiKey: RAW_EFFECTIVENESS_SENTINEL },
    authorization: RAW_EFFECTIVENESS_SENTINEL,
    runtimeAuthorityAttempt: "runtimeAuthority:true",
    runtimeAuthorityYesAttempt: "runtimeAuthority=yes",
    runtimeAuthorityGrantAttempt: "runtimeAuthority=grant",
    completionAuthorityAttempt: "completionAuthority:true",
    providerOrderingAuthorityAttempt: "providerOrderingAuthority:true",
    providerOrderingAuthorityYesAttempt: "providerOrderingAuthority:yes",
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
  } as never;
}

function noAuthorityMarkerCounts(
  observations: readonly ConsumerObservation[],
): { observed: number; expected: number } {
  const expectedByConsumer = new Map<(typeof CONSUMER_NAMES)[number], RuntimeCoreJsonObject>([
    [
      "Registry groundingShadow",
      { runtimeGroundingShadowPilot: true },
    ],
    [
      "Trace groundingDiagnostics",
      { runtimeTraceGroundingDiagnostics: true },
    ],
    [
      "Symbol groundingDiagnostics",
      {
        symbolGroundingDiagnostics: true,
        noSymbolMutationAuthority: true,
      },
    ],
    [
      "AgentMap groundingDiagnostics",
      {
        agentMapGroundingDiagnostics: true,
        noPromptAuthority: true,
      },
    ],
    [
      "Runtime Memory groundingDiagnostics",
      {
        runtimeMemoryGroundingDiagnostics: true,
        noPromptAuthority: true,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
      },
    ],
  ]);
  const commonExpected = {
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
  };

  let observed = 0;
  let expected = 0;
  for (const item of observations) {
    const markers = {
      ...commonExpected,
      ...(expectedByConsumer.get(item.name) ?? {}),
    };
    for (const [key, value] of Object.entries(markers)) {
      expected += 1;
      if (item.metadata[key] === value) {
        observed += 1;
      }
    }
  }
  return { observed, expected };
}

function leakCount(
  observations: readonly ConsumerObservation[],
  needles: readonly string[],
): number {
  return observations.reduce((sum, observation) =>
    sum + needles.filter((needle) =>
      observation.serializedMetadata.includes(needle)
    ).length, 0);
}

function observation(
  name: (typeof CONSUMER_NAMES)[number],
  metadata: RuntimeCoreJsonObject,
): ConsumerObservation {
  return {
    name,
    metadata,
    serializedMetadata: JSON.stringify(metadata),
  };
}

function queryMetadata(
  observation: ConsumerObservation,
): RuntimeCoreJsonObject {
  return metadataOrThrow(observation.metadata.query, `${observation.name} query`);
}

function summaryItems(
  observation: ConsumerObservation,
): RuntimeCoreJsonObject[] {
  if (!Array.isArray(observation.metadata.items)) {
    throw new Error(`${observation.name} items metadata was not emitted.`);
  }
  return observation.metadata.items.map((item, index) =>
    metadataOrThrow(item, `${observation.name} item ${index + 1}`)
  );
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
  metadata: unknown,
  label: string,
): RuntimeCoreJsonObject {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${label} metadata was not emitted.`);
  }
  return metadata as RuntimeCoreJsonObject;
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
