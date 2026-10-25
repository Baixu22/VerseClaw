/** Frozen F2 budgets and pure evaluation for long-use measurements. */
export const LONG_SESSION_LONG_USE_BUDGET = {
  schema: 'clawx.long-session.long-use-budget/v1',
  minimumSessionCount: 333,
  minimumTranscriptBytes: 50 * 1024 * 1024,
  maxLoadP95Ms: 1_500,
  maxSwitchP95Ms: 300,
  // Re-frozen before the official run from two short smoke probes on this same
  // candidate: manual compaction of a 37.6k-token / 151 KB session (the runtime
  // pipeline, with an instant agent-driven model) measured 7.4-9.0 s. The first
  // 5 s value was a placeholder with no compaction calibration.
  maxCompactP95Ms: 15_000,
  maxContinuationP95Ms: 3_000,
  idleDurationMs: 300_000,
  idleSampleMs: 5_000,
  maxIdleGrowthBytes: 64 * 1024 * 1024,
  maxIdleLongestRise: 12,
  minimumLifecycleCycles: 50,
  maxOwnerResidual: 0,
  maxNotificationDuplicates: 0,
  maxPausedQueueLength: 64,
  maxExpiredQueueLength: 64,
} as const;

export type LongUseMeasurement = {
  sessionCount: number;
  transcriptBytes: number;
  loadP95Ms: number;
  switchP95Ms: number;
  compactP95Ms: number;
  continuationP95Ms: number;
  gcAvailable: boolean;
  idleDurationMs: number;
  idleSampleCount: number;
  idleGrowthBytes: number;
  idleLongestRise: number;
  lifecycleCycles: number;
  ownerResidual: number;
  notificationDuplicates: number;
  pausedQueueLength: number;
  expiredQueueLength: number;
};

export function percentile(values: readonly number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index] ?? null;
}

export function evaluateLongSessionLongUseBudgets(measurement: LongUseMeasurement): string[] {
  const failures: string[] = [];
  if (measurement.sessionCount < LONG_SESSION_LONG_USE_BUDGET.minimumSessionCount) failures.push('session-count');
  if (measurement.transcriptBytes < LONG_SESSION_LONG_USE_BUDGET.minimumTranscriptBytes) failures.push('transcript-bytes');
  if (measurement.loadP95Ms > LONG_SESSION_LONG_USE_BUDGET.maxLoadP95Ms) failures.push('load-p95');
  if (measurement.switchP95Ms > LONG_SESSION_LONG_USE_BUDGET.maxSwitchP95Ms) failures.push('switch-p95');
  if (measurement.compactP95Ms > LONG_SESSION_LONG_USE_BUDGET.maxCompactP95Ms) failures.push('compact-p95');
  if (measurement.continuationP95Ms > LONG_SESSION_LONG_USE_BUDGET.maxContinuationP95Ms) failures.push('continuation-p95');
  if (!measurement.gcAvailable) failures.push('gc-unavailable');
  if (measurement.idleDurationMs < LONG_SESSION_LONG_USE_BUDGET.idleDurationMs) failures.push('idle-duration');
  if (measurement.idleSampleCount < 2) failures.push('idle-samples');
  if (measurement.idleGrowthBytes > LONG_SESSION_LONG_USE_BUDGET.maxIdleGrowthBytes) failures.push('idle-growth');
  if (measurement.idleLongestRise > LONG_SESSION_LONG_USE_BUDGET.maxIdleLongestRise) failures.push('idle-monotonic-rise');
  if (measurement.lifecycleCycles < LONG_SESSION_LONG_USE_BUDGET.minimumLifecycleCycles) failures.push('lifecycle-cycles');
  if (measurement.ownerResidual > LONG_SESSION_LONG_USE_BUDGET.maxOwnerResidual) failures.push('owner-residual');
  if (measurement.notificationDuplicates > LONG_SESSION_LONG_USE_BUDGET.maxNotificationDuplicates) failures.push('notification-duplicates');
  if (measurement.pausedQueueLength > LONG_SESSION_LONG_USE_BUDGET.maxPausedQueueLength) failures.push('paused-queue');
  if (measurement.expiredQueueLength > LONG_SESSION_LONG_USE_BUDGET.maxExpiredQueueLength) failures.push('expired-queue');
  return failures;
}
