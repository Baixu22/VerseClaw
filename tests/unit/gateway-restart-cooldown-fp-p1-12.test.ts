/**
 * FP-P1-12: a restart suppressed by the cooldown must not be silently dropped.
 *
 * Before this, `restart()` returned `void` on suppression — the caller could
 * not tell it apart from a successful restart. A config change written just
 * inside the 2500ms window therefore never reached the child, and the flag-ack
 * poll that followed reported an unexplainable `failed`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/fp-p1-12',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: () => undefined,
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined, on: () => undefined },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type ManagerInternals = {
  status: { state: string; port: number; pid?: number };
  startLock: boolean;
  shouldReconnect: boolean;
  restartInFlight: Promise<void> | null;
  restartGovernor: { recordExecuted: (now?: number) => void };
};

describe('FP-P1-12 restart cooldown must delay, never drop', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('waits out the cooldown and still restarts', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as ManagerInternals;

    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    let starts = 0;
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.status = { state: 'stopped', port: 18789 };
    });
    vi.spyOn(manager, 'start').mockImplementation(async () => {
      starts += 1;
      internals.status = { state: 'running', port: 18789 };
    });

    // First restart executes and arms the cooldown.
    await manager.restart();
    expect(starts).toBe(1);

    // Second restart lands inside the cooldown window. It must NOT be dropped:
    // the whole point is that a legitimate config change still reaches a child.
    await manager.restart();
    expect(starts).toBe(2);
  }, 20_000);

  it('gives up rather than hanging when the wait would exceed the ceiling', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as ManagerInternals;

    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;

    vi.spyOn(manager, 'stop').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(manager, 'start').mockResolvedValue(undefined);

    // Force a retryAfter beyond the ceiling by claiming a restart happened far
    // in the future — the governor then reports a huge remaining cooldown.
    internals.restartGovernor.recordExecuted(Date.now() + 10 * 60_000);
    await manager.restart();

    // Suppressed and NOT retried: an absurd wait means something other than the
    // cooldown is wrong, and blocking for minutes would be worse than failing.
    expect(startSpy).not.toHaveBeenCalled();
  }, 20_000);
});
