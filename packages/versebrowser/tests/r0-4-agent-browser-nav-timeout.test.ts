// @vitest-environment node
// R0-4.2: webContents navigation waits must stop the load and fail after
// the timeout instead of hanging forever.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { waitForWebContents } from '../src/engine/service';

type FakeWebContents = {
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function makeFakeWebContents(): FakeWebContents {
  const events = new EventEmitter();
  const fake: FakeWebContents = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => events.on(event, cb)),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => events.once(event, cb)),
    removeListener: vi.fn((event: string, cb: (...args: unknown[]) => void) => events.removeListener(event, cb)),
    stop: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      events.emit(event, ...args);
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

  it('ignores failed subframes but still observes a later main-frame failure', async () => {
    const webContents = makeFakeWebContents();
    const promise = waitForWebContents(webContents as never, 'did-finish-load', 1000);
    webContents.emit('did-fail-load', {}, -20, 'ERR_BLOCKED_BY_CLIENT', 'http://private/', false);
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://main/', true);
    await expect(promise).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });

  it('preserves a loaded main page after an optional iframe is blocked', async () => {
    const webContents = makeFakeWebContents();
    const promise = waitForWebContents(webContents as never, 'did-finish-load', 1000);
    webContents.emit('did-fail-load', {}, -20, 'ERR_BLOCKED_BY_CLIENT', 'http://private/', false);
    webContents.emit('did-finish-load');
    await expect(promise).resolves.toBeUndefined();
  });

  it('cleans the wait when loadURL rejects before a navigation event', async () => {
    const webContents = makeFakeWebContents();
    const failure = new Error('ERR_FAILED');
    const loading = Promise.reject(failure);
    void loading.catch(() => undefined);
    const wait = waitForWebContents(webContents as never, 'did-finish-load', 1000, loading);
    const assertion = expect(wait).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(webContents.stop).not.toHaveBeenCalled();
    expect(webContents.removeListener).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(webContents.removeListener).toHaveBeenCalledWith('did-fail-load', expect.any(Function));
  });
});
