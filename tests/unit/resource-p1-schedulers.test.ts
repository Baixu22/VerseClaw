import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPollScheduler } from '@/lib/poll-scheduler';
import { createReadOnlyQueryCache } from '@/lib/read-only-query-cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('read-only query cache', () => {
  it('coalesces concurrent loads and honors TTL without caching rejections', async () => {
    let now = 0;
    let calls = 0;
    let resolve!: (value: { n: number }) => void;
    const cache = createReadOnlyQueryCache<{ n: number }>({ ttlMs: 100, now: () => now });
    const load = () => {
      calls += 1;
      return new Promise<{ n: number }>((done) => { resolve = done; });
    };
    const first = cache.get('git:status', load);
    const second = cache.get('git:status', load);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolve({ n: 1 });
    await expect(first).resolves.toEqual({ n: 1 });
    await expect(second).resolves.toEqual({ n: 1 });
    expect(await cache.get('git:status', async () => ({ n: 2 }))).toEqual({ n: 1 });
    now = 101;
    expect(await cache.get('git:status', async () => ({ n: 2 }))).toEqual({ n: 2 });
    await expect(cache.get('failure', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(cache.get('failure', async () => ({ n: 3 }))).resolves.toEqual({ n: 3 });
  });

  it('invalidates a cache prefix explicitly', async () => {
    const cache = createReadOnlyQueryCache<string>({ ttlMs: 1000 });
    await cache.get('git:repo-a:status', async () => 'a');
    await cache.get('git:repo-b:status', async () => 'b');
    expect(cache.invalidatePrefix('git:repo-a:')).toBe(1);
    expect(await cache.get('git:repo-a:status', async () => 'a2')).toBe('a2');
    expect(await cache.get('git:repo-b:status', async () => 'b2')).toBe('b');
  });
});

describe('poll scheduler priority', () => {
  it('does not run background polls while shed, but never suppresses interactive polls', () => {
    vi.useFakeTimers();
    let shed = true;
    const background = vi.fn();
    const interactive = vi.fn();
    const stopBackground = createPollScheduler({
      intervalMs: 100, priority: 'background', isShed: () => shed, task: background,
    });
    const stopInteractive = createPollScheduler({
      intervalMs: 100, priority: 'interactive', isShed: () => shed, task: interactive,
    });
    vi.advanceTimersByTime(300);
    expect(background).not.toHaveBeenCalled();
    expect(interactive).toHaveBeenCalledTimes(1);
    shed = false;
    vi.advanceTimersByTime(100);
    expect(background).toHaveBeenCalledTimes(1);
    stopBackground();
    stopInteractive();
    vi.useRealTimers();
  });
});

describe('poll scheduler', () => {
  it('stops callbacks while hidden or blocked and never overlaps work', async () => {
    vi.useFakeTimers();
    let visible = true;
    let canRun = true;
    let running = 0;
    let peak = 0;
    const task = vi.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((done) => setTimeout(done, 50));
      running -= 1;
    });
    const stop = createPollScheduler({
      intervalMs: 100,
      task,
      isVisible: () => visible,
      canRun: () => canRun,
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(task).toHaveBeenCalledTimes(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).toHaveBeenCalledTimes(2);
    visible = true;
    canRun = false;
    await vi.advanceTimersByTimeAsync(30000);
    expect(task).toHaveBeenCalledTimes(2);
    canRun = true;
    await vi.advanceTimersByTimeAsync(120);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(task).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    vi.useRealTimers();
  });
});
