import {
  createRuntimeMemoryGroundingShadowSummary,
  findRuntimeMemoryFacts,
  isEmbeddingProviderAvailable,
  resolveRuntimeMemoryFeatureFlags,
  DEFAULT_RUNTIME_MEMORY_TYPE,
  type ContextItem,
  type ContextItemPriority,
  type EmbeddingProviderOrNone,
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
  type RuntimeMemoryFactRelation,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryRelationType,
  type RuntimeMemorySummary,
  type RuntimeMemorySummaryItem,
  type RuntimeMemoryType,
  type RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";
import { hybridSearchFactsWithEmbedding } from "../runtime-core/memory-hybrid-retrieval.js";

export const RUNTIME_MEMORY_CONTEXT_PROVIDER_ID = "runtime-memory";

export type RuntimeMemoryContextProviderOptions = {
  facts?: readonly RuntimeMemoryQueryableFact[];
  queryFacts?: (
    query: RuntimeMemoryFactQuery,
  ) => readonly RuntimeMemoryQueryableFact[] | Promise<readonly RuntimeMemoryQueryableFact[]>;
  queryRelations?: (
    factId: string,
  ) =>
    | readonly RuntimeMemoryFactRelation[]
    | Promise<readonly RuntimeMemoryFactRelation[]>;
  embeddingProvider?: EmbeddingProviderOrNone;
  embeddingEnabled?: boolean;
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
const MAX_RELATION_EXPANSIONS = 2;

const RELATION_TYPE_PRIORITY: Record<RuntimeMemoryRelationType, number> = {
  supersedes: 3,
  contradicts: 2,
  related_to: 1,
};
const PROVIDER_EVIDENCE_REF: EvidenceRef = {
  type: "other",
  ref: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
  label: "Runtime memory context provider",
};

/**
 * Type-aware retrieval slots (Phase 4.3). Each memory type gets a dedicated
 * retrieval quota with a type-appropriate sort order, ensuring context
 * diversity — a single type can never monopolize the token budget.
 *
 * - `semantic`: 4 slots, sorted by importance (verification + evidence).
 *   Stable facts are always useful, so they get the largest quota.
 * - `episodic`: 2 slots, sorted by recency + relevance. Time-bound events
 *   are most valuable when recent.
 * - `procedural`: 2 slots, sorted by usage + relevance. Learned behaviors
 *   are scarce and high-value, so even 2 slots ensure they surface.
 *
 * Unused slots are redistributed to types that have more matching facts, so
 * total capacity is never wasted (e.g., if there are 0 episodic facts, the
 * 2 episodic slots go to semantic/procedural).
 */
const MEMORY_TYPE_SLOTS: Record<
  RuntimeMemoryType,
  { limit: number; sortBy: "importance" | "recency+relevance" | "usage+relevance" }
> = {
  semantic: { limit: 4, sortBy: "importance" },
  episodic: { limit: 2, sortBy: "recency+relevance" },
  procedural: { limit: 2, sortBy: "usage+relevance" },
};

const SLOT_PRIORITY_ORDER: readonly RuntimeMemoryType[] = [
  "procedural",
  "semantic",
  "episodic",
];

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
      const useEmbedding = options.embeddingEnabled === true &&
        options.embeddingProvider !== undefined &&
        isEmbeddingProviderAvailable(options.embeddingProvider);
      const matchedFacts = useEmbedding
        ? await findFactsWithEmbedding(options.embeddingProvider, facts, providerQuery)
        : findRuntimeMemoryFacts(facts, { ...providerQuery, limit: undefined });
      const rankedFacts = applyTypeAwareSlots(matchedFacts, providerQuery);
      const expandedFacts = options.queryRelations
        ? await expandOneHopRelations(rankedFacts, facts, options.queryRelations)
        : rankedFacts;
      const summary = buildSummary(expandedFacts, providerQuery);
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
  const useEmbedding = options.embeddingEnabled === true &&
    options.embeddingProvider !== undefined &&
    isEmbeddingProviderAvailable(options.embeddingProvider);
  const matchedFacts = useEmbedding
    ? await findFactsWithEmbedding(options.embeddingProvider, facts, providerQuery)
    : findRuntimeMemoryFacts(facts, { ...providerQuery, limit: undefined });
  const rankedFacts = applyTypeAwareSlots(matchedFacts, providerQuery);
  const expandedFacts = options.queryRelations
    ? await expandOneHopRelations(rankedFacts, facts, options.queryRelations)
    : rankedFacts;
  const summary = buildSummary(expandedFacts, providerQuery);
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

async function findFactsWithEmbedding(
  embeddingProvider: EmbeddingProviderOrNone,
  facts: readonly RuntimeMemoryQueryableFact[],
  query: MemoryProviderQuery,
): Promise<RuntimeMemoryQueryableFact[]> {
  const queryText = [query.subject, query.predicate, query.file, query.symbol]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
  if (queryText.trim().length === 0) {
    return findRuntimeMemoryFacts(facts, { ...query, limit: undefined });
  }
  try {
    const hits = await hybridSearchFactsWithEmbedding(
      facts,
      {
        queryText,
        referenceTime: query.reference_time || undefined,
        taskId: query.taskId,
        subject: query.subject,
        topK: query.limit || DEFAULT_LIMIT,
        includeCandidates: query.includeCandidates,
      },
      embeddingProvider,
    );
    return hits.map((hit) => hit.fact);
  } catch {
    return findRuntimeMemoryFacts(facts, { ...query, limit: undefined });
  }
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

function factMemoryType(fact: RuntimeMemoryQueryableFact): RuntimeMemoryType {
  return fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE;
}

function rankFactsForType(
  facts: readonly RuntimeMemoryQueryableFact[],
  memoryType: RuntimeMemoryType,
  query: MemoryProviderQuery,
): RuntimeMemoryQueryableFact[] {
  const ranked = [...facts].map((fact, index) => ({
    fact,
    index,
    rank: providerFactRank(fact, query),
    validAt: fact.valid_at,
  }));

  if (memoryType === "episodic") {
    ranked.sort((a, b) => {
      const time = b.validAt - a.validAt;
      if (time !== 0) return time;
      const rank = b.rank - a.rank;
      if (rank !== 0) return rank;
      return a.index - b.index;
    });
  } else {
    ranked.sort((a, b) => {
      const rank = b.rank - a.rank;
      if (rank !== 0) return rank;
      const time = b.validAt - a.validAt;
      if (time !== 0) return time;
      return a.index - b.index;
    });
  }

  return ranked.map((entry) => entry.fact);
}

function applyTypeAwareSlots(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: MemoryProviderQuery,
): RuntimeMemoryQueryableFact[] {
  if (facts.length === 0) return [];

  const overallLimit = query.limit ?? DEFAULT_LIMIT;

  const byType = new Map<RuntimeMemoryType, RuntimeMemoryQueryableFact[]>();
  for (const fact of facts) {
    const type = factMemoryType(fact);
    const list = byType.get(type);
    if (list) {
      list.push(fact);
    } else {
      byType.set(type, [fact]);
    }
  }

  const sortedByType = new Map<RuntimeMemoryType, RuntimeMemoryQueryableFact[]>();
  for (const [type, typeFacts] of byType) {
    sortedByType.set(type, rankFactsForType(typeFacts, type, query));
  }

  const takenPerType = new Map<RuntimeMemoryType, number>();
  for (const type of SLOT_PRIORITY_ORDER) {
    takenPerType.set(type, 0);
  }

  const result: RuntimeMemoryQueryableFact[] = [];

  for (const type of SLOT_PRIORITY_ORDER) {
    const sorted = sortedByType.get(type) ?? [];
    const slotLimit = Math.min(MEMORY_TYPE_SLOTS[type].limit, sorted.length);
    for (let i = 0; i < slotLimit && result.length < overallLimit; i++) {
      result.push(sorted[i]);
      takenPerType.set(type, i + 1);
    }
  }

  let remaining = overallLimit - result.length;
  while (remaining > 0) {
    let added = false;
    for (const type of SLOT_PRIORITY_ORDER) {
      if (remaining <= 0) break;
      const sorted = sortedByType.get(type) ?? [];
      const taken = takenPerType.get(type) ?? 0;
      if (taken < sorted.length) {
        result.push(sorted[taken]);
        takenPerType.set(type, taken + 1);
        remaining--;
        added = true;
      }
    }
    if (!added) break;
  }

  return result;
}

async function expandOneHopRelations(
  rankedFacts: readonly RuntimeMemoryQueryableFact[],
  allFacts: readonly RuntimeMemoryQueryableFact[],
  queryRelations: (factId: string) =>
    | readonly RuntimeMemoryFactRelation[]
    | Promise<readonly RuntimeMemoryFactRelation[]>,
): Promise<RuntimeMemoryQueryableFact[]> {
  if (rankedFacts.length === 0) return [...rankedFacts];

  const existingIds = new Set(rankedFacts.map((f) => f.factId));
  const factsById = new Map(allFacts.map((f) => [f.factId, f]));

  type Candidate = {
    fact: RuntimeMemoryQueryableFact;
    relationType: RuntimeMemoryRelationType;
    confidence: number;
  };
  const candidates: Candidate[] = [];
  const seenCandidateIds = new Set<string>();

  for (const fact of rankedFacts) {
    const relations = await queryRelations(fact.factId);
    for (const rel of relations) {
      const relatedId = rel.sourceFactId === fact.factId
        ? rel.targetFactId
        : rel.targetFactId === fact.factId
          ? rel.sourceFactId
          : undefined;
      if (relatedId === undefined) continue;
      if (existingIds.has(relatedId)) continue;
      if (seenCandidateIds.has(relatedId)) continue;
      const relatedFact = factsById.get(relatedId);
      if (relatedFact === undefined) continue;
      seenCandidateIds.add(relatedId);
      candidates.push({
        fact: relatedFact,
        relationType: rel.relationType,
        confidence: rel.confidence,
      });
    }
  }

  candidates.sort((a, b) => {
    const priority = RELATION_TYPE_PRIORITY[b.relationType] - RELATION_TYPE_PRIORITY[a.relationType];
    if (priority !== 0) return priority;
    return b.confidence - a.confidence;
  });

  const expanded = candidates
    .slice(0, MAX_RELATION_EXPANSIONS)
    .map((c) => c.fact);

  return [...rankedFacts, ...expanded];
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
