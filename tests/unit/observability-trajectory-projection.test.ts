import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createObservabilityApi,
  type GatewayTrajectoryManager,
} from '../../electron/services/observability-api';
import { clearObservabilityTraceBuffer } from '../../electron/services/observability-service';
import {
  clearObservabilityIndex,
  resetObservabilityIndexForTests,
} from '../../electron/services/observability-index';
import {
  createObservabilityTrajectoryProjector,
  type TrajectoryProjectionDiagnostic,
} from '../../electron/services/observability-trajectory-index';
import type { ObservabilityTrace } from '../../shared/types/observability';

const timestamp = (seq: number): string => `2026-08-15T00:00:0${seq}.000Z`;

function runEvent(seq: number, phase: 'start' | 'end', state: Record<string, unknown> = {}) {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 2,
    traceId: 'trace-projection-1',
    source: 'runtime',
    ts: timestamp(seq),
    seq,
    type: `run/${phase}`,
    role: 'run',
    phase,
    runId: 'run-projection-1',
    state: { status: phase === 'start' ? 'running' : 'completed', ...state },
  };
}

function toolEvent(seq: number, phase: 'start' | 'update' | 'end', output?: string) {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 2,
    traceId: 'trace-projection-1',
    source: 'runtime',
    ts: timestamp(seq),
    seq,
    type: `tool/${phase}`,
    role: 'tool',
    phase,
    runId: 'run-projection-1',
    turnId: 'turn-projection-1',
    stepId: 'step-projection-1',
    toolCallId: 'tool-projection-1',
    state: { status: phase === 'end' ? 'completed' : 'running', ...(output ? { output } : {}) },
    data: { toolName: 'exec', ...(output ? { output } : {}) },
  };
}

