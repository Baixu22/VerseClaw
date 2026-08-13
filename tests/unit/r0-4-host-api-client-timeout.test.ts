// R0-4.1 renderer side: the client must race every host call with a
// timeout slightly above the Main budget so a hung Main cannot pin the UI.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hostInvokeMock } = vi.hoisted(() => ({
  hostInvokeMock: vi.fn(),
}));

describe('R0-4 host-api-client timeout fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.localStorage.clear();
    hostInvokeMock.mockReset();
    (window as unknown as { verseClaw?: unknown }).verseClaw = {
      hostInvoke: hostInvokeMock,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    (window as unknown as { verseClaw?: unknown }).verseClaw = undefined;
  });

  it('rejects when Main hangs and never answers', async () => {
    hostInvokeMock.mockImplementation(() => new Promise(() => {}));
    const { invokeHost } = await import('@/lib/host-api-client');

    const promise = invokeHost('app', 'version');
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(71_000);
    await assertion;
  });

  it('resolves normally when Main answers inside the budget', async () => {
    hostInvokeMock.mockImplementation(async () => ({ id: 'r1', ok: true, data: '1.2.3' }));
    const { invokeHost } = await import('@/lib/host-api-client');

    const result = await invokeHost('app', 'version');
    expect(result).toBe('1.2.3');
  });
});
