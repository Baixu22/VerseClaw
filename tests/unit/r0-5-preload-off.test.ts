// @vitest-environment node
// R0-5.2: preload off() must remove the WRAPPER listeners registered by
// on()/once() — removing the raw callback deletes nothing and leaks.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  ipcOn: vi.fn(),
  ipcOnce: vi.fn(),
  ipcRemoveListener: vi.fn(),
  ipcRemoveAllListeners: vi.fn(),
  exposeInMainWorld: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    on: electronMocks.ipcOn,
    once: electronMocks.ipcOnce,
    removeListener: electronMocks.ipcRemoveListener,
    removeAllListeners: electronMocks.ipcRemoveAllListeners,
    invoke: vi.fn(),
  },
  webUtils: {},
}));

type BridgeApi = {
  on: (channel: string, cb: (...args: unknown[]) => void) => () => void;
  once: (channel: string, cb: (...args: unknown[]) => void) => () => void;
  off: (channel: string, cb?: (...args: unknown[]) => void) => void;
};

async function loadBridge(): Promise<BridgeApi> {
  await import('@electron/preload/index');
  const call = electronMocks.exposeInMainWorld.mock.calls.find((entry) => entry[0] === 'electron');
  // on/once/off live under electronAPI.ipcRenderer in the preload bridge.
  return (call?.[1] as { ipcRenderer: BridgeApi }).ipcRenderer;
}

describe('R0-5 preload off() wrapper removal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('off(callback) removes the wrapper registered by on()', async () => {
    const bridge = await loadBridge();
    const callback = vi.fn();

    bridge.on('channel:telegram-qr', callback);
    bridge.off('channel:telegram-qr', callback);

    const registered = electronMocks.ipcOn.mock.calls[0]?.[1];
    const removed = electronMocks.ipcRemoveListener.mock.calls[0]?.[1];
    expect(removed).toBe(registered);
    expect(removed).not.toBe(callback);
  });

  it('off() without callback removes all listeners for the channel', async () => {
    const bridge = await loadBridge();

    bridge.off('channel:telegram-qr');
    expect(electronMocks.ipcRemoveAllListeners).toHaveBeenCalledWith('channel:telegram-qr');
  });

  it('the on() unsubscribe removes the wrapper too', async () => {
    const bridge = await loadBridge();
    const unsubscribe = bridge.on('channel:telegram-qr', vi.fn());
    unsubscribe();

    const registered = electronMocks.ipcOn.mock.calls[0]?.[1];
    const removed = electronMocks.ipcRemoveListener.mock.calls[0]?.[1];
    expect(removed).toBe(registered);
  });

  it('once() returns a cancellable unsubscribe', async () => {
    const bridge = await loadBridge();
    const unsubscribe = bridge.once('channel:telegram-qr', vi.fn());
    unsubscribe();

    const registered = electronMocks.ipcOnce.mock.calls[0]?.[1];
    const removed = electronMocks.ipcRemoveListener.mock.calls[0]?.[1];
    expect(removed).toBe(registered);
  });
});
