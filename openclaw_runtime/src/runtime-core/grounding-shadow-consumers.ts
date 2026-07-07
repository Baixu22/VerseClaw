import {
  GROUNDING_REF_AUTHORITY,
  GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET,
  isGroundingQuery,
  isGroundingRef,
  isGroundingSummaryItem,
  sanitizeGroundingMetadata,
  sanitizeGroundingQuery,
  sanitizeGroundingRef,
  summarizeGroundingRefs,
  type GroundingQuery,
  type GroundingRef,
  type GroundingRefAuthority,
  type GroundingSummaryItem,
} from "./grounding.js";
import {
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";

export const GROUNDING_SHADOW_CONSUMER_IDS = [
  "runtime-memory",
  "agent-map-readonly-shadow",
  "symbol-readonly-shadow",
  "runtime-trace-context",
] as const;

export type GroundingShadowConsumerId =
  (typeof GROUNDING_SHADOW_CONSUMER_IDS)[number] | (string & {});

export type GroundingShadowConsumerSummaryOptions = {
  enabled?: boolean;
  killSwitch?: boolean;
  consumerId?: GroundingShadowConsumerId;
  query?: GroundingQuery;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingShadowConsumerAdapterOptions = Omit<
  GroundingShadowConsumerSummaryOptions,
  "consumerId"
>;

export type GroundingShadowConsumerSummary = {
  readonly: true;
  localOnly: true;
  shadowOnly: true;
  diagnosticOnly: true;
  summaryOnly: true;
  nonAuthoritative: true;
  consumerId: GroundingShadowConsumerId;
  authority: GroundingRefAuthority;
  rawRetained: false;
  noRuntimeAuthority: true;
  noCompletionAuthority: true;
  noProviderOrderingAuthority: true;
  noMemoryPromotionAuthority: true;
  noPatchMutationAuthority: true;
  query: GroundingQuery;
  items: GroundingSummaryItem[];
  omittedRefCount: number;
  tokenBudget: number;
  estimatedTokens: number;
  metadata?: RuntimeCoreJsonObject;
};

export const GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID =
  "line-c.grounding.singleExplicitDiagnosticsOnlyConsumer" as const;

export type GroundingSingleExplicitDiagnosticsConsumerId =
  typeof GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID;

export type GroundingSingleExplicitDiagnosticsConsumerOptions = {
  enabled?: boolean;
  killSwitch?: boolean;
  consumerId?: GroundingShadowConsumerId;
  summary?: GroundingShadowConsumerSummary;
  limit?: number;
  tokenBudget?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingSingleExplicitDiagnosticsConsumerReport = {
  readonly: true;
  localOnly: true;
  explicitOnly: true;
  metadataOnly: true;
  diagnosticOnly: true;
  summaryOnly: true;
  nonAuthoritative: true;
  consumerId: GroundingSingleExplicitDiagnosticsConsumerId;
  sourceConsumerId?: GroundingShadowConsumerId;
  enabled: boolean;
  skipped: boolean;
  reason: string;
  authority: GroundingRefAuthority;
  rawRetained: false;
  includeRaw: false;
  includeUntrusted: false;
  noRuntimeAuthority: true;
  noPromptAuthority: true;
  noModelMessageAuthority: true;
  noGatewayAuthority: true;
  noTaskLoopAuthority: true;
  noRuntimeDecisionAuthority: true;
  noCompletionAuthority: true;
  noToolAuthority: true;
  noSecurityAuthority: true;
  noApprovalAuthority: true;
  noRetryAuthority: true;
  noProviderOrderingAuthority: true;
  noProviderSelectionAuthority: true;
  noMemoryPromotionAuthority: true;
  noFactAcceptanceAuthority: true;
  noEpisodeWriteAuthority: true;
  noPersistenceAuthority: true;
  noPatchMutationAuthority: true;
  noWorkspaceMutationAuthority: true;
  noSymbolMutationAuthority: true;
  query: GroundingQuery;
  items: GroundingSummaryItem[];
  inputItemCount: number;
  acceptedItemCount: number;
  omittedItemCount: number;
  tokenBudget: number;
  estimatedTokens: number;
  metadata?: RuntimeCoreJsonObject;
};

const DEFAULT_CONSUMER_ID = "grounding-shadow-consumer";
const DEFAULT_LIMIT = 8;
const SINGLE_EXPLICIT_CONSUMER_MAX_LIMIT = 16;
const SINGLE_EXPLICIT_CONSUMER_DEFAULT_TOKEN_BUDGET = 128;
const TOKEN_CHAR_WIDTH = 4;

export function isGroundingShadowConsumerId(
  value: unknown,
): value is GroundingShadowConsumerId {
  return isNonEmptyString(value);
}

export function isGroundingShadowConsumerSummary(
  value: unknown,
): value is GroundingShadowConsumerSummary {
  return (
    isRecord(value) &&
    value.readonly === true &&
    value.localOnly === true &&
    value.shadowOnly === true &&
    value.diagnosticOnly === true &&
    value.summaryOnly === true &&
    value.nonAuthoritative === true &&
    isGroundingShadowConsumerId(value.consumerId) &&
    value.authority === GROUNDING_REF_AUTHORITY &&
    value.rawRetained === false &&
    value.noRuntimeAuthority === true &&
    value.noCompletionAuthority === true &&
    value.noProviderOrderingAuthority === true &&
    value.noMemoryPromotionAuthority === true &&
    value.noPatchMutationAuthority === true &&
    isGroundingQuery(value.query) &&
    Array.isArray(value.items) &&
    value.items.every(isGroundingSummaryItem) &&
    isNonNegativeInteger(value.omittedRefCount) &&
    isNonNegativeInteger(value.tokenBudget) &&
    isNonNegativeInteger(value.estimatedTokens) &&
    Number(value.estimatedTokens) <= Number(value.tokenBudget) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isGroundingSingleExplicitDiagnosticsConsumerReport(
  value: unknown,
): value is GroundingSingleExplicitDiagnosticsConsumerReport {
  return (
    isRecord(value) &&
    value.readonly === true &&
    value.localOnly === true &&
    value.explicitOnly === true &&
    value.metadataOnly === true &&
    value.diagnosticOnly === true &&
    value.summaryOnly === true &&
    value.nonAuthoritative === true &&
    value.consumerId === GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID &&
    (value.sourceConsumerId === undefined ||
      isGroundingShadowConsumerId(value.sourceConsumerId)) &&
    typeof value.enabled === "boolean" &&
    typeof value.skipped === "boolean" &&
    isNonEmptyString(value.reason) &&
    value.authority === GROUNDING_REF_AUTHORITY &&
    value.rawRetained === false &&
    value.includeRaw === false &&
    value.includeUntrusted === false &&
    value.noRuntimeAuthority === true &&
    value.noPromptAuthority === true &&
    value.noModelMessageAuthority === true &&
    value.noGatewayAuthority === true &&
    value.noTaskLoopAuthority === true &&
    value.noRuntimeDecisionAuthority === true &&
    value.noCompletionAuthority === true &&
    value.noToolAuthority === true &&
    value.noSecurityAuthority === true &&
    value.noApprovalAuthority === true &&
    value.noRetryAuthority === true &&
    value.noProviderOrderingAuthority === true &&
    value.noProviderSelectionAuthority === true &&
    value.noMemoryPromotionAuthority === true &&
    value.noFactAcceptanceAuthority === true &&
    value.noEpisodeWriteAuthority === true &&
    value.noPersistenceAuthority === true &&
    value.noPatchMutationAuthority === true &&
    value.noWorkspaceMutationAuthority === true &&
    value.noSymbolMutationAuthority === true &&
    isGroundingQuery(value.query) &&
    Array.isArray(value.items) &&
    value.items.every(isGroundingSummaryItem) &&
    isNonNegativeInteger(value.inputItemCount) &&
    isNonNegativeInteger(value.acceptedItemCount) &&
    isNonNegativeInteger(value.omittedItemCount) &&
    isNonNegativeInteger(value.tokenBudget) &&
    isNonNegativeInteger(value.estimatedTokens) &&
    Number(value.estimatedTokens) <= Number(value.tokenBudget) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function createGroundingShadowConsumerSummary(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerSummaryOptions = {},
): GroundingShadowConsumerSummary {
  const consumerId = normalizeConsumerId(options.consumerId);
  const query = shadowConsumerQuery(options);
  const disabledReason = defaultOnDisabledReason(refs, options);
  const enabled = disabledReason === undefined;
  const acceptedRefs = refs.filter(isGroundingRef).map((ref) => sanitizeGroundingRef(ref));
  const summaryRefs = enabled ? acceptedRefs : [];
  const result = summarizeGroundingRefs(summaryRefs, query);
  const metadata = sanitizeGroundingMetadata({
    consumerId,
    defaultOnDiagnostics: true,
    enabled,
    skipped: !enabled,
    reason: enabled ? "default_on_diagnostics_summary" : disabledReason,
    inputRefCount: refs.length,
    acceptedRefCount: summaryRefs.length,
    invalidRefCount: enabled ? refs.length - acceptedRefs.length : 0,
    untrustedInputRefCount: summaryRefs.filter((ref) => ref.trust === "untrusted").length,
    untrustedExcluded: true,
    readonly: true,
    localOnly: true,
    shadowOnly: true,
    diagnosticOnly: true,
    summaryOnly: true,
    nonAuthoritative: true,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    noRuntimeAuthority: true,
    noCompletionAuthority: true,
    noProviderOrderingAuthority: true,
    noMemoryPromotionAuthority: true,
    noPatchMutationAuthority: true,
    groundingResultMetadata: result.metadata,
    ...(options.metadata ?? {}),
  });
  const summary: GroundingShadowConsumerSummary = {
    readonly: true,
    localOnly: true,
    shadowOnly: true,
    diagnosticOnly: true,
    summaryOnly: true,
    nonAuthoritative: true,
    consumerId,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    noRuntimeAuthority: true,
    noCompletionAuthority: true,
    noProviderOrderingAuthority: true,
    noMemoryPromotionAuthority: true,
    noPatchMutationAuthority: true,
    query: result.query,
    items: result.items,
    omittedRefCount: result.omittedRefCount,
    tokenBudget: result.tokenBudget,
    estimatedTokens: result.estimatedTokens,
    ...(metadata ? { metadata } : {}),
  };
  if (!isGroundingShadowConsumerSummary(summary)) {
    throw new Error("Invalid grounding shadow consumer summary");
  }
  return summary;
}

export function createSingleExplicitGroundingDiagnosticsConsumerReport(
  options: GroundingSingleExplicitDiagnosticsConsumerOptions,
): GroundingSingleExplicitDiagnosticsConsumerReport {
  const disabledReason = singleExplicitConsumerDisabledReason(options);
  if (disabledReason !== undefined) {
    return singleExplicitConsumerDisabledReport(disabledReason, options);
  }

  const sourceSummary = options.summary;
  if (!sourceSummary || !isGroundingShadowConsumerSummary(sourceSummary)) {
    return singleExplicitConsumerDisabledReport("invalid_summary", options);
  }
  const tokenBudget = singleExplicitTokenBudget(options, sourceSummary);
  const limit = singleExplicitLimit(options);
  const items = singleExplicitConsumerItems(sourceSummary.items, {
    limit,
    tokenBudget,
  });
  const metadata = singleExplicitConsumerMetadata({
    sourceSummary,
    options,
    enabled: true,
    skipped: false,
    reason: "explicit_diagnostics_summary",
    acceptedItemCount: items.items.length,
    inputItemCount: sourceSummary.items.length,
    omittedItemCount: sourceSummary.items.length - items.items.length,
  });
  const report: GroundingSingleExplicitDiagnosticsConsumerReport = {
    ...singleExplicitConsumerBase({
      sourceSummary,
      enabled: true,
      skipped: false,
      reason: "explicit_diagnostics_summary",
      query: sourceSummary.query,
    }),
    items: items.items,
    inputItemCount: sourceSummary.items.length,
    acceptedItemCount: items.items.length,
    omittedItemCount: sourceSummary.items.length - items.items.length,
    tokenBudget,
    estimatedTokens: items.estimatedTokens,
    ...(metadata ? { metadata } : {}),
  };
  if (!isGroundingSingleExplicitDiagnosticsConsumerReport(report)) {
    throw new Error("Invalid single explicit grounding diagnostics report");
  }
  return report;
}

export function createRuntimeMemoryGroundingShadowSummary(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerAdapterOptions = {},
): GroundingShadowConsumerSummary {
  return createGroundingShadowConsumerSummary(refs, {
    ...options,
    consumerId: "runtime-memory",
  });
}

export function createAgentMapGroundingShadowSummary(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerAdapterOptions = {},
): GroundingShadowConsumerSummary {
  return createGroundingShadowConsumerSummary(refs, {
    ...options,
    consumerId: "agent-map-readonly-shadow",
  });
}

export function createSymbolGroundingShadowSummary(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerAdapterOptions = {},
): GroundingShadowConsumerSummary {
  return createGroundingShadowConsumerSummary(refs, {
    ...options,
    consumerId: "symbol-readonly-shadow",
  });
}

export function createRuntimeTraceGroundingShadowSummary(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerAdapterOptions = {},
): GroundingShadowConsumerSummary {
  return createGroundingShadowConsumerSummary(refs, {
    ...options,
    consumerId: "runtime-trace-context",
  });
}

function singleExplicitConsumerDisabledReason(
  options: GroundingSingleExplicitDiagnosticsConsumerOptions,
): string | undefined {
  if (options.enabled === false) {
    return "flag_disabled";
  }
  if (options.killSwitch === true) {
    return "kill_switch";
  }
  if (options.consumerId === undefined) {
    return "missing_consumer_id";
  }
  if (options.consumerId !== GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID) {
    return "invalid_consumer_id";
  }
  if (!validOptionalNonNegativeInteger(options.limit) ||
    !validOptionalNonNegativeInteger(options.tokenBudget)) {
    return "invalid_config";
  }
  if (options.tokenBudget === 0) {
    return "budget_exhausted";
  }
  if (!isGroundingShadowConsumerSummary(options.summary)) {
    return "invalid_summary";
  }
  if (
    options.summary.authority !== GROUNDING_REF_AUTHORITY ||
    options.summary.rawRetained !== false ||
    options.summary.query.includeRaw !== false ||
    options.summary.query.includeUntrusted !== false ||
    options.summary.items.some((item) => item.trust === "untrusted")
  ) {
    return "invalid_summary_boundary";
  }
  return undefined;
}

function singleExplicitConsumerDisabledReport(
  reason: string,
  options: GroundingSingleExplicitDiagnosticsConsumerOptions,
): GroundingSingleExplicitDiagnosticsConsumerReport {
  const sourceSummary = isGroundingShadowConsumerSummary(options.summary)
    ? options.summary
    : undefined;
  const metadata = singleExplicitConsumerMetadata({
    sourceSummary,
    options,
    enabled: false,
    skipped: true,
    reason,
    acceptedItemCount: 0,
    inputItemCount: sourceSummary?.items.length ?? 0,
    omittedItemCount: 0,
  });
  const report: GroundingSingleExplicitDiagnosticsConsumerReport = {
    ...singleExplicitConsumerBase({
      sourceSummary,
      enabled: false,
      skipped: true,
      reason,
      query: disabledSingleExplicitQuery(),
    }),
    items: [],
    inputItemCount: sourceSummary?.items.length ?? 0,
    acceptedItemCount: 0,
    omittedItemCount: 0,
    tokenBudget: 0,
    estimatedTokens: 0,
    ...(metadata ? { metadata } : {}),
  };
  if (!isGroundingSingleExplicitDiagnosticsConsumerReport(report)) {
    throw new Error("Invalid disabled single explicit grounding diagnostics report");
  }
  return report;
}

function singleExplicitConsumerBase(params: {
  sourceSummary?: GroundingShadowConsumerSummary;
  enabled: boolean;
  skipped: boolean;
  reason: string;
  query: GroundingQuery;
}): Omit<
  GroundingSingleExplicitDiagnosticsConsumerReport,
  | "items"
  | "inputItemCount"
  | "acceptedItemCount"
  | "omittedItemCount"
  | "tokenBudget"
  | "estimatedTokens"
  | "metadata"
> {
  return {
    readonly: true,
    localOnly: true,
    explicitOnly: true,
    metadataOnly: true,
    diagnosticOnly: true,
    summaryOnly: true,
    nonAuthoritative: true,
    consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
    ...(params.sourceSummary
      ? { sourceConsumerId: params.sourceSummary.consumerId }
      : {}),
    enabled: params.enabled,
    skipped: params.skipped,
    reason: params.reason,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    includeRaw: false,
    includeUntrusted: false,
    noRuntimeAuthority: true,
    noPromptAuthority: true,
    noModelMessageAuthority: true,
    noGatewayAuthority: true,
    noTaskLoopAuthority: true,
    noRuntimeDecisionAuthority: true,
    noCompletionAuthority: true,
    noToolAuthority: true,
    noSecurityAuthority: true,
    noApprovalAuthority: true,
    noRetryAuthority: true,
    noProviderOrderingAuthority: true,
    noProviderSelectionAuthority: true,
    noMemoryPromotionAuthority: true,
    noFactAcceptanceAuthority: true,
    noEpisodeWriteAuthority: true,
    noPersistenceAuthority: true,
    noPatchMutationAuthority: true,
    noWorkspaceMutationAuthority: true,
    noSymbolMutationAuthority: true,
    query: singleExplicitConsumerQuery(params.query),
  };
}

function singleExplicitConsumerQuery(query: GroundingQuery): GroundingQuery {
  return sanitizeGroundingQuery({
    ...query,
    readonly: true,
    includeRaw: false,
    includeUntrusted: false,
    metadata: undefined,
  });
}

function singleExplicitConsumerItems(
  input: readonly GroundingSummaryItem[],
  params: { limit: number; tokenBudget: number },
): { items: GroundingSummaryItem[]; estimatedTokens: number } {
  const items: GroundingSummaryItem[] = [];
  let estimatedTokens = 0;
  for (const inputItem of input.slice(0, params.limit)) {
    if (inputItem.trust === "untrusted") {
      continue;
    }
    const rest = {
      id: inputItem.id,
      canonicalKey: inputItem.canonicalKey,
      kind: inputItem.kind,
      ref: inputItem.ref,
      ...(inputItem.label ? { label: inputItem.label } : {}),
      summary: inputItem.summary,
      trust: inputItem.trust,
      sourceSurface: inputItem.sourceSurface,
      sourceField: inputItem.sourceField,
      rank: inputItem.rank,
      ...(inputItem.timestamp !== undefined ? { timestamp: inputItem.timestamp } : {}),
    };
    const item = {
      ...rest,
      authority: GROUNDING_REF_AUTHORITY,
    };
    const nextTokens = estimateSingleExplicitTokens(item.summary);
    if (items.length > 0 && estimatedTokens + nextTokens > params.tokenBudget) {
      continue;
    }
    if (estimatedTokens + nextTokens > params.tokenBudget) {
      const summary = truncateSingleExplicitSummary(
        item.summary,
        params.tokenBudget - estimatedTokens,
      );
      if (!summary) {
        continue;
      }
      item.summary = summary;
    }
    if (!isGroundingSummaryItem(item)) {
      continue;
    }
    items.push(item);
    estimatedTokens += estimateSingleExplicitTokens(item.summary);
  }
  return { items, estimatedTokens };
}

function singleExplicitConsumerMetadata(params: {
  sourceSummary?: GroundingShadowConsumerSummary;
  options: GroundingSingleExplicitDiagnosticsConsumerOptions;
  enabled: boolean;
  skipped: boolean;
  reason: string;
  inputItemCount: number;
  acceptedItemCount: number;
  omittedItemCount: number;
}): RuntimeCoreJsonObject | undefined {
  return sanitizeGroundingMetadata({
    consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
    sourceConsumerId: params.sourceSummary?.consumerId,
    explicitDiagnosticsOnlyConsumer: true,
    explicitOnly: true,
    diagnosticsOnly: true,
    metadataOnly: true,
    readonly: true,
    localOnly: true,
    summaryOnly: true,
    diagnosticOnly: true,
    nonAuthoritative: true,
    enabled: params.enabled,
    skipped: params.skipped,
    reason: params.reason,
    inputItemCount: params.inputItemCount,
    acceptedItemCount: params.acceptedItemCount,
    omittedItemCount: params.omittedItemCount,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    includeRaw: false,
    includeUntrusted: false,
    noRuntimeAuthority: true,
    noPromptAuthority: true,
    noModelMessageAuthority: true,
    noGatewayAuthority: true,
    noTaskLoopAuthority: true,
    noRuntimeDecisionAuthority: true,
    noCompletionAuthority: true,
    noToolAuthority: true,
    noSecurityAuthority: true,
    noApprovalAuthority: true,
    noRetryAuthority: true,
    noProviderOrderingAuthority: true,
    noProviderSelectionAuthority: true,
    noMemoryPromotionAuthority: true,
    noFactAcceptanceAuthority: true,
    noEpisodeWriteAuthority: true,
    noPersistenceAuthority: true,
    noPatchMutationAuthority: true,
    noWorkspaceMutationAuthority: true,
    noSymbolMutationAuthority: true,
  });
}

function singleExplicitLimit(
  options: GroundingSingleExplicitDiagnosticsConsumerOptions,
): number {
  return Math.min(
    SINGLE_EXPLICIT_CONSUMER_MAX_LIMIT,
    Math.max(0, Math.floor(options.limit ?? DEFAULT_LIMIT)),
  );
}

function singleExplicitTokenBudget(
  options: GroundingSingleExplicitDiagnosticsConsumerOptions,
  sourceSummary: GroundingShadowConsumerSummary,
): number {
  return Math.max(
    0,
    Math.floor(
      options.tokenBudget ??
        Math.min(
          sourceSummary.tokenBudget,
          SINGLE_EXPLICIT_CONSUMER_DEFAULT_TOKEN_BUDGET,
        ),
    ),
  );
}

function disabledSingleExplicitQuery(): GroundingQuery {
  return sanitizeGroundingQuery({
    readonly: true,
    limit: 0,
    tokenBudget: 0,
    includeRaw: false,
    includeUntrusted: false,
  });
}

function estimateSingleExplicitTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}

function truncateSingleExplicitSummary(
  text: string,
  tokenBudget: number,
): string {
  return text.trim().slice(0, Math.max(0, tokenBudget * TOKEN_CHAR_WIDTH));
}

function shadowConsumerQuery(
  options: GroundingShadowConsumerSummaryOptions,
): GroundingQuery {
  return sanitizeGroundingQuery({
    readonly: true,
    ...(options.query ?? {}),
    limit: options.limit ?? options.query?.limit ?? DEFAULT_LIMIT,
    tokenBudget: options.tokenBudget ??
      options.query?.tokenBudget ??
      GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET,
    includeRaw: false,
    includeUntrusted: false,
  });
}

function defaultOnDisabledReason(
  refs: readonly GroundingRef[],
  options: GroundingShadowConsumerSummaryOptions,
): string | undefined {
  if (options.enabled === false) {
    return "flag_disabled";
  }
  if (options.killSwitch === true) {
    return "kill_switch";
  }
  if (refs.length === 0) {
    return "missing_refs";
  }
  if (!validOptionalNonNegativeInteger(options.limit) ||
    !validOptionalNonNegativeInteger(options.tokenBudget)) {
    return "invalid_config";
  }
  if (options.tokenBudget === 0) {
    return "budget_exhausted";
  }
  if (!refs.some(isGroundingRef)) {
    return "invalid_refs";
  }
  return undefined;
}

function normalizeConsumerId(
  value: GroundingShadowConsumerId | undefined,
): GroundingShadowConsumerId {
  if (!isGroundingShadowConsumerId(value)) {
    return DEFAULT_CONSUMER_ID;
  }
  const trimmed = value.trim();
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}
