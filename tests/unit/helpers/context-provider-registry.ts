import type { LoopContextPackInput } from "../../../openclaw_runtime/src/agents/loop-context-pack";
import type { AgentMessage } from "../../../openclaw_runtime/src/agents/runtime";
import {
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  createLegacyContextEngineProvider,
  createLoopContextPackProvider,
} from "../../../openclaw_runtime/src/context-engine/provider-registry";
import {
  RuntimeContextProviderRegistry,
  createGroundingShadowConsumerSummary,
  isRuntimeContextProviderResult,
  isolateRuntimeRegistryError,
  resolveRuntimeRegistryFeatureFlags,
  type ContextItem,
  type GroundingQuery,
  type GroundingRef,
  type GroundingShadowConsumerSummary,
  type RuntimeContextProvider,
  type RuntimeContextProviderExtras,
  type RuntimeContextProviderQuery,
  type RuntimeContextProviderResult,
  type RuntimeCoreJsonObject,
  type RuntimeRegistryDiagnostic,
} from "../../../openclaw_runtime/src/runtime-core";

export {
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  createLegacyContextEngineProvider,
  createLoopContextPackProvider,
};

export const CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID =
  "context-provider-registry-grounding-shadow";

export type TestContextProviderRegistryGroundingShadowOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type TestContextProviderRegistryParams = {
  config?: unknown;
  sessionId?: string;
  tokenBudget?: number;
  legacyMessages?: AgentMessage[];
  loopContextInput?: LoopContextPackInput;
  extraProviders?: RuntimeContextProvider[];
  extraProviderQueries?: Record<string, RuntimeContextProviderQuery>;
  extraProviderExtras?: Record<string, RuntimeContextProviderExtras>;
  groundingShadow?: TestContextProviderRegistryGroundingShadowOptions;
};

