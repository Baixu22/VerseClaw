// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { WatcherHub } from '../../shared/resources/watcher-hub';
import { createReadOnlyQueryCache } from '../../src/lib/read-only-query-cache';
import { join, resolve } from 'node:path';

function fixture() {
  const close = vi.fn(); const watchDirectory = vi.fn(() => ({ close }) as never);
  const watchFile = vi.fn(); const unwatchFile = vi.fn();
  return { close, watchDirectory, watchFile, unwatchFile,
    hub: new WatcherHub({ watchDirectory, watchFile, unwatchFile, normalizeKey: path => path }) };
}
describe('independent watcher ownership', () => {
  it('keeps two subscriptions with the same callback until both handles close', () => {
    const { hub, close } = fixture(); const listener = vi.fn();
    const first = hub.subscribeDirectory('/root', listener); const second = hub.subscribeDirectory('/root', listener);
    expect(hub.getDiagnostics().subscriptions).toBe(2);
    first.close(); expect(close).not.toHaveBeenCalled(); second.close(); expect(close).toHaveBeenCalledOnce();
  });
  it('does not let an old handle close a recreated subscription', () => {
    const { hub, close } = fixture(); const listener = vi.fn();
    const first = hub.subscribeDirectory('/root', listener); first.close();
    const second = hub.subscribeDirectory('/root', listener); first.close();
    expect(hub.getDiagnostics().subscriptions).toBe(1); expect(close).toHaveBeenCalledOnce(); second.close();
  });
  it('updates the shared file poll to the fastest active interval', () => {
    const { hub, watchFile } = fixture();
    const slow = hub.subscribeFile('/root/file', vi.fn(), { intervalMs: 1000 });
    const fast = hub.subscribeFile('/root/file', vi.fn(), { intervalMs: 100 });
    expect(watchFile.mock.calls.at(-1)?.[1]).toBe(100);
    fast.close(); expect(watchFile.mock.calls.at(-1)?.[1]).toBe(1000); slow.close();
  });
  it('routes overlapping recursive and shallow subscriptions using their own roots and filters', () => {
    const backends: Array<{ path: string; dispatch: (type: string, name: string | null) => void; close: ReturnType<typeof vi.fn> }> = [];
    const hub = new WatcherHub({ watchDirectory: (path, dispatch) => {
      const entry = { path, dispatch, close: vi.fn() }; backends.push(entry); return entry;
    } });
    const root = resolve('watch-root'); const child = join(root, 'child');
    const shallow = vi.fn(), markdown = vi.fn(), all = vi.fn();
    const one = hub.subscribeDirectory(child, shallow);
    const two = hub.subscribeDirectory(child, markdown, undefined, { recursive: true, filter: name => name.endsWith('.md') });
    const three = hub.subscribeDirectory(root, all, undefined, { recursive: true });
    expect(hub.getDiagnostics()).toMatchObject({ directoryWatchers: 1, subscriptions: 3 });
    const dispatch = backends.at(-1)!.dispatch;
    dispatch('change', join('child', 'nested', 'a.md'));
    expect(shallow).not.toHaveBeenCalled(); expect(markdown).toHaveBeenCalledWith('change', join('nested', 'a.md'));
    dispatch('change', join('child', 'a.txt')); expect(shallow).toHaveBeenCalledWith('change', 'a.txt'); expect(markdown).toHaveBeenCalledTimes(1);
    dispatch('change', 'sibling.md'); expect(shallow).toHaveBeenCalledTimes(1); expect(markdown).toHaveBeenCalledTimes(1);
    backends[0].dispatch('change', 'late'); expect(shallow).toHaveBeenCalledTimes(1);
    three.close(); dispatch('change', join('child', 'b.md')); expect(markdown).toHaveBeenCalledTimes(2);
    one.close(); two.close(); expect(hub.getDiagnostics().directoryWatchers).toBe(0);
    expect(backends.every(entry => entry.close.mock.calls.length === 1)).toBe(true);
  });
  it('unregisters only its file callback and ignores late delivery from an old poll', () => {
    const { hub, watchFile, unwatchFile } = fixture(); const listener = vi.fn();
    const first = hub.subscribeFile('/root/file', listener); const oldDispatch = watchFile.mock.calls[0][2];
    first.close(); expect(unwatchFile).toHaveBeenCalledWith('/root/file', oldDispatch);
    const current = hub.subscribeFile('/root/file', listener); first.close(); oldDispatch({}, {});
    expect(listener).not.toHaveBeenCalled(); expect(hub.getDiagnostics().subscriptions).toBe(1); current.close();
  });
  it('restores the original file poll when a faster backend cannot start', () => {
    const { hub, watchFile } = fixture(); const listener = vi.fn();
    const first = hub.subscribeFile('/root/file', listener, { intervalMs: 1000 });
    watchFile.mockImplementation((_path, interval) => { if (interval === 100) throw new Error('backend unavailable'); });
    expect(() => hub.subscribeFile('/root/file', vi.fn(), { intervalMs: 100 })).toThrow('backend unavailable');
    const last = watchFile.mock.calls.at(-1)!; expect(last[1]).toBe(1000); last[2]({}, {});
    expect(listener).toHaveBeenCalledOnce(); expect(hub.getDiagnostics().subscriptions).toBe(1); first.close();
  });
});
describe('read-only cache generation', () => {
  it('does not return or publish an invalidated pending result to new callers', async () => {
    const cache = createReadOnlyQueryCache<string>(); let finish!: (value: string) => void;
    const first = cache.get('root:status', () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.invalidatePrefix('root:');
    const current = cache.get('root:status', async () => 'new'); finish('old');
    expect(await first).toBe('old'); expect(await current).toBe('new');
    expect(await cache.get('root:status', async () => 'unexpected')).toBe('new');
  });
  it('clear separates pending loads and respects the requesting TTL', async () => {
    let now = 0; const cache = createReadOnlyQueryCache<string>({ ttlMs: 1000, now: () => now });
    await cache.get('key', async () => 'old', 1000); now = 200;
    expect(await cache.get('key', async () => 'fresh', 100)).toBe('fresh');
    let finish!: (value: string) => void;
    const pending = cache.get('pending', () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.clear(); const fresh = cache.get('pending', async () => 'new'); finish('old');
    await pending; expect(await fresh).toBe('new');
  });
});
