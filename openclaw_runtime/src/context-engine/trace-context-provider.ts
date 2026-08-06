import {
  createRuntimeTraceGroundingShadowSummary,
  resolveRuntimeTraceContextFeatureFlags,
  type ContextItem,
  type ContextItemPriority,
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
  type RuntimeTraceSpanStore,
  type RuntimeTraceSummary,
  type RuntimeTraceSummaryItem,
} from "../runtime-core/index.js";

export const RUNTIME_TRACE_CONTEXT_PROVIDER_ID = "runtime-trace-context";

export type RuntimeTraceContextProviderOptions = {
  store: RuntimeTraceSpanStore;
  config?: unknown;
  defaultTokenBudget?: number;
  maxTraceIds?: number;
  groundingDiagnostics?: RuntimeTraceContextProviderGroundingDiagnosticsOptions;
};

export type RuntimeTraceContextProviderGroundingDiagnosticsOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

type TraceProviderQuery = {
  traceIds: string[];
  taskId?: string;
  toolName?: string;
  file?: string;
  symbol?: string;
  tokenBudget: number;
};

const DEFAULT_TOKEN_BUDGET = 256;
const DEFAULT_MAX_TRACE_IDS = 3;
const INTERNAL_SUMMARY_TOKEN_BUDGET = 10_000;
const TOKEN_CHAR_WIDTH = 6;
const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "trace",
  ref: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
  label: "Runtime trace context provider",
};

