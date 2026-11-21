// @vitest-environment node
// R0-4.1: the host dispatcher must fail closed with a TIMEOUT code when an
// action hangs, and the long-action whitelist must extend the budget.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostInvokeDispatcher } from '@electron/main/ipc/host-invoke';
import { getHostDeadline } from '@electron/utils/host-deadline-context';

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

  it.each([
    { method: 'mission.run', completes: true },
    { method: ' mission.run ', completes: true },
    { method: 'memory.proposals', completes: false },
  ])('enforces the nested Gateway budget for $method', async ({ method, completes }) => {
    const payload = { method, timeoutMs: 150_000 };
    const dispatch = createHostInvokeDispatcher({
      gateway: { rpc: () => new Promise((resolve) => setTimeout(() => resolve('settled'), 70_000)) },
    } as never, { requireSender: false });

    const promise = dispatch({ id: method, module: 'gateway', action: 'rpc', payload });
    await vi.advanceTimersByTimeAsync(70_000);
    const response = await promise;

    if (completes) {
      expect(response).toEqual({ id: method, ok: true, data: 'settled' });
    } else {
      expect(response).toMatchObject({ id: method, ok: false, error: { code: 'TIMEOUT' } });
    }
  });
});

describe('NET-E host dispatcher logical deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps the Main budget to the remaining logical deadline instead of adding to it', async () => {
    const deadline = { deadlineAtMs: Date.now() + 5000, timeoutMs: 60_000, stage: 'renderer' as const, requestId: 'r-deadline' };
    const dispatch = createHostInvokeDispatcher({
      app: { version: () => neverSettles() },
    } as never, { requireSender: false });

    const promise = dispatch({ id: 'r-deadline', module: 'app', action: 'version', deadline });
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void promise.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const response = await promise;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TIMEOUT');
      expect(response.error.details).toMatchObject({
        stage: 'main',
        deadlineMs: 5000,
        elapsedMs: 5000,
        requestId: 'r-deadline',
        deadlineAtMs: deadline.deadlineAtMs,
      });
    }
  });

  it('clamps a whitelisted long action to the caller deadline', async () => {
    const deadline = { deadlineAtMs: Date.now() + 3000, timeoutMs: 3000, stage: 'renderer' as const };
    const dispatch = createHostInvokeDispatcher({
      git: { fetch: () => neverSettles() },
    } as never, { requireSender: false });

    const promise = dispatch({ id: 'r-long', module: 'git', action: 'fetch', deadline });
    await vi.advanceTimersByTimeAsync(3000);
    const response = await promise;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TIMEOUT');
      expect(response.error.details).toMatchObject({ stage: 'main', deadlineMs: 3000 });
    }
  });

  it('fails fast when the propagated deadline already expired', async () => {
    const action = vi.fn(() => Promise.resolve('late'));
    const dispatch = createHostInvokeDispatcher({
      app: { version: action },
    } as never, { requireSender: false });

    const response = await dispatch({
      id: 'r-expired',
      module: 'app',
      action: 'version',
      deadline: { deadlineAtMs: Date.now() - 1, timeoutMs: 1000, stage: 'renderer' as const, requestId: 'r-expired' },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TIMEOUT');
      expect(response.error.details).toMatchObject({ stage: 'main', deadlineMs: 0, requestId: 'r-expired' });
    }
    // A late success never runs once the logical deadline has expired.
    expect(action).not.toHaveBeenCalled();
  });

  it('exposes the caller deadline to nested Main-side work', async () => {
    const deadline = { deadlineAtMs: Date.now() + 5000, timeoutMs: 5000, stage: 'renderer' as const, requestId: 'r-context' };
    const dispatch = createHostInvokeDispatcher({
      app: { version: () => Promise.resolve(getHostDeadline() ?? null) },
    } as never, { requireSender: false });

    const response = await dispatch({ id: 'r-context', module: 'app', action: 'version', deadline });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toMatchObject({ stage: 'renderer', requestId: 'r-context' });
    }
    // The ambient context never leaks outside the action.
    expect(getHostDeadline()).toBeUndefined();
  });
});