export type TestContextProviderRegistryResult = {
  enabled: boolean;
  registry: RuntimeContextProviderRegistry;
  contextItems: NonNullable<RuntimeContextProviderResult["contextItems"]>;
  diagnostics: RuntimeRegistryDiagnostic[];
  providerResults: RuntimeContextProviderResult[];
  groundingShadowSummary?: GroundingShadowConsumerSummary;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function diagnostic(params: {
  providerId?: string;
  status: RuntimeRegistryDiagnostic["status"];
  reason: RuntimeRegistryDiagnostic["reason"];
  message: string;
  metadata?: RuntimeCoreJsonObject;
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: params.providerId,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: params.providerId
      ? [{ type: "other", ref: params.providerId, label: "Context provider registry test" }]
      : [],
    metadata: params.metadata,
  };
}

function groundingShadowSummary(
  options?: TestContextProviderRegistryGroundingShadowOptions,
): GroundingShadowConsumerSummary | undefined {
  if (options?.enabled !== true) {
    return undefined;
  }
  return createGroundingShadowConsumerSummary(options.refs ?? [], {
    enabled: true,
    consumerId: CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
    query: options.query,
    limit: options.limit,
    tokenBudget: options.tokenBudget,
    metadata: {
      ...(options.metadata ?? {}),
      runtimeGroundingShadowPilot: true,
      diagnosticsOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
    },
  });
}

function groundingShadowQueryMetadata(query: GroundingQuery): RuntimeCoreJsonObject {
  return {
    readonly: true,
    ...(query.kind !== undefined ? { kind: query.kind as never } : {}),
    ...(query.trust !== undefined ? { trust: query.trust as never } : {}),
    ...(query.taskId !== undefined ? { taskId: query.taskId } : {}),
    ...(query.traceId !== undefined ? { traceId: query.traceId } : {}),
    ...(query.spanId !== undefined ? { spanId: query.spanId } : {}),
    ...(query.eventId !== undefined ? { eventId: query.eventId } : {}),
    ...(query.checkpointId !== undefined ? { checkpointId: query.checkpointId } : {}),
    ...(query.toolCallId !== undefined ? { toolCallId: query.toolCallId } : {}),
    ...(query.file !== undefined ? { file: query.file } : {}),
    ...(query.symbol !== undefined ? { symbol: query.symbol } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.tokenBudget !== undefined ? { tokenBudget: query.tokenBudget } : {}),
    includeRaw: false,
    includeUntrusted: false,
  } as never;
}

function groundingShadowDiagnostic(
  summary: GroundingShadowConsumerSummary,
): RuntimeRegistryDiagnostic {
  return diagnostic({
    providerId: CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
    status: summary.items.length > 0 ? "ok" : "skipped",
    reason: summary.items.length > 0 ? "registered" : "no_result",
    message: "Grounding runtime shadow test emitted diagnostics-only summary metadata.",
    metadata: {
      runtimeGroundingShadowPilot: true,
      diagnosticsOnly: true,
      metadataOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
      consumerId: summary.consumerId,
      itemCount: summary.items.length,
      omittedRefCount: summary.omittedRefCount,
      tokenBudget: summary.tokenBudget,
      estimatedTokens: summary.estimatedTokens,
      authority: summary.authority,
      rawRetained: summary.rawRetained,
      readonly: summary.readonly,
      localOnly: summary.localOnly,
      shadowOnly: summary.shadowOnly,
      summaryOnly: summary.summaryOnly,
      diagnosticOnly: summary.diagnosticOnly,
      nonAuthoritative: summary.nonAuthoritative,
      noRuntimeAuthority: summary.noRuntimeAuthority,
      noCompletionAuthority: summary.noCompletionAuthority,
      noProviderOrderingAuthority: summary.noProviderOrderingAuthority,
      noMemoryPromotionAuthority: summary.noMemoryPromotionAuthority,
      noPatchMutationAuthority: summary.noPatchMutationAuthority,
      query: groundingShadowQueryMetadata(summary.query),
      items: summary.items.map((item) => ({
        id: item.id,
        canonicalKey: item.canonicalKey,
        kind: item.kind,
        ref: item.ref,
        ...(item.label ? { label: item.label } : {}),
        summary: item.summary,
        trust: item.trust,
        authority: item.authority,
        sourceSurface: item.sourceSurface,
        sourceField: item.sourceField,
        rank: item.rank,
        ...(item.timestamp !== undefined ? { timestamp: item.timestamp } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
      })),
      ...(summary.metadata ? { summaryMetadata: summary.metadata } : {}),
    },
  });
}

function collectEvidenceRefs(
  result: RuntimeContextProviderResult,
): RuntimeContextProviderResult["evidenceRefs"] {
  return [...result.evidenceRefs, ...result.contextItems.flatMap((item) => item.evidenceRefs)];
}

function contextItemResult(
  provider: RuntimeContextProvider,
  contextItems: ContextItem[],
): RuntimeContextProviderResult {
  const result: RuntimeContextProviderResult = {
    status: "success",
    contextItems,
    diagnostics: [
      diagnostic({
        providerId: provider.manifest.id,
        status: "fallback",
        reason: "legacy_authoritative",
        message: "Context provider returned ContextItem[] for shadow diagnostics only.",
        metadata: {
          legacyAuthoritative: true,
          shadowOnly: provider.manifest.shadowOnly,
          contextItemCount: contextItems.length,
        },
      }),
    ],
    evidenceRefs: provider.manifest.evidenceRefs,
    metadata: {
      providerId: provider.manifest.id,
      legacyAuthoritative: true,
      shadowOnly: provider.manifest.shadowOnly,
    },
  };
  return { ...result, evidenceRefs: collectEvidenceRefs(result) };
}

function invalidResult(provider: RuntimeContextProvider): RuntimeContextProviderResult {
  const errorDiagnostic = diagnostic({
    providerId: provider.manifest.id,
    status: "error",
    reason: "provider_error",
    message: "Context provider returned an invalid RuntimeContextProviderResult shape.",
    metadata: {
      legacyBehaviorUnaffected: true,
      providerFailureIsolated: true,
      shadowOnly: provider.manifest.shadowOnly,
    },
  });
  return {
    status: "error",
    contextItems: [],
    diagnostics: [errorDiagnostic],
    evidenceRefs: [...provider.manifest.evidenceRefs, ...errorDiagnostic.evidenceRefs],
    metadata: {
      providerId: provider.manifest.id,
      legacyBehaviorUnaffected: true,
      providerFailureIsolated: true,
      shadowOnly: provider.manifest.shadowOnly,
    },
  };
}

async function runIsolatedProvider(params: {
  provider: RuntimeContextProvider;
  query: RuntimeContextProviderQuery;
  extras?: RuntimeContextProviderExtras;
}): Promise<RuntimeContextProviderResult> {
  try {
    const result = await params.provider.getContext(params.query, params.extras);
    if (Array.isArray(result)) {
      return contextItemResult(params.provider, result);
    }
    return isRuntimeContextProviderResult(result) ? result : invalidResult(params.provider);
  } catch (error) {
    const isolated = isolateRuntimeRegistryError({
      surface: "context",
      providerId: params.provider.manifest.id,
      error,
      metadata: {
        legacyBehaviorUnaffected: true,
        providerFailureIsolated: true,
        shadowOnly: params.provider.manifest.shadowOnly,
      },
    });
    return {
      status: "error",
      contextItems: [],
      diagnostics: [isolated.diagnostic],
      evidenceRefs: [
        ...params.provider.manifest.evidenceRefs,
        ...isolated.diagnostic.evidenceRefs,
      ],
      metadata: {
        providerId: params.provider.manifest.id,
        legacyBehaviorUnaffected: true,
        providerFailureIsolated: true,
        shadowOnly: params.provider.manifest.shadowOnly,
      },
    };
  }
}

export function createTestContextProviderRegistry(
  extraProviders: RuntimeContextProvider[] = [],
): RuntimeContextProviderRegistry {
  return new RuntimeContextProviderRegistry([
    createLegacyContextEngineProvider(),
    createLoopContextPackProvider(),
    ...extraProviders,
  ]);
}

export async function runTestContextProviderRegistry(
  params: TestContextProviderRegistryParams,
): Promise<TestContextProviderRegistryResult> {
  const registry = createTestContextProviderRegistry(params.extraProviders);
  const summary = groundingShadowSummary(params.groundingShadow);
  const flags = resolveRuntimeRegistryFeatureFlags(params.config);
  const enabled =
    flags.registryPilotEnabled &&
    flags.providerRegistryShadow &&
    flags.contextProviderRegistryPilot;

  if (!enabled) {
    const result: TestContextProviderRegistryResult = {
      enabled: false,
      registry,
      contextItems: [],
      providerResults: [],
      diagnostics: [
        diagnostic({
          status: "skipped",
          reason: "flag_disabled",
          message: "Context provider registry test flags are disabled.",
          metadata: {
            legacyAuthoritative: true,
            requiredFlags: [
              "runtime.registryPilot.enabled",
              "runtime.providerRegistry.shadow",
              "runtime.contextProviders.registryPilot",
            ],
          },
        }),
      ],
    };
    return summary
      ? {
          ...result,
          diagnostics: [...result.diagnostics, groundingShadowDiagnostic(summary)],
          groundingShadowSummary: summary,
        }
      : result;
  }

  const providerResults: RuntimeContextProviderResult[] = [];
  const legacyProvider = registry.resolve(LEGACY_CONTEXT_ENGINE_PROVIDER_ID);
  if (legacyProvider && params.legacyMessages) {
    providerResults.push(
      await runIsolatedProvider({
        provider: legacyProvider,
        query: {
          taskId: params.sessionId,
          tokenBudget: params.tokenBudget,
          metadata: { messages: params.legacyMessages as never },
        },
      }),
    );
  }

  const loopProvider = registry.resolve(LOOP_CONTEXT_PACK_PROVIDER_ID);
  if (loopProvider && params.loopContextInput) {
    providerResults.push(
      await runIsolatedProvider({
        provider: loopProvider,
        query: {
          taskId: params.sessionId,
          tokenBudget: params.tokenBudget,
          metadata: { loopContextInput: params.loopContextInput as never },
        },
      }),
    );
  }

  const defaultProviderIds = new Set([
    LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
    LOOP_CONTEXT_PACK_PROVIDER_ID,
  ]);
  for (const manifest of registry.listManifests()) {
    if (defaultProviderIds.has(manifest.id)) {
      continue;
    }
    const provider = registry.resolve(manifest.id);
    if (!provider) {
      continue;
    }
    const extras = params.extraProviderExtras?.[manifest.id];
    const metadata = asRecord(extras?.metadata) ?? {};
    providerResults.push(
      await runIsolatedProvider({
        provider,
        query:
          params.extraProviderQueries?.[manifest.id] ?? {
            taskId: params.sessionId,
            tokenBudget: params.tokenBudget,
          },
        extras:
          params.config === undefined
            ? extras
            : {
                ...extras,
                metadata: {
                  config: params.config as never,
                  ...metadata,
                },
              },
      }),
    );
  }

  const result: TestContextProviderRegistryResult = {
    enabled: true,
    registry,
    providerResults,
    contextItems: providerResults.flatMap((providerResult) => providerResult.contextItems),
    diagnostics: providerResults.flatMap((providerResult) => providerResult.diagnostics),
  };
  return summary
    ? {
        ...result,
        diagnostics: [...result.diagnostics, groundingShadowDiagnostic(summary)],
        groundingShadowSummary: summary,
      }
    : result;
}
