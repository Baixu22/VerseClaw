import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
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
import type {
  ObservabilityTrajectorySupplyEvent,
} from '../../shared/types/observability';
import type { TrajectoryEventV2 } from '../../openclaw_runtime/src/trajectory/types';

const timestamp = (seq: number): string => `2026-08-15T00:00:${String(seq).padStart(2, '0')}.000Z`;

function runEvent(seq: number, phase: 'start' | 'end', state: Record<string, unknown> = {}) {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 2,
    traceId: 'trace-supply-1',
    source: 'runtime',
    ts: timestamp(seq),
    seq,
    type: `run/${phase}`,
    role: 'run',
    phase,
    runId: 'run-supply-1',
    state: { status: phase === 'start' ? 'running' : 'completed', ...state },
  };
}

function toolEvent(seq: number, phase: 'start' | 'update' | 'end', output?: string) {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 2,
    traceId: 'trace-supply-1',
    source: 'runtime',
    ts: timestamp(seq),
    seq,
    type: `tool/${phase}`,
    role: 'tool',
    phase,
    runId: 'run-supply-1',
    turnId: 'turn-supply-1',
    stepId: 'step-supply-1',
    toolCallId: 'tool-supply-1',
    state: {
      status: phase === 'end' ? 'completed' : 'running',
      nested: { deep: [1, 'two', { three: true }] },
      ...(output ? { output } : {}),
    },
    data: { toolName: 'exec', ...(output ? { output } : {}) },
  };
}

function v1Event(seq: number) {
  return {
    traceSchema: 'openclaw-trajectory',
    schemaVersion: 1,
    traceId: 'legacy-trace',
    source: 'runtime',
    sessionId: 'legacy-session',
    runId: 'legacy-run',
    type: 'tool.completed',
    ts: timestamp(seq),
    seq,
    data: { toolName: 'legacy-tool' },
  };
}

type SupplyProjectorHarness = {
  supplyEvents: TrajectoryEventV2[][];
  diagnostics: TrajectoryProjectionDiagnostic[];
  projector: ReturnType<typeof createObservabilityTrajectoryProjector>;
};

function createSupplyProjector(): SupplyProjectorHarness {
  const supplyEvents: TrajectoryEventV2[][] = [];
  const diagnostics: TrajectoryProjectionDiagnostic[] = [];
  const projector = createObservabilityTrajectoryProjector({
    onTrace: () => {},
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    onV2Events: (_sessionKey, events) => supplyEvents.push([...events]),
  });
  return { supplyEvents, diagnostics, projector };
}

type ApiEnv = {
  tempRoot: string;
  restore: () => Promise<void>;
};

