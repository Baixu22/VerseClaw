// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostInvoke = vi.fn();
let hostApiCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  window.localStorage.clear();
  hostInvoke.mockReset();
  hostApiCalls = [];
  (window as unknown as { __CLAWX_TEST__?: unknown }).__CLAWX_TEST__ = { hostApiCalls };
  (window as unknown as { verseClaw?: unknown }).verseClaw = { hostInvoke };
});

afterEach(() => {
  vi.useRealTimers();
  (window as unknown as { __CLAWX_TEST__?: unknown }).__CLAWX_TEST__ = undefined;
  (window as unknown as { verseClaw?: unknown }).verseClaw = undefined;
});

describe('host-api-client structured error preservation (#118)', () => {
  it('preserves the Main code, request id and structured details', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req-timeout-118',
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'deadline exceeded',
        details: { upstream: 'synthetic-provider' },
      },
    });
    const { invokeHost } = await import('@/lib/host-api-client');

    await expect(invokeHost('app', 'version')).rejects.toMatchObject({
      code: 'TIMEOUT',
      requestId: 'req-timeout-118',
      message: 'deadline exceeded',
      details: {
        upstream: 'synthetic-provider',
        module: 'app',
        action: 'version',
        requestId: 'req-timeout-118',
      },
    });
  });

  it('uses nested status when the Main code is the generic INTERNAL bucket', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req-rate-118',
      ok: false,
      error: { code: 'INTERNAL', message: 'limited', details: { status: 429 } },
    });
    const { invokeHost } = await import('@/lib/host-api-client');

    await expect(invokeHost('app', 'version')).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      requestId: 'req-rate-118',
      details: { status: 429 },
    });
  });

  it('records bridge rejection on the same request id and preserves its structured code', async () => {
    hostInvoke.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'PERMISSION' }));
    const { invokeHost } = await import('@/lib/host-api-client');

    const rejection = await invokeHost('app', 'version').catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      code: 'PERMISSION',
      message: 'permission denied',
      requestId: hostApiCalls[0].id,
    });
    expect(hostApiCalls[0]).toMatchObject({
      id: (rejection as { requestId?: string }).requestId,
      module: 'app',
      action: 'version',
      ok: false,
      error: 'permission denied',
      endedAt: expect.any(Number),
      durationMs: expect.any(Number),
    });
  });

  it('records a renderer timeout instead of leaking a bare Error', async () => {
    vi.useFakeTimers();
    hostInvoke.mockImplementation(() => new Promise(() => {}));
    const { invokeHost } = await import('@/lib/host-api-client');

    const rejection = invokeHost('app', 'version').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(71_000);
    const error = await rejection;
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      requestId: hostApiCalls[0].id,
    });
    expect(hostApiCalls[0]).toMatchObject({ ok: false, endedAt: expect.any(Number) });
  });
});
