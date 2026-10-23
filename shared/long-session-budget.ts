/**
 * F2 / TF-0562 — long-use budget contract.
 *
 * Every number here is declared BEFORE the current candidate is measured and is
 * the only thing the long-use gates compare against. They live in one tracked
 * module so the unit test, the evidence driver and a reviewer read the same
 * frozen values instead of re-deriving them from a printed report.
 *
 * Provenance, in order of precedence:
 * 1. hard bounds already enforced by the production owners:
 *    MAX_SESSION_SUMMARY_KEYS / SESSION_SUMMARY_CONCURRENCY
 *      (electron/services/sessions-api.ts),
 *    SESSION_ADMISSION_DEFAULT_MAX_ENTRIES
 *      (openclaw_runtime/src/sessions/session-admission-registry.ts),
 *    MAX_SESSION_COMPLETION_BATCH_WORKERS / max 8 batches per activity snapshot
 *      (openclaw_runtime/src/agents/completion-batch-receipt.ts,
 *       openclaw_runtime/src/gateway/server-methods/session-activity.ts),
 *    MAX_MERGED_STEERING_CHARS / MAX_RESULT_CHARS_PER_ITEM / MAX_METADATA_CHARS
 *      (openclaw_runtime/src/agents/agent-steering-queue.ts);
 * 2. cooldowns the renderer already applies (src/stores/gateway.ts:
 *    LOAD_SESSIONS_MIN_INTERVAL_MS, LOAD_HISTORY_MIN_INTERVAL_MS,
 *    GATEWAY_EVENT_DEDUPE_TTL_MS) and the sidebar sweep cap in
 *    src/stores/chat.ts (newest 40 sessions per sweep);
 * 3. the TF-0423 improved-build observation, used only as a latency envelope
 *    with headroom — never as this candidate's result.
 */

/** Schemas for the artifacts written by this node. */
export const LONG_USE_BEFORE_AFTER_SCHEMA = 'clawx.long-session.f2-long-use-before-after/v1';
export const LONG_USE_RSS_SCHEMA = 'clawx.long-session.f2-rss-and-owner-counts/v1';
export const LONG_USE_NOTIFICATION_SCHEMA = 'clawx.long-session.f2-notification-budget/v1';
export const LONG_USE_OBSERVATION_SCHEMA = 'clawx.long-session.f2-observation/v1';

/** Percentile ratios used by the long-use gates. */
export type LongUsePercentile = 0.5 | 0.95;

/**
 * Nearest-rank percentile over raw samples. An empty sample set returns null so
 * an unmeasured cell stays explicitly unmeasured instead of reading as zero.
 */
export function longUsePercentile(values: readonly number[], ratio: LongUsePercentile): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * ratio));
  return sorted[Math.min(sorted.length - 1, rank - 1)] ?? null;
}

