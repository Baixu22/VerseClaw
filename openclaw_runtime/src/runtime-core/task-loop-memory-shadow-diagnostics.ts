import { performance } from "node:perf_hooks";
import {
  consumeRuntimeMemoryHydrationFacts,
  readRuntimeMemoryHydrationShadow,
  type RuntimeMemoryHydrationConsumerMetrics,
  type RuntimeMemoryHydrationConsumerQuery,
  type RuntimeMemoryHydrationConsumerRejectionReason,
  type RuntimeMemoryHydrationShadowDiagnostic,
  type RuntimeMemoryHydrationShadowFactProjection,
  type RuntimeMemoryHydrationShadowOptions,
  type RuntimeMemoryHydrationShadowResult,
  type RuntimeMemoryHydrationShadowStats,
} from "./index.js";
import {
  DEFAULT_PROMPT_INJECTION_SENTINEL as PROMPT_INJECTION_SENTINEL,
  DEFAULT_RAW_LEAK_SENTINEL as RAW_LEAK_SENTINEL,
} from "./memory-read-hydration-consumer.js";

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyQuery =
  RuntimeMemoryHydrationConsumerQuery & {
    queryId?: string;
    expectedFactIds?: readonly string[];
  };

export type TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotProvenance =
  | "controlled_fixture"
  | "sanitized_internal_sample";

export type TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotCorpus = {
  corpusId: string;
  corpusVersion: string;
  provenance: TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotProvenance;
  description?: string;
  auditRefs: readonly string[];
  sanitized: true;
  noUserRealData: true;
  reproducible: true;
};

