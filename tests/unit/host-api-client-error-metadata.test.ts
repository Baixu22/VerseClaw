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

describe('host replay payload identity (#238)', () => {
  it.each([true, false])('prefers the exact payload regardless of fixture order (generic first=%s)', async (genericFirst) => {
    const generic = { module: 'sessions', action: 'history', result: { messages: ['generic'] } };
    const wrong = { ...generic, payload: { sessionKey: 'A' }, result: { messages: ['A'] } };
    const exact = { ...generic, payload: { limit: 20, sessionKey: 'B' }, result: { messages: ['B'] } };
    Object.assign((window as unknown as { __CLAWX_TEST__: object }).__CLAWX_TEST__, {
      hostApiReplay: { mode: 'replay', fixtures: genericFirst ? [generic, wrong, exact] : [wrong, exact, generic] },
    });
    const { invokeHost } = await import('@/lib/host-api-client');
    expect(await invokeHost('sessions', 'history', { sessionKey: 'B', limit: 20 })).toEqual(exact.result);
    expect(await invokeHost('sessions', 'history', { sessionKey: 'C' })).toEqual(generic.result);
    expect(hostInvoke).not.toHaveBeenCalled();
  });

  it('uses the real bridge when only a mismatched payload fixture exists', async () => {
    Object.assign((window as unknown as { __CLAWX_TEST__: object }).__CLAWX_TEST__, {
      hostApiReplay: { mode: 'replay', fixtures: [{ module: 'sessions', action: 'history', payload: { sessionKey: 'A' }, result: { messages: ['A'] } }] },
    });
    hostInvoke.mockResolvedValue({ id: 'real-B', ok: true, data: { messages: ['B'] } });
    const { invokeHost } = await import('@/lib/host-api-client');
    expect(await invokeHost('sessions', 'history', { sessionKey: 'B' })).toEqual({ messages: ['B'] });
    expect(hostInvoke).toHaveBeenCalledOnce();
  });
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

  it('preserves the Main timeout stage, budget and elapsed details', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req-timeout-stage',
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Host action gateway.rpc timed out after 5s',
        details: {
          stage: 'main',
          deadlineMs: 5000,
          elapsedMs: 5000,
          requestId: 'req-timeout-stage',
          deadlineAtMs: 1_700_000_005_000,
        },
      },
    });
    const { invokeHost } = await import('@/lib/host-api-client');

    const rejection = await invokeHost('app', 'version').catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      code: 'TIMEOUT',
      requestId: 'req-timeout-stage',
      details: {
        stage: 'main',
        deadlineMs: 5000,
        elapsedMs: 5000,
        requestId: 'req-timeout-stage',
        module: 'app',
        action: 'version',
      },
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
