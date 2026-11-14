import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { statusRead, events } = vi.hoisted(() => ({ statusRead: vi.fn(), events: {} as Record<string, (payload: unknown) => void> }));
vi.mock('@/lib/host-api', () => ({ hostApi: { gateway: { status: statusRead } } }));
vi.mock('@/lib/host-events', () => ({ hostEvents: Object.fromEntries(['onWorkspaceNavigationChanged','onGatewayStatus','onGatewayError','onGatewayNotification','onGatewayHealth','onGatewayPresence','onGatewayChatMessage','onChatRuntimeEvent','onGatewayChannelStatus'].map(name => [name, (callback: (payload: unknown) => void) => { events[name] = callback; return () => {}; }])) }));
vi.mock('@/stores/cron', () => ({ useCronStore: { getState: () => ({ fetchJobs: vi.fn() }) } }));
const status = (pid: number, ready: boolean) => ({ state: 'running' as const, port: 21000 + pid, pid, connectedAt: pid, gatewayReady: ready });
describe('current Gateway status snapshots', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); statusRead.mockReset(); Object.keys(events).forEach(key => delete events[key]); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it('refreshes readiness and process identity when bootstrap reads both say running', async () => {
    statusRead.mockResolvedValueOnce(status(1, false)).mockResolvedValueOnce(status(2, true));
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    expect(useGatewayStore.getState().status).toEqual(status(2, true));
  });
  it('retains a newer event when the bootstrap confirmation replies late', async () => {
    let reply!: (value: unknown) => void;
    statusRead.mockResolvedValueOnce(status(1, false)).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const { useGatewayStore } = await import('@/stores/gateway');
    const init = useGatewayStore.getState().init();
    await vi.advanceTimersByTimeAsync(0);
    events.onGatewayStatus(status(2, true));
    reply({ ...status(1, false), state: 'starting' }); await init;
    expect(useGatewayStore.getState().status).toEqual(status(2, true));
  });
  it('reconciles same-state readiness and process identity from the owner', async () => {
    statusRead.mockResolvedValueOnce(status(1, false)).mockResolvedValueOnce(status(1, false)).mockResolvedValueOnce(status(2, true));
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init(); await vi.advanceTimersByTimeAsync(30000);
    expect(useGatewayStore.getState().status).toEqual(status(2, true));
  });
  it('retains a newer event when a reconciliation read replies late', async () => {
    let reply!: (value: unknown) => void;
    statusRead.mockResolvedValueOnce(status(1, true)).mockResolvedValueOnce(status(1, true)).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init(); await vi.advanceTimersByTimeAsync(30000);
    events.onGatewayStatus(status(3, true)); reply({ ...status(2, false), state: 'starting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(useGatewayStore.getState().status).toEqual(status(3, true));
  });
  it.each(['older-first', 'newer-first'] as const)('keeps the latest overlapping reconciliation when replies arrive %s', async (order) => {
    let olderReply!: (value: unknown) => void;
    let newerReply!: (value: unknown) => void;
    statusRead.mockResolvedValueOnce(status(1, false)).mockResolvedValueOnce(status(1, false))
      .mockImplementationOnce(() => new Promise(resolve => { olderReply = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newerReply = resolve; }));
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(30000);
    const replies = order === 'older-first'
      ? [() => olderReply(status(2, false)), () => newerReply(status(3, true))]
      : [() => newerReply(status(3, true)), () => olderReply(status(2, false))];
    for (const reply of replies) { reply(); await vi.advanceTimersByTimeAsync(0); }
    expect(useGatewayStore.getState().status).toEqual(status(3, true));
  });
  it('lets a newer reconciliation complete while bootstrap confirmation is pending', async () => {
    let bootstrapReply!: (value: unknown) => void;
    let reconcileReply!: (value: unknown) => void;
    statusRead.mockResolvedValueOnce(status(1, false))
      .mockImplementationOnce(() => new Promise(resolve => { bootstrapReply = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { reconcileReply = resolve; }));
    const { useGatewayStore } = await import('@/stores/gateway');
    const init = useGatewayStore.getState().init();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30000);
    bootstrapReply(status(2, false)); await init;
    reconcileReply(status(3, true)); await vi.advanceTimersByTimeAsync(0);
    expect(useGatewayStore.getState().status).toEqual(status(3, true));
  });
});
