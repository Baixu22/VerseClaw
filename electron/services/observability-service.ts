import type {
  ObservabilityDashboardSnapshot,
  ObservabilityScorecard,
  ObservabilitySourceHealth,
  ObservabilityTrace,
  ObservabilityTraceIndexEntry,
  ObservabilityHostDiagnostic,
} from '../../shared/types/observability';

// In-memory trace store shared with the Electron main process observability API.
// Traces are not persisted to disk in MVP — they reset on app restart.

const MAX_TRACES = 200;
/** A running trace older than this is considered stuck and evictable. */
const RUNNING_TRACE_MAX_AGE_MS = 30 * 60 * 1000;
const traces = new Map<string, ObservabilityTrace>();
// Scorecards merged from the runtime; keyed by traceId.
const scorecards = new Map<string, ObservabilityScorecard>();
const hostDiagnostics: ObservabilityHostDiagnostic[] = [];

const HOST_DIAGNOSTIC_CAPACITY = 200;
const HOST_DIAGNOSTIC_FAILURE_KINDS = new Set<ObservabilityHostDiagnostic['failureKind']>([
  'compile',
  'test',
  'tool_missing',
  'permission',
  'environment',
  'runtime',
  'timeout',
  'cancelled',
  'unknown',
]);
const HOST_DIAGNOSTIC_SUGGESTED_ACTIONS = new Set<ObservabilityHostDiagnostic['suggestedAction']>([
  'retry',
  'ask_user',
  'stop',
  'continue_with_caution',
]);
const TRACE_ID_PATTERN = /^[a-f0-9]{32}$/u;
const SPAN_ID_PATTERN = /^[a-f0-9]{16}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

function ownData(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const allowed = new Set(keys);
    return Object.getOwnPropertyNames(value).every((key) => allowed.has(key))
      && Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
}

function boundedOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  return value === undefined
    ? undefined
    : typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
      ? value
      : undefined;
}

function projectHostDiagnostic(value: unknown): ObservabilityHostDiagnostic | undefined {
  if (!hasOnlyKeys(value, ['schemaVersion', 'trace', 'failureKind', 'suggestedAction', 'durationMs', 'exitCode', 'signal', 'redaction'])) {
    return undefined;
  }
  if (ownData(value, 'schemaVersion') !== '1' || ownData(value, 'redaction') !== 'raw-fields-omitted') {
    return undefined;
  }

  const trace = ownData(value, 'trace');
  if (!hasOnlyKeys(trace, ['requestId', 'traceId', 'spanId', 'parentTraceId', 'runId', 'correlationDigest'])) {
    return undefined;
  }
  const requestId = ownData(trace, 'requestId');
  const traceId = ownData(trace, 'traceId');
  const spanId = ownData(trace, 'spanId');
  const parentTraceId = ownData(trace, 'parentTraceId');
  const runId = ownData(trace, 'runId');
  const correlationDigest = ownData(trace, 'correlationDigest');
  if (
    typeof requestId !== 'string' || !OPAQUE_ID_PATTERN.test(requestId)
    || typeof traceId !== 'string' || !TRACE_ID_PATTERN.test(traceId) || /^0+$/u.test(traceId)
    || typeof spanId !== 'string' || !SPAN_ID_PATTERN.test(spanId) || /^0+$/u.test(spanId)
    || (parentTraceId !== undefined && (typeof parentTraceId !== 'string' || !TRACE_ID_PATTERN.test(parentTraceId) || /^0+$/u.test(parentTraceId)))
    || (runId !== undefined && (typeof runId !== 'string' || !OPAQUE_ID_PATTERN.test(runId)))
    || (correlationDigest !== undefined && (typeof correlationDigest !== 'string' || !DIGEST_PATTERN.test(correlationDigest)))
  ) {
    return undefined;
  }

  const failureKind = ownData(value, 'failureKind');
  if (typeof failureKind !== 'string' || !HOST_DIAGNOSTIC_FAILURE_KINDS.has(failureKind as ObservabilityHostDiagnostic['failureKind'])) {
    return undefined;
  }
  const suggestedAction = ownData(value, 'suggestedAction');
  if (typeof suggestedAction !== 'string' || !HOST_DIAGNOSTIC_SUGGESTED_ACTIONS.has(suggestedAction as ObservabilityHostDiagnostic['suggestedAction'])) {
    return undefined;
  }
  const durationMs = boundedOptionalNumber(ownData(value, 'durationMs'), 0, 24 * 60 * 60 * 1000);
  const exitCode = boundedOptionalNumber(ownData(value, 'exitCode'), -1, 255);
  const signal = ownData(value, 'signal');
  if ((ownData(value, 'durationMs') !== undefined && durationMs === undefined)
    || (ownData(value, 'exitCode') !== undefined && exitCode === undefined)
    || (signal !== undefined && signal !== 'sigint' && signal !== 'sigterm' && signal !== 'sigkill' && signal !== 'other')) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: '1',
    trace: Object.freeze({
      requestId,
      traceId,
      spanId,
      ...(parentTraceId !== undefined ? { parentTraceId } : {}),
      ...(runId !== undefined ? { runId } : {}),
      ...(correlationDigest !== undefined ? { correlationDigest } : {}),
    }),
    failureKind: failureKind as ObservabilityHostDiagnostic['failureKind'],
    suggestedAction: suggestedAction as ObservabilityHostDiagnostic['suggestedAction'],
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal !== undefined ? { signal } : {}),
    redaction: 'raw-fields-omitted',
  });
}