/** Longest run of strictly increasing consecutive samples. */
export function longestMonotonicRise(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

/** Net change from the first to the last sample of a series. */
export function seriesGrowth(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  return values[values.length - 1] - values[0];
}

/**
 * Growth verdict for the idle RSS curve. A series with too few samples is
 * reported as growing (not enough evidence of stability), never as a pass.
 */
export function isPersistentRssGrowth(params: {
  samples: readonly number[];
  minSamples: number;
  maxMonotonicRiseRatio: number;
  maxGrowthBytes: number;
}): boolean {
  if (params.samples.length < params.minSamples) return true;
  const growth = seriesGrowth(params.samples) ?? 0;
  if (growth <= params.maxGrowthBytes) return false;
  return longestMonotonicRise(params.samples) >= Math.ceil(params.samples.length * params.maxMonotonicRiseRatio);
}

/** The frozen fixture the current candidate must be measured against. */
export const LONG_USE_FIXTURE_BUDGET = {
  minSessionCount: 333,
  minTranscriptBytes: 40 * 1024 * 1024,
  idleRssDurationMs: 300_000,
  idleRssSampleIntervalMs: 5_000,
  minIdleRssSamples: 55,
  minSwitchSamples: 5,
  /** Renderer long tasks >= 50 ms allowed inside a measured window. */
  maxLongTasksOver50Ms: 0,
} as const;

/** Metric ids covered by the frozen latency budgets. */
export const LONG_USE_LATENCY_METRICS = [
  'sidebar.loadSessions.p50',
  'sidebar.loadSessions.p95',
  'sidebar.sessionSwitch.p50',
  'sidebar.sessionSwitch.p95',
  'sidebar.longSessionOpen.p95',
  'host.sessionsSummaries.p95',
  'compaction.plan.p50',
  'compaction.plan.p95',
  'continuation.build.p50',
  'continuation.build.p95',
] as const;

export type LongUseLatencyMetric = (typeof LONG_USE_LATENCY_METRICS)[number];

/** Frozen latency budgets in milliseconds, keyed by metric id. */
export const LONG_USE_LATENCY_BUDGET_MS: Record<LongUseLatencyMetric, number> = {
  // reload -> first rendered session row over the frozen 333-session fixture.
  'sidebar.loadSessions.p50': 900,
  'sidebar.loadSessions.p95': 1_500,
  // click -> two settled animation frames (the TF-0423 probe definition).
  'sidebar.sessionSwitch.p50': 260,
  'sidebar.sessionSwitch.p95': 420,
  // opening the largest synthetic transcript in the fixture.
  'sidebar.longSessionOpen.p95': 600,
  // one bounded sessions.summaries host call for a sidebar sweep.
  'host.sessionsSummaries.p95': 900,
  // compaction planning over a long transcript (planning only, no provider).
  'compaction.plan.p50': 1_500,
  'compaction.plan.p95': 3_000,
  // continuation build for one bounded completion batch.
  'continuation.build.p50': 600,
  'continuation.build.p95': 1_500,
};

/** A null observation is explicitly unmeasured: it is never a pass. */
export type LongUseLatencyObservation = Partial<Record<LongUseLatencyMetric, number | null>>;

export type LongUseLatencyVerdict = {
  passed: boolean;
  violations: Array<{ metric: LongUseLatencyMetric; observedMs: number; budgetMs: number }>;
  unmeasured: LongUseLatencyMetric[];
};

/**
 * Compares observations with the frozen budgets. Missing or null cells are
 * returned as unmeasured so a reviewer can see what was never proven; a single
 * over-budget cell fails the verdict.
 */
export function evaluateLongUseLatency(observed: LongUseLatencyObservation): LongUseLatencyVerdict {
  const violations: LongUseLatencyVerdict['violations'] = [];
  const unmeasured: LongUseLatencyMetric[] = [];
  for (const metric of LONG_USE_LATENCY_METRICS) {
    const value = observed[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      unmeasured.push(metric);
      continue;
    }
    const budget = LONG_USE_LATENCY_BUDGET_MS[metric];
    if (value > budget) violations.push({ metric, observedMs: value, budgetMs: budget });
  }
  return { passed: violations.length === 0, violations, unmeasured };
}

/** Frozen resident-memory, owner-count and cache budgets. */
export const LONG_USE_RESIDENCY_BUDGET = {
  /** Lifecycle rounds the measurement must run at minimum. */
  minLifecycleRounds: 50,
  maxRssGrowthBytes: 64 * 1024 * 1024,
  maxMonotonicRiseRatio: 0.6,
  minIdleRssSamples: 55,
  /** The suite must expose an explicit GC gate; without it the node fails. */
  requireExplicitGcGate: true,
  /** Post-teardown residue allowed for the measured scope. */
  maxScopeResidue: {
    terminals: 0,
    managedPorts: 0,
    envelopeEntries: 0,
    admissionEntries: 0,
    admissionActive: 0,
    admissionFenced: 0,
    admissionWaiters: 0,
    labelHydrationInFlight: 0,
    labelHydrationHandled: 0,
    timerTasks: 0,
    watcherSubscriptions: 0,
    rendererHostEventSubscriptions: 0,
  },
  /** keep_on_leave handles are accounted separately, never as residue. */
  keepOnLeaveAccountedSeparately: true,
  /** The admission registry must stay inside its shipped capacity bound. */
  admissionMaxEntriesBudget: 1_024,
  /** Heap growth allowed across the rounds once the explicit GC gate has run. */
  maxHeapGrowthAfterGcBytes: 32 * 1024 * 1024,
  /** Renderer poll surfaces must register at most one timer each. */
  maxTimersPerPollSurface: 1,
} as const;

/** Frozen notification and background-queue budgets. */
export const LONG_USE_NOTIFICATION_BUDGET = {
  /** One meaningful steering result per requester turn and per batch. */
  maxMeaningfulPromptsPerBatch: 1,
  maxMergedSteeringChars: 24_000,

  maxResultCharsPerItem: 6_000,
  maxMetadataChars: 500,
  maxCompletionBatchWorkers: 64,
  maxCompletionBatchesPerSnapshot: 8,
  /** Duplicate or replayed events must never reach the chat store twice. */
  maxDuplicateNotificationDeliveries: 0,
  loadSessionsMinIntervalMs: 1_200,
  loadHistoryMinIntervalMs: 800,
  gatewayEventDedupeTtlMs: 30_000,
  /** A sidebar sweep requests at most this many summary keys. */
  maxSummaryKeysPerSweep: 40,
  /** Hidden UI: a background-priority poll must not issue work at all. */
  hiddenSurfaceMaxPollTasks: 0,
  /** Paused / expired / stale-generation follow-ups must never execute work. */
  maxRefusedFollowUpExecutions: 0,
  /** A refused follow-up round must not add queue depth. */
  maxGrowthPerRefusedFollowUpRound: 0,
} as const;

/**
 * Derived structural ceiling for ONE atomic Team Result Bundle. The shipped
 * owner keeps a batch whole instead of truncating it ("batch atomicity wins over
 * the soft prompt cap"), so a single maximum-size batch may exceed
 * maxMergedSteeringChars; its bound comes from the shipped per-item clamps:
 *   workers x (result clamp + 4 metadata clamp + line scaffolding) + prefix.
 * Declared from owner constants, not from an observed sample.
 */
export const LONG_USE_MAX_SINGLE_BATCH_STEERING_CHARS: number =
  LONG_USE_NOTIFICATION_BUDGET.maxCompletionBatchWorkers
    * (LONG_USE_NOTIFICATION_BUDGET.maxResultCharsPerItem
      + LONG_USE_NOTIFICATION_BUDGET.maxMetadataChars * 4
      + 100)
  + 1_000;

/** Scopes that stay explicitly unmeasured for this node. */
export const LONG_USE_UNMEASURED_SCOPE = [
  'macOS and Linux session-loading, idle-RSS and owner-count samples (only Windows x64 was sampled)',
  'live-provider long transcripts and model-driven compaction quality (no provider credential is configured)',
  'packaged / installed Electron build RSS (measured against the built dist-electron app only)',
  'real-human multi-day long use: the fixture is synthetic and agent-generated, so it is not human usage evidence',
  'renderer latency of the compaction/continuation build inside the built Electron window (planning is measured in-process against the shipped planners)',
] as const;
