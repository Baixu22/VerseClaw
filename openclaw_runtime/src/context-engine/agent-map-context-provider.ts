import {
  createAgentMapGroundingShadowSummary,
  isAgentMapResult,
  type AgentMapDiagnostic,
  type AgentMapRankedTag,
  type AgentMapResult,
  type ContextItem,
  type EvidenceRef,
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

export const AGENT_MAP_CONTEXT_PROVIDER_ID = "agent-map-readonly-shadow";

export type AgentMapContextProviderOptions = {
  result?: AgentMapResult;
  config?: unknown;
  groundingDiagnostics?: AgentMapContextProviderGroundingDiagnosticsOptions;
  getResult?: (
    query: RuntimeContextProviderQuery,
    extras?: RuntimeContextProviderExtras,
  ) => AgentMapResult | undefined | Promise<AgentMapResult | undefined>;
};

export type AgentMapContextProviderGroundingDiagnosticsOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: AGENT_MAP_CONTEXT_PROVIDER_ID,
  label: "AgentMap readonly shadow provider",
};

export function createAgentMapContextProvider(
  options: AgentMapContextProviderOptions = {},
): RuntimeContextProvider {
  const manifest = {
    id: AGENT_MAP_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "AgentMap readonly shadow provider",
    description: "Readonly AgentMap symbol and evidence context for explicit shadow runs.",
    source: "runtime-core" as const,
    capabilities: ["context.agent-map", "context.symbol"],
    priority: 30,
    order: 30,
    permission: {
      decision: "allow" as const,
      capability: "context.agent-map",
      reason: "Readonly diagnostics/evidence only; legacy prompt assembly remains authoritative.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/runtime-core/agent-map.ts",
      },
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/agent-map-context-provider.ts",
      },
    ],
    outputKinds: ["symbol" as const, "file" as const, "summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: {
      readonlyAgentMap: true,
      shadowOnly: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };

  return {
    manifest,
    async getContext(query, extras): Promise<RuntimeContextProviderResult> {
      const groundingSummary = groundingDiagnosticsSummary(
        options.groundingDiagnostics,
      );
      const flags = resolveRuntimeAgentMapFeatureFlags(
        providerConfig(options.config, query, extras),
      );
      if (!flags.provider) {
        return withGroundingDiagnostics(providerResult({
          status: "fallback",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "skipped",
              reason: "flag_disabled",
              message: "AgentMap context provider flag is disabled.",
              metadata: {
                shadowOnly: true,
                legacyAuthoritative: true,
                legacyBehaviorUnaffected: true,
                readonlyAgentMap: true,
                requiredFlag: "runtime.agentMap.provider",
                noPromptAuthority: true,
                noToolAuthority: true,
                noRuntimeAuthority: true,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: false,
            shadowOnly: true,
            legacyAuthoritative: true,
            legacyBehaviorUnaffected: true,
            readonlyAgentMap: true,
            contextItemCount: 0,
            noPromptAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const result = await resolveAgentMapResultSafely(options, query, extras);
      if (result.error) {
        return withGroundingDiagnostics(providerResult({
          status: "error",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "error",
              reason: "provider_error",
              message: result.error,
              metadata: {
                shadowOnly: true,
                legacyAuthoritative: true,
                readonlyAgentMap: true,
                providerFailureIsolated: true,
                legacyBehaviorUnaffected: true,
                noPromptAuthority: true,
                noToolAuthority: true,
                noRuntimeAuthority: true,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: true,
            shadowOnly: true,
            legacyAuthoritative: true,
            readonlyAgentMap: true,
            contextItemCount: 0,
            providerFailureIsolated: true,
            legacyBehaviorUnaffected: true,
            noPromptAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const agentMapResult = result.result;
      if (!agentMapResult) {
        return withGroundingDiagnostics(providerResult({
          status: "fallback",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "skipped",
              reason: "no_result",
              message: "No readonly AgentMap result was supplied for the shadow provider.",
              metadata: {
                shadowOnly: true,
                legacyAuthoritative: true,
                readonlyAgentMap: true,
                noPromptAuthority: true,
                noToolAuthority: true,
                noRuntimeAuthority: true,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: true,
            shadowOnly: true,
            legacyAuthoritative: true,
            readonlyAgentMap: true,
            contextItemCount: 0,
            noPromptAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const contextItems = agentMapContextItems(agentMapResult);
      const agentMapDiagnostics = agentMapResult.diagnostics ?? [];
      return withGroundingDiagnostics(providerResult({
        status: "success",
        contextItems,
        diagnostics: [
          diagnostic({
            status: "fallback",
            reason: "legacy_authoritative",
            message: "AgentMap readonly output is exposed as shadow diagnostics/evidence only.",
            metadata: {
              shadowOnly: true,
              legacyAuthoritative: true,
              readonlyAgentMap: true,
              resultStatus: agentMapResult.status,
              includedSymbolCount: agentMapResult.includedSymbols.length,
              includedFileCount: agentMapResult.includedFiles.length,
              excludedFileCount: agentMapResult.excludedFiles.length,
              promptPresentExcludedCount: agentMapResult.excludedFiles.filter((file) =>
                file.reason === "promptPresentFile"
              ).length,
              agentMapDiagnosticCount: agentMapDiagnostics.length,
              tokenBudget: agentMapResult.tokenBudget,
              tokenEstimate: agentMapResult.tokenEstimate,
              noPromptAuthority: true,
              noToolAuthority: true,
              noRuntimeAuthority: true,
            },
          }),
          ...agentMapDiagnostics.map(agentMapDiagnostic),
        ],
        metadata: {
          providerId: manifest.id,
          enabled: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          readonlyAgentMap: true,
          resultStatus: agentMapResult.status,
          contextItemCount: contextItems.length,
          includedSymbolCount: agentMapResult.includedSymbols.length,
          agentMapDiagnosticCount: agentMapDiagnostics.length,
          tokenBudget: agentMapResult.tokenBudget,
          tokenEstimate: agentMapResult.tokenEstimate,
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        },
        manifestEvidenceRefs: manifest.evidenceRefs,
        extraEvidenceRefs: agentMapDiagnostics.flatMap((item) => item.evidenceRefs),
      }), groundingSummary);
    },
  };
}

function groundingDiagnosticsSummary(
  options?: AgentMapContextProviderGroundingDiagnosticsOptions,
): GroundingShadowConsumerSummary | undefined {
  if (options?.enabled !== true) {
    return undefined;
  }
  return createAgentMapGroundingShadowSummary(options.refs ?? [], {
    enabled: true,
    query: options.query,
    limit: options.limit,
    tokenBudget: options.tokenBudget,
    metadata: {
      ...(options.metadata ?? {}),
      agentMapGroundingDiagnostics: true,
      diagnosticsOnly: true,
      metadataOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
      noPromptAuthority: true,
      noProviderOrderingAuthority: true,
    },
  });
}

function withGroundingDiagnostics(
  result: RuntimeContextProviderResult,
  summary: GroundingShadowConsumerSummary | undefined,
): RuntimeContextProviderResult {
  if (!summary) {
    return result;
  }
  return {
    ...result,
    diagnostics: [...result.diagnostics, groundingDiagnosticsDiagnostic(summary)],
    metadata: {
      ...(result.metadata ?? {}),
      groundingDiagnostics: groundingDiagnosticsMetadata(summary),
    },
  };
}

function groundingDiagnosticsDiagnostic(
  summary: GroundingShadowConsumerSummary,
): RuntimeRegistryDiagnostic {
  return diagnostic({
    status: summary.items.length > 0 ? "ok" : "skipped",
    reason: summary.items.length > 0 ? "registered" : "no_result",
    message: "AgentMap context provider emitted grounding diagnostics-only summary metadata.",
    metadata: groundingDiagnosticsMetadata(summary),
  });
}

function groundingDiagnosticsMetadata(
  summary: GroundingShadowConsumerSummary,
): RuntimeCoreJsonObject {
  return {
    agentMapGroundingDiagnostics: true,
    diagnosticsOnly: true,
    metadataOnly: true,
    noContextItemAuthority: true,
    noProviderResultAuthority: true,
    noPromptAuthority: true,
    noProviderOrderingAuthority: true,
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
    noMemoryPromotionAuthority: summary.noMemoryPromotionAuthority,
    noPatchMutationAuthority: summary.noPatchMutationAuthority,
    query: groundingDiagnosticsQueryMetadata(summary.query),
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
  };
}

function groundingDiagnosticsQueryMetadata(
  query: GroundingQuery,
): RuntimeCoreJsonObject {
  const metadata: RuntimeCoreJsonObject = { readonly: true };
  if (query.kind !== undefined) metadata.kind = query.kind as never;
  if (query.trust !== undefined) metadata.trust = query.trust as never;
  if (query.taskId !== undefined) metadata.taskId = query.taskId;
  if (query.traceId !== undefined) metadata.traceId = query.traceId;
  if (query.spanId !== undefined) metadata.spanId = query.spanId;
  if (query.eventId !== undefined) metadata.eventId = query.eventId;
  if (query.checkpointId !== undefined) metadata.checkpointId = query.checkpointId;
  if (query.toolCallId !== undefined) metadata.toolCallId = query.toolCallId;
  if (query.file !== undefined) metadata.file = query.file;
  if (query.symbol !== undefined) metadata.symbol = query.symbol;
  if (query.limit !== undefined) metadata.limit = query.limit;
  if (query.tokenBudget !== undefined) metadata.tokenBudget = query.tokenBudget;
  metadata.includeRaw = false;
  metadata.includeUntrusted = false;
  return metadata;
}

type AgentMapProviderResolution =
  | { result?: AgentMapResult; error?: undefined }
  | { result?: undefined; error: string };

async function resolveAgentMapResultSafely(
  options: AgentMapContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): Promise<AgentMapProviderResolution> {
  try {
    return { result: await resolveAgentMapResult(options, query, extras) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

async function resolveAgentMapResult(
  options: AgentMapContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): Promise<AgentMapResult | undefined> {
  const metadata = {
    ...recordFrom(query.metadata),
    ...recordFrom(extras?.metadata),
  };
  const supplied = metadata.agentMapResult;
  if (isAgentMapResult(supplied)) {
    return supplied;
  }
  if (options.getResult) {
    const result = await options.getResult(query, extras);
    return isAgentMapResult(result) ? result : undefined;
  }
  return isAgentMapResult(options.result) ? options.result : undefined;
}

function agentMapContextItems(result: AgentMapResult): ContextItem[] {
  const summary = result.content.trim()
    ? [agentMapSummaryItem(result)]
    : [];
  const diagnostics = (result.diagnostics ?? []).map(agentMapDiagnosticItem);
  return [
    ...result.includedSymbols.map((rankedTag) =>
      agentMapSymbolItem(rankedTag, result)
    ),
    ...summary,
    ...diagnostics,
  ];
}

function agentMapSymbolItem(
  rankedTag: AgentMapRankedTag,
  result: AgentMapResult,
): ContextItem {
  const tag = rankedTag.tag;
  return {
    id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:symbol:${tag.tagId}`,
    kind: "symbol",
    text: rankedTag.renderedBlock ?? tag.signature ?? tag.snippet ?? tag.namePath.join("."),
    source: `agent-map:${tag.file}:${tag.range.startLine}:${tag.range.startColumn}`,
    priority: rankedTag.rank <= 3 ? "P1" : "P2",
    evidenceRefs: uniqueEvidenceRefs([
      ...rankedTag.evidenceRefs,
      ...rankedTag.reasons.flatMap((reason) => reason.evidenceRefs),
      ...tag.evidenceRefs,
    ]),
    metadata: {
      providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
      readonlyAgentMap: true,
      shadowOnly: true,
      legacyAuthoritative: true,
      tagId: tag.tagId,
      file: tag.file,
      name: tag.name,
      namePath: tag.namePath,
      symbolKind: tag.symbolKind,
      rank: rankedTag.rank,
      score: rankedTag.score,
      reasonKinds: rankedTag.reasons.map((reason) => reason.kind),
      resultStatus: result.status,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function agentMapSummaryItem(result: AgentMapResult): ContextItem {
  return {
    id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:summary:${result.status}`,
    kind: "summary",
    text: result.content,
    source: "agent-map:readonly-render",
    priority: "P2",
    evidenceRefs: uniqueEvidenceRefs([
      ...result.evidenceRefs,
      ...result.evidence.flatMap((evidence) => evidence.evidenceRefs),
    ]),
    metadata: {
      providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
      readonlyAgentMap: true,
      shadowOnly: true,
      legacyAuthoritative: true,
      resultStatus: result.status,
      tokenBudget: result.tokenBudget,
      tokenEstimate: result.tokenEstimate,
      includedFileCount: result.includedFiles.length,
      excludedFileCount: result.excludedFiles.length,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function agentMapDiagnosticItem(
  item: AgentMapDiagnostic,
  index: number,
): ContextItem {
  return {
    id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:diagnostic:${index + 1}:${item.code}`,
    kind: "evidence",
    text: item.file ? `${item.code}: ${item.file}: ${item.message}` : `${item.code}: ${item.message}`,
    source: item.file ? `agent-map:diagnostic:${item.file}` : "agent-map:diagnostic",
    priority: item.severity === "error" ? "P1" : "P2",
    evidenceRefs: uniqueEvidenceRefs(item.evidenceRefs),
    metadata: {
      providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
      readonlyAgentMap: true,
      shadowOnly: true,
      legacyAuthoritative: true,
      agentMapDiagnosticCode: item.code,
      agentMapDiagnosticSeverity: item.severity,
      ...(item.file ? { file: item.file } : {}),
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function agentMapDiagnostic(
  item: AgentMapDiagnostic,
): RuntimeRegistryDiagnostic {
  return diagnostic({
    status: item.severity === "error" ? "error" : "fallback",
    reason: item.severity === "error" ? "provider_error" : "legacy_authoritative",
    message: item.message,
    metadata: {
      agentMapDiagnosticCode: item.code,
      agentMapDiagnosticSeverity: item.severity,
      ...(item.file ? { file: item.file } : {}),
      readonlyAgentMap: true,
      shadowOnly: true,
      legacyAuthoritative: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
    extraEvidenceRefs: item.evidenceRefs,
  });
}

function providerResult(params: {
  status: RuntimeContextProviderResult["status"];
  contextItems: ContextItem[];
  diagnostics: RuntimeRegistryDiagnostic[];
  metadata: RuntimeCoreJsonObject;
  manifestEvidenceRefs: EvidenceRef[];
  extraEvidenceRefs?: EvidenceRef[];
}): RuntimeContextProviderResult {
  return {
    status: params.status,
    contextItems: params.contextItems,
    diagnostics: params.diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      ...params.manifestEvidenceRefs,
      PROVIDER_EVIDENCE_REF,
      ...(params.extraEvidenceRefs ?? []),
      ...params.contextItems.flatMap((item) => item.evidenceRefs),
      ...params.diagnostics.flatMap((item) => item.evidenceRefs),
    ]),
    metadata: params.metadata,
  };
}

function diagnostic(params: {
  status: RuntimeRegistryDiagnostic["status"];
  reason: RuntimeRegistryDiagnostic["reason"];
  message: string;
  metadata?: RuntimeCoreJsonObject;
  extraEvidenceRefs?: EvidenceRef[];
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: uniqueEvidenceRefs([
      PROVIDER_EVIDENCE_REF,
      ...(params.extraEvidenceRefs ?? []),
    ]),
    metadata: params.metadata,
  };
}

function providerConfig(
  fallbackConfig: unknown,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): unknown {
  const candidates = [
    recordFrom(extras?.metadata).config,
    recordFrom(query.metadata).config,
    extras?.metadata,
    query.metadata,
    fallbackConfig,
  ];
  return candidates.find((candidate) =>
    resolveRuntimeAgentMapFeatureFlags(candidate).provider
  ) ?? fallbackConfig;
}

function resolveRuntimeAgentMapFeatureFlags(value: unknown): { provider: boolean } {
  const runtime = runtimeConfigFrom(value);
  const agentMap = recordFrom(runtime?.agentMap);
  return { provider: agentMap.provider === true };
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = recordFrom(value);
  const directRuntime = recordFrom(record.runtime);
  if (directRuntime.runtime !== undefined || Object.keys(directRuntime).length > 0) {
    return directRuntime;
  }
  const config = recordFrom(record.config);
  const configRuntime = recordFrom(config.runtime);
  return Object.keys(configRuntime).length > 0 ? configRuntime : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}:${ref.label ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [ref];
  });
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