export function recordObservabilityHostDiagnostic(summary: unknown): boolean {
  const projected = projectHostDiagnostic(summary);
  if (!projected) return false;
  hostDiagnostics.push(projected);
  if (hostDiagnostics.length > HOST_DIAGNOSTIC_CAPACITY) hostDiagnostics.shift();
  return true;
}

export function getObservabilityHostDiagnostics(): readonly ObservabilityHostDiagnostic[] {
  return [...hostDiagnostics];
}

export function upsertObservabilityTrace(trace: ObservabilityTrace): void {
  traces.set(trace.id, trace);
  if (traces.size > MAX_TRACES) {
    const now = Date.now();
    const evictable = [...traces.values()]
      .filter((candidate) => (
        candidate.status !== 'running'
        || now - candidate.startedAt > RUNNING_TRACE_MAX_AGE_MS
      ))
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const candidate of evictable) {
      if (traces.size <= MAX_TRACES) break;
      traces.delete(candidate.id);
      // R0-3: keep scorecards in lockstep with the trace store — evicted
      // traces must not leak scorecard entries forever.
      scorecards.delete(candidate.id);
    }
  }
}

export function getObservabilityTraceBuffer(): ObservabilityTrace[] {
  return [...traces.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getObservabilityTrace(id: string): ObservabilityTrace | null {
  return traces.get(id) ?? null;
}

export function upsertObservabilityScorecard(scorecard: ObservabilityScorecard): void {
  if (scorecard?.traceId) {
    scorecards.set(scorecard.traceId, scorecard);
  }
}

export function clearObservabilityTraceBuffer(): void {
  traces.clear();
  scorecards.clear();
  hostDiagnostics.length = 0;
}

function dashboardRowFromIndex(entry: ObservabilityTraceIndexEntry): ObservabilityDashboardSnapshot['traces'][number] {
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    durationMs: entry.durationMs,
    updatedAt: entry.updatedAt,
    sourceStatus: entry.sourceStatus,
    score: entry.score,
    costUsd: entry.costUsd,
    tokenCount: entry.tokenCount,
    spanCount: entry.spanCount,
    errorCount: entry.errorCount,
    toolCallCount: entry.toolCallCount,
    artifactCount: entry.artifactCount,
    warningCount: entry.warningCount,
    retryCount: entry.retryCount,
    approvalCount: entry.approvalCount,
    issueCount: entry.issueCount,
    issues: entry.issues,
    firstError: entry.firstError,
    slowestNodeLabel: entry.slowestNodeLabel,
    startedAt: entry.startedAt,
    sessionKey: entry.sessionKey,
    runId: entry.runId,
    leadRole: entry.leadRole,
    agent: entry.agent,
    role: entry.role,
    model: entry.model,
    hasToolCalls: entry.hasToolCalls,
    hasArtifacts: entry.hasArtifacts,
    hasApproval: entry.hasApproval,
    hasRetries: entry.hasRetries,
    hasWarnings: entry.hasWarnings,
    correlation: entry.correlation,
  };
}

function defaultSourceHealth(memoryTraceCount: number, indexEntryCount: number): ObservabilitySourceHealth {
  return {
    runtime: {
      status: memoryTraceCount > 0 ? 'ok' : 'empty',
      reason: memoryTraceCount > 0 ? 'available' : 'no-data',
    },
    index: {
      status: indexEntryCount > 0 ? 'ok' : 'empty',
      reason: indexEntryCount > 0 ? 'available' : 'no-data',
    },
    trajectory: { status: 'empty', reason: 'no-data' },
  };
}

export function buildObservabilityDashboardSnapshot(
  indexEntries: ObservabilityTraceIndexEntry[] = [],
  sourceHealth?: ObservabilitySourceHealth,
): ObservabilityDashboardSnapshot {
  const now = Date.now();
  const allTraces = getObservabilityTraceBuffer();

  const traceRows = allTraces.map((trace) => {
    const spans = trace.spans ?? [];
    const events = trace.events ?? [];
    const errorCount = spans.filter(
      (span) => span.status === 'error' || span.status === 'aborted',
    ).length;
    const orchestrator = spans.find((span) => span.kind === 'orchestrator');
    const leadRole = typeof orchestrator?.attributes?.leadRole === 'string'
      ? orchestrator.attributes.leadRole
      : spans.find((span) => span.roleName)?.roleName;
    const toolCallCount = spans.filter((span) => span.kind === 'tool').length;
    const artifactCount = events.filter((event) => /file|patch|artifact|output/iu.test(event.type)).length
      + spans.filter((span) => /file|patch|artifact|output/iu.test(span.kind) || /file|patch|artifact|output/iu.test(span.name)).length;
    const warningCount = events.filter((event) => /warn/iu.test(event.type) || /warn/iu.test(event.name)).length;
    const retryCount = events.filter((event) => /retry/iu.test(event.type) || /retry/iu.test(event.name)).length;
    const approvalCount = events.filter((event) => /approval/iu.test(event.type) || /approval/iu.test(event.name)).length
      + spans.filter((span) => /approval/iu.test(span.name)).length;
    const slowestSpan = [...spans].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
    return {
      id: trace.id,
      name: trace.name,
      status: trace.status,
      durationMs: trace.durationMs ?? 0,
      updatedAt: trace.updatedAt ?? trace.endedAt ?? trace.startedAt,
      sourceStatus: 'live' as const,
      costUsd: trace.tokenUsage?.costUsd ?? 0,
      tokenCount: trace.tokenUsage?.totalTokens ?? 0,
      spanCount: spans.length,
      errorCount,
      toolCallCount,
      artifactCount,
      warningCount,
      retryCount,
      approvalCount,
      slowestNodeLabel: slowestSpan?.roleName ?? slowestSpan?.name,
      startedAt: trace.startedAt,
      sessionKey: trace.sessionKey,
      runId: trace.runId,
      leadRole,
      hasToolCalls: toolCallCount > 0,
      hasArtifacts: artifactCount > 0,
      hasApproval: approvalCount > 0,
      hasRetries: retryCount > 0,
      hasWarnings: warningCount > 0,
      correlation: {
        traceId: trace.id,
        runId: trace.runId,
        sessionKey: trace.sessionKey,
        filePaths: [],
      },
    };
  });

  const mergedRows = new Map<string, ObservabilityDashboardSnapshot['traces'][number]>();
  for (const entry of indexEntries) mergedRows.set(entry.id, dashboardRowFromIndex(entry));
  for (const row of traceRows) mergedRows.set(row.id, row);
  const dashboardRows = [...mergedRows.values()]
    .sort((a, b) => (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0));

  const totalTraces = dashboardRows.length;
  const totalSpanErrors = dashboardRows.reduce((sum, row) => sum + row.errorCount, 0);
  // A trace counts as failed if the run itself errored/aborted OR any span errored.
  // (Counting only span errors missed failed runs that produced zero spans.)
  const failedTraces = dashboardRows.filter(
    (trace) =>
      trace.status === 'error' ||
      trace.status === 'aborted' ||
      trace.errorCount > 0,
  ).length;
  const totalTokens = dashboardRows.reduce((sum, row) => sum + row.tokenCount, 0);
  const totalCost = dashboardRows.reduce((sum, row) => sum + row.costUsd, 0);
  const avgDuration = totalTraces > 0 ? Math.round(dashboardRows.reduce((sum, row) => sum + row.durationMs, 0) / totalTraces) : 0;

  const alerts: string[] = [];
  if (failedTraces > 0) {
    const detail = totalSpanErrors > 0 ? ` (${totalSpanErrors} error span(s))` : '';
    alerts.push(`${failedTraces} of ${totalTraces} trace(s) failed${detail}.`);
  }
  const adversarialTraces = allTraces.filter((trace) => trace.mode === 'adversarial-review');
  for (const trace of adversarialTraces) {
    const hasVerifier = (trace.spans ?? []).some(
      (span) => span.kind === 'verifier' || span.roleName === 'skeptic',
    );
    if (!hasVerifier) {
      alerts.push(`${trace.name} is missing a verifier/skeptic span.`);
    }
  }
  for (const row of dashboardRows) {
    const criticalIssue = row.issues?.find((issue) => issue.severity === 'critical' || issue.category === 'error-root-cause');
    if (criticalIssue) alerts.push(`${row.name}: ${criticalIssue.title}.`);
  }

  return {
    generatedAt: now,
    cards: [
      { id: 'traces', label: 'Traces', value: totalTraces, tone: 'neutral' },
      { id: 'avg-duration', label: 'Avg Duration', value: avgDuration, unit: 'ms', tone: 'neutral' },
      { id: 'errors', label: 'Errors', value: failedTraces, tone: failedTraces === 0 ? 'good' : 'bad' },
      { id: 'tokens', label: 'Tokens', value: totalTokens, tone: 'neutral' },
      { id: 'cost', label: 'Cost', value: Number(totalCost.toFixed(6)), unit: 'USD', tone: totalCost > 1 ? 'warn' : 'good' },
    ],
    scorecards: [...scorecards.values()],
    traces: dashboardRows,
    alerts,
    sourceHealth: sourceHealth ?? defaultSourceHealth(allTraces.length, indexEntries.length),
  };
}
