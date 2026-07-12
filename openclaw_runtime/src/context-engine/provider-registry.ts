import {
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
  type LoopContextPackInput,
} from "../agents/loop-context-pack.js";
import type { AgentMessage } from "../agents/runtime/index.js";
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
} from "../runtime-core/index.js";
import { LegacyContextEngine } from "./legacy.js";

export const LEGACY_CONTEXT_ENGINE_PROVIDER_ID = "legacy-context-engine";
export const LOOP_CONTEXT_PACK_PROVIDER_ID = "loop-context-pack";
export const CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID =
  "context-provider-registry-grounding-shadow";

export type ContextProviderRegistryGroundingShadowPilotOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

type ContextProviderRegistryPilotParams = {
  config?: unknown;
  sessionId?: string;
  sessionKey?: string;
  tokenBudget?: number;
  legacyMessages?: AgentMessage[];
  loopContextInput?: LoopContextPackInput;
  extraProviders?: RuntimeContextProvider[];
  extraProviderQueries?: Record<string, RuntimeContextProviderQuery>;
  extraProviderExtras?: Record<string, RuntimeContextProviderExtras>;
  groundingShadow?: ContextProviderRegistryGroundingShadowPilotOptions;
};

export type ContextProviderRegistryPilotResult = {
  enabled: boolean;
  registry: RuntimeContextProviderRegistry;
  contextItems: NonNullable<RuntimeContextProviderResult["contextItems"]>;
  diagnostics: RuntimeRegistryDiagnostic[];
  providerResults: RuntimeContextProviderResult[];
  groundingShadowSummary?: GroundingShadowConsumerSummary;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metadataFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): Record<string, unknown> {
  return {
    ...(asRecord(query.metadata) ?? {}),
    ...(asRecord(extras?.metadata) ?? {}),
  };
}

function messagesFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): AgentMessage[] {
  const messages = metadataFrom(query, extras).messages;
  return Array.isArray(messages) ? messages as AgentMessage[] : [];
}

function loopContextInputFrom(
  query: RuntimeContextProviderQuery,
  extras?: { metadata?: RuntimeCoreJsonObject },
): LoopContextPackInput {
  const input = metadataFrom(query, extras).loopContextInput;
  return asRecord(input) ? input as LoopContextPackInput : {};
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
      ? [{ type: "other", ref: params.providerId, label: "Context provider registry pilot" }]
      : [],
    metadata: params.metadata,
  };
}