export function createRuntimeTraceContextProvider(
  options: RuntimeTraceContextProviderOptions,
): RuntimeContextProvider {
  const manifest = {
    id: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Runtime Trace Context Provider",
    description: "Readonly budgeted trace context summaries for runtime/tool/test behavior.",
    source: "runtime-core" as const,
    capabilities: ["context.trace", "context.runtime-trace"],
    priority: 60,
    order: 60,
    permission: {
      decision: "allow" as const,
      capability: "context.trace",
      reason: "Readonly trace summaries only; no runtime authority.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["flag_disabled" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/trace-context-provider.ts",
      },
    ],
    outputKinds: ["trace" as const, "summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: {
      readonlyTraceContext: true,
      noRuntimeAuthority: true,
    },
  };

  return {
    manifest,
    getContext(query, extras): RuntimeContextProviderResult {
      const groundingSummary = groundingDiagnosticsSummary(
        options.groundingDiagnostics,
      );
      const flags = resolveRuntimeTraceContextFeatureFlags(
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
              message: "Runtime trace context provider flag is disabled.",
              metadata: {
                shadowOnly: true,
                legacyBehaviorUnaffected: true,
                requiredFlag: "runtime.traceContext.provider",
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: false,
            shadowOnly: true,
            legacyBehaviorUnaffected: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const providerQuery = traceProviderQuery(options, query, extras);
      if (providerQuery.traceIds.length === 0) {
        return withGroundingDiagnostics(providerResult({
          status: "success",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "skipped",
              reason: "no_result",
              message: "No matching trace spans were found for the trace context query.",
              metadata: {
                queryHadTaskId: providerQuery.taskId !== undefined,
                queryHadToolName: providerQuery.toolName !== undefined,
                queryHadFile: providerQuery.file !== undefined,
                queryHadSymbol: providerQuery.symbol !== undefined,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: true,
            shadowOnly: true,
            readonlyTraceContext: true,
            traceIds: [],
            contextItemCount: 0,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const summaries = providerQuery.traceIds.map((traceId) =>
        options.store.summarizeTrace(traceId, INTERNAL_SUMMARY_TOKEN_BUDGET, {
          taskId: providerQuery.taskId,
          toolName: providerQuery.toolName,
          file: providerQuery.file,
          symbol: providerQuery.symbol,
        })
      );
      const contextItems = buildContextItems(summaries, providerQuery);
      const estimatedTokens = contextItems.reduce(
        (total, item) => total + estimateTokens(item.text),
        0,
      );
      return withGroundingDiagnostics(providerResult({
        status: "success",
        contextItems,
        diagnostics: [
          diagnostic({
            status: "ok",
            reason: "registered",
            message: "Runtime trace context provider returned readonly budgeted context items.",
            metadata: {
              traceIds: providerQuery.traceIds,
              contextItemCount: contextItems.length,
              omittedSpanCount: summaries.reduce(
                (total, summary) => total + summary.omittedSpanCount,
                0,
              ),
              tokenBudget: providerQuery.tokenBudget,
              estimatedTokens,
              readonlyTraceContext: true,
              noRuntimeAuthority: true,
            },
          }),
        ],
        metadata: {
          providerId: manifest.id,
          enabled: true,
          shadowOnly: true,
          readonlyTraceContext: true,
          noRuntimeAuthority: true,
          traceIds: providerQuery.traceIds,
          tokenBudget: providerQuery.tokenBudget,
          estimatedTokens,
          contextItemCount: contextItems.length,
        },
        manifestEvidenceRefs: manifest.evidenceRefs,
      }), groundingSummary);
    },
  };
}

function groundingDiagnosticsSummary(
  options?: RuntimeTraceContextProviderGroundingDiagnosticsOptions,
): GroundingShadowConsumerSummary | undefined {
  if (options?.enabled !== true) {
    return undefined;
  }
  return createRuntimeTraceGroundingShadowSummary(options.refs ?? [], {
    enabled: true,
    query: options.query,
    limit: options.limit,
    tokenBudget: options.tokenBudget,
    metadata: {
      ...options.metadata,
      runtimeTraceGroundingDiagnostics: true,
      diagnosticsOnly: true,
      metadataOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
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
      ...result.metadata,
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
    message: "Runtime trace context provider emitted grounding diagnostics-only summary metadata.",
    metadata: groundingDiagnosticsMetadata(summary),
  });
}

function groundingDiagnosticsMetadata(
  summary: GroundingShadowConsumerSummary,
): RuntimeCoreJsonObject {
  return {
    runtimeTraceGroundingDiagnostics: true,
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
  } as unknown as RuntimeCoreJsonObject;
}

function providerConfig(
  fallbackConfig: unknown,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): unknown {
  const candidates = [
    recordFrom(extras?.metadata)?.config,
    recordFrom(query.metadata)?.config,
    extras?.metadata,
    query.metadata,
    fallbackConfig,
  ];
  return candidates.find((candidate) =>
    resolveRuntimeTraceContextFeatureFlags(candidate).provider
  ) ?? fallbackConfig;
}

function traceProviderQuery(
  options: RuntimeTraceContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): TraceProviderQuery {
  const metadata = {
    ...recordFrom(query.metadata),
    ...recordFrom(extras?.metadata),
  };
  const taskId = stringFrom(query.taskId) ?? stringFrom(metadata.taskId);
  const toolName = stringFrom(metadata.toolName);
  const file = stringFrom(metadata.file) ?? query.activeFiles?.find(isPresentString);
  const symbol = stringFrom(metadata.symbol);
  const tokenBudget = positiveInteger(
    query.tokenBudget,
    positiveInteger(metadata.tokenBudget, options.defaultTokenBudget ?? DEFAULT_TOKEN_BUDGET),
  );
  const requestedTraceIds = stringArrayFrom(metadata.traceIds);
  const requestedTraceId = stringFrom(metadata.traceId);
  const traceIds = uniqueStrings([
    ...requestedTraceIds,
    ...(requestedTraceId ? [requestedTraceId] : []),
  ]).slice(0, options.maxTraceIds ?? DEFAULT_MAX_TRACE_IDS);

  return {
    traceIds: traceIds.length > 0
      ? traceIds
      : discoverTraceIds(options.store, {
          taskId,
          toolName,
          file,
          symbol,
          maxTraceIds: options.maxTraceIds ?? DEFAULT_MAX_TRACE_IDS,
        }),
    taskId,
    toolName,
    file,
    symbol,
    tokenBudget,
  };
}

function discoverTraceIds(
  store: RuntimeTraceSpanStore,
  query: Pick<TraceProviderQuery, "taskId" | "toolName" | "file" | "symbol"> & {
    maxTraceIds: number;
  },
): string[] {
  if (
    query.taskId === undefined &&
    query.toolName === undefined &&
    query.file === undefined &&
    query.symbol === undefined
  ) {
    return [];
  }
  return uniqueStrings(
    store.query({
      taskId: query.taskId,
      toolName: query.toolName,
      file: query.file,
      symbol: query.symbol,
    }).map((span) => span.traceId),
  ).slice(0, query.maxTraceIds);
}

function buildContextItems(
  summaries: readonly RuntimeTraceSummary[],
  query: TraceProviderQuery,
): ContextItem[] {
  const rankedItems = summaries
    .flatMap((summary) => summary.items)
    .map((item, index) => ({
      item,
      index,
      rank: providerItemRank(item, query),
    }))
    .sort((left, right) => {
      const rank = right.rank - left.rank;
      if (rank !== 0) return rank;
      return left.index - right.index;
    });
  const contextItems: ContextItem[] = [];
  let estimatedTokens = 0;
  for (const ranked of rankedItems) {
    const text = contextText(ranked.item);
    const nextTokens = estimateTokens(text);
    if (estimatedTokens + nextTokens > query.tokenBudget) {
      if (contextItems.length > 0 || query.tokenBudget === 0) {
        continue;
      }
      const truncatedText = truncateToTokenBudget(text, query.tokenBudget);
      contextItems.push(toContextItem(ranked.item, ranked.rank, truncatedText));
      estimatedTokens += estimateTokens(truncatedText);
      continue;
    }
    contextItems.push(toContextItem(ranked.item, ranked.rank, text));
    estimatedTokens += nextTokens;
  }
  return contextItems;
}

function toContextItem(
  item: RuntimeTraceSummaryItem,
  rank: number,
  text: string,
): ContextItem {
  return {
    id: `${RUNTIME_TRACE_CONTEXT_PROVIDER_ID}:${item.traceId}:${item.spanId}`,
    kind: "trace",
    text,
    source: `trace:${item.traceId}:${item.spanId}`,
    priority: itemPriority(item),
    evidenceRefs: contextEvidenceRefs(item),
    metadata: {
      providerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
      traceId: item.traceId,
      spanId: item.spanId,
      ...(item.parentSpanId ? { parentSpanId: item.parentSpanId } : {}),
      name: item.name,
      kind: item.kind,
      status: item.status,
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
      eventCount: item.eventCount,
      linkCount: item.links.length,
      sourceRefs: item.sourceRefs as never,
      evidenceRefCount: item.evidenceRefs.length,
      rank,
      readonlyTraceContext: true,
      sourceRefsAreEvidenceLinksOnly: true,
      noVerifierAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function contextText(item: RuntimeTraceSummaryItem): string {
  return [
    item.summary,
    `events=${item.eventCount}`,
    `links=${item.links.length}`,
  ].join(" | ");
}

function contextEvidenceRefs(item: RuntimeTraceSummaryItem): EvidenceRef[] {
  return uniqueEvidenceRefs([
    {
      type: "trace",
      ref: `${item.traceId}:${item.spanId}`,
      label: "Runtime trace span",
      summary: item.summary,
    },
    ...item.evidenceRefs,
  ]);
}

function itemPriority(item: RuntimeTraceSummaryItem): ContextItemPriority {
  if (item.status === "error") return "P0";
  if (item.kind === "test" || item.kind === "verifier") return "P1";
  if (item.links.some((link) => link.relationship === "evidence" || link.relationship === "resume")) {
    return "P1";
  }
  return "P2";
}

function providerItemRank(item: RuntimeTraceSummaryItem, query: TraceProviderQuery): number {
  let rank = 0;
  if (item.status === "error") rank += 1_000_000;
  rank += currentMatchRank(item, query);
  if (item.kind === "test" || item.kind === "verifier") rank += 600_000;
  if (item.links.some((link) => link.relationship === "evidence" || link.relationship === "resume")) {
    rank += 400_000;
  }
  return rank + Math.min(item.rank, 999);
}

function currentMatchRank(item: RuntimeTraceSummaryItem, query: TraceProviderQuery): number {
  const specificMatch =
    (query.toolName !== undefined && item.summary.includes(`tool=${query.toolName}`)) ||
    (query.file !== undefined && item.sourceRefs.some((ref) => ref.file === query.file)) ||
    (query.symbol !== undefined && item.sourceRefs.some((ref) => ref.symbol === query.symbol));
  if (specificMatch) return 850_000;
  return query.taskId !== undefined && item.summary.includes(`task=${query.taskId}`)
    ? 100_000
    : 0;
}

function providerResult(params: {
  status: RuntimeContextProviderResult["status"];
  contextItems: ContextItem[];
  diagnostics: RuntimeRegistryDiagnostic[];
  metadata: RuntimeCoreJsonObject;
  manifestEvidenceRefs: EvidenceRef[];
}): RuntimeContextProviderResult {
  return {
    status: params.status,
    contextItems: params.contextItems,
    diagnostics: params.diagnostics,
    evidenceRefs: uniqueEvidenceRefs([
      ...params.manifestEvidenceRefs,
      PROVIDER_EVIDENCE_REF,
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
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
    status: params.status,
    reason: params.reason,
    message: params.message,
    evidenceRefs: [PROVIDER_EVIDENCE_REF],
    metadata: params.metadata,
  };
}

function uniqueEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [ref];
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  return text.slice(0, Math.max(0, tokenBudget * TOKEN_CHAR_WIDTH));
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const normalized = stringFrom(item);
    return normalized ? [normalized] : [];
  }) : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isPresentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
