import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRestartController } from '@electron/gateway/restart-controller';

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

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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

  it.each([
    { name: 'reload captured by successful launch', before: ['reload'], after: [], outcome: 'managed', restarts: 0 },
    { name: 'reload after configuration capture in the same millisecond', before: ['reload'], after: ['reload'], outcome: 'managed', restarts: 1 },
    { name: 'explicit restart before configuration capture', before: ['restart', 'reload'], after: [], outcome: 'managed', restarts: 1 },
    { name: 'explicit restart after configuration capture', before: ['reload'], after: ['restart'], outcome: 'managed', restarts: 1 },
    { name: 'reload on failed startup', before: ['reload'], after: [], outcome: 'failed', restarts: 1 },
    { name: 'reload on external process attachment', before: ['reload'], after: [], outcome: 'external', restarts: 1 },
    { name: 'reload on owned process reconnection without configuration capture', before: ['reload'], after: [], outcome: 'owned', restarts: 1 },
    { name: 'reload after a spawned process recovers on retry', before: ['reload'], after: [], outcome: 'spawned-retry', restarts: 0 },
    { name: 'later reload before a spawned process recovers on retry', before: ['reload'], after: ['reload'], outcome: 'spawned-retry', restarts: 1 },
  ])('handles $name', async ({ before, after, outcome, restarts }) => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { runGatewayStartupSequence } = await import('@electron/gateway/startup-orchestrator');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      refreshConfiguredPort: () => Promise<void>;
      refreshReloadPolicy: () => Promise<void>;
      initDeviceIdentity: () => Promise<void>;
      startProcess: () => Promise<void>;
      startHealthCheck: () => void;
      scheduleReconnect: () => void;
      setStatus: (status: { state: string }) => void;
      restartController: GatewayRestartController;
      process: { pid: number };
      ownsProcess: boolean;
    };
    for (const method of ['refreshConfiguredPort', 'refreshReloadPolicy', 'initDeviceIdentity', 'startProcess'] as const) {
      vi.spyOn(internals, method).mockResolvedValue(undefined);
    }
    vi.spyOn(internals, 'startHealthCheck').mockImplementation(() => undefined);
    vi.spyOn(internals, 'scheduleReconnect').mockImplementation(() => undefined);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue(undefined);
    const enqueue = (reason: string) => internals.restartController.markDeferredRestart(reason, { state: 'starting', startLock: true });
    vi.mocked(runGatewayStartupSequence).mockImplementationOnce(async (hooks) => {
      before.forEach(enqueue);
      if (outcome !== 'external' && outcome !== 'owned') await hooks.startProcess();
      after.forEach(enqueue);
      if (outcome === 'failed') throw new Error('startup failed');
      internals.setStatus({ state: 'running' });
      if (outcome === 'owned' || outcome === 'spawned-retry') {
        internals.process = { pid: 1234 };
        internals.ownsProcess = true;
      }
      if (outcome === 'managed') hooks.onConnectedToManagedGateway();
      else hooks.onConnectedToExistingGateway();
    });

    if (outcome === 'failed') await expect(manager.start()).rejects.toThrow('startup failed');
    else await manager.start();
    expect(restart).toHaveBeenCalledTimes(restarts);
  });

  it('executes a later reload after the enclosing restart finishes', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { runGatewayStartupSequence } = await import('@electron/gateway/startup-orchestrator');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      refreshConfiguredPort: () => Promise<void>;
      refreshReloadPolicy: () => Promise<void>;
      initDeviceIdentity: () => Promise<void>;
      startProcess: () => Promise<void>;
      startHealthCheck: () => void;
      setStatus: (status: { state: string }) => void;
      restartInFlight: Promise<void> | null;
      restartGovernor: { decide: () => { allow: true } };
    };
    for (const method of ['refreshConfiguredPort', 'refreshReloadPolicy', 'initDeviceIdentity', 'startProcess'] as const) {
      vi.spyOn(internals, method).mockResolvedValue(undefined);
    }
    vi.spyOn(internals, 'startHealthCheck').mockImplementation(() => undefined);
    vi.spyOn(internals.restartGovernor, 'decide').mockReturnValue({ allow: true });
    let starts = 0;
    vi.mocked(runGatewayStartupSequence).mockImplementation(async (hooks) => {
      await hooks.startProcess();
      if (++starts === 1) await manager.reload();
      internals.setStatus({ state: 'running' });
      hooks.onConnectedToManagedGateway();
    });
    internals.setStatus({ state: 'running' });
    await manager.restart();
    await internals.restartInFlight;
    expect(runGatewayStartupSequence).toHaveBeenCalledTimes(2);
    expect(manager.getStatus().state).toBe('running');
  });

  it.each(['stop', 'start', 'start-failure'] as const)('preserves an explicit stop during restart %s', async (phase) => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      shouldReconnect: boolean;
      scheduleReconnect: () => void;
      restartGovernor: { getObservability: () => { executed_total: number } };
    };
    internals.status = { state: 'running', port: 18789 };
    internals.shouldReconnect = true;
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const originalStop = manager.stop.bind(manager);
    if (phase === 'stop') {
      vi.spyOn(manager, 'stop').mockImplementationOnce(async () => {
        await originalStop();
        entered();
        await pending;
      });
    }
    const start = vi.spyOn(manager, 'start').mockImplementation(async () => {
      if (phase !== 'stop') {
        entered();
        await pending;
        if (phase === 'start-failure') throw new Error('cancelled startup failure');
      }
    });
    const reconnect = vi.spyOn(internals, 'scheduleReconnect').mockImplementation(() => undefined);
    const restart = manager.restart();
    const outcome = restart.catch(error => error);
    await waiting;
    await manager.stop();
    release();
    await outcome;
    expect(internals.shouldReconnect).toBe(false);
    expect(manager.getStatus().state).toBe('stopped');
    expect(reconnect).not.toHaveBeenCalled();
    expect(internals.restartGovernor.getObservability().executed_total).toBe(0);
    if (phase === 'stop') expect(start).not.toHaveBeenCalled();
  });

  it('cancels a restart waiting for its cooldown when explicitly stopped', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      restartGovernor: { recordExecuted: () => void };
    };
    internals.status = { state: 'running', port: 18789 };
    internals.restartGovernor.recordExecuted();
    const start = vi.spyOn(manager, 'start').mockResolvedValue(undefined);
    const restart = manager.restart();
    await manager.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await restart;
    expect(start).not.toHaveBeenCalled();
    expect(manager.getStatus().state).toBe('stopped');
  });
});
