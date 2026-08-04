import {
  createSymbolGroundingShadowSummary,
  flattenRuntimeSymbols,
  isRuntimeSymbolContractDiagnostic,
  isRuntimeSymbolFallback,
  isRuntimeSymbolOverview,
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
  type RuntimeSymbolContractDiagnostic,
  type RuntimeSymbolFallback,
  type RuntimeSymbolNode,
  type RuntimeSymbolOverview,
} from "../runtime-core/index.js";

export const SYMBOL_CONTEXT_PROVIDER_ID = "symbol-readonly-shadow";

export type SymbolContextProviderOptions = {
  overviews?: readonly RuntimeSymbolOverview[];
  fallback?: RuntimeSymbolFallback;
  diagnostics?: readonly RuntimeSymbolContractDiagnostic[];
  groundingDiagnostics?: SymbolContextProviderGroundingDiagnosticsOptions;
  getOverviews?: (
    query: RuntimeContextProviderQuery,
    extras?: RuntimeContextProviderExtras,
  ) => readonly RuntimeSymbolOverview[] | undefined | Promise<readonly RuntimeSymbolOverview[] | undefined>;
};

export type SymbolContextProviderGroundingDiagnosticsOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: SYMBOL_CONTEXT_PROVIDER_ID,
  label: "Symbol readonly shadow provider",
};

export function createSymbolContextProvider(
  options: SymbolContextProviderOptions = {},
): RuntimeContextProvider {
  const manifest = {
    id: SYMBOL_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Symbol readonly shadow provider",
    description: "Readonly symbol overview/find/reference/checkpoint evidence for explicit shadow runs.",
    source: "runtime-core" as const,
    capabilities: ["context.symbol", "symbol.overview", "symbol.find", "symbol.references"],
    priority: 40,
    order: 40,
    permission: {
      decision: "allow" as const,
      capability: "context.symbol",
      reason: "Readonly symbol diagnostics/evidence only; no symbol edit or runtime authority.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["legacy_authoritative" as const, "capability_unsupported" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/runtime-core/symbols.ts",
      },
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/symbol-context-provider.ts",
      },
    ],
    outputKinds: ["symbol" as const, "summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: {
      readonlySymbolContext: true,
      shadowOnly: true,
      noSymbolMutation: true,
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
      const providerInput = await resolveSymbolProviderInput(options, query, extras);
      if (providerInput.fallback) {
        return withGroundingDiagnostics(providerResult({
          status: "fallback",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "fallback",
              reason: "capability_unsupported",
              message: providerInput.fallback.message,
              metadata: {
                shadowOnly: true,
                legacyAuthoritative: true,
                readonlySymbolContext: true,
                operation: providerInput.fallback.operation,
                symbolFallbackReason: providerInput.fallback.reason,
                retryable: providerInput.fallback.retryable,
                noSymbolMutation: true,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: true,
            shadowOnly: true,
            legacyAuthoritative: true,
            readonlySymbolContext: true,
            operation: providerInput.fallback.operation,
            symbolFallbackReason: providerInput.fallback.reason,
            contextItemCount: 0,
            noSymbolMutation: true,
            noPromptAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
          extraEvidenceRefs: providerInput.fallback.evidence,
        }), groundingSummary);
      }

      if (providerInput.overviews.length === 0) {
        return withGroundingDiagnostics(providerResult({
          status: "fallback",
          contextItems: [],
          diagnostics: [
            diagnostic({
              status: "skipped",
              reason: "no_result",
              message: "No readonly symbol overview was supplied for the shadow provider.",
              metadata: {
                shadowOnly: true,
                legacyAuthoritative: true,
                readonlySymbolContext: true,
                noSymbolMutation: true,
              },
            }),
          ],
          metadata: {
            providerId: manifest.id,
            enabled: true,
            shadowOnly: true,
            legacyAuthoritative: true,
            readonlySymbolContext: true,
            contextItemCount: 0,
            noSymbolMutation: true,
          },
          manifestEvidenceRefs: manifest.evidenceRefs,
        }), groundingSummary);
      }

      const symbols = providerInput.overviews.flatMap((overview) =>
        flattenRuntimeSymbols(overview.symbols)
      );
      const contextItems = symbols.map(symbolContextItem);
      const registryDiagnostics = [
        diagnostic({
          status: "fallback",
          reason: "legacy_authoritative",
          message: "Symbol readonly output is exposed as shadow diagnostics/evidence only.",
          metadata: {
            shadowOnly: true,
            legacyAuthoritative: true,
            readonlySymbolContext: true,
            overviewCount: providerInput.overviews.length,
            symbolCount: symbols.length,
            symbolDiagnosticCount: providerInput.diagnostics.length,
            noSymbolMutation: true,
            noPromptAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          },
        }),
        ...providerInput.diagnostics.map(symbolDiagnostic),
      ];
      return withGroundingDiagnostics(providerResult({
        status: "success",
        contextItems,
        diagnostics: registryDiagnostics,
        metadata: {
          providerId: manifest.id,
          enabled: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          readonlySymbolContext: true,
          overviewCount: providerInput.overviews.length,
          symbolCount: symbols.length,
          contextItemCount: contextItems.length,
          symbolDiagnosticCount: providerInput.diagnostics.length,
          noSymbolMutation: true,
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        },
        manifestEvidenceRefs: manifest.evidenceRefs,
      }), groundingSummary);
    },
  };
}

