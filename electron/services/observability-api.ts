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
  listObservabilityTrajectorySessionKeys,
  readLegacyTrajectorySessions,
  refreshObservabilityTrajectoryIndex,
  type TrajectoryProjectionDiagnostic,
} from './observability-trajectory-index';
import { readTrajectoryEventsForTrace } from './observability-trajectory';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import type {
  ObservabilityRuntimeEvent,
  ObservabilityScorecard,
  ObservabilitySourceHealth,
  ObservabilitySourceHealthEntry,
  ObservabilityTrace,
  ObservabilityTraceQuery,
} from '../../shared/types/observability';

/** Optional fetcher that pulls runtime-process traces + scorecards via Gateway RPC. */
type RuntimeTraceFetchResult = {
  traces: Array<Record<string, unknown>>;
  scorecards?: Array<Record<string, unknown>>;
  error?: string;
};
type RuntimeTraceFetcher = () => Promise<RuntimeTraceFetchResult>;
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
  gatewayReady?: boolean;
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

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.trim().slice(0, 320) || 'Unknown error';
}

function sourceHealth(
  status: ObservabilitySourceHealthEntry['status'],
  reason: ObservabilitySourceHealthEntry['reason'],
  detail?: string,
): ObservabilitySourceHealthEntry {
  return detail ? { status, reason, detail } : { status, reason };
}

async function ingestRuntimeTraces(): Promise<ObservabilitySourceHealthEntry> {
  if (!runtimeTraceFetcher) return sourceHealth('empty', 'not-configured');
  try {
    const { traces, scorecards, error } = await runtimeTraceFetcher();
    if (error) return sourceHealth('error', 'failed', error.slice(0, 320));
    for (const entry of traces) {
      upsertObservabilityTrace(entry as ObservabilityTrace);
    }
    if (scorecards) {
      for (const entry of scorecards) {
        upsertObservabilityScorecard(entry as ObservabilityScorecard);
      }
    }
    return traces.length > 0 || (scorecards?.length ?? 0) > 0
      ? sourceHealth('ok', 'available')
      : sourceHealth('empty', 'no-data');
  } catch (error) {
    const detail = errorDetail(error);
    logger.warn(`[observability] runtime trace fetch failed: ${detail}`);
    return sourceHealth('error', 'failed', detail);
  }
}

