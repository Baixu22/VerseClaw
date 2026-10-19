import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerAligner } from '../../shared/resources/timer-aligner';
import { WatcherHub } from '../../shared/resources/watcher-hub';

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerAligner', () => {
  it('runs aligned tasks and stretches non-interactive work while shedding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const aligner = new TimerAligner({ tickMs: 1_000 });
    let backgroundRuns = 0;
    let interactiveRuns = 0;
    aligner.register({ id: 'background', intervalMs: 1_000, run: () => { backgroundRuns += 1; } });
    aligner.register({ id: 'interactive', intervalMs: 1_000, priority: 'interactive', run: () => { interactiveRuns += 1; } });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(backgroundRuns).toBe(3);
    expect(interactiveRuns).toBe(3);

    aligner.setShedding(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(backgroundRuns).toBe(4);
    expect(interactiveRuns).toBe(7);
    expect(aligner.getDiagnostics()).toMatchObject({ shedding: true, ticks: 7, runs: 11, skippedInFlight: 0 });
  });

  it('does not overlap async work and releases its interval when empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const aligner = new TimerAligner({ tickMs: 1_000 });
    let release!: () => void;
    let runs = 0;
    const unregister = aligner.register({ id: 'slow', intervalMs: 1_000, run: () => {
      runs += 1;
      return new Promise<void>((resolve) => { release = resolve; });
    } });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runs).toBe(1);
    expect(aligner.getDiagnostics().skippedInFlight).toBeGreaterThan(0);
    release();
    await Promise.resolve();
    unregister();
    expect(aligner.running).toBe(false);
  });
});

describe('WatcherHub', () => {
  it('shares one directory watcher across subscribers and closes it with the last one', () => {
    const watchers: Array<{ close: () => void }> = [];
    const dispatchRef: { current: ((eventType: string, filename: string | null) => void) | null } = { current: null };
    const watchDirectory = vi.fn((_path: string, listener: (eventType: string, filename: string | null) => void) => {
      dispatchRef.current = listener;
      const watcher = { close: vi.fn() };
      watchers.push(watcher);
      return watcher as never;
    });
    const hub = new WatcherHub({ watchDirectory, normalizeKey: (path) => path });
    const first = vi.fn();
    const second = vi.fn();
    const firstHandle = hub.subscribeDirectory('/root', first);
    const secondHandle = hub.subscribeDirectory('/root', second);
    expect(watchDirectory).toHaveBeenCalledTimes(1);
    expect(hub.getDiagnostics()).toMatchObject({ directoryWatchers: 1, subscriptions: 2 });
    dispatchRef.current?.('change', 'file.txt');
    expect(first).toHaveBeenCalledWith('change', 'file.txt');
    expect(second).toHaveBeenCalledWith('change', 'file.txt');
    firstHandle.close();
    expect(watchers[0].close).not.toHaveBeenCalled();
    secondHandle.close();
    expect(watchers[0].close).toHaveBeenCalledTimes(1);
    expect(hub.getDiagnostics().directoryWatchers).toBe(0);
  });

  it('shares one file watcher across subscribers and removes it on the last close', () => {
    const dispatchRef: { current: ((current: unknown, previous: unknown) => void) | null } = { current: null };
    const unwatch = vi.fn();
    const watchFile = vi.fn((_path: string, _interval: number, listener: (current: unknown, previous: unknown) => void) => {
      dispatchRef.current = listener;
    });
    const hub = new WatcherHub({ watchFile: watchFile as never, unwatchFile: unwatch as never, normalizeKey: (path) => path });
    const first = vi.fn();
    const second = vi.fn();
    const firstHandle = hub.subscribeFile('/root/file.txt', first as never);
    hub.subscribeFile('/root/file.txt', second as never);
    expect(watchFile).toHaveBeenCalledTimes(1);
    dispatchRef.current?.({ size: 1 }, { size: 0 });
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    firstHandle.close();
    expect(unwatch).not.toHaveBeenCalled();
    hub.resetForTest();
    expect(unwatch).toHaveBeenCalledWith('/root/file.txt');
  });
});