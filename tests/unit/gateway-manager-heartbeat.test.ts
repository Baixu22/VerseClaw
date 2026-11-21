import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('GatewayManager heartbeat recovery', () => {
  const originalPlatform = process.platform;

  it('preserves Gateway timeout classification and metadata through the host dispatcher', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { createHostInvokeDispatcher } = await import('@electron/main/ipc/host-invoke');
    const manager = new GatewayManager();
    const ws = { readyState: 1, send: vi.fn() };
    (manager as unknown as { ws: typeof ws }).ws = ws;
    const dispatch = createHostInvokeDispatcher({
      gateway: { rpc: () => manager.rpc('mission.run', {}, 50) },
    } as never, { requireSender: false });
    const deadline = { deadlineAtMs: Date.now() + 1000, timeoutMs: 1000, stage: 'renderer' as const, requestId: 'mission-short' };

    const promise = dispatch({ id: 'mission-short', module: 'gateway', action: 'rpc', payload: { method: 'mission.run' }, deadline });
    await vi.advanceTimersByTimeAsync(50);
    expect(await promise).toMatchObject({ ok: false, error: { code: 'TIMEOUT', details: {
      stage: 'gateway', deadlineMs: 50, elapsedMs: 50, requestId: 'mission-short', deadlineAtMs: deadline.deadlineAtMs,
    } } });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect((manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size).toBe(0);
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('refuses to send an RPC after its propagated deadline expired', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { runWithHostDeadline } = await import('@electron/utils/host-deadline-context');
    const manager = new GatewayManager();
    const ws = { readyState: 1, send: vi.fn() };
    (manager as unknown as { ws: typeof ws }).ws = ws;
    const deadline = { deadlineAtMs: Date.now() - 1, timeoutMs: 1000, stage: 'renderer' as const, requestId: 'mission-expired' };

    await expect(runWithHostDeadline(deadline, () => manager.rpc('mission.run', {}, 900_000))).rejects.toMatchObject({
      code: 'TIMEOUT', details: { stage: 'gateway', deadlineMs: 0, requestId: 'mission-expired' },
    });
    expect(ws.send).not.toHaveBeenCalled();
    expect((manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.size).toBe(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('restarts after consecutive heartbeat misses reach threshold', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(300_000);

    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('defers heartbeat restart while initial gateway.ready is still within grace', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    const connectedAt = Date.now();
    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt,
      gatewayReady: false,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);
    expect(restartSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(179_999);
    expect(restartSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not restart when heartbeat is recovered by incoming messages', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(60_000); // ping #1
    vi.advanceTimersByTime(60_000); // miss #1 + ping #2
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    vi.advanceTimersByTime(60_000); // recovered, ping #3
    vi.advanceTimersByTime(60_000); // miss #1 + ping #4
    vi.advanceTimersByTime(60_000); // miss #2 + ping #5

    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('skips heartbeat recovery when auto-reconnect is disabled', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = false;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(300_000);

    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('restarts after consecutive heartbeat misses on windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(300_000);

    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
