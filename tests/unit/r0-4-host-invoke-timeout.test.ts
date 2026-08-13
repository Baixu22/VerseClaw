// @vitest-environment node
// R0-4.1: the host dispatcher must fail closed with a TIMEOUT code when an
// action hangs, and the long-action whitelist must extend the budget.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostInvokeDispatcher } from '@electron/main/ipc/host-invoke';

function neverSettles(): Promise<unknown> {
  return new Promise(() => {});
}

describe('R0-4 host dispatcher timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns TIMEOUT when a normal action hangs past the default budget', async () => {
    const dispatch = createHostInvokeDispatcher({
      app: { version: () => neverSettles() },
    } as never, { requireSender: false });

    const promise = dispatch({ id: 'r1', module: 'app', action: 'version' });
    await vi.advanceTimersByTimeAsync(61_000);
    const response = await promise;

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TIMEOUT');
      expect(response.error.message).toContain('app.version');
      expect(response.error.message).toContain('60s');
    }
  });

  it('lets a normal action complete inside the budget', async () => {
    const dispatch = createHostInvokeDispatcher({
      app: { version: () => Promise.resolve('1.2.3') },
    } as never, { requireSender: false });

    const promise = dispatch({ id: 'r2', module: 'app', action: 'version' });
    await vi.advanceTimersByTimeAsync(1000);
    const response = await promise;

    expect(response).toEqual({ id: 'r2', ok: true, data: '1.2.3' });
  });

  it('extends the budget for whitelisted long actions (git.fetch)', async () => {
    const dispatch = createHostInvokeDispatcher({
      git: { fetch: () => neverSettles() },
    } as never, { requireSender: false });

    const promise = dispatch({ id: 'r3', module: 'git', action: 'fetch' });
    // Handle the eventual resolution immediately so later rejections are observed.
    const finalAssertion = promise.then((response) => {
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.error.code).toBe('TIMEOUT');
    });
    await vi.advanceTimersByTimeAsync(61_000);
    // Still inside the extended budget: the dispatch promise must not have settled.
    let settled = false;
    void promise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await finalAssertion;
  });

  it('keeps INTERNAL for synchronous action errors', async () => {
    const dispatch = createHostInvokeDispatcher({
      app: { version: () => { throw new Error('boom'); } },
    } as never, { requireSender: false });

    const response = await dispatch({ id: 'r4', module: 'app', action: 'version' });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INTERNAL');
  });
});