function groundingDiagnosticsSummary(
  options?: SymbolContextProviderGroundingDiagnosticsOptions,
): GroundingShadowConsumerSummary | undefined {
  if (options?.enabled !== true) {
    return undefined;
  }
  return createSymbolGroundingShadowSummary(options.refs ?? [], {
    enabled: true,
    query: options.query,
    limit: options.limit,
    tokenBudget: options.tokenBudget,
    metadata: {
      ...(options.metadata ?? {}),
      symbolGroundingDiagnostics: true,
      diagnosticsOnly: true,
      metadataOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
      noSymbolMutationAuthority: true,
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
    message: "Symbol context provider emitted grounding diagnostics-only summary metadata.",
    metadata: groundingDiagnosticsMetadata(summary),
  });
}

function groundingDiagnosticsMetadata(
  summary: GroundingShadowConsumerSummary,
): RuntimeCoreJsonObject {
  return {
    symbolGroundingDiagnostics: true,
    diagnosticsOnly: true,
    metadataOnly: true,
    noContextItemAuthority: true,
    noProviderResultAuthority: true,
    noSymbolMutationAuthority: true,
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

type SymbolProviderInput = {
  overviews: readonly RuntimeSymbolOverview[];
  fallback?: RuntimeSymbolFallback;
  diagnostics: readonly RuntimeSymbolContractDiagnostic[];
};

async function resolveSymbolProviderInput(
  options: SymbolContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): Promise<SymbolProviderInput> {
  const metadata = {
    ...recordFrom(query.metadata),
    ...recordFrom(extras?.metadata),
  };
  const fallback = firstSymbolFallback([
    metadata.symbolFallback,
    options.fallback,
  ]);
  const diagnostics = firstSymbolDiagnostics([
    metadata.symbolDiagnostics,
    options.diagnostics,
  ]);
  const metadataOverviews = symbolOverviewsFrom(metadata.symbolOverviews);
  const loadedOverviews = metadataOverviews ??
    (options.getOverviews ? await options.getOverviews(query, extras) : undefined);
  const overviews = symbolOverviewsFrom(loadedOverviews) ??
    symbolOverviewsFrom(options.overviews) ??
    [];

  return {
    overviews,
    ...(fallback ? { fallback } : {}),
    diagnostics,
  };
}

function symbolOverviewsFrom(value: unknown): readonly RuntimeSymbolOverview[] | undefined {
  return Array.isArray(value) && value.every(isRuntimeSymbolOverview)
    ? value
    : undefined;
}

function firstSymbolFallback(values: readonly unknown[]): RuntimeSymbolFallback | undefined {
  return values.find(isRuntimeSymbolFallback);
}

function firstSymbolDiagnostics(
  values: readonly unknown[],
): readonly RuntimeSymbolContractDiagnostic[] {
  const diagnostics = values.find((value) =>
    Array.isArray(value) && value.every(isRuntimeSymbolContractDiagnostic)
  );
  return Array.isArray(diagnostics) ? diagnostics : [];
}

function symbolContextItem(symbol: RuntimeSymbolNode): ContextItem {
  return {
    id: `${SYMBOL_CONTEXT_PROVIDER_ID}:symbol:${symbol.symbolId}`,
    kind: "symbol",
    text: symbolText(symbol),
    source: `symbol:${symbol.file}:${symbol.range.start.line}:${symbol.range.start.character}`,
    priority: symbol.namePath.length <= 1 ? "P1" : "P2",
    evidenceRefs: uniqueEvidenceRefs(symbol.evidence),
    metadata: {
      providerId: SYMBOL_CONTEXT_PROVIDER_ID,
      readonlySymbolContext: true,
      shadowOnly: true,
      legacyAuthoritative: true,
      symbolId: symbol.symbolId,
      name: symbol.name,
      namePath: symbol.namePath,
      kind: symbol.kind,
      file: symbol.file,
      range: symbol.range as never,
      childCount: symbol.children.length,
      noSymbolMutation: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function symbolText(symbol: RuntimeSymbolNode): string {
  return [
    `${symbol.namePath.join(".")} (${symbol.kind}) ${symbol.file}:${symbol.range.start.line}:${symbol.range.start.character}-${symbol.range.end.line}:${symbol.range.end.character}`,
    symbol.signature,
  ].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
}

function symbolDiagnostic(
  item: RuntimeSymbolContractDiagnostic,
): RuntimeRegistryDiagnostic {
  const metadata: RuntimeCoreJsonObject = {
    symbolDiagnosticCode: item.code,
    symbolDiagnosticSeverity: item.severity,
  };
  if (item.file) metadata.file = item.file;
  if (item.range) metadata.range = item.range as never;
  metadata.readonlySymbolContext = true;
  metadata.shadowOnly = true;
  return diagnostic({
    status: item.severity === "error" ? "error" : "fallback",
    reason: item.severity === "error" ? "provider_error" : "legacy_authoritative",
    message: item.message,
    metadata,
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
}): RuntimeRegistryDiagnostic {
  return {
    surface: "context",
    providerId: SYMBOL_CONTEXT_PROVIDER_ID,
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
