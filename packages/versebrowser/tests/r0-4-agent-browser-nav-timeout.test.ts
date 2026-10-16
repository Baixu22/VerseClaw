// @vitest-environment node
// R0-4.2: webContents navigation waits must stop the load and fail after
// the timeout instead of hanging forever.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForWebContents } from '../src/engine/service';

type FakeWebContents = {
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function makeFakeWebContents(): FakeWebContents {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const fake: FakeWebContents = {
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? new Set();
      current.add(cb);
      listeners.set(event, current);
    }),
    removeListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(cb);
    }),
    stop: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  };
  return fake;
}

describe('R0-4 agent browser navigation timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops the load and rejects when navigation never finishes', async () => {
    const webContents = makeFakeWebContents();
    const promise = waitForWebContents(webContents as never, 'did-finish-load', 1000);
    const assertion = expect(promise).rejects.toThrow(/timed out after 1s/);

    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(webContents.stop).toHaveBeenCalledTimes(1);
  });

  it('resolves on the navigation event and never calls stop', async () => {
    const webContents = makeFakeWebContents();
    const promise = waitForWebContents(webContents as never, 'did-finish-load', 1000);

    webContents.emit('did-finish-load');
    await expect(promise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(webContents.stop).not.toHaveBeenCalled();
  });

  it('rejects on did-fail-load with the error code', async () => {
    const webContents = makeFakeWebContents();
    const promise = waitForWebContents(webContents as never, 'dom-ready', 1000);

    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED');
    await expect(promise).rejects.toThrow(/navigation failed \(-105\): ERR_NAME_NOT_RESOLVED/);
    expect(webContents.stop).not.toHaveBeenCalled();
  });
});
