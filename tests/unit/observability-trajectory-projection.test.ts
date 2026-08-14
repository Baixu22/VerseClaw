import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createObservabilityApi, type GatewayTrajectoryManager } from '../../electron/services/observability-api';
import { clearObservabilityTraceBuffer } from '../../electron/services/observability-service';
import { clearObservabilityIndex, resetObservabilityIndexForTests } from '../../electron/services/observability-index';
import {
  createObservabilityTrajectoryProjector,
  type TrajectoryProjectionDiagnostic,
} from '../../electron/services/observability-trajectory-index';
import type { ObservabilityTrace } from '../../shared/types/observability';

const timestamp = (seq: number): string => `2026-08-14T00:00:0${seq}.000Z`;

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

describe('Electron trajectory stream projection', () => {
  it('accepts ordered v2 events and rejects duplicate, invalid, and missing identity rows', async () => {
    const traces: ObservabilityTrace[] = [];
    const { projector, diagnostics } = createProjector((trace) => traces.push(trace));

    const accepted = await projector.ingest('agent:main:projection', [runEvent(1, 'start')]);
    expect(accepted).toMatchObject({ accepted: 1, rejected: 0, lastSeq: 1 });
    expect(traces.at(-1)?.status).toBe('running');

    const duplicate = await projector.ingest('agent:main:projection', [runEvent(1, 'start')]);
    expect(duplicate).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });

    const invalid = await projector.ingest('agent:main:projection', [{ ...runEvent(2, 'end'), type: 'run/update', phase: 'update' }]);
    expect(invalid).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });

    const missingIdentity = await projector.ingest('agent:main:projection', [{
      ...toolEvent(2, 'end'),
      toolCallId: undefined,
    }]);
    expect(missingIdentity).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1 });
    expect(diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      'duplicate',
      'invalid',
      'invalid',
    ]);
  });

  it('repairs a seq gap deterministically and matches full replacement', async () => {
    const events = [runEvent(1, 'start'), toolEvent(2, 'start'), toolEvent(3, 'update', 'partial'), toolEvent(4, 'end', 'done'), runEvent(5, 'end')];
    const streamTraces: ObservabilityTrace[] = [];
    const stream = createProjector((trace) => streamTraces.push(structuredClone(trace)));

    await stream.projector.ingest('agent:main:projection', events.slice(0, 1));
    const gap = await stream.projector.ingest('agent:main:projection', [events[2]]);
    expect(gap).toMatchObject({ accepted: 0, rejected: 1, lastSeq: 1, gap: { expectedSeq: 2, actualSeq: 3 } });
    await stream.projector.ingest('agent:main:projection', events.slice(1));

    const replaceTraces: ObservabilityTrace[] = [];
    const replacement = createProjector((trace) => replaceTraces.push(structuredClone(trace)));
    await replacement.projector.replace('agent:main:projection', events);

    expect(stream.projector.getLastSeq('agent:main:projection')).toBe(5);
    expect(streamTraces.at(-1)).toEqual(replaceTraces.at(-1));
  });

  it('keeps v1 fallback rows readable and explicitly marked', async () => {
    const traces: ObservabilityTrace[] = [];
    const { projector } = createProjector((trace) => traces.push(trace));
    const v1Rows = [
      {
        traceSchema: 'openclaw-trajectory',
        schemaVersion: 1,
        traceId: 'legacy-trace',
        sessionKey: 'agent:main:legacy',
        runId: 'legacy-run',
        type: 'tool.completed',
        ts: timestamp(1),
        seq: 7,
        data: { toolName: 'legacy-tool' },
      },
    ];

    const result = await projector.replace('agent:main:legacy', v1Rows, {
      legacyFallback: true,
      allowGaps: true,
      allowLegacyRows: true,
    });
    expect(result).toMatchObject({ accepted: 1, rejected: 0, lastSeq: 7 });
    expect(traces.at(-1)?.tags).toContain('legacy-v1-fallback');
  });

  it('subscribes known sessions and resubscribes after Gateway reconnect', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawx-observability-projection-stream-'));
    const previousConfigDir = process.env.OPENCLAW_CONFIG_DIR;
    const previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const rpcCalls: Array<{ method: string; params?: unknown }> = [];
    const gateway: GatewayTrajectoryManager = {
      rpc: async <T>(method: string, params?: unknown) => {
        rpcCalls.push({ method, params });
        return (method === 'observability.subscribe'
          ? { subscriptionId: 'test-subscription', sourceAvailable: true, nextSeq: 2 }
          : { events: [] }) as T;
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
      await writeFile(join(sessionsDir, 'projection.trajectory.jsonl'), [
        runEvent(1, 'start'),
        runEvent(2, 'end'),
      ].map((event) => JSON.stringify(event)).join('\n'), 'utf8');
      process.env.OPENCLAW_CONFIG_DIR = tempRoot;
      process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'index');
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await clearObservabilityIndex();

      const api = createObservabilityApi({ gatewayManager: gateway });
      await api.observability.traces();
      expect(rpcCalls.filter((call) => call.method === 'observability.subscribe')).toHaveLength(1);

      for (const listener of listeners.get('status') ?? []) listener({ state: 'reconnecting' });
      for (const listener of listeners.get('status') ?? []) listener({ state: 'running' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rpcCalls.filter((call) => call.method === 'observability.subscribe')).toHaveLength(2);
    } finally {
      vi.restoreAllMocks();
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
