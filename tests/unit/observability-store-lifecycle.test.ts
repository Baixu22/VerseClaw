import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(), history: vi.fn(),
  runtime: null as ((event: unknown) => void) | null,
  trajectory: [] as Array<(event: unknown) => void>,
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { observability: {
  dashboardSnapshot: () => mocks.dashboard(), queryTraces: async () => ({}),
  trajectoryHistory: (input: unknown) => mocks.history(input),
} } }));
vi.mock('@/lib/host-events', () => ({ hostEvents: {
  onObservabilityRuntimeEvent: (handler: (event: unknown) => void) => { mocks.runtime = handler; return () => { mocks.runtime = null; }; },
  onObservabilityTrajectoryEvent: (handler: (event: unknown) => void) => {
    mocks.trajectory.push(handler); return () => { mocks.trajectory = mocks.trajectory.filter((entry) => entry !== handler); };
  },
} }));

describe('observability lifecycle source', () => {
  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.trajectory = []; });
  it('refreshes on assembler lifecycle transitions and ignores notifications with no new v2 state', async () => {
    const first = { traceSchema: 'openclaw-trajectory', schemaVersion: 2, traceId: 'trace', source: 'runtime',
      type: 'run/start', role: 'run', phase: 'start', runId: 'run', seq: 1,
      ts: '2026-11-07T00:00:00Z', state: { status: 'running' } };
    mocks.dashboard.mockResolvedValue({ traces: [{ id: 'trace', sessionKey: 'session-a' }] });
    mocks.history.mockImplementation(async ({ fromSeq }: { fromSeq: number }) => ({
      sessionKey: 'session-a', schemaVersion: 2, fromSeq, events: fromSeq === 0 ? [first] : [],
      asOfSeq: fromSeq === 0 ? 1 : fromSeq, hasMore: false, legacyFallback: false, rejected: 0,
    }));
    const { useObservabilityStore } = await import('@/stores/observability');
    const stop = useObservabilityStore.getState().subscribeRealtime();
    await useObservabilityStore.getState().fetchDashboard();
    await vi.waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(2));
    mocks.runtime?.({ type: 'trace.updated', trace: { id: 'trace', sessionKey: 'session-a' } });
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.dashboard).toHaveBeenCalledTimes(2);
    for (const handler of [...mocks.trajectory]) handler({ sessionKey: 'session-a', schemaVersion: 2,
      events: [{ ...first, seq: 2, type: 'run/end', phase: 'end', state: { status: 'completed' } }] });
    await vi.waitFor(() => expect(mocks.dashboard).toHaveBeenCalledTimes(3));
    stop();
    expect(mocks.trajectory).toHaveLength(0);
  });
});