export type TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotOptions = {
  enabled?: boolean;
  corpus?: TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotCorpus;
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOperatorGate = {
  optInRequested?: boolean;
  operatorId?: string;
  approvalRef?: string;
  scope?: "diagnostics_shadow_only";
  participantScope?: string;
  corpusScope?: string;
  requestedAt?: number;
  expiresAt?: number;
  defaultEnabled?: boolean;
  productCutover?: boolean;
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInCorpusGate = {
  provenance?:
    TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotProvenance;
  sanitized?: boolean;
  noUserRealData?: boolean;
  reproducible?: boolean;
  auditRefs?: readonly string[];
  sanitizerBoundaryPreserved?: boolean;
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInPrivacyRetentionGate = {
  noRawMaterial?: boolean;
  retentionDays?: number;
  deletionOwner?: string;
  aggregateMetricsOnly?: boolean;
  noUserRuntimeDbRead?: boolean;
  noDurableFactAuthority?: boolean;
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInRollbackGate = {
  killSwitch?: boolean;
  owner?: string;
  disableProcedure?: string;
  noMigrationRequired?: boolean;
  noDurableWritesToUndo?: boolean;
  validationCommands?: readonly string[];
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInMetricsGate = {
  guardedRecallAtK?: number;
  guardedPrecision?: number;
  staleInvalidSuppressionRate?: number;
  candidateRejectedSuppressionRate?: number;
  conflictSuppressionRate?: number;
  rawLeakRate?: number;
  promptInjectionReturnRate?: number;
  taskLoopDecisionDeltaCount?: number;
  toolCallDeltaCount?: number;
  providerOrderingDeltaCount?: number;
  promptContextModelMessageInjectionCount?: number;
  checkpointTranscriptLifecycleTraceInjectionCount?: number;
  durableMemoryWriteCount?: number;
  thresholdViolationCount?: number;
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOptions = {
  enabled?: boolean;
  operator?: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOperatorGate;
  corpus?: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInCorpusGate;
  privacyRetention?:
    TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInPrivacyRetentionGate;
  rollback?: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInRollbackGate;
  metrics?: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInMetricsGate;
};

export type TaskLoopRuntimeMemoryReadHydrationBreakthroughArm = "baseline" | "treatment";

export type TaskLoopRuntimeMemoryReadHydrationBreakthroughInjection = {
  enabled: true;
  arm: TaskLoopRuntimeMemoryReadHydrationBreakthroughArm;
  acceptedFactsMaxTokens: number;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions = {
  explicitOptIn?: boolean;
  testResearchOnly?: boolean;
  testResearchOnlyBreakthrough?: boolean;
  breakthroughInjection?: TaskLoopRuntimeMemoryReadHydrationBreakthroughInjection;
  databasePath?: string;
  queries?: readonly TaskLoopRuntimeMemoryReadHydrationShadowOnlyQuery[];
  limit?: number;
  maxEpisodes?: number;
  maxFacts?: number;
  now?: () => number;
  openReadOnlyDatabase?: RuntimeMemoryHydrationShadowOptions["openReadOnlyDatabase"];
  controlledInternalShadowPilot?:
    TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotOptions;
  limitedProductionOptIn?:
    TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOptions;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyAuthority = {
  diagnosticsOnly: true;
  readonly: true;
  shadowOnly: true;
  explicitOptInRequired: true;
  testResearchOnly: true;
  noPromptInjection: true;
  noPromptContextModelMessageInjection: true;
  noTaskLoopDecisionAuthority: true;
  noToolSelectionAuthority: true;
  noProviderOrdering: true;
  noRuntimeAuthority: true;
  noDurableFactAuthority: true;
  noCheckpointAuthority: true;
  noTranscriptAuthority: true;
  noMemoryWriteAuthority: true;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyRejectedFact = {
  factId: string;
  reason: RuntimeMemoryHydrationConsumerRejectionReason;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult = {
  queryId: string;
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  expectedFactIds: string[];
  acceptedFacts: RuntimeMemoryHydrationShadowFactProjection[];
  rejectedFacts: TaskLoopRuntimeMemoryReadHydrationShadowOnlyRejectedFact[];
  truePositiveCount: number;
  recallAtK: number;
  precision: number;
  metrics: RuntimeMemoryHydrationConsumerMetrics;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics = {
  queryCount: number;
  expectedFactCount: number;
  truePositiveCount: number;
  acceptedFactCount: number;
  rejectedFactCount: number;
  guardedRecallAtK: number;
  guardedPrecision: number;
  staleInvalidSuppressionRate: number;
  candidateRejectedSuppressionRate: number;
  conflictSuppressionRate: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
  tokenOverhead: number;
  latencyOverheadMs: number;
  defaultPathNoOpRate: number;
  taskLoopDecisionDeltaCount: number;
  toolCallDeltaCount: number;
  providerOrderingDeltaCount: number;
  promptContextModelMessageInjectionCount: number;
  durableMemoryWriteCount: number;
  runtimeAuthorityCount: 0;
  thresholdViolations: string[];
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyHydration = {
  status: RuntimeMemoryHydrationShadowResult["status"];
  reason?: Extract<
    RuntimeMemoryHydrationShadowResult,
    { status: "skipped" | "error" }
  >["reason"];
  stats: RuntimeMemoryHydrationShadowStats;
  diagnostics: RuntimeMemoryHydrationShadowDiagnostic[];
  factProjectionCount: number;
};

export type TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotBoundary = {
  enabled: true;
  accepted: boolean;
  corpusId?: string;
  corpusVersion?: string;
  provenance?:
    TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotProvenance;
  description?: string;
  auditRefs: string[];
  sanitized: boolean;
  noUserRealData: boolean;
  reproducible: boolean;
  boundaryViolations: string[];
};

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateName =
  | "operator_gate"
  | "corpus_gate"
  | "privacy_retention_gate"
  | "rollback_gate"
  | "metrics_gate";

export type TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateReport = {
  enabled: true;
  accepted: boolean;
  missing: string[];
  hardGates: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateName[];
  defaultTaskLoopEnabled: false;
  productionCutoverAllowed: false;
  userRuntimeDbReadAllowed: false;
  diagnosticsReadonly: true;
  nonAuthoritative: true;
  runtimeAssertions: {
    operatorGate: "required_before_db_open";
    corpusGate: "required_before_db_open";
    privacyRetentionGate: "required_before_db_open";
    rollbackGate: "required_before_db_open";
    metricsGate: "required_before_db_open";
    diagnosticsPath: "explicit_diagnostics_shadow_only";
  };
};

export type TaskLoopRuntimeMemoryReadHydrationBreakthroughInjectionSummary = {
  arm: TaskLoopRuntimeMemoryReadHydrationBreakthroughArm;
  acceptedFactCount: number;
  estimatedTokens: number;
  acceptedFactsMaxTokens: number;
  truncatedByTokenBudget: boolean;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics = {
  schemaVersion: 1;
  source: "task_loop.runtime_memory_read_hydration_shadow_only_explicit_opt_in";
  status: "skipped" | "loaded" | "error";
  reason?:
    | "explicit_opt_in_required"
    | "test_research_gate_required"
    | "limited_production_opt_in_gate_required"
    | "pilot_corpus_boundary_required"
    | "hydration_skipped"
    | "hydration_failed";
  loopRunId: string;
  sessionKey: string;
  iteration: number;
  contextPackHash?: string;
  controlledInternalShadowPilot?:
    TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotBoundary;
  limitedProductionOptIn?:
    TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateReport;
  hydration?: TaskLoopRuntimeMemoryReadHydrationShadowOnlyHydration;
  breakthroughInjection?:
    TaskLoopRuntimeMemoryReadHydrationBreakthroughInjectionSummary;
  queries: TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult[];
  metrics: TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics;
  authority: TaskLoopRuntimeMemoryReadHydrationShadowOnlyAuthority;
};

export type TaskLoopRuntimeMemoryReadHydrationDeltaCounts = {
  taskLoopDecisionDeltaCount?: number;
  toolCallDeltaCount?: number;
  providerOrderingDeltaCount?: number;
  promptContextModelMessageInjectionCount?: number;
  durableMemoryWriteCount?: number;
};

export type TaskLoopRuntimeMemoryReadHydrationShadowOnlyInput = {
  config?: unknown;
  options: TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions;
  loopRunId: string;
  sessionKey: string;
  iteration: number;
  contextPackHash?: string;
  deltaCounts?: TaskLoopRuntimeMemoryReadHydrationDeltaCounts;
};

const SOURCE =
  "task_loop.runtime_memory_read_hydration_shadow_only_explicit_opt_in";

const AUTHORITY: TaskLoopRuntimeMemoryReadHydrationShadowOnlyAuthority = {
  diagnosticsOnly: true,
  readonly: true,
  shadowOnly: true,
  explicitOptInRequired: true,
  testResearchOnly: true,
  noPromptInjection: true,
  noPromptContextModelMessageInjection: true,
  noTaskLoopDecisionAuthority: true,
  noToolSelectionAuthority: true,
  noProviderOrdering: true,
  noRuntimeAuthority: true,
  noDurableFactAuthority: true,
  noCheckpointAuthority: true,
  noTranscriptAuthority: true,
  noMemoryWriteAuthority: true,
};

const LIMITED_PRODUCTION_OPT_IN_HARD_GATES: TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateName[] = [
  "operator_gate",
  "corpus_gate",
  "privacy_retention_gate",
  "rollback_gate",
  "metrics_gate",
];

export function buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics(
  input: TaskLoopRuntimeMemoryReadHydrationShadowOnlyInput,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics {
  const startedAt = performance.now();
  try {
    return buildDiagnostics(input, startedAt);
  } catch {
    return baseDiagnostics(input, "error", {
      reason: "hydration_failed",
      latencyOverheadMs: performance.now() - startedAt,
    });
  }
}

function buildDiagnostics(
  input: TaskLoopRuntimeMemoryReadHydrationShadowOnlyInput,
  startedAt: number,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics {
  if (input.options.explicitOptIn !== true) {
    return baseDiagnostics(input, "skipped", {
      reason: "explicit_opt_in_required",
      defaultPathNoOpRate: 1,
      latencyOverheadMs: performance.now() - startedAt,
    });
  }
  if (input.options.testResearchOnly !== true) {
    return baseDiagnostics(input, "skipped", {
      reason: "test_research_gate_required",
      defaultPathNoOpRate: 1,
      latencyOverheadMs: performance.now() - startedAt,
    });
  }

  const limitedProductionOptIn = normalizeLimitedProductionOptInGate(
    input.options.limitedProductionOptIn,
  );
  if (limitedProductionOptIn && !limitedProductionOptIn.accepted) {
    return baseDiagnostics(input, "skipped", {
      reason: "limited_production_opt_in_gate_required",
      limitedProductionOptIn,
      defaultPathNoOpRate: 1,
      latencyOverheadMs: performance.now() - startedAt,
    });
  }

  const controlledInternalShadowPilot =
    normalizeControlledInternalShadowPilot(
      input.options.controlledInternalShadowPilot,
    );
  if (
    controlledInternalShadowPilot &&
    !controlledInternalShadowPilot.accepted
  ) {
    return baseDiagnostics(input, "skipped", {
      reason: "pilot_corpus_boundary_required",
      limitedProductionOptIn,
      controlledInternalShadowPilot,
      defaultPathNoOpRate: 1,
      latencyOverheadMs: performance.now() - startedAt,
    });
  }

  const hydration = readRuntimeMemoryHydrationShadow({
    config: input.config,
    databasePath: input.options.databasePath,
    readShadow: true,
    limit: input.options.limit,
    maxEpisodes: input.options.maxEpisodes,
    maxFacts: input.options.maxFacts,
    now: input.options.now,
    ...(input.options.openReadOnlyDatabase
      ? { openReadOnlyDatabase: input.options.openReadOnlyDatabase }
      : {}),
  });
  const latencyOverheadMs = performance.now() - startedAt;
  const hydrationDiagnostics = summarizeHydration(hydration);

  if (hydration.status !== "loaded") {
    return baseDiagnostics(input, hydration.status === "error" ? "error" : "skipped", {
      reason: hydration.status === "error" ? "hydration_failed" : "hydration_skipped",
      limitedProductionOptIn,
      controlledInternalShadowPilot,
      hydration: hydrationDiagnostics,
      latencyOverheadMs,
    });
  }

  const queries = (input.options.queries ?? []).map((query, index) =>
    consumeQuery(hydration.facts, query, index)
  );
  const breakthroughInjection = summarizeBreakthroughInjection(
    input.options.testResearchOnlyBreakthrough === true,
    input.options.breakthroughInjection,
    queries,
  );
  return {
    ...baseDiagnostics(input, "loaded", {
      controlledInternalShadowPilot,
      limitedProductionOptIn,
      hydration: hydrationDiagnostics,
      breakthroughInjection,
      latencyOverheadMs,
    }),
    queries,
    metrics: aggregateMetrics(queries, latencyOverheadMs, 0, input.deltaCounts),
  };
}

function summarizeBreakthroughInjection(
  breakthroughEnabled: boolean,
  injection:
    | TaskLoopRuntimeMemoryReadHydrationBreakthroughInjection
    | undefined,
  queries: readonly TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult[],
):
  | TaskLoopRuntimeMemoryReadHydrationBreakthroughInjectionSummary
  | undefined {
  if (!breakthroughEnabled || !injection || injection.enabled !== true) {
    return undefined;
  }
  const acceptedFactCount = sum(
    queries.map((query) => query.acceptedFacts.length),
  );
  const estimatedTokens = sum(
    queries.map((query) => query.metrics.estimatedTokens),
  );
  const acceptedFactsMaxTokens = injection.acceptedFactsMaxTokens;
  return {
    arm: injection.arm,
    acceptedFactCount,
    estimatedTokens,
    acceptedFactsMaxTokens,
    truncatedByTokenBudget: estimatedTokens > acceptedFactsMaxTokens,
  };
}

function consumeQuery(
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[],
  query: TaskLoopRuntimeMemoryReadHydrationShadowOnlyQuery,
  index: number,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult {
  const result = consumeRuntimeMemoryHydrationFacts(facts, query);
  const expectedFactIds = [...(query.expectedFactIds ?? [])];
  const acceptedIds = new Set(result.acceptedFacts.map((fact) => fact.factId));
  const truePositiveCount = expectedFactIds.filter((factId) =>
    acceptedIds.has(factId)
  ).length;
  return {
    queryId: query.queryId?.trim() || `query_${index + 1}`,
    taskId: query.taskId,
    subject: query.subject,
    predicate: query.predicate,
    referenceTime: query.referenceTime,
    expectedFactIds,
    acceptedFacts: [...result.acceptedFacts],
    rejectedFacts: result.rejectedFacts.map((entry) => ({
      factId: entry.fact.factId,
      reason: entry.reason,
    })),
    truePositiveCount,
    recallAtK: expectedFactIds.length === 0
      ? 1
      : truePositiveCount / expectedFactIds.length,
    precision: result.acceptedFacts.length === 0
      ? 0
      : truePositiveCount / result.acceptedFacts.length,
    metrics: result.metrics,
  };
}

function baseDiagnostics(
  input: TaskLoopRuntimeMemoryReadHydrationShadowOnlyInput,
  status: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics["status"],
  options: {
    reason?: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics["reason"];
    controlledInternalShadowPilot?:
      TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotBoundary;
    limitedProductionOptIn?:
      TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateReport;
    hydration?: TaskLoopRuntimeMemoryReadHydrationShadowOnlyHydration;
    breakthroughInjection?:
      TaskLoopRuntimeMemoryReadHydrationBreakthroughInjectionSummary;
    latencyOverheadMs?: number;
    defaultPathNoOpRate?: number;
  } = {},
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics {
  return {
    schemaVersion: 1,
    source: SOURCE,
    status,
    ...(options.reason ? { reason: options.reason } : {}),
    loopRunId: input.loopRunId,
    sessionKey: input.sessionKey,
    iteration: input.iteration,
    ...(input.contextPackHash ? { contextPackHash: input.contextPackHash } : {}),
    ...(options.controlledInternalShadowPilot
      ? {
          controlledInternalShadowPilot:
            options.controlledInternalShadowPilot,
        }
      : {}),
    ...(options.limitedProductionOptIn
      ? { limitedProductionOptIn: options.limitedProductionOptIn }
      : {}),
    ...(options.hydration ? { hydration: options.hydration } : {}),
    ...(options.breakthroughInjection
      ? { breakthroughInjection: options.breakthroughInjection }
      : {}),
    queries: [],
    metrics: emptyMetrics(
      options.latencyOverheadMs ?? 0,
      options.defaultPathNoOpRate ?? 0,
    ),
    authority: AUTHORITY,
  };
}

function normalizeLimitedProductionOptInGate(
  optIn:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOptions
    | undefined,
):
  | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInGateReport
  | undefined {
  if (optIn?.enabled !== true) {
    return undefined;
  }

  const missing = [
    ...limitedProductionOperatorMissing(optIn.operator),
    ...limitedProductionCorpusMissing(optIn.corpus),
    ...limitedProductionPrivacyRetentionMissing(optIn.privacyRetention),
    ...limitedProductionRollbackMissing(optIn.rollback),
    ...limitedProductionMetricsMissing(optIn.metrics),
  ];

  return {
    enabled: true,
    accepted: missing.length === 0,
    missing,
    hardGates: [...LIMITED_PRODUCTION_OPT_IN_HARD_GATES],
    defaultTaskLoopEnabled: false,
    productionCutoverAllowed: false,
    userRuntimeDbReadAllowed: false,
    diagnosticsReadonly: true,
    nonAuthoritative: true,
    runtimeAssertions: {
      operatorGate: "required_before_db_open",
      corpusGate: "required_before_db_open",
      privacyRetentionGate: "required_before_db_open",
      rollbackGate: "required_before_db_open",
      metricsGate: "required_before_db_open",
      diagnosticsPath: "explicit_diagnostics_shadow_only",
    },
  };
}

function limitedProductionOperatorMissing(
  operator:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInOperatorGate
    | undefined,
): string[] {
  const missing: string[] = [];
  if (operator?.optInRequested !== true) {
    missing.push("operator.opt_in_required");
  }
  if (!operator?.operatorId?.trim()) {
    missing.push("operator.owner_required");
  }
  if (!operator?.approvalRef?.trim()) {
    missing.push("operator.approval_ref_required");
  }
  if (operator?.scope !== "diagnostics_shadow_only") {
    missing.push("operator.diagnostics_shadow_only_scope_required");
  }
  if (!operator?.participantScope?.trim()) {
    missing.push("operator.participant_scope_required");
  }
  if (!operator?.corpusScope?.trim()) {
    missing.push("operator.corpus_scope_required");
  }
  if (
    !Number.isFinite(operator?.requestedAt) ||
    !Number.isFinite(operator?.expiresAt) ||
    (operator?.expiresAt ?? 0) <= (operator?.requestedAt ?? 0)
  ) {
    missing.push("operator.expiry_required");
  }
  if (operator?.defaultEnabled !== false) {
    missing.push("operator.default_off_attestation_required");
  }
  if (operator?.productCutover !== false) {
    missing.push("operator.no_cutover_attestation_required");
  }
  return missing;
}

function limitedProductionCorpusMissing(
  corpus:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInCorpusGate
    | undefined,
): string[] {
  const missing: string[] = [];
  if (
    corpus?.provenance !== "controlled_fixture" &&
    corpus?.provenance !== "sanitized_internal_sample"
  ) {
    missing.push("corpus.approved_provenance_required");
  }
  if (corpus?.sanitized !== true) {
    missing.push("corpus.sanitized_required");
  }
  if (corpus?.noUserRealData !== true) {
    missing.push("corpus.no_user_real_data_required");
  }
  if (corpus?.reproducible !== true) {
    missing.push("corpus.reproducible_required");
  }
  if (!corpus?.auditRefs?.length) {
    missing.push("corpus.audit_refs_required");
  }
  if (corpus?.sanitizerBoundaryPreserved !== true) {
    missing.push("corpus.sanitizer_boundary_required");
  }
  return missing;
}

function limitedProductionPrivacyRetentionMissing(
  privacyRetention:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInPrivacyRetentionGate
    | undefined,
): string[] {
  const missing: string[] = [];
  if (privacyRetention?.noRawMaterial !== true) {
    missing.push("privacy.no_raw_material_required");
  }
  if (
    !Number.isInteger(privacyRetention?.retentionDays) ||
    (privacyRetention?.retentionDays ?? 0) < 1 ||
    (privacyRetention?.retentionDays ?? 0) > 30
  ) {
    missing.push("privacy.retention_window_required");
  }
  if (!privacyRetention?.deletionOwner?.trim()) {
    missing.push("privacy.deletion_owner_required");
  }
  if (privacyRetention?.aggregateMetricsOnly !== true) {
    missing.push("privacy.aggregate_metrics_only_required");
  }
  if (privacyRetention?.noUserRuntimeDbRead !== true) {
    missing.push("privacy.no_user_runtime_db_read_required");
  }
  if (privacyRetention?.noDurableFactAuthority !== true) {
    missing.push("privacy.no_durable_fact_authority_required");
  }
  return missing;
}

function limitedProductionRollbackMissing(
  rollback:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInRollbackGate
    | undefined,
): string[] {
  const missing: string[] = [];
  if (rollback?.killSwitch !== true) {
    missing.push("rollback.kill_switch_required");
  }
  if (!rollback?.owner?.trim()) {
    missing.push("rollback.owner_required");
  }
  if (!rollback?.disableProcedure?.trim()) {
    missing.push("rollback.disable_procedure_required");
  }
  if (rollback?.noMigrationRequired !== true) {
    missing.push("rollback.no_migration_required");
  }
  if (rollback?.noDurableWritesToUndo !== true) {
    missing.push("rollback.no_durable_writes_to_undo_required");
  }
  if (!rollback?.validationCommands?.length) {
    missing.push("rollback.validation_commands_required");
  }
  return missing;
}

function limitedProductionMetricsMissing(
  metrics:
    | TaskLoopRuntimeMemoryReadHydrationLimitedProductionOptInMetricsGate
    | undefined,
): string[] {
  const missing: string[] = [];
  if (metrics?.guardedRecallAtK !== 1) {
    missing.push("metrics.guarded_recall_required");
  }
  if (metrics?.guardedPrecision !== 1) {
    missing.push("metrics.guarded_precision_required");
  }
  if (metrics?.staleInvalidSuppressionRate !== 1) {
    missing.push("metrics.stale_invalid_suppression_required");
  }
  if (metrics?.candidateRejectedSuppressionRate !== 1) {
    missing.push("metrics.candidate_rejected_suppression_required");
  }
  if (metrics?.conflictSuppressionRate !== 1) {
    missing.push("metrics.conflict_suppression_required");
  }
  if (metrics?.rawLeakRate !== 0) {
    missing.push("metrics.raw_leak_zero_required");
  }
  if (metrics?.promptInjectionReturnRate !== 0) {
    missing.push("metrics.prompt_injection_zero_required");
  }
  if (metrics?.taskLoopDecisionDeltaCount !== 0) {
    missing.push("metrics.taskloop_decision_delta_zero_required");
  }
  if (metrics?.toolCallDeltaCount !== 0) {
    missing.push("metrics.tool_delta_zero_required");
  }
  if (metrics?.providerOrderingDeltaCount !== 0) {
    missing.push("metrics.provider_ordering_delta_zero_required");
  }
  if (metrics?.promptContextModelMessageInjectionCount !== 0) {
    missing.push("metrics.prompt_context_model_injection_zero_required");
  }
  if (metrics?.checkpointTranscriptLifecycleTraceInjectionCount !== 0) {
    missing.push("metrics.checkpoint_transcript_lifecycle_trace_zero_required");
  }
  if (metrics?.durableMemoryWriteCount !== 0) {
    missing.push("metrics.durable_memory_write_zero_required");
  }
  if (metrics?.thresholdViolationCount !== 0) {
    missing.push("metrics.threshold_violations_zero_required");
  }
  return missing;
}

function summarizeHydration(
  hydration: RuntimeMemoryHydrationShadowResult,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyHydration {
  return {
    status: hydration.status,
    ...(hydration.status === "skipped" || hydration.status === "error"
      ? { reason: hydration.reason }
      : {}),
    stats: hydration.stats,
    diagnostics: [...hydration.diagnostics],
    factProjectionCount: hydration.facts.length,
  };
}

function aggregateMetrics(
  queries: readonly TaskLoopRuntimeMemoryReadHydrationShadowOnlyQueryResult[],
  latencyOverheadMs: number,
  defaultPathNoOpRate: number,
  deltaCounts?: TaskLoopRuntimeMemoryReadHydrationDeltaCounts,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics {
  const expectedFactCount = sum(queries.map((query) => query.expectedFactIds.length));
  const truePositiveCount = sum(queries.map((query) => query.truePositiveCount));
  const acceptedFacts = queries.flatMap((query) => query.acceptedFacts);
  const rejectionCounts = mergeRejectionCounts(queries.map((query) =>
    query.metrics.rejectionCounts
  ));
  const acceptedFactCount = acceptedFacts.length;
  const rejectedFactCount = sum(queries.map((query) => query.rejectedFacts.length));
  const acceptedStaleInvalidCount = acceptedFacts.filter(isStaleInvalid).length;
  const staleInvalidCandidateCount = acceptedStaleInvalidCount +
    (rejectionCounts.future_valid_at ?? 0) +
    (rejectionCounts.invalidated_at_reference_time ?? 0) +
    (rejectionCounts.expired_at_reference_time ?? 0);
  const acceptedCandidateRejectedCount = acceptedFacts.filter((fact) =>
    fact.recordKind !== "fact" || fact.verificationStatus !== "verified"
  ).length;
  const candidateRejectedCandidateCount = acceptedCandidateRejectedCount +
    (rejectionCounts.record_kind_not_fact ?? 0) +
    (rejectionCounts.verification_status_not_verified ?? 0);
  const rawLeakReturnedCount = acceptedFacts.filter(hasRawLeakSentinel).length;
  const promptInjectionReturnedCount = acceptedFacts.filter(
    hasPromptInjectionSentinel,
  ).length;
  const metrics: TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics = {
    queryCount: queries.length,
    expectedFactCount,
    truePositiveCount,
    acceptedFactCount,
    rejectedFactCount,
    guardedRecallAtK: expectedFactCount === 0
      ? 1
      : truePositiveCount / expectedFactCount,
    guardedPrecision: acceptedFactCount === 0
      ? 0
      : truePositiveCount / acceptedFactCount,
    staleInvalidSuppressionRate: suppressionRate(
      staleInvalidCandidateCount,
      acceptedStaleInvalidCount,
    ),
    candidateRejectedSuppressionRate: suppressionRate(
      candidateRejectedCandidateCount,
      acceptedCandidateRejectedCount,
    ),
    conflictSuppressionRate: suppressionRate(
      rejectionCounts.conflicting_fact ?? 0,
      0,
    ),
    rawLeakRate: acceptedFactCount === 0 ? 0 : rawLeakReturnedCount / acceptedFactCount,
    promptInjectionReturnRate: acceptedFactCount === 0
      ? 0
      : promptInjectionReturnedCount / acceptedFactCount,
    tokenOverhead: sum(queries.map((query) => query.metrics.estimatedTokens)),
    latencyOverheadMs,
    defaultPathNoOpRate,
    taskLoopDecisionDeltaCount: deltaCounts?.taskLoopDecisionDeltaCount ?? 0,
    toolCallDeltaCount: deltaCounts?.toolCallDeltaCount ?? 0,
    providerOrderingDeltaCount: deltaCounts?.providerOrderingDeltaCount ?? 0,
    promptContextModelMessageInjectionCount:
      deltaCounts?.promptContextModelMessageInjectionCount ?? 0,
    durableMemoryWriteCount: deltaCounts?.durableMemoryWriteCount ?? 0,
    runtimeAuthorityCount: 0,
    thresholdViolations: [],
  };
  return {
    ...metrics,
    thresholdViolations: thresholdViolations(metrics),
  };
}

function emptyMetrics(
  latencyOverheadMs: number,
  defaultPathNoOpRate: number,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics {
  return {
    queryCount: 0,
    expectedFactCount: 0,
    truePositiveCount: 0,
    acceptedFactCount: 0,
    rejectedFactCount: 0,
    guardedRecallAtK: 1,
    guardedPrecision: 1,
    staleInvalidSuppressionRate: 1,
    candidateRejectedSuppressionRate: 1,
    conflictSuppressionRate: 1,
    rawLeakRate: 0,
    promptInjectionReturnRate: 0,
    tokenOverhead: 0,
    latencyOverheadMs,
    defaultPathNoOpRate,
    taskLoopDecisionDeltaCount: 0,
    toolCallDeltaCount: 0,
    providerOrderingDeltaCount: 0,
    promptContextModelMessageInjectionCount: 0,
    durableMemoryWriteCount: 0,
    runtimeAuthorityCount: 0,
    thresholdViolations: [],
  };
}

function thresholdViolations(
  metrics: TaskLoopRuntimeMemoryReadHydrationShadowOnlyMetrics,
): string[] {
  const violations: string[] = [];
  if (metrics.expectedFactCount > 0 && metrics.guardedRecallAtK < 1) {
    violations.push("guarded recall@k");
  }
  if (metrics.expectedFactCount > 0 && metrics.guardedPrecision < 1) {
    violations.push("guarded precision");
  }
  if (metrics.staleInvalidSuppressionRate < 1) {
    violations.push("guarded stale/invalid suppression");
  }
  if (metrics.candidateRejectedSuppressionRate < 1) {
    violations.push("guarded candidate/rejected suppression");
  }
  if (metrics.conflictSuppressionRate < 1) {
    violations.push("guarded conflict suppression");
  }
  if (metrics.rawLeakRate !== 0) {
    violations.push("guarded raw leak rate");
  }
  if (metrics.promptInjectionReturnRate !== 0) {
    violations.push("guarded prompt injection return rate");
  }
  if (metrics.taskLoopDecisionDeltaCount !== 0) {
    violations.push("TaskLoop decision delta");
  }
  if (metrics.promptContextModelMessageInjectionCount !== 0) {
    violations.push("prompt/context/model-message injection");
  }
  return violations;
}

function isStaleInvalid(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return fact.valid_at > fact.reference_time ||
    (fact.invalid_at !== undefined && fact.invalid_at <= fact.reference_time) ||
    (fact.expired_at !== undefined && fact.expired_at <= fact.reference_time);
}

function hasPromptInjectionSentinel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return PROMPT_INJECTION_SENTINEL.test(projectionText(fact));
}

function hasRawLeakSentinel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): boolean {
  return RAW_LEAK_SENTINEL.test(projectionText(fact));
}

function normalizeControlledInternalShadowPilot(
  pilot:
    | TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotOptions
    | undefined,
):
  | TaskLoopRuntimeMemoryReadHydrationControlledInternalShadowPilotBoundary
  | undefined {
  if (pilot?.enabled !== true) {
    return undefined;
  }

  const corpus = pilot.corpus;
  const boundaryViolations: string[] = [];
  const corpusId = safePilotString(corpus?.corpusId, 80);
  const corpusVersion = safePilotString(corpus?.corpusVersion, 80);
  const description = safePilotString(corpus?.description, 240);
  const rawAuditRefs = Array.isArray(corpus?.auditRefs) ? corpus.auditRefs : [];
  const auditRefs = rawAuditRefs
    .map((ref) => safePilotString(ref, 180))
    .filter((ref): ref is string => ref !== undefined)
    .slice(0, 16);

  if (!corpus) {
    boundaryViolations.push("corpus_required");
  }
  if (!corpusId) {
    boundaryViolations.push("corpus_id_required");
  }
  if (!corpusVersion) {
    boundaryViolations.push("corpus_version_required");
  }
  if (
    corpus?.provenance !== "controlled_fixture" &&
    corpus?.provenance !== "sanitized_internal_sample"
  ) {
    boundaryViolations.push("approved_provenance_required");
  }
  if (corpus?.sanitized !== true) {
    boundaryViolations.push("sanitized_required");
  }
  if (corpus?.noUserRealData !== true) {
    boundaryViolations.push("no_user_real_data_required");
  }
  if (corpus?.reproducible !== true) {
    boundaryViolations.push("reproducible_required");
  }
  if (auditRefs.length === 0) {
    boundaryViolations.push("audit_ref_required");
  }
  if (auditRefs.length !== rawAuditRefs.length) {
    boundaryViolations.push("audit_ref_sanitization_required");
  }
  if (corpus?.description && !description) {
    boundaryViolations.push("description_sanitization_required");
  }

  return {
    enabled: true,
    accepted: boundaryViolations.length === 0,
    ...(corpusId ? { corpusId } : {}),
    ...(corpusVersion ? { corpusVersion } : {}),
    ...(corpus?.provenance === "controlled_fixture" ||
      corpus?.provenance === "sanitized_internal_sample"
      ? { provenance: corpus.provenance }
      : {}),
    ...(description ? { description } : {}),
    auditRefs,
    sanitized: corpus?.sanitized === true,
    noUserRealData: corpus?.noUserRealData === true,
    reproducible: corpus?.reproducible === true,
    boundaryViolations,
  };
}

function safePilotString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!text || hasPilotMetadataSentinel(text)) {
    return undefined;
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function hasPilotMetadataSentinel(value: string): boolean {
  return PROMPT_INJECTION_SENTINEL.test(value) || RAW_LEAK_SENTINEL.test(value);
}

function projectionText(fact: RuntimeMemoryHydrationShadowFactProjection): string {
  return [
    fact.factId,
    fact.taskId ?? "",
    fact.subject,
    fact.predicate,
    fact.objectSummary,
    fact.source,
    fact.verificationStatus,
    JSON.stringify(fact.sourceEpisodeRefs),
    JSON.stringify(fact.evidenceRefs),
    JSON.stringify(fact.metadata ?? {}),
  ].join("\n");
}

function suppressionRate(candidateCount: number, returnedCount: number): number {
  return candidateCount === 0 ? 1 : 1 - returnedCount / candidateCount;
}

function mergeRejectionCounts(
  counts: readonly RuntimeMemoryHydrationConsumerMetrics["rejectionCounts"][],
): Record<RuntimeMemoryHydrationConsumerRejectionReason, number> {
  const merged = emptyRejectionCounts();
  for (const entry of counts) {
    for (const reason of Object.keys(merged) as RuntimeMemoryHydrationConsumerRejectionReason[]) {
      merged[reason] += entry[reason] ?? 0;
    }
  }
  return merged;
}

function emptyRejectionCounts(): Record<
  RuntimeMemoryHydrationConsumerRejectionReason,
  number
> {
  return {
    record_kind_not_fact: 0,
    verification_status_not_verified: 0,
    future_valid_at: 0,
    invalidated_at_reference_time: 0,
    expired_at_reference_time: 0,
    task_mismatch: 0,
    subject_mismatch: 0,
    predicate_mismatch: 0,
    prompt_injection_sentinel: 0,
    raw_leak_sentinel: 0,
    conflicting_fact: 0,
    token_budget_exceeded: 0,
    limit_exceeded: 0,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
