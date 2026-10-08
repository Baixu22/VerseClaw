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

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/gateway/startup-orchestrator', () => ({ runGatewayStartupSequence: vi.fn() }));
vi.mock('@electron/gateway/supervisor', async (importOriginal) => ({
  ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
  warmupManagedPythonReadiness: vi.fn(),
}));

describe('GatewayManager restart recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
  });

  it('re-enables auto-reconnect when start() fails during restart', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    // Expose private members for testing
    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
      stop: () => Promise<void>;
      start: () => Promise<void>;
    };

    // Set the manager into a state where restart can proceed:
    // - state must not be 'starting' or 'reconnecting' (would defer restart)
    // - startLock must be false
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to just reset flags (simulates normal stop)
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to fail (simulates the race condition where gateway
    // is reachable but not attachable after in-process restart)
    vi.spyOn(manager, 'start').mockRejectedValue(
      new Error('WebSocket closed before handshake: unknown'),
    );

    // Spy on scheduleReconnect
    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    // Perform the restart - it should throw because start() fails
    await expect(manager.restart()).rejects.toThrow(
      'WebSocket closed before handshake: unknown',
    );

    // KEY ASSERTION: After start() fails in restart(), shouldReconnect
    // must be re-enabled so the gateway can self-heal
    expect(internals.shouldReconnect).toBe(true);
    expect(scheduleReconnectSpy).toHaveBeenCalled();
  });

  it('does not schedule extra reconnect when restart succeeds', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
    };

    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to reset flags
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to succeed
    vi.spyOn(manager, 'start').mockImplementation(async () => {
      internals.shouldReconnect = true;
      internals.status = { state: 'running', port: 18789 };
    });

    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    await manager.restart();

    // scheduleReconnect should NOT have been called by the catch block
    // (it may be called from other paths, but not the restart-recovery catch)
    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
  });
  it('accepts a recovery start after stop cancels a pending startup', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { runGatewayStartupSequence } = await import('@electron/gateway/startup-orchestrator');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      refreshConfiguredPort: () => Promise<void>;
      refreshReloadPolicy: () => Promise<void>;
      initDeviceIdentity: () => Promise<void>;
      setStatus: (status: { state: string }) => void;
    };
    for (const method of ['refreshConfiguredPort', 'refreshReloadPolicy', 'initDeviceIdentity'] as const) {
      vi.spyOn(internals, method).mockResolvedValue(undefined);
    }
    let entered!: () => void;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(runGatewayStartupSequence)
      .mockImplementationOnce(async (hooks) => {
        entered();
        await pending;
        hooks.assertLifecycle('test/pending-start');
      })
      .mockImplementationOnce(async () => {
        internals.setStatus({ state: 'running' });
      });

    const initialStart = manager.start();
    await started;
    // Match the operator's stop -> repair -> start order while the old start
    // still owns its lock. The recovery request must not disappear.
    const recovery = manager.stop().then(() => manager.start());
    await Promise.resolve();
    release();
    await Promise.all([initialStart, recovery]);
    expect(runGatewayStartupSequence).toHaveBeenCalledTimes(2);
    expect(manager.getStatus().state).toBe('running');
  });

});
