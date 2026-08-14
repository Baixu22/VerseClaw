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
  persistObservabilityTracesToIndex,
  queryObservabilityTraces,
} from './observability-index';
import { refreshObservabilityTrajectoryIndex } from './observability-trajectory-index';
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

export function createObservabilityApi(ctx: ObservabilityApiContext = {}): Pick<CompleteHostServiceRegistry, 'observability'> {
  return {
    observability: {
      dashboardSnapshot: async () => {
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
        await ingestRuntimeTraces();
        return getObservabilityTraceBuffer();
      },
      trace: async ({ id }: { id: string }) => {
        await ingestRuntimeTraces();
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
        await ingestRuntimeTraces();
        await refreshTraceIndex();
        return queryObservabilityTraces(payload ?? {}, getObservabilityTraceBuffer());
      },
      traceGraph: async ({ id }: { id: string }) => {
        await ingestRuntimeTraces();
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
        await ingestRuntimeTraces();
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
        return { success: true };
      },
    },
  };
}
