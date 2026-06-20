import type {
  ObservabilityDashboardSnapshot,
  ObservabilityScorecard,
  ObservabilityTrace,
  ObservabilityTraceIndexEntry,
} from '../../shared/types/observability';

// In-memory trace store shared with the Electron main process observability API.
// Traces are not persisted to disk in MVP — they reset on app restart.

const MAX_TRACES = 200;
const traces = new Map<string, ObservabilityTrace>();
// Scorecards merged from the runtime; keyed by traceId.
const scorecards = new Map<string, ObservabilityScorecard>();

export function upsertObservabilityTrace(trace: ObservabilityTrace): void {
  traces.set(trace.id, trace);
  if (traces.size > MAX_TRACES) {
    const evictable = [...traces.values()]
      .filter((candidate) => candidate.status !== 'running')
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const candidate of evictable) {
      if (traces.size <= MAX_TRACES) break;
      traces.delete(candidate.id);
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

export function buildObservabilityDashboardSnapshot(indexEntries: ObservabilityTraceIndexEntry[] = []): ObservabilityDashboardSnapshot {
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
  };
}
