// @vitest-environment node
// R0-3: trace eviction must reclaim scorecards in lockstep and treat
// over-age running traces as evictable.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ObservabilityScorecard, ObservabilityTrace } from '@shared/types/observability';

const {
  buildObservabilityDashboardSnapshot,
  clearObservabilityTraceBuffer,
  getObservabilityTraceBuffer,
  upsertObservabilityScorecard,
  upsertObservabilityTrace,
} = await import('@electron/services/observability-service');

const NOW = Date.now();
const RUNNING_TRACE_MAX_AGE_MS = 30 * 60 * 1000;

function makeTrace(id: string, startedAt: number, status: ObservabilityTrace['status'] = 'completed'): ObservabilityTrace {
  return {
    id,
    name: 'trace-' + id,
    status,
    startedAt,
    endedAt: status === 'running' ? undefined : startedAt + 1000,
    spans: [],
    events: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
    metrics: {},
    tags: [],
  };
}

function makeScorecard(traceId: string): ObservabilityScorecard {
  return {
    traceId,
    score: 0.5,
    verdict: 'mixed',
    createdAt: NOW,
  } as ObservabilityScorecard;
}

beforeEach(() => {
  clearObservabilityTraceBuffer();
});

describe('R0-3 observability trace eviction', () => {
  it('evicts scorecards together with their traces', () => {
    for (let index = 0; index < 200; index += 1) {
      const id = 'trace-' + index;
      upsertObservabilityTrace(makeTrace(id, NOW - (200 - index) * 1000));
      upsertObservabilityScorecard(makeScorecard(id));
    }
    upsertObservabilityTrace(makeTrace('trace-200', NOW));

    const buffer = getObservabilityTraceBuffer();
    expect(buffer.length).toBeLessThanOrEqual(200);
    expect(buffer.some((trace) => trace.id === 'trace-0')).toBe(false); // oldest evicted
    expect(buffer.some((trace) => trace.id === 'trace-200')).toBe(true);

    // The evicted trace's scorecard must be gone too — the dashboard exposes
    // scorecards separately, so a leak here shows ghost entries forever.
    const snapshot = buildObservabilityDashboardSnapshot();
    expect(snapshot.scorecards.some((card) => card.traceId === 'trace-0')).toBe(false);
    expect(snapshot.scorecards.some((card) => card.traceId === 'trace-199')).toBe(true);
  });

  it('treats running traces older than 30 minutes as evictable', () => {
    for (let index = 0; index < 200; index += 1) {
      upsertObservabilityTrace(makeTrace('stuck-' + index, NOW - RUNNING_TRACE_MAX_AGE_MS - 1000, 'running'));
    }
    upsertObservabilityTrace(makeTrace('fresh', NOW));

    const buffer = getObservabilityTraceBuffer();
    expect(buffer.length).toBeLessThanOrEqual(200);
    expect(buffer.some((trace) => trace.id === 'fresh')).toBe(true);
    expect(buffer.some((trace) => trace.id === 'stuck-0')).toBe(false);
  });

  it('does not evict fresh running traces', () => {
    for (let index = 0; index < 200; index += 1) {
      upsertObservabilityTrace(makeTrace('live-' + index, NOW - 1000, 'running'));
    }
    upsertObservabilityTrace(makeTrace('fresh', NOW, 'running'));

    const buffer = getObservabilityTraceBuffer();
    // All 200 running traces are younger than 30 minutes: nothing evictable.
    expect(buffer.length).toBe(201);
    expect(buffer.some((trace) => trace.id === 'fresh')).toBe(true);
  });
});
