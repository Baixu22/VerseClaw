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
import { readTrajectoryEventsForTrace } from './observability-trajectory';
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

export function createObservabilityApi(ctx: ObservabilityApiContext = {}): Pick<CompleteHostServiceRegistry, 'observability'> {
  return {
    observability: {
      dashboardSnapshot: async () => {
        await ingestRuntimeTraces();
        await refreshTraceIndex();
        const queryResult = await queryObservabilityTraces({ pageSize: 1000 }, getObservabilityTraceBuffer());
        return buildObservabilityDashboardSnapshot(queryResult.items);
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
