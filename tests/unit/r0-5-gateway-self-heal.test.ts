// @vitest-environment node
// R0-5.4: after the reconnect cap is exhausted, a 5-minute background probe
// must restart the attempt cycle instead of leaving a permanent error.

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

type ManagerInternals = {
  shouldReconnect: boolean;
  setStatus: (status: { state: string; port?: number }) => void;
  getStatus: () => { state: string };
  reconnectAttempts: number;
  reconnectConfig: { maxAttempts: number; baseDelay: number; maxDelay: number };
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectSelfHealTimer: ReturnType<typeof setTimeout> | null;
  scheduleReconnect: () => void;
};

async function makeExhaustedManager() {
  const { GatewayManager } = await import('@electron/gateway/manager');
  const manager = new GatewayManager();
  const internals = manager as unknown as ManagerInternals;
  internals.setStatus({ state: 'error', port: 18789 });
  internals.shouldReconnect = true;
  internals.reconnectAttempts = internals.reconnectConfig.maxAttempts;
  internals.reconnectTimer = null;
  return { manager, internals };
}

describe('R0-5 gateway reconnect self-heal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
  });

  it('arms a 5-minute probe when reconnect attempts are exhausted', async () => {
    const { internals } = await makeExhaustedManager();

    internals.scheduleReconnect();

    expect(internals.getStatus().state).toBe('error');
    expect(internals.reconnectSelfHealTimer).not.toBeNull();
  });

  it('restarts the attempt cycle from the probe when the gateway is still down', async () => {
    const { internals } = await makeExhaustedManager();
    internals.scheduleReconnect();
    expect(internals.reconnectSelfHealTimer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    // Fresh cycle: scheduleReconnect immediately consumes attempt 1 again.
    expect(internals.reconnectAttempts).toBe(1);
    expect(internals.getStatus().state).toBe('reconnecting');
    expect(internals.reconnectTimer).not.toBeNull();
  });

  it('skips the probe when the gateway is healthy again', async () => {
    const { internals } = await makeExhaustedManager();
    internals.scheduleReconnect();
    internals.setStatus({ state: 'running', port: 18789 });
    const attemptsBefore = internals.reconnectAttempts;

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(internals.reconnectAttempts).toBe(attemptsBefore);
    expect(internals.getStatus().state).toBe('running');
  });
});
