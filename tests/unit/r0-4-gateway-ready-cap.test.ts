// @vitest-environment node
// R0-4.3: the gateway readiness wait must respect a hard wall-clock ceiling
// even when the process stays alive but never becomes ready.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsState = vi.hoisted(() => ({
  sockets: [] as Array<{ emitJsonMessage: (m: unknown) => void }>,
  MockWebSocket: class MockWebSocket {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readyState = 1;
    readonly terminate = vi.fn(() => { this.readyState = 3; });
    constructor(public readonly url: string) {
      wsState.sockets.push(this);
    }
    on(event: string, callback: (...args: unknown[]) => void): this {
      const current = this.listeners.get(event) ?? new Set();
      current.add(callback);
      this.listeners.set(event, current);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const callback of this.listeners.get(event) ?? []) callback(...args);
    }
    emitJsonMessage(message: unknown): void {
      this.emit('message', Buffer.from(JSON.stringify(message)));
    }
  },
}));

vi.mock('ws', () => ({
  default: wsState.MockWebSocket,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('R0-4 gateway readiness wall-clock cap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsState.sockets = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws after the hard limit when the process lives but never becomes ready', async () => {
    const { waitForGatewayReady } = await import('@electron/gateway/ws-client');

    const promise = waitForGatewayReady({
      port: 18789,
      getProcessExitCode: () => null, // process stays alive, never ready
      intervalMs: 10,
      hardLimitMs: 90_000,
    });
    const assertion = expect(promise).rejects.toThrow(/failed to become ready within 90s/);

    await vi.advanceTimersByTimeAsync(91_000);
    await assertion;
  });

  it('resolves when the gateway answers the readiness challenge inside the limit', async () => {
    const { waitForGatewayReady } = await import('@electron/gateway/ws-client');

    const promise = waitForGatewayReady({
      port: 18789,
      getProcessExitCode: () => null,
      intervalMs: 10,
      hardLimitMs: 90_000,
    });

    // Simulate a gateway that becomes ready right after the first probe.
    await vi.advanceTimersByTimeAsync(10);
    wsState.sockets[0]?.emitJsonMessage({ type: 'event', event: 'connect.challenge' });
    await expect(promise).resolves.toBeUndefined();
  });
});
