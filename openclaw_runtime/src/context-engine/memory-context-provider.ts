import {
  createRuntimeMemoryGroundingShadowSummary,
  findRuntimeMemoryFacts,
  resolveRuntimeMemoryFeatureFlags,
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
  type RuntimeMemoryContextProviderResult,
  type RuntimeMemoryFactQuery,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemorySummary,
  type RuntimeMemorySummaryItem,
  type RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";

export const RUNTIME_MEMORY_CONTEXT_PROVIDER_ID = "runtime-memory";

export type RuntimeMemoryContextProviderOptions = {
  facts?: readonly RuntimeMemoryQueryableFact[];
  queryFacts?: (
    query: RuntimeMemoryFactQuery,
  ) => readonly RuntimeMemoryQueryableFact[] | Promise<readonly RuntimeMemoryQueryableFact[]>;
  config?: unknown;
  defaultTokenBudget?: number;
  defaultLimit?: number;
  groundingDiagnostics?: RuntimeMemoryContextProviderGroundingDiagnosticsOptions;
};

export type RuntimeMemoryContextProviderGroundingDiagnosticsOptions = {
  enabled?: boolean;
  refs?: readonly GroundingRef[];
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

type MemoryProviderQuery = RuntimeMemoryFactQuery & {
  tokenBudget: number;
  file?: string;
  symbol?: string;
  candidateFactsRequested: boolean;
};

const DEFAULT_TOKEN_BUDGET = 256;
const DEFAULT_LIMIT = 24;
const TOKEN_CHAR_WIDTH = 4;
const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
  label: "Runtime memory context provider",
};

export function createRuntimeMemoryContextProvider(
  options: RuntimeMemoryContextProviderOptions = {},
): RuntimeContextProvider {
  const manifest = {
    id: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
    kind: "context" as const,
    title: "Runtime Memory Context Provider",
    description: "Readonly budgeted summaries of evidence-backed runtime memory facts.",
    source: "runtime-core" as const,
    capabilities: ["context.memory", "context.runtime-memory"],
    priority: 70,
    order: 70,
    permission: {
      decision: "allow" as const,
      capability: "context.memory",
      reason: "Readonly memory summaries only; no completion, verifier, tool, retry, security, or runtime authority.",
    },
    enabledByDefault: false,
    shadowOnly: true,
    fallbackReasons: ["flag_disabled" as const, "no_result" as const, "provider_error" as const],
    evidenceRefs: [
      {
        type: "file" as const,
        ref: "openclaw_runtime/src/context-engine/memory-context-provider.ts",
      },
    ],
    outputKinds: ["memory" as const, "summary" as const, "evidence" as const],
    dependsOnIndexing: false,
    metadata: {
      readonlyMemoryContext: true,
      noMemoryDump: true,
      noCompletionAuthority: true,
      noVerifierAuthority: true,
      noSecurityAuthority: true,
      noRetryAuthority: true,
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
      const flags = resolveRuntimeMemoryFeatureFlags(
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
              message: "Runtime memory context provider flag is disabled.",
              metadata: {
                shadowOnly: true,
                legacyBehaviorUnaffected: true,
                requiredFlag: "runtime.memory.provider",
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

      const providerQuery = memoryProviderQuery(options, query, extras);
      const facts = await readFacts(options, providerQuery);
      const rankedFacts = rankProviderFacts(
        findRuntimeMemoryFacts(facts, providerQuery),
        providerQuery,
      );
      const summary = buildSummary(rankedFacts, providerQuery);
      const contextItems = summary.items.map(toContextItem);

      return withGroundingDiagnostics(providerResult({
        status: "success",
        contextItems,
        diagnostics: [
          diagnostic({
            status: summary.items.length > 0 ? "ok" : "skipped",
            reason: summary.items.length > 0 ? "registered" : "no_result",
            message: summary.items.length > 0
              ? "Runtime memory context provider returned readonly budgeted context items."
              : "No matching runtime memory facts were found for the memory context query.",
            metadata: {
              contextItemCount: contextItems.length,
              omittedFactCount: summary.omittedFactCount,
              tokenBudget: providerQuery.tokenBudget,
              estimatedTokens: summary.estimatedTokens,
              candidateFactsRequested: providerQuery.candidateFactsRequested,
              readonlyMemoryContext: true,
              noMemoryDump: true,
              noCompletionAuthority: true,
              noVerifierAuthority: true,
              noSecurityAuthority: true,
              noRetryAuthority: true,
              noToolAuthority: true,
              noRuntimeAuthority: true,
            },
          }),
        ],
        metadata: {
          providerId: manifest.id,
          enabled: true,
          shadowOnly: true,
          readonlyMemoryContext: true,
          noMemoryDump: true,
          noCompletionAuthority: true,
          noVerifierAuthority: true,
          noSecurityAuthority: true,
          noRetryAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
          contextItemCount: contextItems.length,
          omittedFactCount: summary.omittedFactCount,
          tokenBudget: providerQuery.tokenBudget,
          estimatedTokens: summary.estimatedTokens,
          candidateFactsRequested: providerQuery.candidateFactsRequested,
        },
        manifestEvidenceRefs: manifest.evidenceRefs,
      }), groundingSummary);
    },
  };
}

export async function createRuntimeMemoryProviderResult(
  options: RuntimeMemoryContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): Promise<RuntimeMemoryContextProviderResult> {
  const providerQuery = memoryProviderQuery(options, query, extras);
  const facts = await readFacts(options, providerQuery);
  const summary = buildSummary(
    rankProviderFacts(findRuntimeMemoryFacts(facts, providerQuery), providerQuery),
    providerQuery,
  );
  const contextItems = summary.items.map(toContextItem);
  return {
    contextItems,
    summary,
    evidenceRefs: uniqueEvidenceRefs(contextItems.flatMap((item) => item.evidenceRefs)),
    readonly: true,
  };
}

function groundingDiagnosticsSummary(
  options?: RuntimeMemoryContextProviderGroundingDiagnosticsOptions,
): GroundingShadowConsumerSummary | undefined {
  if (options?.enabled !== true) {
    return undefined;
  }
  return createRuntimeMemoryGroundingShadowSummary(options.refs ?? [], {
    enabled: true,
    query: options.query,
    limit: options.limit,
    tokenBudget: options.tokenBudget,
    metadata: {
      ...(options.metadata ?? {}),
      runtimeMemoryGroundingDiagnostics: true,
      diagnosticsOnly: true,
      metadataOnly: true,
      noContextItemAuthority: true,
      noProviderResultAuthority: true,
      noPromptAuthority: true,
      noProviderOrderingAuthority: true,
      noDurableFactAuthority: true,
      noMemoryFactPromotionAuthority: true,
      noFactAcceptanceAuthority: true,
      noEpisodeWriteAuthority: true,
      noMemoryPersistenceAuthority: true,
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
    message: "Runtime memory context provider emitted grounding diagnostics-only summary metadata.",
    metadata: groundingDiagnosticsMetadata(summary),
  });
}

function groundingDiagnosticsMetadata(
  summary: GroundingShadowConsumerSummary,
): RuntimeCoreJsonObject {
  return {
    runtimeMemoryGroundingDiagnostics: true,
    diagnosticsOnly: true,
    metadataOnly: true,
    noContextItemAuthority: true,
    noProviderResultAuthority: true,
    noPromptAuthority: true,
    noProviderOrderingAuthority: true,
    noDurableFactAuthority: true,
    noMemoryFactPromotionAuthority: true,
    noFactAcceptanceAuthority: true,
    noEpisodeWriteAuthority: true,
    noMemoryPersistenceAuthority: true,
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
    resolveRuntimeMemoryFeatureFlags(candidate).provider
  ) ?? fallbackConfig;
}

function memoryProviderQuery(
  options: RuntimeMemoryContextProviderOptions,
  query: RuntimeContextProviderQuery,
  extras?: RuntimeContextProviderExtras,
): MemoryProviderQuery {
  const metadata = {
    ...recordFrom(query.metadata),
    ...recordFrom(extras?.metadata),
  };
  const memoryQuery = recordFrom(metadata.memoryQuery);
  const candidateFactsRequested =
    booleanFrom(memoryQuery.includeCandidates) === true ||
    booleanFrom(metadata.includeCandidates) === true ||
    stringArrayFrom(memoryQuery.verificationStatuses).includes("candidate") ||
    stringArrayFrom(metadata.verificationStatuses).includes("candidate");
  const tokenBudget = positiveInteger(
    query.tokenBudget,
    positiveInteger(metadata.tokenBudget, options.defaultTokenBudget ?? DEFAULT_TOKEN_BUDGET),
  );

  return {
    taskId: stringFrom(memoryQuery.taskId) ?? stringFrom(metadata.taskId) ?? query.taskId,
    subject: stringFrom(memoryQuery.subject) ?? stringFrom(metadata.subject),
    predicate: stringFrom(memoryQuery.predicate) ?? stringFrom(metadata.predicate),
    sourceEpisodeId: stringFrom(memoryQuery.sourceEpisodeId) ??
      stringFrom(metadata.sourceEpisodeId),
    evidenceRef: stringFrom(memoryQuery.evidenceRef) ?? stringFrom(metadata.evidenceRef),
    reference_time: numberFrom(memoryQuery.reference_time) ??
      numberFrom(metadata.reference_time),
    includeCandidates: candidateFactsRequested,
    includeRejected: booleanFrom(memoryQuery.includeRejected) === true ||
      booleanFrom(metadata.includeRejected) === true,
    includeInvalidated: booleanFrom(memoryQuery.includeInvalidated) === true ||
      booleanFrom(metadata.includeInvalidated) === true,
    includeExpired: booleanFrom(memoryQuery.includeExpired) === true ||
      booleanFrom(metadata.includeExpired) === true,
    verificationStatuses: verificationStatusesFrom(memoryQuery.verificationStatuses) ??
      verificationStatusesFrom(metadata.verificationStatuses),
    limit: positiveInteger(
      memoryQuery.limit,
      positiveInteger(metadata.limit, options.defaultLimit ?? DEFAULT_LIMIT),
    ),
    tokenBudget,
    file: stringFrom(memoryQuery.file) ?? stringFrom(metadata.file) ??
      query.activeFiles?.find(isPresentString),
    symbol: stringFrom(memoryQuery.symbol) ?? stringFrom(metadata.symbol),
    candidateFactsRequested,
  };
}

async function readFacts(
  options: RuntimeMemoryContextProviderOptions,
  query: RuntimeMemoryFactQuery,
): Promise<readonly RuntimeMemoryQueryableFact[]> {
  if (options.queryFacts) {
    return options.queryFacts(query);
  }
  return options.facts ?? [];
}

function buildSummary(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: MemoryProviderQuery,
): RuntimeMemorySummary {
  const items: RuntimeMemorySummaryItem[] = [];
  let estimatedTokens = 0;
  for (const fact of facts) {
    const item = summaryItem(fact, query);
    const nextTokens = estimateTokens(item.summary);
    if (estimatedTokens + nextTokens > query.tokenBudget) {
      if (items.length > 0 || query.tokenBudget === 0) {
        continue;
      }
      const truncated = {
        ...item,
        summary: truncateToTokenBudget(item.summary, query.tokenBudget),
      };
      items.push(truncated);
      estimatedTokens += estimateTokens(truncated.summary);
      continue;
    }
    items.push(item);
    estimatedTokens += nextTokens;
  }
  return {
    items,
    omittedFactCount: Math.max(0, facts.length - items.length),
    tokenBudget: query.tokenBudget,
    estimatedTokens,
    readonly: true,
  };
}

function summaryItem(
  fact: RuntimeMemoryQueryableFact,
  query: MemoryProviderQuery,
): RuntimeMemorySummaryItem {
  const item: RuntimeMemorySummaryItem = {
    factId: fact.factId,
    ...(fact.taskId ? { taskId: fact.taskId } : {}),
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    verificationStatus: fact.verificationStatus,
    valid_at: fact.valid_at,
    ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
    ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
    reference_time: fact.reference_time,
    sourceEpisodeRefs: fact.sourceEpisodeRefs,
    evidenceRefs: fact.evidenceRefs,
    rank: providerFactRank(fact, query),
    summary: contextText(fact, query),
  };
  return item;
}

function toContextItem(item: RuntimeMemorySummaryItem): ContextItem {
  return {
    id: `${RUNTIME_MEMORY_CONTEXT_PROVIDER_ID}:${item.factId}`,
    kind: "memory",
    text: item.summary,
    source: `runtime-memory:${item.factId}`,
    priority: itemPriority(item),
    evidenceRefs: contextEvidenceRefs(item),
    metadata: {
      providerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      factId: item.factId,
      ...(item.taskId ? { taskId: item.taskId } : {}),
      verificationStatus: item.verificationStatus,
      valid_at: item.valid_at,
      ...(item.invalid_at !== undefined ? { invalid_at: item.invalid_at } : {}),
      ...(item.expired_at !== undefined ? { expired_at: item.expired_at } : {}),
      reference_time: item.reference_time,
      sourceEpisodeIds: item.sourceEpisodeRefs.map((ref) => ref.episodeId),
      evidenceRefCount: item.evidenceRefs.length,
      rank: item.rank,
      readonlyMemoryContext: true,
      noMemoryDump: true,
      sourceRefsAreEvidenceLinksOnly: true,
      noCompletionAuthority: true,
      noVerifierAuthority: true,
      noSecurityAuthority: true,
      noRetryAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    },
  };
}

function contextText(
  fact: RuntimeMemoryQueryableFact,
  query: MemoryProviderQuery,
): string {
  const timeScope = query.reference_time !== undefined &&
    query.reference_time !== fact.reference_time
    ? "historical"
    : "current";
  const parts = [
    `${fact.verificationStatus} ${fact.subject} ${fact.predicate}`,
    fact.objectSummary,
    `time_scope=${timeScope}`,
    `valid_at=${fact.valid_at}`,
    `reference_time=${fact.reference_time}`,
  ];
  if (fact.invalid_at !== undefined) {
    parts.push(`invalid_at=${fact.invalid_at}`);
  }
  if (fact.expired_at !== undefined) {
    parts.push(`expired_at=${fact.expired_at}`);
  }
  if (fact.sourceEpisodeRefs.length > 0) {
    parts.push(
      `episodes=${fact.sourceEpisodeRefs.map((ref) => ref.episodeId).slice(0, 3).join(",")}`,
    );
  }
  if (fact.evidenceRefs.length > 0) {
    parts.push(
      `evidence=${fact.evidenceRefs.map((ref) => ref.ref).slice(0, 3).join(",")}`,
    );
  }
  return parts.join(" | ");
}

function contextEvidenceRefs(item: RuntimeMemorySummaryItem): EvidenceRef[] {
  return uniqueEvidenceRefs([
    {
      type: "other",
      ref: item.factId,
      label: "Runtime memory fact",
      summary: item.summary,
    },
    ...item.evidenceRefs,
  ]);
}

function itemPriority(item: RuntimeMemorySummaryItem): ContextItemPriority {
  if (item.verificationStatus === "verified") return "P1";
  if (item.verificationStatus === "human_approved") return "P1";
  return "P2";
}

function rankProviderFacts(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: MemoryProviderQuery,
): RuntimeMemoryQueryableFact[] {
  return [...facts]
    .map((fact, index) => ({
      fact,
      index,
      rank: providerFactRank(fact, query),
    }))
    .sort((left, right) => {
      const rank = right.rank - left.rank;
      if (rank !== 0) return rank;
      const time = right.fact.valid_at - left.fact.valid_at;
      if (time !== 0) return time;
      return left.index - right.index;
    })
    .map((entry) => entry.fact);
}

function providerFactRank(
  fact: RuntimeMemoryQueryableFact,
  query: MemoryProviderQuery,
): number {
  let rank = 0;
  if (fact.verificationStatus === "verified") rank += 1_000_000;
  if (fact.verificationStatus === "human_approved") rank += 900_000;
  if (fact.verificationStatus === "deterministic_rule") rank += 850_000;
  if (fact.evidenceRefs.length > 0) rank += 300_000;
  if (fact.sourceEpisodeRefs.length > 0) rank += 200_000;
  if (query.taskId !== undefined && fact.taskId === query.taskId) rank += 100_000;
  if (query.sourceEpisodeId !== undefined &&
    fact.sourceEpisodeRefs.some((ref) => ref.episodeId === query.sourceEpisodeId)) {
    rank += 95_000;
  }
  if (query.file !== undefined && factMatchesText(fact, query.file)) rank += 90_000;
  if (query.symbol !== undefined && factMatchesText(fact, query.symbol)) rank += 85_000;
  if (query.evidenceRef !== undefined &&
    fact.evidenceRefs.some((ref) => ref.ref === query.evidenceRef)) {
    rank += 80_000;
  }
  if (query.subject !== undefined && fact.subject === query.subject) rank += 60_000;
  if (query.predicate !== undefined && fact.predicate === query.predicate) rank += 40_000;
  if (fact.verificationStatus === "candidate") rank -= 100_000;
  return rank;
}

function factMatchesText(fact: RuntimeMemoryQueryableFact, value: string): boolean {
  const haystack = [
    fact.subject,
    fact.predicate,
    fact.objectSummary,
    ...fact.evidenceRefs.flatMap((ref) => [
      ref.ref,
      ref.label ?? "",
      ref.summary ?? "",
      JSON.stringify(ref.metadata ?? {}),
    ]),
    JSON.stringify(fact.metadata ?? {}),
  ].join("\n");
  return haystack.includes(value);
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
    providerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
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

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

function verificationStatusesFrom(
  value: unknown,
): RuntimeMemoryFactQuery["verificationStatuses"] | undefined {
  const values = stringArrayFrom(value).filter((item) =>
    item === "candidate" ||
    item === "verified" ||
    item === "human_approved" ||
    item === "deterministic_rule" ||
    item === "rejected" ||
    item === "invalidated"
  );
  return values.length > 0
    ? values as RuntimeMemoryFactQuery["verificationStatuses"]
    : undefined;
}

function isPresentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