async function setupApiEnv(prefix: string, sessionFiles: Record<string, string[]>): Promise<ApiEnv> {
  const tempRoot = await mkdtemp(join(tmpdir(), prefix));
  const previousConfigDir = process.env.OPENCLAW_CONFIG_DIR;
  const previousIndexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
  const sessionsDir = join(tempRoot, 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  for (const [fileName, lines] of Object.entries(sessionFiles)) {
    await writeFile(join(sessionsDir, fileName), `${lines.join('\n')}\n`, 'utf8');
  }
  process.env.OPENCLAW_CONFIG_DIR = tempRoot;
  process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = join(tempRoot, 'index');
  clearObservabilityTraceBuffer();
  resetObservabilityIndexForTests();
  await clearObservabilityIndex();
  return {
    tempRoot,
    restore: async () => {
      if (previousConfigDir == null) delete process.env.OPENCLAW_CONFIG_DIR;
      else process.env.OPENCLAW_CONFIG_DIR = previousConfigDir;
      if (previousIndexDir == null) delete process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR;
      else process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR = previousIndexDir;
      clearObservabilityTraceBuffer();
      resetObservabilityIndexForTests();
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

function createGateway(
  readFrom: (params: Record<string, unknown>) => { events: unknown[]; hasMore?: boolean },
): { gateway: GatewayTrajectoryManager; listeners: Map<string, Set<(payload: unknown) => void>> } {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const gateway: GatewayTrajectoryManager = {
    rpc: async <T>(method: string, params?: unknown) => {
      if (method === 'observability.readFrom') {
        return readFrom(params as Record<string, unknown>) as T;
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
  return { gateway, listeners };
}

function emitNotification(
  listeners: Map<string, Set<(payload: unknown) => void>>,
  sessionKey: string,
  events: unknown[],
): void {
  for (const listener of listeners.get('notification') ?? []) {
    listener({
      method: 'observability.trajectory',
      params: { kind: 'events', sessionKey, events },
    });
  }
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WV-B2-02A renderer v2 trajectory supply', () => {
  it('emits only validated raw v2 rows to the supply and rejects invalid rows at the boundary', async () => {
    const { supplyEvents, diagnostics, projector } = createSupplyProjector();

    await projector.ingest('agent:main:mixed', [
      runEvent(1, 'start'),
      v1Event(2),
      { traceSchema: 'openclaw-trajectory', schemaVersion: 2, seq: 3, type: 'nonsense' },
      toolEvent(3, 'start'),
    ]);

    // The v1 row is projected as legacy trace data but never enters the v2 supply.
    expect(supplyEvents).toHaveLength(1);
    expect(supplyEvents[0].map((event: unknown) => (event as { seq?: number }).seq)).toEqual([1, 3]);
    expect(supplyEvents[0].every((event: unknown) => (event as { schemaVersion?: number }).schemaVersion === 2)).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.kind === 'invalid')).toBe(true);

    // Raw rows are exact: the projector's normalized data merge must not leak.
    expect(supplyEvents[0][1]).toEqual(toolEvent(3, 'start'));
    expect(projector.getV2Events('agent:main:mixed').map((event: unknown) => (event as { seq?: number }).seq)).toEqual([1, 3]);
  });

  it('does not emit duplicates or late/older events to the supply', async () => {
    const { supplyEvents, projector } = createSupplyProjector();

    await projector.ingest('agent:main:dupes', [runEvent(1, 'start'), toolEvent(2, 'start')]);
    await projector.ingest('agent:main:dupes', [toolEvent(2, 'start')]);
    await projector.ingest('agent:main:dupes', [runEvent(1, 'start')]);

    expect(supplyEvents).toHaveLength(1);
    expect(supplyEvents[0].map((event: unknown) => (event as { seq?: number }).seq)).toEqual([1, 2]);
    expect(projector.getV2Events('agent:main:dupes').map((event: unknown) => (event as { seq?: number }).seq)).toEqual([1, 2]);
  });

  it('preserves stable IDs and full state across JSON serialization unchanged', async () => {
    const { supplyEvents, projector } = createSupplyProjector();
    const original = toolEvent(1, 'update', 'partial output');
    await projector.ingest('agent:main:roundtrip', [original]);

    const supplied = supplyEvents[0][0] as TrajectoryEventV2 & { turnId: string; stepId: string; toolCallId: string };
    const roundTripped = JSON.parse(JSON.stringify(supplied)) as typeof supplied;

    expect(roundTripped).toEqual(original);
    expect(roundTripped.runId).toBe('run-supply-1');
    expect(roundTripped.turnId).toBe('turn-supply-1');
    expect(roundTripped.stepId).toBe('step-supply-1');
    expect(roundTripped.toolCallId).toBe('tool-supply-1');
    expect(roundTripped.state).toEqual(original.state);
  });

  it('joins cold history and realtime at asOfSeq to match a full Main replay', async () => {
    const historyRows = [runEvent(1, 'start'), toolEvent(2, 'start'), toolEvent(3, 'update', 'partial')];
    const liveRows = [toolEvent(4, 'end', 'done'), runEvent(5, 'end')];
    const env = await setupApiEnv('clawx-observability-supply-join-', {
      'supply.jsonl': ['{"type":"session.placeholder"}'],
    });
    const { gateway, listeners } = createGateway((params) => (
      params.sessionKey === 'agent:main:supply' && params.fromSeq === 0
        ? { events: historyRows, hasMore: false }
        : { events: [], hasMore: false }
    ));

    try {
      const realtime: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>[] = [];
      const api = createObservabilityApi({
        gatewayManager: gateway,
        onTrajectoryEvent: (event) => realtime.push(structuredClone(event)),
      });

      // Hydration replays cold history through the projector, so the renderer
      // may buffer realtime frames before its history query returns.
      await api.observability.traces();
      emitNotification(listeners, 'agent:main:supply', liveRows);
      await flushAsync();

      const page = await api.observability.trajectoryHistory({ sessionKey: 'agent:main:supply', fromSeq: 0 });
      expect(page.schemaVersion).toBe(2);
      expect(page.legacyFallback).toBe(false);
      expect(page.hasMore).toBe(false);
      expect(page.rejected).toBe(0);
      expect(page.asOfSeq).toBe(5);

      // Renderer handoff contract: drop buffered realtime rows at or below asOfSeq.
      const buffered = realtime
        .filter((event: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>) => event.sessionKey === 'agent:main:supply')
        .flatMap((event: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>) => event.events);
      const joined = [
        ...page.events,
        ...buffered.filter((event: unknown) => Number((event as { seq?: number }).seq) > page.asOfSeq),
      ];

      const fullReplay = [...historyRows, ...liveRows];
      expect(joined.map((event: unknown) => (event as { seq?: number }).seq)).toEqual(fullReplay.map((event: unknown) => (event as { seq?: number }).seq));
      expect(JSON.parse(JSON.stringify(joined))).toEqual(fullReplay);

      // No record is lost or double-appended in the joined sequence.
      expect(new Set(joined.map((event: unknown) => (event as { seq?: number }).seq)).size).toBe(joined.length);
    } finally {
      await env.restore();
    }
  });

  it('re-validates remote history rows at the boundary and dedupes deterministically', async () => {
    const env = await setupApiEnv('clawx-observability-supply-remote-', {
      'discovered.jsonl': ['{"type":"session.placeholder"}'],
    });
    const { gateway } = createGateway((params) => (
      params.sessionKey === 'agent:remote:cold'
        ? {
          events: [
            runEvent(1, 'start'),
            runEvent(1, 'start'),
            v1Event(2),
            { traceSchema: 'openclaw-trajectory', schemaVersion: 2, seq: 2, type: 'garbage' },
            toolEvent(2, 'start'),
          ],
          hasMore: false,
        }
        : { events: [], hasMore: false }
    ));

    try {
      const api = createObservabilityApi({ gatewayManager: gateway });
      const page = await api.observability.trajectoryHistory({ sessionKey: 'agent:remote:cold', fromSeq: 0 });

      expect(page.events.map((event: unknown) => (event as { seq?: number }).seq)).toEqual([1, 2]);
      expect(page.events.map((event: unknown) => (event as { schemaVersion?: number }).schemaVersion)).toEqual([2, 2]);
      expect(page.rejected).toBe(3);
      expect(page.asOfSeq).toBe(2);
      expect(page.hasMore).toBe(false);
    } finally {
      await env.restore();
    }
  });

  it('reports v1-only sessions as explicit legacy fallback with no v2 supply', async () => {
    const env = await setupApiEnv('clawx-observability-supply-legacy-', {
      'legacy.jsonl': ['{"type":"session.placeholder"}'],
      'legacy.trajectory.jsonl': [JSON.stringify(v1Event(1))],
    });
    const { gateway } = createGateway(() => ({ events: [], hasMore: false }));

    try {
      const realtime: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>[] = [];
      const api = createObservabilityApi({
        gatewayManager: gateway,
        onTrajectoryEvent: (event) => realtime.push(event),
      });

      const { sessions } = await api.observability.trajectorySessions();
      const legacy = sessions.find((session) => session.sessionKey === 'agent:main:legacy');
      expect(legacy).toEqual({
        sessionKey: 'agent:main:legacy',
        lastSeq: 0,
        earliestRetainedSeq: 0,
        legacyFallback: true,
      });

      const page = await api.observability.trajectoryHistory({ sessionKey: 'agent:main:legacy', fromSeq: 0 });
      expect(page.events).toEqual([]);
      expect(page.legacyFallback).toBe(true);
      expect(page.asOfSeq).toBe(0);
      expect(realtime).toEqual([]);
    } finally {
      await env.restore();
    }
  });

  it('keeps the renderer supply entrypoints free of direct IPC, Gateway HTTP, and WebSocket use', async () => {
    const hostApiSource = await readFile(join(process.cwd(), 'src', 'lib', 'host-api.ts'), 'utf8');
    const hostEventsSource = await readFile(join(process.cwd(), 'src', 'lib', 'host-events.ts'), 'utf8');

    for (const source of [hostApiSource, hostEventsSource]) {
      expect(source).not.toMatch(/new WebSocket\(/u);
      expect(source).not.toMatch(/EventSource\(/u);
      expect(source).not.toMatch(/ws:\/\//u);
      expect(source).not.toMatch(/http:\/\/127\.0\.0\.1:18789/u);
      expect(source).not.toMatch(/ipcRenderer\.invoke\(/u);
    }
    expect(hostApiSource).toMatch(/trajectoryHistory:.*\n?\s*invokeHost\('observability', 'trajectoryHistory'/u);
    expect(hostApiSource).toMatch(/trajectorySessions:.*\n?\s*invokeHost\('observability', 'trajectorySessions'/u);
    expect(hostEventsSource).toMatch(/onObservabilityTrajectoryEvent/u);
  });
});
