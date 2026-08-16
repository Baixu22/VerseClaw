// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ObservabilityTrace } from '../../shared/types/observability';
import { createObservabilityApi, setRuntimeTraceFetcher } from '../../electron/services/observability-api';
import {
  clearObservabilityTraceBuffer,
  getObservabilityTraceBuffer,
  upsertObservabilityTrace,
} from '../../electron/services/observability-service';
import {
  clearObservabilityIndex,
  persistObservabilityTraceToIndex,
  queryObservabilityTraces,
  resetObservabilityIndexForTests,
} from '../../electron/services/observability-index';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function makeTrace(id: string, startedAt: number, overrides: Partial<ObservabilityTrace> = {}): ObservabilityTrace {
  return {
    id,
    name: id,
    status: 'completed',
    startedAt,
    updatedAt: startedAt,
    durationMs: 0,
    spans: [],
    events: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
    metrics: {},
    tags: [],
    ...overrides,
  };
}

function trajectoryLine(id: string, index: number, timestamp: string): string {
  return JSON.stringify({
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: id,
    sessionKey: 'agent:main:main',
    runId: `run-${index}`,
    type: 'tool.completed',
    ts: timestamp,
    seq: 1,
    data: { toolName: 'read', path: `src/file-${index}.ts` },
  });
}

