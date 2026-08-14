import {
  buildObservabilityDashboardSnapshot,
  clearObservabilityTraceBuffer,
  getObservabilityTrace,
  getObservabilityTraceBuffer,
  upsertObservabilityScorecard,
  upsertObservabilityTrace,
} from './observability-service';
import { resetObservabilityAdapter } from './observability-adapter';
import { buildObservabilityNodeDiagnostics, buildObservabilityTraceGraph } from './observability-graph';
import {
  clearObservabilityIndex,
  getIndexedObservabilityTrace,
  loadObservabilityIndex,
  persistObservabilityTraceToIndex,
  persistObservabilityTracesToIndex,
  queryObservabilityTraces,
} from './observability-index';
import {
  createObservabilityTrajectoryProjector,
  readLegacyTrajectorySessions,
  type TrajectoryProjectionDiagnostic,
} from './observability-trajectory-index';
import { readTrajectoryEventsForTrace } from './observability-trajectory';
import { logger } from '../utils/logger';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  ObservabilityRuntimeEvent,
  ObservabilityScorecard,
  ObservabilityTrace,
  ObservabilityTraceQuery,
} from '../../shared/types/observability';

/** Optional fetcher that pulls runtime-process traces + scorecards via Gateway RPC. */
type RuntimeTraceFetcher = () => Promise<{ traces: Array<Record<string, unknown>>; scorecards?: Array<Record<string, unknown>> }>;
let runtimeTraceFetcher: RuntimeTraceFetcher | undefined;
type ObservabilityApiContext = {
  onRuntimeEvent?: (event: ObservabilityRuntimeEvent) => void;
  onProjectionDiagnostic?: (diagnostic: TrajectoryProjectionDiagnostic) => void;
  gatewayManager?: GatewayTrajectoryManager;
};

export type GatewayTrajectoryNotification = {
  method: string;
  params?: unknown;
};

export type GatewayTrajectoryStatus = {
  state?: string;
};

export type GatewayTrajectoryManager = {
  rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  on: (event: 'notification' | 'status', listener: (payload: unknown) => void) => void;
  off: (event: 'notification' | 'status', listener: (payload: unknown) => void) => void;
  getStatus?: () => GatewayTrajectoryStatus;
};

export function setRuntimeTraceFetcher(fetcher: RuntimeTraceFetcher): void {
  runtimeTraceFetcher = fetcher;
}

async function ingestRuntimeTraces(): Promise<void> {
  if (!runtimeTraceFetcher) return;
  try {
    const { traces, scorecards } = await runtimeTraceFetcher();
    for (const entry of traces) {
      upsertObservabilityTrace(entry as ObservabilityTrace);
    }
    if (scorecards) {
      for (const entry of scorecards) {
        upsertObservabilityScorecard(entry as ObservabilityScorecard);
      }
    }
  } catch {
    // Runtime trace fetch is best-effort — the UI must not break if the
    // gateway doesn't respond or the runtime hasn't produced any traces.
  }
}

