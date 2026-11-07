import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), stop: vi.fn(), shed: vi.fn(() => false), visible: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { window: { isVisible: mocks.visible }, resourceTracker: { list: mocks.list, stop: mocks.stop, stopAll: mocks.stop } } }));
vi.mock('@/lib/resource-shed', () => ({ isResourceShed: mocks.shed }));
import { useResourceStore } from '@/stores/resource-tracker';
import { createPollScheduler } from '@/lib/poll-scheduler';
const empty = { resources: [], healthyCount: 0, idleCount: 0, unreachableCount: 0, idleTimeoutMinutes: 10 };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); mocks.list.mockReset().mockResolvedValue(empty); mocks.stop.mockClear(); mocks.shed.mockClear(); });
afterEach(() => { useResourceStore.getState().stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('resource observer lifetime', () => {
  it('uses native visibility over Chromium and ignores an older visibility response', async () => {
    let settle!: (visible: boolean) => void;
    let listener!: (visible: boolean) => void;
    const unsubscribe = vi.fn(); const task = vi.fn();
    mocks.visible.mockImplementationOnce(() => new Promise<boolean>(resolve => { settle = resolve; }));
    vi.stubGlobal('window', { verseClaw: { hostInvoke() {} }, electron: { ipcRenderer: { on: (_channel: string, fn: typeof listener) => { listener = fn; return unsubscribe; } } } });
    const stop = createPollScheduler({ intervalMs: 100, immediate: true, task });
    listener(false); settle(true); await flush(); await vi.advanceTimersByTimeAsync(1000);
    expect(task).not.toHaveBeenCalled();
    listener(true); await flush(); expect(task).toHaveBeenCalledOnce();
    stop(); listener(true); await flush(); expect(task).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('shares a single refresh and releases only the final observer', async () => {
    const first = useResourceStore.getState().init(); const second = useResourceStore.getState().init();
    await flush(); expect(mocks.list).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    expect(first).toBeTypeOf('function'); expect(second).toBeTypeOf('function');
    first(); first(); await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    second(); expect(vi.getTimerCount()).toBe(0); expect(useResourceStore.getState().isInitialized).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000); expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('ignores a stopped generation response and shares explicit refreshes', async () => {
    let finish!: (value: typeof empty) => void;
    mocks.list.mockImplementationOnce(() => new Promise<typeof empty>(resolve => { finish = resolve; }));
    const old = useResourceStore.getState().init();
    const explicit = useResourceStore.getState().refresh();
    expect(mocks.list).toHaveBeenCalledOnce();
    useResourceStore.getState().stop();
    const current = useResourceStore.getState().init(); await flush();
    finish({ ...empty, healthyCount: 99 }); await explicit; await flush();
    expect(useResourceStore.getState().healthyCount).toBe(0);
    old?.(); expect(useResourceStore.getState().isInitialized).toBe(true);
    current?.(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not issue shed requests while hidden and refreshes when visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const task = vi.fn();
    const stop = createPollScheduler({ intervalMs: 100, task, isShed: mocks.shed });
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).not.toHaveBeenCalled(); expect(mocks.shed).not.toHaveBeenCalled();
    mocks.shed.mockReturnValueOnce(true);
    visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(task).toHaveBeenCalledOnce();
    stop(); document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(task).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