describe('WV-B0 observability data-path baseline', () => {
  let tempRoot: string;
  let previousUserData: string | undefined;
  let previousIndexDir: string | undefined;
  let previousOpenClawConfigDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clawx-wv-b0-observability-'));
    previousUserData = process.env.VERSE_CLAW_USER_DATA_DIR;
    previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    previousOpenClawConfigDir = process.env.OPENCLAW_CONFIG_DIR;
    process.env.VERSE_CLAW_USER_DATA_DIR = tempRoot;
    process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'observability-index');
    process.env.OPENCLAW_CONFIG_DIR = join(tempRoot, 'openclaw-config');
    clearObservabilityTraceBuffer();
    resetObservabilityIndexForTests();
    await clearObservabilityIndex();
    setRuntimeTraceFetcher(async () => ({ traces: [], scorecards: [] }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    clearObservabilityTraceBuffer();
    resetObservabilityIndexForTests();
    setRuntimeTraceFetcher(async () => ({ traces: [], scorecards: [] }));
    if (previousUserData == null) delete process.env.VERSE_CLAW_USER_DATA_DIR;
    else process.env.VERSE_CLAW_USER_DATA_DIR = previousUserData;
    if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
    if (previousOpenClawConfigDir == null) delete process.env.OPENCLAW_CONFIG_DIR;
    else process.env.OPENCLAW_CONFIG_DIR = previousOpenClawConfigDir;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('merges runtime fetcher updates into the in-memory trace buffer by trace id', async () => {
    const api = createObservabilityApi();
    setRuntimeTraceFetcher(async () => ({
      traces: [makeTrace('runtime-trace', 100, { name: 'first snapshot' })],
      scorecards: [],
    }));

    await api.observability.traces();

    setRuntimeTraceFetcher(async () => ({
      traces: [makeTrace('runtime-trace', 200, { name: 'refreshed snapshot' })],
      scorecards: [],
    }));
    const traces = await api.observability.traces() as ObservabilityTrace[];

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ id: 'runtime-trace', name: 'refreshed snapshot', startedAt: 200 });
  });

  it('records runtime fetch failures in the dashboard source health without failing the snapshot', async () => {
    setRuntimeTraceFetcher(async () => {
      throw new Error('Gateway trace RPC unavailable');
    });

    const snapshot = await createObservabilityApi().observability.dashboardSnapshot();

    expect(snapshot.traces).toEqual([]);
    expect(snapshot.sourceHealth).toMatchObject({
      runtime: {
        status: 'error',
        reason: 'failed',
        detail: 'Gateway trace RPC unavailable',
      },
      index: { status: 'empty', reason: 'no-data' },
      trajectory: { status: 'empty', reason: 'no-data' },
    });
  });

  it('keeps the 200-trace cap while only evicting completed or over-age running traces', () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-14T10:00:00.000Z');
    vi.setSystemTime(now);

    for (let index = 0; index < 199; index += 1) {
      upsertObservabilityTrace(makeTrace(`completed-${index}`, now.getTime() - 10_000 - index));
    }
    upsertObservabilityTrace(makeTrace('stuck-running', now.getTime() - THIRTY_MINUTES_MS - 1, { status: 'running' }));
    upsertObservabilityTrace(makeTrace('incoming', now.getTime(), { status: 'running' }));

    expect(getObservabilityTraceBuffer()).toHaveLength(200);
    expect(getObservabilityTraceBuffer().some((trace) => trace.id === 'stuck-running')).toBe(false);
    expect(getObservabilityTraceBuffer().some((trace) => trace.id === 'incoming')).toBe(true);

    clearObservabilityTraceBuffer();
    for (let index = 0; index < 200; index += 1) {
      upsertObservabilityTrace(makeTrace(`fresh-running-${index}`, now.getTime() - 1, { status: 'running' }));
    }
    upsertObservabilityTrace(makeTrace('fresh-incoming', now.getTime(), { status: 'running' }));

    expect(getObservabilityTraceBuffer()).toHaveLength(201);
  });

  it('caps trajectory scans at 40 session files and ignores malformed trajectory lines', async () => {
    const sessionsDir = join(tempRoot, 'openclaw-source-state', 'agents', 'main', 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const baseTime = Date.now() - 60_000;

    for (let index = 0; index <= 40; index += 1) {
      const sessionId = `session-${index}`;
      const transcriptPath = join(sessionsDir, `${sessionId}.jsonl`);
      const trajectoryPath = join(sessionsDir, `${sessionId}.trajectory.jsonl`);
      const timestamp = new Date(baseTime + index * 1000).toISOString();
      const lines = index === 40
        ? ['{not valid json', trajectoryLine(`trajectory-${index}`, index, timestamp)]
        : [trajectoryLine(`trajectory-${index}`, index, timestamp)];
      await writeFile(transcriptPath, '{"type":"session.placeholder"}\n', 'utf8');
      await writeFile(trajectoryPath, `${lines.join('\n')}\n`, 'utf8');
      const fileTime = new Date(baseTime + index * 1000);
      await utimes(transcriptPath, fileTime, fileTime);
    }

    const api = createObservabilityApi();
    const result = await api.observability.queryTraces({ pageSize: 200 });

    expect(result.total).toBe(40);
    expect(result.items.some((trace) => trace.runId === 'run-0')).toBe(false);
    expect(result.items.some((trace) => trace.runId === 'run-40')).toBe(true);
  });

  it('returns deterministic pages from the indexed trace query', async () => {
    const now = Date.now();
    for (let index = 0; index < 6; index += 1) {
      await persistObservabilityTraceToIndex(makeTrace(`page-${index}`, now + index));
    }

    const firstPage = await queryObservabilityTraces({ page: 1, pageSize: 2, sortBy: 'updatedAt', sortDir: 'asc' });
    const secondPage = await queryObservabilityTraces({ page: 2, pageSize: 2, sortBy: 'updatedAt', sortDir: 'asc' });
    const thirdPage = await queryObservabilityTraces({ page: 3, pageSize: 2, sortBy: 'updatedAt', sortDir: 'asc' });

    expect(firstPage.total).toBe(6);
    expect(firstPage.items.map((trace) => trace.id)).toEqual(['page-0', 'page-1']);
    expect(secondPage.items.map((trace) => trace.id)).toEqual(['page-2', 'page-3']);
    expect(thirdPage.items.map((trace) => trace.id)).toEqual(['page-4', 'page-5']);
  });
});