async function refreshTraceIndex(): Promise<void> {
  await loadObservabilityIndex();
  const memoryTraces = getObservabilityTraceBuffer();
  if (memoryTraces.length > 0) {
    await persistObservabilityTracesToIndex(memoryTraces);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function statusIsRunning(status: GatewayTrajectoryStatus): boolean {
  return status.state === 'running';
}

export function createObservabilityApi(ctx: ObservabilityApiContext = {}): Pick<CompleteHostServiceRegistry, 'observability'> {
  let streamStarted = false;
  let streamStartPromise: Promise<void> | undefined;
  const subscribedSessions = new Set<string>();
  const subscriptionInFlight = new Set<string>();
  const projector = createObservabilityTrajectoryProjector({
    onTrace: async (trace) => {
      const previous = getObservabilityTrace(trace.id);
      upsertObservabilityTrace(trace);
      await persistObservabilityTraceToIndex(trace, {
        sourceStatus: trace.tags.includes('legacy-v1-fallback')
          ? 'partial'
          : trace.status === 'running' ? undefined : 'live',
      });
      if (ctx.onRuntimeEvent) {
        const type = !previous
          ? 'trace.started'
          : trace.status === 'running' ? 'trace.updated' : 'trace.completed';
        ctx.onRuntimeEvent({ type, trace } as ObservabilityRuntimeEvent);
      }
    },
    onDiagnostic: (diagnostic) => {
      logger.warn(
        `[observability-trajectory] ${diagnostic.kind} session=${diagnostic.sessionKey} `
          + `${diagnostic.message}${diagnostic.seq == null ? '' : ` seq=${diagnostic.seq}`}`,
      );
      ctx.onProjectionDiagnostic?.(diagnostic);
    },
  });

  const repairGap = async (sessionKey: string): Promise<void> => {
    const fromSeq = projector.getLastSeq(sessionKey);
    try {
      const page = await ctx.gatewayManager?.rpc<Record<string, unknown>>('observability.readFrom', {
        sessionKey,
        fromSeq,
        limit: 1_000,
      });
      if (!page || !Array.isArray(page.events)) return;
      if (isRecord(page.gap)) {
        logger.warn(
          `[observability-trajectory] Gateway gap remains for session=${sessionKey} `
            + `expected=${String(page.gap.expectedSeq)} actual=${String(page.gap.actualSeq)}`,
        );
        return;
      }
      const result = await projector.ingest(sessionKey, page.events);
      if (result.gap) {
        logger.warn(
          `[observability-trajectory] readFrom returned another gap for session=${sessionKey}`,
        );
      }
    } catch (error) {
      logger.warn(
        `[observability-trajectory] readFrom failed for session=${sessionKey}: ${String(error)}`,
      );
    }
  };

  const handleTrajectoryNotification = async (notification: GatewayTrajectoryNotification): Promise<void> => {
    if (notification.method !== 'observability.trajectory' || !isRecord(notification.params)) return;
    const sessionKey = readString(notification.params.sessionKey);
    if (!sessionKey) {
      logger.warn('[observability-trajectory] ignored notification without sessionKey');
      return;
    }
    if (notification.params.kind === 'gap') {
      await repairGap(sessionKey);
      return;
    }
    if (notification.params.kind !== 'events' || !Array.isArray(notification.params.events)) return;
    const result = await projector.ingest(sessionKey, notification.params.events);
    if (result.gap) await repairGap(sessionKey);
  };

  const ensureSubscriptions = async (): Promise<void> => {
    if (!ctx.gatewayManager) return;
    for (const sessionKey of projector.getKnownSessionKeys()) {
      if (subscribedSessions.has(sessionKey) || subscriptionInFlight.has(sessionKey)) continue;
      subscriptionInFlight.add(sessionKey);
      try {
        await ctx.gatewayManager.rpc('observability.subscribe', {
          sessionKey,
          fromSeq: projector.getLastSeq(sessionKey),
        });
        subscribedSessions.add(sessionKey);
      } catch (error) {
        logger.warn(
          `[observability-trajectory] subscribe failed for session=${sessionKey}: ${String(error)}`,
        );
      } finally {
        subscriptionInFlight.delete(sessionKey);
      }
    }
  };

  const handleGatewayStatus = (status: GatewayTrajectoryStatus): void => {
    if (!statusIsRunning(status)) {
      subscribedSessions.clear();
      return;
    }
    void ensureSubscriptions();
  };

  const startTrajectoryStream = (): Promise<void> => {
    if (streamStartPromise) return streamStartPromise;
    streamStartPromise = (async () => {
      if (streamStarted) return;
      streamStarted = true;
      // One-time migration bootstrap. Subsequent dashboard reads never scan
      // the disk and never pull the runtime snapshot RPC.
      await ingestRuntimeTraces();
      const sessions = await readLegacyTrajectorySessions();
      for (const session of sessions) {
        const legacyFallback = session.events.every((event) => event.schemaVersion !== 2);
        await projector.replace(session.sessionKey, session.events, {
          legacyFallback,
          allowGaps: legacyFallback,
          allowLegacyRows: legacyFallback,
          transcriptMessages: session.transcriptMessages,
        });
      }
      if (ctx.gatewayManager) {
        ctx.gatewayManager.on('notification', (payload) => {
          void handleTrajectoryNotification(payload as GatewayTrajectoryNotification);
        });
        ctx.gatewayManager.on('status', (payload) => {
          handleGatewayStatus(payload as GatewayTrajectoryStatus);
        });
        if (statusIsRunning(ctx.gatewayManager.getStatus?.() ?? {})) {
          await ensureSubscriptions();
        }
      }
    })().catch((error) => {
      streamStartPromise = undefined;
      logger.warn(`[observability-trajectory] stream bootstrap failed: ${String(error)}`);
    });
    return streamStartPromise;
  };

  void startTrajectoryStream();

  return {
    observability: {
      dashboardSnapshot: async () => {
        await startTrajectoryStream();
        await refreshTraceIndex();
        const queryResult = await queryObservabilityTraces({ pageSize: 1000 }, getObservabilityTraceBuffer());
        return buildObservabilityDashboardSnapshot(queryResult.items);
      },
      traces: async () => {
        await startTrajectoryStream();
        return getObservabilityTraceBuffer();
      },
      trace: async ({ id }: { id: string }) => {
        await startTrajectoryStream();
        return getObservabilityTrace(id) ?? (await getIndexedObservabilityTrace(id))?.trace ?? null;
      },
      reportTrace: async ({ trace }: { trace: ObservabilityTrace }) => {
        if (!trace || typeof trace !== 'object' || typeof trace.id !== 'string' || !trace.id.trim()) {
          return { success: false, error: 'observability.reportTrace requires a trace with an id' };
        }
        upsertObservabilityTrace(trace);
        ctx.onRuntimeEvent?.({
          type: trace.status === 'running' ? 'trace.updated' : 'trace.completed',
          trace,
        });
        return { success: true, traceId: trace.id };
      },
      queryTraces: async (payload?: ObservabilityTraceQuery) => {
        await startTrajectoryStream();
        await refreshTraceIndex();
        return queryObservabilityTraces(payload ?? {}, getObservabilityTraceBuffer());
      },
      traceGraph: async ({ id }: { id: string }) => {
        await startTrajectoryStream();
        await refreshTraceIndex();
        const trace = getObservabilityTrace(id);
        if (trace) {
          const trajectoryEvents = await readTrajectoryEventsForTrace(trace);
          return buildObservabilityTraceGraph(trace, trajectoryEvents);
        }
        const indexed = await getIndexedObservabilityTrace(id);
        if (!indexed) return null;
        const trajectoryEvents = await readTrajectoryEventsForTrace(indexed.trace);
        return buildObservabilityTraceGraph(indexed.trace, trajectoryEvents, {
          sourceStatus: indexed.entry.sourceStatus === 'stale' ? 'stale' : 'rehydrated',
        });
      },
      traceNodeDiagnostics: async ({ traceId, nodeId }: { traceId: string; nodeId: string }) => {
        await startTrajectoryStream();
        await refreshTraceIndex();
        const trace = getObservabilityTrace(traceId) ?? (await getIndexedObservabilityTrace(traceId))?.trace ?? null;
        if (!trace) return null;
        const trajectoryEvents = await readTrajectoryEventsForTrace(trace);
        return buildObservabilityNodeDiagnostics(trace, nodeId, trajectoryEvents);
      },
      clearTraces: async () => {
        clearObservabilityTraceBuffer();
        await clearObservabilityIndex();
        resetObservabilityAdapter();
        projector.reset();
        subscribedSessions.clear();
        return { success: true };
      },
    },
  };
}