async function refreshTraceIndex(): Promise<Pick<ObservabilitySourceHealth, 'index' | 'trajectory'>> {
  let index: ObservabilitySourceHealthEntry;
  let trajectory: ObservabilitySourceHealthEntry;

  try {
    const entries = await loadObservabilityIndex();
    index = entries.length > 0 ? sourceHealth('ok', 'available') : sourceHealth('empty', 'no-data');
  } catch (error) {
    const detail = errorDetail(error);
    logger.warn(`[observability] trace index load failed: ${detail}`);
    index = sourceHealth('error', 'failed', detail);
  }

  try {
    const indexedTrajectories = await refreshObservabilityTrajectoryIndex();
    trajectory = indexedTrajectories > 0 ? sourceHealth('ok', 'available') : sourceHealth('empty', 'no-data');
    if (indexedTrajectories > 0) index = sourceHealth('ok', 'available');
  } catch (error) {
    const detail = errorDetail(error);
    logger.warn(`[observability] trajectory refresh failed: ${detail}`);
    trajectory = sourceHealth('error', 'failed', detail);
  }

  const memoryTraces = getObservabilityTraceBuffer();
  if (memoryTraces.length > 0) {
    try {
      await persistObservabilityTracesToIndex(memoryTraces);
      index = sourceHealth('ok', 'available');
    } catch (error) {
      const detail = errorDetail(error);
      logger.warn(`[observability] trace index persist failed: ${detail}`);
      index = sourceHealth('error', 'failed', detail);
    }
  }

  return { index, trajectory };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function statusIsReady(status: GatewayTrajectoryStatus | undefined): boolean {
  return status?.state === 'running' && status.gatewayReady !== false;
}

export function createObservabilityApi(ctx: ObservabilityApiContext = {}): Pick<CompleteHostServiceRegistry, 'observability'> {
  const projector = createObservabilityTrajectoryProjector({
    onTrace: async (trace) => {
      const previous = getObservabilityTrace(trace.id);
      upsertObservabilityTrace(trace);
      await persistObservabilityTraceToIndex(trace, {
        sourceStatus: trace.tags.includes('legacy-v1-fallback')
          ? 'partial'
          : trace.status === 'running'
            ? undefined
            : 'live',
      });
      if (ctx.onRuntimeEvent) {
        const type = !previous
          ? 'trace.started'
          : trace.status === 'running'
            ? 'trace.updated'
            : 'trace.completed';
        ctx.onRuntimeEvent({ type, trace } as ObservabilityRuntimeEvent);
      }
    },
    onDiagnostic: (diagnostic) => {
      logger.warn(
        `[observability-trajectory] ${diagnostic.kind} session=${diagnostic.sessionKey}`
          + `${diagnostic.seq == null ? '' : ` seq=${diagnostic.seq}`}: ${diagnostic.message}`,
      );
      ctx.onProjectionDiagnostic?.(diagnostic);
    },
  });
  const hydratedSessions = new Set<string>();
  const repairInFlight = new Set<string>();
  let subscribedSession: string | undefined;
  let subscriptionInFlight = false;
  let streamStarted = false;
  let streamStartPromise: Promise<void> | undefined;

  const repairGap = async (sessionKey: string): Promise<boolean> => {
    if (!ctx.gatewayManager || repairInFlight.has(sessionKey)) return false;
    repairInFlight.add(sessionKey);
    try {
      let fromSeq = projector.getLastSeq(sessionKey);
      for (;;) {
        const page = await ctx.gatewayManager.rpc<Record<string, unknown>>('observability.readFrom', {
          sessionKey,
          fromSeq,
          limit: 1_000,
        });
        if (!isRecord(page) || !Array.isArray(page.events)) {
          logger.warn(`[observability-trajectory] readFrom returned an invalid page for session=${sessionKey}`);
          return false;
        }
        if (isRecord(page.gap)) {
          logger.warn(
            `[observability-trajectory] readFrom reported an unrepaired gap for session=${sessionKey}`,
          );
          return false;
        }
        const result = await projector.ingest(sessionKey, page.events);
        if (result.gap) {
          return false;
        }
        if (page.hasMore !== true) {
          return true;
        }
        if (result.accepted === 0) return false;
        fromSeq = result.lastSeq;
      }
    } catch (error) {
      logger.warn(`[observability-trajectory] readFrom failed for session=${sessionKey}: ${errorDetail(error)}`);
      return false;
    } finally {
      repairInFlight.delete(sessionKey);
    }
  };

  const handleTrajectoryNotification = (payload: unknown): void => {
    if (!isRecord(payload)) return;
    const notification = payload as GatewayTrajectoryNotification;
    if (notification.method !== 'observability.trajectory' || !isRecord(notification.params)) return;
    const sessionKey = readString(notification.params.sessionKey);
    if (!sessionKey) {
      logger.warn('[observability-trajectory] ignored notification without sessionKey');
      return;
    }
    if (notification.params.kind === 'gap') {
      void repairGap(sessionKey);
      return;
    }
    if (notification.params.kind !== 'events' || !Array.isArray(notification.params.events)) {
      logger.warn(`[observability-trajectory] ignored malformed notification for session=${sessionKey}`);
      return;
    }
    void projector.ingest(sessionKey, notification.params.events).then((result) => {
      if (result.gap) void repairGap(sessionKey);
    }).catch((error) => {
      logger.warn(`[observability-trajectory] failed to project session=${sessionKey}: ${errorDetail(error)}`);
    });
  };

  const ensureSubscriptions = async (): Promise<void> => {
    if (!ctx.gatewayManager || !statusIsReady(ctx.gatewayManager.getStatus?.())) return;
    const discoveredSessionKeys = await listObservabilityTrajectorySessionKeys();
    for (const sessionKey of discoveredSessionKeys) {
      projector.track(sessionKey);
    }
    for (const sessionKey of projector.getKnownSessionKeys()) {
      if (!hydratedSessions.has(sessionKey)) {
        if (await repairGap(sessionKey)) hydratedSessions.add(sessionKey);
      }
    }

    // B1-03 subscriptions are connection-scoped, so this Main-owned Gateway
    // socket can carry one live trajectory stream. All other known sessions
    // stay recoverable through their persisted/readFrom projection.
    const activeSession = discoveredSessionKeys[0];
    if (!activeSession || activeSession === subscribedSession || subscriptionInFlight) return;
    subscriptionInFlight = true;
    try {
      if (subscribedSession) {
        await ctx.gatewayManager.rpc('observability.unsubscribe');
      }
      await ctx.gatewayManager.rpc('observability.subscribe', {
        sessionKey: activeSession,
        fromSeq: projector.getLastSeq(activeSession),
      });
      subscribedSession = activeSession;
    } catch (error) {
      logger.warn(`[observability-trajectory] subscribe failed for session=${activeSession}: ${errorDetail(error)}`);
    } finally {
      subscriptionInFlight = false;
    }
  };

  const handleGatewayStatus = (payload: unknown): void => {
    const status = isRecord(payload) ? payload as GatewayTrajectoryStatus : {};
    if (!statusIsReady(status)) {
      subscribedSession = undefined;
      return;
    }
    void ensureSubscriptions();
  };

  const startTrajectoryStream = (): Promise<void> => {
    if (!ctx.gatewayManager) return Promise.resolve();
    if (streamStartPromise) return streamStartPromise;
    streamStartPromise = (async () => {
      if (streamStarted) return;
      streamStarted = true;
      ctx.gatewayManager?.on('notification', handleTrajectoryNotification);
      ctx.gatewayManager?.on('status', handleGatewayStatus);

      // Files are read once as an explicitly marked v1 migration fallback.
      // Live v2 history and updates are supplied by Gateway readFrom/subscribe.
      for (const session of await readLegacyTrajectorySessions()) {
        await projector.replace(session.sessionKey, session.events, {
          legacyFallback: true,
          allowGaps: true,
          allowLegacyRows: true,
          transcriptMessages: session.transcriptMessages,
        });
      }
      await ensureSubscriptions();
    })();
    return streamStartPromise;
  };

  const prepare = async (includeLegacyIndex: boolean): Promise<void> => {
    if (ctx.gatewayManager) {
      await startTrajectoryStream();
      await ensureSubscriptions();
      return;
    }
    await ingestRuntimeTraces();
    if (includeLegacyIndex) await refreshTraceIndex();
  };

  return {
    observability: {
      dashboardSnapshot: async () => {
        if (ctx.gatewayManager) {
          await prepare(false);
          const entries = await loadObservabilityIndex();
          const available = projector.getKnownSessionKeys().length > 0;
          const health: ObservabilitySourceHealth = {
            runtime: statusIsReady(ctx.gatewayManager.getStatus?.())
              ? sourceHealth('ok', 'available')
              : sourceHealth('empty', 'not-configured'),
            index: entries.length > 0 ? sourceHealth('ok', 'available') : sourceHealth('empty', 'no-data'),
            trajectory: available ? sourceHealth('ok', 'available') : sourceHealth('empty', 'no-data'),
          };
          const queryResult = await queryObservabilityTraces({ pageSize: 1000 }, getObservabilityTraceBuffer());
          return buildObservabilityDashboardSnapshot(queryResult.items, health);
        }
        const runtime = await ingestRuntimeTraces();
        const { index, trajectory } = await refreshTraceIndex();
        const health = { runtime, index, trajectory };
        try {
          const queryResult = await queryObservabilityTraces({ pageSize: 1000 }, getObservabilityTraceBuffer());
          return buildObservabilityDashboardSnapshot(queryResult.items, health);
        } catch (error) {
          const detail = errorDetail(error);
          logger.warn(`[observability] dashboard trace query failed: ${detail}`);
          return buildObservabilityDashboardSnapshot([], {
            ...health,
            index: sourceHealth('error', 'failed', detail),
          });
        }
      },
      traces: async () => {
        await prepare(false);
        return getObservabilityTraceBuffer();
      },
      trace: async ({ id }: { id: string }) => {
        await prepare(false);
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
        await prepare(true);
        return queryObservabilityTraces(payload ?? {}, getObservabilityTraceBuffer());
      },
      traceGraph: async ({ id }: { id: string }) => {
        await prepare(true);
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
        await prepare(true);
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
        hydratedSessions.clear();
        subscribedSession = undefined;
        return { success: true };
      },
    },
  };
}