function groundingShadowPilotSummary(
  options?: ContextProviderRegistryGroundingShadowPilotOptions,
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

function groundingShadowDiagnostic(
  summary: GroundingShadowConsumerSummary,
): RuntimeRegistryDiagnostic {
  const itemMetadata: RuntimeCoreJsonObject[] = summary.items.map((item) => ({
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
  }));
  return diagnostic({
    providerId: CONTEXT_PROVIDER_REGISTRY_GROUNDING_SHADOW_CONSUMER_ID,
    status: summary.items.length > 0 ? "ok" : "skipped",
    reason: summary.items.length > 0 ? "registered" : "no_result",
    message: "Grounding runtime shadow pilot emitted diagnostics-only summary metadata.",
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
      items: itemMetadata,
      ...(summary.metadata ? { summaryMetadata: summary.metadata } : {}),
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
  };
}

function withGroundingShadowPilot(
  result: ContextProviderRegistryPilotResult,
  summary: GroundingShadowConsumerSummary | undefined,
): ContextProviderRegistryPilotResult {
  if (!summary) {
    return result;
  }
  return {
    ...result,
    diagnostics: [...result.diagnostics, groundingShadowDiagnostic(summary)],
    groundingShadowSummary: summary,
  };
}

function withContextShadowRuntime(input: LoopContextPackInput): LoopContextPackInput {
  return {
    ...input,
    runtime: {
      ...(asRecord(input.runtime) ?? {}),
      contextProviders: {
        ...(asRecord(asRecord(input.runtime)?.contextProviders) ?? {}),
        shadow: true,
        loopPackShadow: true,
      },
    },
  };
}

function collectEvidenceRefs(
  result: RuntimeContextProviderResult,
): RuntimeContextProviderResult["evidenceRefs"] {
  return [
    ...result.evidenceRefs,
    ...result.contextItems.flatMap((item) => item.evidenceRefs),
  ];
}

function providerContextItemResult(
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
  return {
    ...result,
    evidenceRefs: collectEvidenceRefs(result),
  };
}

function providerInvalidResult(
  provider: RuntimeContextProvider,
): RuntimeContextProviderResult {
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
    evidenceRefs: [
      ...provider.manifest.evidenceRefs,
      ...errorDiagnostic.evidenceRefs,
    ],
    metadata: {
      providerId: provider.manifest.id,
      legacyBehaviorUnaffected: true,
      providerFailureIsolated: true,
      shadowOnly: provider.manifest.shadowOnly,
    },
  };
}

async function runIsolatedContextProvider(params: {
  provider: RuntimeContextProvider;
  query: RuntimeContextProviderQuery;
  extras?: RuntimeContextProviderExtras;
}): Promise<RuntimeContextProviderResult> {
  try {
    const result = await params.provider.getContext(params.query, params.extras);
    if (Array.isArray(result)) {
      return providerContextItemResult(params.provider, result);
    }
    if (isRuntimeContextProviderResult(result)) {
      return result;
    }
    return providerInvalidResult(params.provider);
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

function defaultProviderQuery(
  params: ContextProviderRegistryPilotParams,
): RuntimeContextProviderQuery {
  return {
    taskId: params.sessionId,
    tokenBudget: params.tokenBudget,
  };
}

function extraProviderExtras(
  params: ContextProviderRegistryPilotParams,
  providerId: string,
): RuntimeContextProviderExtras | undefined {
  const extras = params.extraProviderExtras?.[providerId];
  if (params.config === undefined) {
    return extras;
  }
  const metadata = asRecord(extras?.metadata) ?? {};
  return {
    ...extras,
    metadata: {
      config: params.config as never,
      ...metadata,
    },
  };
}

export function createLegacyContextEngineProvider(): RuntimeContextProvider {
  const manifest = {
    id: LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
    kind: "context" as const,
    title: "Legacy ContextEngine compatibility provider",
    source: "legacy" as const,
    capabilities: ["context.legacy", "context.messages"],
    priority: 10,
    order: 10,
    permission: {
      decision: "allow" as const,
      capability: "context.legacy",
      reason: "Compatibility provider emits shadow ContextItems only.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "provider_error" as const],
    evidenceRefs: [{ type: "file" as const, ref: "openclaw_runtime/src/context-engine/legacy.ts" }],
    outputKinds: ["message" as const],
    dependsOnIndexing: false,
  };

  return {
    manifest,
    async getContext(query, extras): Promise<RuntimeContextProviderResult> {
      const messages = messagesFrom(query, extras);
      const engine = new LegacyContextEngine({
        runtime: { contextProviders: { shadow: true } },
      });
      const assembled = await engine.assemble({
        sessionId: query.taskId ?? "registry-shadow",
        ...(query.taskId ? {} : { sessionKey: "registry-shadow" }),
        messages,
        tokenBudget: query.tokenBudget,
      });
      const result: RuntimeContextProviderResult = {
        status: "success",
        contextItems: assembled.contextItems ?? [],
        diagnostics: [
          diagnostic({
            providerId: manifest.id,
            status: "fallback",
            reason: "legacy_authoritative",
            message: "LegacyContextEngine remains authoritative; registry output is shadow-only.",
            metadata: {
              legacyAuthoritative: true,
              shadowOnly: true,
              messagesIdentityPreserved: assembled.messages === messages,
              messageOrderPreserved: assembled.messages.every((message, index) =>
                message === messages[index]
              ),
              messageCount: messages.length,
            },
          }),
        ],
        evidenceRefs: manifest.evidenceRefs,
        metadata: {
          providerId: manifest.id,
          legacyAuthoritative: true,
          shadowOnly: true,
        },
      };
      return {
        ...result,
        evidenceRefs: collectEvidenceRefs(result),
      };
    },
  };
}

export function createLoopContextPackProvider(): RuntimeContextProvider {
  const manifest = {
    id: LOOP_CONTEXT_PACK_PROVIDER_ID,
    kind: "context" as const,
    title: "LoopContextPack compatibility provider",
    source: "legacy" as const,
    capabilities: ["context.loop-pack", "context.task-loop"],
    priority: 20,
    order: 20,
    permission: {
      decision: "allow" as const,
      capability: "context.loop-pack",
      reason: "Compatibility provider emits shadow ContextItems only.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "provider_error" as const],
    evidenceRefs: [{ type: "file" as const, ref: "openclaw_runtime/src/agents/loop-context-pack.ts" }],
    outputKinds: [
      "instruction" as const,
      "checkpoint" as const,
      "memory" as const,
      "evidence" as const,
      "summary" as const,
    ],
    dependsOnIndexing: false,
  };

  return {
    manifest,
    getContext(query, extras): RuntimeContextProviderResult {
      const input = loopContextInputFrom(query, extras);
      const baseline = buildLoopContextPack(input);
      const shadow = buildLoopContextPack(withContextShadowRuntime(input));
      const baselinePrompt = formatLoopContextPackForPrompt(baseline);
      const shadowPrompt = formatLoopContextPackForPrompt(shadow);
      const result: RuntimeContextProviderResult = {
        status: "success",
        contextItems: shadow.contextItems ?? [],
        diagnostics: [
          diagnostic({
            providerId: manifest.id,
            status: "fallback",
            reason: "legacy_authoritative",
            message: "LoopContextPack prompt text remains authoritative; registry output is shadow-only.",
            metadata: {
              legacyAuthoritative: true,
              shadowOnly: true,
              promptTextUnchanged: baselinePrompt === shadowPrompt,
              packHashUnchanged: baseline.hash === shadow.hash,
              sectionCount: baseline.sections.length,
            },
          }),
        ],
        evidenceRefs: manifest.evidenceRefs,
        metadata: {
          providerId: manifest.id,
          legacyAuthoritative: true,
          shadowOnly: true,
        },
      };
      return {
        ...result,
        evidenceRefs: collectEvidenceRefs(result),
      };
    },
  };
}

/**
 * @deprecated DCS v1.6.1 增补5: provider-registry pilot is marked for deletion
 * as T1. Zero production callers confirmed. Deletion was downgraded to
 * @deprecated because 14+ unit test files reference these functions as
 * registry construction helpers. Do NOT add new production callers.
 * Tracked for removal once test files migrate to direct registry construction.
 */
export function createContextProviderRegistryPilot(
  extraProviders: RuntimeContextProvider[] = [],
): RuntimeContextProviderRegistry {
  return new RuntimeContextProviderRegistry([
    createLegacyContextEngineProvider(),
    createLoopContextPackProvider(),
    ...extraProviders,
  ]);
}

/**
 * @deprecated DCS v1.6.1 增补5: provider-registry pilot is marked for deletion
 * as T1. Zero production callers confirmed. Deletion was downgraded to
 * @deprecated because 14+ unit test files reference these functions as
 * registry construction helpers. Do NOT add new production callers.
 * Tracked for removal once test files migrate to direct registry construction.
 */
export async function runContextProviderRegistryPilot(
  params: ContextProviderRegistryPilotParams,
): Promise<ContextProviderRegistryPilotResult> {
  const registry = createContextProviderRegistryPilot(params.extraProviders);
  const groundingShadowSummary = groundingShadowPilotSummary(params.groundingShadow);
  const flags = resolveRuntimeRegistryFeatureFlags(params.config);
  const enabled = flags.registryPilotEnabled
    && flags.providerRegistryShadow
    && flags.contextProviderRegistryPilot;

  if (!enabled) {
    return withGroundingShadowPilot({
      enabled: false,
      registry,
      contextItems: [],
      providerResults: [],
      diagnostics: [
        diagnostic({
          status: "skipped",
          reason: "flag_disabled",
          message: "Context provider registry pilot flags are disabled; legacy context remains authoritative.",
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
    }, groundingShadowSummary);
  }

  const providerResults: RuntimeContextProviderResult[] = [];
  const legacyProvider = registry.resolve(LEGACY_CONTEXT_ENGINE_PROVIDER_ID);
  if (legacyProvider && params.legacyMessages) {
    providerResults.push(await runIsolatedContextProvider({
      provider: legacyProvider,
      query: {
        taskId: params.sessionId,
        tokenBudget: params.tokenBudget,
        metadata: { messages: params.legacyMessages as never },
      },
    }));
  }

  const loopProvider = registry.resolve(LOOP_CONTEXT_PACK_PROVIDER_ID);
  if (loopProvider && params.loopContextInput) {
    providerResults.push(await runIsolatedContextProvider({
      provider: loopProvider,
      query: {
        taskId: params.sessionId,
        tokenBudget: params.tokenBudget,
        metadata: { loopContextInput: params.loopContextInput as never },
      },
    }));
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
    providerResults.push(await runIsolatedContextProvider({
      provider,
      query: params.extraProviderQueries?.[manifest.id] ?? defaultProviderQuery(params),
      extras: extraProviderExtras(params, manifest.id),
    }));
  }

  return withGroundingShadowPilot({
    enabled: true,
    registry,
    providerResults,
    contextItems: providerResults.flatMap((result) => result.contextItems),
    diagnostics: providerResults.flatMap((result) => result.diagnostics),
  }, groundingShadowSummary);
}
