import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { describeUserError } from '@/lib/user-error';
import type {
  ObservabilityDashboardSnapshot,
  ObservabilityNodeDiagnostics,
  ObservabilityTrace,
  ObservabilityTraceGraphResult,
  ObservabilityTraceQuery,
  ObservabilityTraceQueryResult,
} from '@shared/types/observability';

export type ObservabilityState = {
  snapshot: ObservabilityDashboardSnapshot | null;
  query: ObservabilityTraceQuery;
  queryResult: ObservabilityTraceQueryResult | null;
  loading: boolean;
  error: string | null;
  /** R2: developer-log reference minted by describeUserError. */
  errorId: string | null;

  selectedTraceId: string | null;
  selectedTrace: ObservabilityTrace | null;
  selectedGraph: ObservabilityTraceGraphResult | null;
  selectedNodeDiagnostics: ObservabilityNodeDiagnostics | null;
  traceLoading: boolean;
  diagnosticsLoading: boolean;

  fetchDashboard: (opts?: { silent?: boolean }) => Promise<void>;
  queryTraces: (query?: ObservabilityTraceQuery, opts?: { silent?: boolean }) => Promise<void>;
  clearTraces: () => Promise<void>;
  selectTrace: (id: string) => Promise<void>;
  loadNodeDiagnostics: (traceId: string, nodeId: string) => Promise<void>;
  closeTrace: () => void;
  /** Subscribe to live runtime events; returns an unsubscribe fn. */
  subscribeRealtime: () => () => void;
};

export const useObservabilityStore = create<ObservabilityState>((set, get) => ({
  snapshot: null,
  query: { page: 1, pageSize: 100, sortBy: 'updatedAt', sortDir: 'desc' },
  queryResult: null,
  loading: false,
  error: null,
  errorId: null,
  selectedTraceId: null,
  selectedTrace: null,
  selectedGraph: null,
  selectedNodeDiagnostics: null,
  traceLoading: false,
  diagnosticsLoading: false,

  fetchDashboard: async (opts) => {
    if (!opts?.silent) set({ loading: true, error: null, errorId: null });
    try {
      const snapshot = await hostApi.observability.dashboardSnapshot();
      const query = get().query;
      const queryResult = await hostApi.observability.queryTraces(query);
      set({ snapshot, queryResult, loading: false });
    } catch (error) {
      const details = describeUserError(error);
      set({ error: details.message, errorId: details.errorId, loading: false });
    }
  },

  queryTraces: async (queryPatch, opts) => {
    const query = { ...get().query, ...(queryPatch ?? {}) };
    if (!opts?.silent) set({ loading: true, error: null, errorId: null, query });
    else set({ query });
    try {
      const queryResult = await hostApi.observability.queryTraces(query);
      set({ queryResult, loading: false });
    } catch (error) {
      const details = describeUserError(error);
      set({ error: details.message, errorId: details.errorId, loading: false });
    }
  },

  clearTraces: async () => {
    try {
      await hostApi.observability.clearTraces();
      set({ snapshot: null, queryResult: null, selectedTraceId: null, selectedTrace: null, selectedGraph: null, selectedNodeDiagnostics: null });
    } catch (error) {
      const details = describeUserError(error);
      set({ error: details.message, errorId: details.errorId });
    }
  },

  selectTrace: async (id) => {
    set({ selectedTraceId: id, traceLoading: true, selectedNodeDiagnostics: null });
    try {
      const graph = await hostApi.observability.traceGraph(id);
      // Ignore stale responses if the user moved on to another trace.
      if (get().selectedTraceId === id) {
        set({ selectedTrace: graph?.trace ?? null, selectedGraph: graph, traceLoading: false });
      }
    } catch (error) {
      if (get().selectedTraceId === id) {
        const details = describeUserError(error);
        set({ error: details.message, errorId: details.errorId, traceLoading: false });
      }
    }
  },

  loadNodeDiagnostics: async (traceId, nodeId) => {
    set({ diagnosticsLoading: true });
    try {
      const diagnostics = await hostApi.observability.traceNodeDiagnostics(traceId, nodeId);
      if (get().selectedTraceId === traceId) {
        set({ selectedNodeDiagnostics: diagnostics, diagnosticsLoading: false });
      }
    } catch (error) {
      if (get().selectedTraceId === traceId) {
        const details = describeUserError(error);
        set({ error: details.message, errorId: details.errorId, diagnosticsLoading: false });
      }
    }
  },

  closeTrace: () => set({ selectedTraceId: null, selectedTrace: null, selectedGraph: null, selectedNodeDiagnostics: null, traceLoading: false, diagnosticsLoading: false }),

  subscribeRealtime: () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = hostEvents.onObservabilityRuntimeEvent(() => {
      // Coalesce bursts of span events into a single trailing refresh.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void get().fetchDashboard({ silent: true });
        const id = get().selectedTraceId;
        if (id) {
          void hostApi.observability.traceGraph(id).then((graph) => {
            if (get().selectedTraceId === id) set({ selectedTrace: graph?.trace ?? null, selectedGraph: graph });
          });
        }
      }, 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  },
}));