function createProjector(onTrace: (trace: ObservabilityTrace) => void) {
  const diagnostics: TrajectoryProjectionDiagnostic[] = [];
  const projector = createObservabilityTrajectoryProjector({
    onTrace,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { diagnostics, projector };
}

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

describe('Electron trajectory stream projection', () => {
  it('accepts ordered v2 rows and explicitly rejects duplicate, invalid, and missing identity rows', async () => {
    const traces: ObservabilityTrace[] = [];
    const { projector, diagnostics } = createProjector((trace) => traces.push(trace));

    expect(await projector.ingest('agent:main:projection', [runEvent(1, 'start')]))
      .toMatchObject({ accepted: 1, rejected: 0, lastSeq: 1 });
    expect(traces.at(-1)?.status).toBe('running');

    expect(await projector.ingest('agent:main:projection', [runEvent(1, 'start')]))
      .toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });
    expect(await projector.ingest('agent:main:projection', [{
      ...runEvent(2, 'end'),
      type: 'run/update',
      phase: 'update',
    }])).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });
    expect(await projector.ingest('agent:main:projection', [{
      ...toolEvent(2, 'end'),
      toolCallId: undefined,
    }])).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });
    expect(diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'duplicate',
      'invalid',
      'invalid',
    ]);
  });

  it('repairs a seq gap deterministically and matches a complete replacement', async () => {
    const events = [
      runEvent(1, 'start'),
      toolEvent(2, 'start'),
      toolEvent(3, 'update', 'partial'),
      toolEvent(4, 'end', 'done'),
      runEvent(5, 'end'),
    ];
    const streamTraces: ObservabilityTrace[] = [];
    const stream = createProjector((trace) => streamTraces.push(structuredClone(trace)));

    await stream.projector.ingest('agent:main:projection', events.slice(0, 1));
    expect(await stream.projector.ingest('agent:main:projection', [events[2]]))
      .toMatchObject({
        accepted: 0,
        rejected: 1,
        lastSeq: 1,
        gap: { expectedSeq: 2, actualSeq: 3 },
      });
    await stream.projector.ingest('agent:main:projection', events.slice(1));

    const replacementTraces: ObservabilityTrace[] = [];
    const replacement = createProjector((trace) => replacementTraces.push(structuredClone(trace)));
    await replacement.projector.replace('agent:main:projection', events);

    expect(stream.projector.getLastSeq('agent:main:projection')).toBe(5);
    expect(streamTraces.at(-1)).toEqual(replacementTraces.at(-1));
  });

  it('keeps v1 fallback rows readable and explicitly marked', async () => {
    const traces: ObservabilityTrace[] = [];
    const { projector } = createProjector((trace) => traces.push(trace));

    const result = await projector.replace('agent:main:legacy', [{
      traceSchema: 'openclaw-trajectory',
      schemaVersion: 1,
      traceId: 'legacy-trace',
      sessionKey: 'agent:main:legacy',
      runId: 'legacy-run',
      type: 'tool.completed',
      ts: timestamp(1),
      seq: 7,
      data: { toolName: 'legacy-tool' },
    }], {
      legacyFallback: true,
      allowGaps: true,
      allowLegacyRows: true,
    });

    expect(result).toMatchObject({ accepted: 1, rejected: 0, lastSeq: 7 });
    expect(traces.at(-1)?.tags).toContain('legacy-v1-fallback');
  });

  it('rehydrates persisted v1 sidecars after an Electron restart as a marked fallback', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-v1-restart-'));
    const previousConfigDir = process.env.OPENCLAW_CONFIG_DIR;
    const previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const gateway: GatewayTrajectoryManager = {
      rpc: async <T>(method: string) => (method === 'observability.readFrom'
        ? { events: [], hasMore: false }
        : { subscriptionId: 'test-subscription' }) as T,
      on: (event, listener) => {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      off: (event, listener) => listeners.get(event)?.delete(listener),
      getStatus: () => ({ state: 'running' }),
    };

    try {
      const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, 'legacy.jsonl'), '{"type":"session.placeholder"}\n', 'utf8');
      await writeFile(join(sessionsDir, 'legacy.trajectory.jsonl'), `${JSON.stringify({
        traceSchema: 'openclaw-trajectory',
        schemaVersion: 1,
        traceId: 'legacy-restart-trace',
        sessionKey: 'agent:main:legacy',
        runId: 'legacy-restart-run',
        type: 'tool.completed',
        ts: timestamp(1),
        seq: 1,
        data: { toolName: 'legacy-tool' },
      })}\n`, 'utf8');
      process.env.OPENCLAW_CONFIG_DIR = tempRoot;
      process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'index');
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await clearObservabilityIndex();

      const firstApi = createObservabilityApi({ gatewayManager: gateway });
      expect((await firstApi.observability.traces()).find((trace) => trace.runId === 'legacy-restart-run')?.tags)
        .toContain('legacy-v1-fallback');

      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await clearObservabilityIndex();
      const restartedApi = createObservabilityApi({ gatewayManager: gateway });
      expect((await restartedApi.observability.traces()).find((trace) => trace.runId === 'legacy-restart-run')?.tags)
        .toContain('legacy-v1-fallback');
    } finally {
      if (previousConfigDir == null) delete process.env.OPENCLAW_CONFIG_DIR;
      else process.env.OPENCLAW_CONFIG_DIR = previousConfigDir;
      if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
      else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('repairs a live notification gap with readFrom without accepting the gap event first', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-gap-repair-'));
    const previousConfigDir = process.env.OPENCLAW_CONFIG_DIR;
    const previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const readFromCalls: Array<Record<string, unknown>> = [];
    let repairRequested = false;
    const gateway: GatewayTrajectoryManager = {
      rpc: async <T>(method: string, params?: unknown) => {
        if (method === 'observability.readFrom') {
          readFromCalls.push(params as Record<string, unknown>);
          return (repairRequested
            ? { events: [toolEvent(2, 'end', 'repaired'), runEvent(3, 'end')], hasMore: false }
            : { events: [runEvent(1, 'start')], hasMore: false }) as T;
        }
        return { subscriptionId: 'test-subscription' } as T;
      },
      on: (event, listener) => {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      off: (event, listener) => listeners.get(event)?.delete(listener),
      getStatus: () => ({ state: 'running' }),
    };

    try {
      const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, 'projection.jsonl'), '{"type":"session.placeholder"}\n', 'utf8');
      process.env.OPENCLAW_CONFIG_DIR = tempRoot;
      process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'index');
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await clearObservabilityIndex();

      const api = createObservabilityApi({ gatewayManager: gateway });
      await api.observability.traces();
      repairRequested = true;
      for (const listener of listeners.get('notification') ?? []) {
        listener({
          method: 'observability.trajectory',
          params: {
            kind: 'events',
            sessionKey: 'agent:main:projection',
            events: [runEvent(3, 'end')],
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(readFromCalls.map((params) => params.fromSeq)).toEqual([0, 1]);
      expect((await api.observability.traces()).at(-1)?.status).toBe('completed');
    } finally {
      if (previousConfigDir == null) delete process.env.OPENCLAW_CONFIG_DIR;
      else process.env.OPENCLAW_CONFIG_DIR = previousConfigDir;
      if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
      else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('hydrates all known sessions and keeps the connection-scoped live subscription on the newest session', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-projection-'));
    const previousConfigDir = process.env.OPENCLAW_CONFIG_DIR;
    const previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const rpcCalls: Array<{ method: string; params?: unknown }> = [];
    const gateway: GatewayTrajectoryManager = {
      rpc: async <T>(method: string, params?: unknown) => {
        rpcCalls.push({ method, params });
        return (method === 'observability.subscribe'
          ? { subscriptionId: 'test-subscription' }
          : { events: [], hasMore: false }) as T;
      },
      on: (event, listener) => {
        const bucket = listeners.get(event) ?? new Set();
        bucket.add(listener);
        listeners.set(event, bucket);
      },
      off: (event, listener) => listeners.get(event)?.delete(listener),
      getStatus: () => ({ state: 'running' }),
    };

    try {
      const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
      await mkdir(sessionsDir, { recursive: true });
      const olderSessionPath = join(sessionsDir, 'older.jsonl');
      const newestSessionPath = join(sessionsDir, 'newest.jsonl');
      await writeFile(olderSessionPath, '{"type":"session.placeholder"}\n', 'utf8');
      await writeFile(newestSessionPath, '{"type":"session.placeholder"}\n', 'utf8');
      const now = Date.now() / 1_000;
      await utimes(olderSessionPath, now - 60, now - 60);
      await utimes(newestSessionPath, now, now);
      process.env.OPENCLAW_CONFIG_DIR = tempRoot;
      process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'index');
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await clearObservabilityIndex();

      const api = createObservabilityApi({ gatewayManager: gateway });
      await api.observability.traces();
      expect(rpcCalls.filter((call) => call.method === 'observability.readFrom').map(
        (call) => (call.params as { sessionKey: string }).sessionKey,
      )).toEqual(['agent:main:newest', 'agent:main:older']);
      expect(rpcCalls.filter((call) => call.method === 'observability.subscribe')).toHaveLength(1);
      expect(rpcCalls.find((call) => call.method === 'observability.subscribe')?.params).toEqual({
        sessionKey: 'agent:main:newest',
        fromSeq: 0,
      });
      expect(rpcCalls.some((call) => call.method === 'observability.traces')).toBe(false);

      const replacementSessionPath = join(sessionsDir, 'replacement.jsonl');
      await writeFile(replacementSessionPath, '{"type":"session.placeholder"}\n', 'utf8');
      await utimes(replacementSessionPath, now + 60, now + 60);
      for (const listener of listeners.get('status') ?? []) listener({ state: 'running' });
      await waitFor(() => {
        expect(rpcCalls.filter((call) => call.method === 'observability.unsubscribe')).toHaveLength(1);
        expect(rpcCalls.filter((call) => call.method === 'observability.subscribe')).toHaveLength(2);
      });
      expect(rpcCalls.at(-1)).toEqual({
        method: 'observability.subscribe',
        params: { sessionKey: 'agent:main:replacement', fromSeq: 0 },
      });

      for (const listener of listeners.get('status') ?? []) listener({ state: 'reconnecting' });
      for (const listener of listeners.get('status') ?? []) listener({ state: 'running' });
      await waitFor(() => {
        expect(rpcCalls.filter((call) => call.method === 'observability.subscribe')).toHaveLength(3);
      });
    } finally {
      if (previousConfigDir == null) delete process.env.OPENCLAW_CONFIG_DIR;
      else process.env.OPENCLAW_CONFIG_DIR = previousConfigDir;
      if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
      else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
