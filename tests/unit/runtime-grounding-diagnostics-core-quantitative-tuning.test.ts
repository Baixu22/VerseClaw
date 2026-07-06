import { describe, expect, it } from "vitest";
import {
  buildGroundingRefFixture,
  createGroundingShadowConsumerSummary,
  createSingleExplicitGroundingDiagnosticsConsumerReport,
  GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
  isGroundingSingleExplicitDiagnosticsConsumerReport,
  type GroundingShadowConsumerSummary,
  type GroundingSingleExplicitDiagnosticsConsumerOptions,
  type GroundingSingleExplicitDiagnosticsConsumerReport,
  type RuntimeCoreJsonObject,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_SENTINEL = "RAW_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const PROMPT_SENTINEL = "PROMPT_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const MODEL_MESSAGE_SENTINEL =
  "MODEL_MESSAGE_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const PROVIDER_SENTINEL =
  "PROVIDER_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const GATEWAY_SENTINEL =
  "GATEWAY_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const TASK_LOOP_SENTINEL =
  "TASK_LOOP_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const RUNTIME_DECISION_SENTINEL =
  "RUNTIME_DECISION_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const PERSISTENCE_SENTINEL =
  "PERSISTENCE_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const MEMORY_SENTINEL =
  "MEMORY_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const MUTATION_SENTINEL =
  "MUTATION_QUANTITATIVE_GROUNDING_SHOULD_NOT_SURVIVE";
const SOURCE_METADATA_SENTINEL =
  "SAFE_SOURCE_METADATA_FOR_QUANTITATIVE_DROP_SHOULD_NOT_SURVIVE";
const QUERY_METADATA_SENTINEL =
  "SAFE_QUERY_METADATA_FOR_QUANTITATIVE_DROP_SHOULD_NOT_SURVIVE";
const SOURCE_OPTIONS_METADATA_SENTINEL =
  "SAFE_SOURCE_OPTIONS_METADATA_FOR_QUANTITATIVE_DROP_SHOULD_NOT_SURVIVE";
const REPORT_OPTIONS_METADATA_SENTINEL =
  "SAFE_REPORT_OPTIONS_METADATA_FOR_QUANTITATIVE_DROP_SHOULD_NOT_SURVIVE";

const LEAKAGE_NEEDLES = [
  RAW_SENTINEL,
  PROMPT_SENTINEL,
  MODEL_MESSAGE_SENTINEL,
  PROVIDER_SENTINEL,
  GATEWAY_SENTINEL,
  TASK_LOOP_SENTINEL,
  RUNTIME_DECISION_SENTINEL,
  PERSISTENCE_SENTINEL,
  MEMORY_SENTINEL,
  MUTATION_SENTINEL,
  "rawPrompt",
  "promptPayload",
  "modelMessages",
  "providerOrdering\"",
  "providerSelection\"",
  "gatewayRequest",
  "taskLoopIntegration",
  "runtimeDecision",
  "persistenceWrite",
  "memoryWrite",
  "patchApply",
  "workspaceEdit",
  "symbolMutation",
  "includeRaw\":true",
  "includeUntrusted\":true",
] as const;

const METADATA_DROP_NEEDLES = [
  SOURCE_METADATA_SENTINEL,
  QUERY_METADATA_SENTINEL,
  SOURCE_OPTIONS_METADATA_SENTINEL,
  REPORT_OPTIONS_METADATA_SENTINEL,
] as const;

const REQUIRED_AUTHORITY_MARKERS = {
  readonly: true,
  localOnly: true,
  explicitOnly: true,
  metadataOnly: true,
  diagnosticOnly: true,
  summaryOnly: true,
  nonAuthoritative: true,
  authority: "none",
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
} as const;

type CorpusExpectation = "accepted" | "fail_closed" | "rollback";

type CorpusCase = {
  name: string;
  expectation: CorpusExpectation;
  expectedReason: string;
  options: GroundingSingleExplicitDiagnosticsConsumerOptions;
  maxItems: number;
  maxTokens: number;
};

type Observation = CorpusCase & {
  report: GroundingSingleExplicitDiagnosticsConsumerReport;
  serialized: string;
};

type QuantitativeMetrics = {
  corpusSize: number;
  passCount: number;
  failCount: number;
  acceptedSanitizedSummaryCount: number;
  rejectedInvalidMissingWrongConsumerSummaryCount: number;
  failClosedRate: number;
  leakageCount: number;
  includeRawFalseRate: number;
  includeUntrustedFalseRate: number;
  authorityMarkerCompletenessScore: number;
  metadataDropRate: number;
  boundedItemCount: number;
  boundedEstimatedTokenCount: number;
  boundednessPassRate: number;
  sourceMetadataDropRate: number;
  untrustedExclusionRate: number;
  rollbackParityRate: number;
  deterministicStabilityRate: number;
  duplicateCanonicalInputCount: number;
  omittedItemCount: number;
  performanceNoiseObservations: {
    repeatedRunCount: number;
    maxReportItemCount: number;
    maxSerializedReportBytes: number;
    diagnosticsOnlyNoiseScore: number;
  };
  optimizationRecommendations: {
    keep: string[];
    tighten: string[];
    remove: string[];
    defer: string[];
  };
};

describe("runtime grounding diagnostics core quantitative tuning", () => {
  it("quantifies diagnostics-only quality without expanding runtime authority", () => {
    const scorecard = buildQuantitativeScorecard();

    expect(scorecard.metrics).toMatchObject({
      corpusSize: 12,
      passCount: 12,
      failCount: 0,
      acceptedSanitizedSummaryCount: 2,
      rejectedInvalidMissingWrongConsumerSummaryCount: 8,
      failClosedRate: 1,
      leakageCount: 0,
      includeRawFalseRate: 1,
      includeUntrustedFalseRate: 1,
      authorityMarkerCompletenessScore: 1,
      metadataDropRate: 1,
      boundedItemCount: 2,
      boundedEstimatedTokenCount: 8,
      boundednessPassRate: 1,
      sourceMetadataDropRate: 1,
      untrustedExclusionRate: 1,
      rollbackParityRate: 1,
      deterministicStabilityRate: 1,
      duplicateCanonicalInputCount: 1,
      omittedItemCount: 1,
      performanceNoiseObservations: expect.objectContaining({
        repeatedRunCount: 3,
        maxReportItemCount: 2,
        diagnosticsOnlyNoiseScore: 1,
      }),
      optimizationRecommendations: {
        keep: [
          "single explicit diagnostics-only consumer id",
          "source/query/item/options metadata drop",
          "fail-closed disabled reports",
        ],
        tighten: [
          "keep quantitative corpus in focused unit coverage before wider proposals",
        ],
        remove: [],
        defer: [
          "formal runtime use",
          "prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration",
          "persistence, memory write, mutation, UI/API/transport, and production rollout",
        ],
      },
    });
    expect(
      scorecard.metrics.performanceNoiseObservations.maxSerializedReportBytes,
    ).toBeLessThanOrEqual(4_096);

    for (const observation of scorecard.observations) {
      expect(isGroundingSingleExplicitDiagnosticsConsumerReport(observation.report))
        .toBe(true);
      expect(observation.report.reason).toBe(observation.expectedReason);
      expect(observation.report.items.length).toBeLessThanOrEqual(
        observation.maxItems,
      );
      expect(observation.report.estimatedTokens).toBeLessThanOrEqual(
        observation.maxTokens,
      );
      expect(observation.report.includeRaw).toBe(false);
      expect(observation.report.includeUntrusted).toBe(false);
      expect(observation.report.query.includeRaw).toBe(false);
      expect(observation.report.query.includeUntrusted).toBe(false);
      expect(leakageCount([observation], LEAKAGE_NEEDLES)).toBe(0);
    }
  });
});

function buildQuantitativeScorecard(): {
  observations: Observation[];
  metrics: QuantitativeMetrics;
} {
  const observations = buildObservations();
  const repeatedSerializations = Array.from({ length: 3 }, () =>
    serializeReports(buildObservations())
  );
  const baselineSerialization = serializeReports(observations);
  const metrics = computeMetrics({
    observations,
    repeatedSerializations,
    baselineSerialization,
  });
  return { observations, metrics };
}

function buildObservations(): Observation[] {
  return buildCorpusCases().map((item) => {
    const report = createSingleExplicitGroundingDiagnosticsConsumerReport(
      item.options,
    );
    return {
      ...item,
      report,
      serialized: JSON.stringify(report),
    };
  });
}

function buildCorpusCases(): CorpusCase[] {
  const basicSummary = sourceSummary({
    id: "accepted_basic",
    trustedCount: 3,
    duplicateFirstCanonicalKey: true,
  });
  const boundedSummary = sourceSummary({
    id: "accepted_bounded",
    trustedCount: 2,
    longSummaries: true,
  });
  const failClosedSummary = sourceSummary({
    id: "fail_closed",
    trustedCount: 1,
  });

  return [
    {
      name: "accepted sanitized summary",
      expectation: "accepted",
      expectedReason: "explicit_diagnostics_summary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: basicSummary,
        limit: 2,
        tokenBudget: 32,
        metadata: reportOptionsMetadata("accepted-basic"),
      },
      maxItems: 2,
      maxTokens: 32,
    },
    {
      name: "accepted bounded sanitized summary",
      expectation: "accepted",
      expectedReason: "explicit_diagnostics_summary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: boundedSummary,
        limit: 3,
        tokenBudget: 8,
        metadata: reportOptionsMetadata("accepted-bounded"),
      },
      maxItems: 3,
      maxTokens: 8,
    },
    {
      name: "missing explicit consumer id",
      expectation: "fail_closed",
      expectedReason: "missing_consumer_id",
      options: {
        summary: failClosedSummary,
        metadata: reportOptionsMetadata("missing-consumer"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "wrong explicit consumer id",
      expectation: "fail_closed",
      expectedReason: "invalid_consumer_id",
      options: {
        consumerId: "line-c.grounding.wrongQuantitativeConsumer",
        summary: failClosedSummary,
        metadata: reportOptionsMetadata("wrong-consumer"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "missing summary",
      expectation: "fail_closed",
      expectedReason: "invalid_summary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        metadata: reportOptionsMetadata("missing-summary"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "invalid summary shape",
      expectation: "fail_closed",
      expectedReason: "invalid_summary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: { readonly: true } as never,
        metadata: reportOptionsMetadata("invalid-summary"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "raw summary includeRaw attempt",
      expectation: "fail_closed",
      expectedReason: "invalid_summary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: {
          ...failClosedSummary,
          query: { ...failClosedSummary.query, includeRaw: true },
        } as never,
        metadata: reportOptionsMetadata("raw-summary"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "untrusted item summary boundary attempt",
      expectation: "fail_closed",
      expectedReason: "invalid_summary_boundary",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: untrustedItemSummary(failClosedSummary),
        metadata: reportOptionsMetadata("untrusted-item"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "invalid config",
      expectation: "fail_closed",
      expectedReason: "invalid_config",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: failClosedSummary,
        limit: -1,
        metadata: reportOptionsMetadata("invalid-config"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "budget exhausted",
      expectation: "fail_closed",
      expectedReason: "budget_exhausted",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: failClosedSummary,
        tokenBudget: 0,
        metadata: reportOptionsMetadata("budget-exhausted"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "explicit disabled rollback",
      expectation: "rollback",
      expectedReason: "flag_disabled",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: failClosedSummary,
        enabled: false,
        metadata: reportOptionsMetadata("disabled"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
    {
      name: "kill switch rollback",
      expectation: "rollback",
      expectedReason: "kill_switch",
      options: {
        consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        summary: failClosedSummary,
        killSwitch: true,
        metadata: reportOptionsMetadata("kill-switch"),
      },
      maxItems: 0,
      maxTokens: 0,
    },
  ];
}

function computeMetrics(params: {
  observations: readonly Observation[];
  baselineSerialization: string;
  repeatedSerializations: readonly string[];
}): QuantitativeMetrics {
  const accepted = params.observations.filter((item) =>
    item.expectation === "accepted"
  );
  const failClosed = params.observations.filter((item) =>
    item.expectation === "fail_closed" || item.expectation === "rollback"
  );
  const failClosedPassCount = failClosed.filter((item) =>
    item.report.enabled === false &&
    item.report.skipped === true &&
    item.report.items.length === 0 &&
    item.report.acceptedItemCount === 0 &&
    item.report.tokenBudget === 0 &&
    item.report.estimatedTokens === 0
  ).length;
  const passCount = params.observations.filter(observationPassed).length;
  const authorityMarkers = authorityMarkerCounts(params.observations);
  const metadataDrop = metadataDropCounts(params.observations);
  const rollback = rollbackReports(params.observations);
  const maxSerializedReportBytes = Math.max(
    ...params.observations.map((item) => item.serialized.length),
  );

  return {
    corpusSize: params.observations.length,
    passCount,
    failCount: params.observations.length - passCount,
    acceptedSanitizedSummaryCount: accepted.filter((item) =>
      item.report.enabled === true &&
      item.report.acceptedItemCount > 0 &&
      item.report.reason === "explicit_diagnostics_summary"
    ).length,
    rejectedInvalidMissingWrongConsumerSummaryCount: params.observations.filter(
      (item) => item.expectation === "fail_closed",
    ).length,
    failClosedRate: rate(failClosedPassCount, failClosed.length),
    leakageCount: leakageCount(params.observations, LEAKAGE_NEEDLES),
    includeRawFalseRate: rate(
      params.observations.filter((item) =>
        item.report.includeRaw === false &&
        item.report.query.includeRaw === false
      ).length,
      params.observations.length,
    ),
    includeUntrustedFalseRate: rate(
      params.observations.filter((item) =>
        item.report.includeUntrusted === false &&
        item.report.query.includeUntrusted === false
      ).length,
      params.observations.length,
    ),
    authorityMarkerCompletenessScore: rate(
      authorityMarkers.observed,
      authorityMarkers.expected,
    ),
    metadataDropRate: rate(metadataDrop.dropped, metadataDrop.expected),
    boundedItemCount: Math.max(
      ...params.observations.map((item) => item.report.items.length),
    ),
    boundedEstimatedTokenCount: Math.max(
      ...params.observations.map((item) => item.report.estimatedTokens),
    ),
    boundednessPassRate: rate(
      params.observations.filter((item) =>
        item.report.items.length <= item.maxItems &&
        item.report.estimatedTokens <= item.maxTokens
      ).length,
      params.observations.length,
    ),
    sourceMetadataDropRate: rate(
      accepted.filter(sourceMetadataDropped).length,
      accepted.length,
    ),
    untrustedExclusionRate: rate(
      params.observations.filter((item) =>
        item.report.items.every((summaryItem) => summaryItem.trust !== "untrusted")
      ).length,
      params.observations.length,
    ),
    rollbackParityRate: rollback ? (rollbackParity(rollback) ? 1 : 0) : 0,
    deterministicStabilityRate: rate(
      params.repeatedSerializations.filter((item) =>
        item === params.baselineSerialization
      ).length,
      params.repeatedSerializations.length,
    ),
    duplicateCanonicalInputCount: 1,
    omittedItemCount: accepted.reduce(
      (sum, item) => sum + item.report.omittedItemCount,
      0,
    ),
    performanceNoiseObservations: {
      repeatedRunCount: params.repeatedSerializations.length,
      maxReportItemCount: Math.max(
        ...params.observations.map((item) => item.report.items.length),
      ),
      maxSerializedReportBytes,
      diagnosticsOnlyNoiseScore: maxSerializedReportBytes <= 4_096 ? 1 : 0,
    },
    optimizationRecommendations: {
      keep: [
        "single explicit diagnostics-only consumer id",
        "source/query/item/options metadata drop",
        "fail-closed disabled reports",
      ],
      tighten: [
        "keep quantitative corpus in focused unit coverage before wider proposals",
      ],
      remove: [],
      defer: [
        "formal runtime use",
        "prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration",
        "persistence, memory write, mutation, UI/API/transport, and production rollout",
      ],
    },
  };
}

function observationPassed(item: Observation): boolean {
  const validReport = isGroundingSingleExplicitDiagnosticsConsumerReport(
    item.report,
  );
  const reasonMatches = item.report.reason === item.expectedReason;
  const bounded = item.report.items.length <= item.maxItems &&
    item.report.estimatedTokens <= item.maxTokens;
  const noLeakage = leakageCount([item], LEAKAGE_NEEDLES) === 0;
  if (item.expectation === "accepted") {
    return validReport &&
      reasonMatches &&
      bounded &&
      noLeakage &&
      item.report.enabled === true &&
      item.report.skipped === false &&
      item.report.acceptedItemCount > 0;
  }
  return validReport &&
    reasonMatches &&
    bounded &&
    noLeakage &&
    item.report.enabled === false &&
    item.report.skipped === true &&
    item.report.items.length === 0 &&
    item.report.acceptedItemCount === 0 &&
    item.report.tokenBudget === 0 &&
    item.report.estimatedTokens === 0;
}

function sourceSummary(params: {
  id: string;
  trustedCount: number;
  duplicateFirstCanonicalKey?: boolean;
  longSummaries?: boolean;
}): GroundingShadowConsumerSummary {
  const refs = Array.from({ length: params.trustedCount }, (_, index) => {
    const canonicalKey =
      params.duplicateFirstCanonicalKey === true && index === params.trustedCount - 1
        ? `symbol:${params.id}:0`
        : `symbol:${params.id}:${index}`;
    return buildGroundingRefFixture({
      id: `${params.id}_trusted_${index}`,
      canonicalKey,
      kind: "symbol",
      ref: `src/QuantitativeGrounding.ts#${params.id}_${index}`,
      summary: params.longSummaries === true
        ? `Long bounded summary ${index} ${"x".repeat(160)}`
        : `Summary ${index}.`,
      trust: "supplied",
      metadata: sourceMetadata(`${params.id}-trusted-${index}`) as never,
    });
  });
  const untrusted = buildGroundingRefFixture({
    id: `${params.id}_untrusted`,
    canonicalKey: `trace:${params.id}:untrusted`,
    ref: `trace:${params.id}:untrusted`,
    trust: "untrusted",
    metadata: sourceMetadata(`${params.id}-untrusted`) as never,
  });

  return createGroundingShadowConsumerSummary([...refs, untrusted], {
    consumerId: `source-${params.id}`,
    limit: 8,
    tokenBudget: 128,
    query: {
      readonly: true,
      includeRaw: true,
      includeUntrusted: true,
      metadata: {
        queryMarker: QUERY_METADATA_SENTINEL,
        ...hostileBoundaryMetadata("query"),
      },
    } as never,
    metadata: {
      sourceOptionsMarker: SOURCE_OPTIONS_METADATA_SENTINEL,
      ...hostileBoundaryMetadata("source-options"),
    } as never,
  });
}

function untrustedItemSummary(
  source: GroundingShadowConsumerSummary,
): GroundingShadowConsumerSummary {
  const item = source.items[0];
  if (!item) {
    throw new Error("Expected source summary item for untrusted boundary case.");
  }
  return {
    ...source,
    items: [{
      ...item,
      id: "untrusted_summary_item",
      canonicalKey: "trace:untrusted_summary_item",
      ref: "trace:untrusted_summary_item",
      trust: "untrusted",
    }],
    omittedRefCount: 0,
  };
}

function reportOptionsMetadata(location: string): RuntimeCoreJsonObject {
  return {
    reportOptionsMarker: REPORT_OPTIONS_METADATA_SENTINEL,
    ...hostileBoundaryMetadata(`report-options-${location}`),
  } as never;
}

function sourceMetadata(location: string): RuntimeCoreJsonObject {
  return {
    sourceMarker: SOURCE_METADATA_SENTINEL,
    location,
    ...hostileBoundaryMetadata(`source-${location}`),
  } as never;
}

function hostileBoundaryMetadata(location: string): RuntimeCoreJsonObject {
  return {
    location,
    rawPrompt: RAW_SENTINEL,
    rawTrace: RAW_SENTINEL,
    fullPayload: RAW_SENTINEL,
    toolArgs: RAW_SENTINEL,
    stdout: RAW_SENTINEL,
    stderr: RAW_SENTINEL,
    env: RAW_SENTINEL,
    secret: RAW_SENTINEL,
    apiKey: RAW_SENTINEL,
    authHeader: RAW_SENTINEL,
    traceparent: RAW_SENTINEL,
    tracestate: RAW_SENTINEL,
    baggage: RAW_SENTINEL,
    promptPayload: PROMPT_SENTINEL,
    modelMessages: [MODEL_MESSAGE_SENTINEL],
    providerOrdering: [PROVIDER_SENTINEL],
    providerSelection: PROVIDER_SENTINEL,
    gatewayRequest: GATEWAY_SENTINEL,
    taskLoopIntegration: TASK_LOOP_SENTINEL,
    runtimeDecision: RUNTIME_DECISION_SENTINEL,
    persistenceWrite: PERSISTENCE_SENTINEL,
    memoryWrite: MEMORY_SENTINEL,
    patchApply: MUTATION_SENTINEL,
    workspaceEdit: MUTATION_SENTINEL,
    symbolMutation: MUTATION_SENTINEL,
    runtimeAuthorityAttempt: "runtimeAuthority:true",
    promptAuthorityAttempt: "promptAuthority:true",
    modelMessageAuthorityAttempt: "modelMessageAuthority:true",
    providerOrderingAuthorityAttempt: "providerOrderingAuthority:true",
    providerSelectionAuthorityAttempt: "providerSelectionAuthority:true",
    gatewayAuthorityAttempt: "gatewayAuthority:true",
    taskLoopAuthorityAttempt: "taskLoopAuthority:true",
    runtimeDecisionAuthorityAttempt: "runtimeDecisionAuthority:true",
    persistenceAuthorityAttempt: "persistenceAuthority:true",
    memoryPromotionAuthorityAttempt: "memoryPromotionAuthority:true",
    factAcceptanceAuthorityAttempt: "factAcceptanceAuthority:true",
    episodeWriteAuthorityAttempt: "episodeWriteAuthority:true",
    patchMutationAuthorityAttempt: "patchMutationAuthority:true",
    workspaceMutationAuthorityAttempt: "workspaceMutationAuthority:true",
    symbolMutationAuthorityAttempt: "symbolMutationAuthority:true",
  } as never;
}

function authorityMarkerCounts(
  observations: readonly Observation[],
): { observed: number; expected: number } {
  let observed = 0;
  let expected = 0;
  for (const item of observations) {
    for (const [key, value] of Object.entries(REQUIRED_AUTHORITY_MARKERS)) {
      expected += 1;
      if (item.report[key as keyof GroundingSingleExplicitDiagnosticsConsumerReport] === value) {
        observed += 1;
      }
    }
    for (const summaryItem of item.report.items) {
      expected += 1;
      if (summaryItem.authority === "none") {
        observed += 1;
      }
    }
  }
  return { observed, expected };
}

function metadataDropCounts(
  observations: readonly Observation[],
): { dropped: number; expected: number } {
  return {
    dropped: observations.reduce((sum, item) =>
      sum + METADATA_DROP_NEEDLES.filter((needle) =>
        !item.serialized.includes(needle)
      ).length, 0),
    expected: observations.length * METADATA_DROP_NEEDLES.length,
  };
}

function sourceMetadataDropped(item: Observation): boolean {
  return item.report.query.metadata === undefined &&
    item.report.items.every((summaryItem) =>
      summaryItem.metadata === undefined &&
      !JSON.stringify(summaryItem).includes(SOURCE_METADATA_SENTINEL)
    ) &&
    !item.serialized.includes(SOURCE_METADATA_SENTINEL) &&
    !item.serialized.includes(QUERY_METADATA_SENTINEL) &&
    !item.serialized.includes(SOURCE_OPTIONS_METADATA_SENTINEL) &&
    !item.serialized.includes(REPORT_OPTIONS_METADATA_SENTINEL);
}

function rollbackReports(
  observations: readonly Observation[],
): readonly [Observation, Observation] | undefined {
  const disabled = observations.find((item) => item.expectedReason === "flag_disabled");
  const killSwitch = observations.find((item) => item.expectedReason === "kill_switch");
  return disabled && killSwitch ? [disabled, killSwitch] : undefined;
}

function rollbackParity(
  pair: readonly [Observation, Observation],
): boolean {
  return JSON.stringify(rollbackComparableReport(pair[0].report)) ===
    JSON.stringify(rollbackComparableReport(pair[1].report));
}

function rollbackComparableReport(
  report: GroundingSingleExplicitDiagnosticsConsumerReport,
): RuntimeCoreJsonObject {
  return {
    enabled: report.enabled,
    skipped: report.skipped,
    authority: report.authority,
    rawRetained: report.rawRetained,
    includeRaw: report.includeRaw,
    includeUntrusted: report.includeUntrusted,
    query: report.query,
    items: report.items,
    inputItemCount: report.inputItemCount,
    acceptedItemCount: report.acceptedItemCount,
    omittedItemCount: report.omittedItemCount,
    tokenBudget: report.tokenBudget,
    estimatedTokens: report.estimatedTokens,
  };
}

function leakageCount(
  observations: readonly Pick<Observation, "serialized">[],
  needles: readonly string[],
): number {
  return observations.reduce((sum, item) =>
    sum + needles.filter((needle) => item.serialized.includes(needle)).length, 0);
}

function serializeReports(observations: readonly Observation[]): string {
  return JSON.stringify(observations.map((item) => item.report));
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
