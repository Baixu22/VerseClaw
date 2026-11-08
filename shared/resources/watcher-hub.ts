/** Shared filesystem observations; each handle retains independent ownership. */
import { watch, watchFile, unwatchFile, type FSWatcher, type Stats } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type WatcherHubError = Error;
export type WatcherHubHandle = { readonly key: string; close: () => void };
type DirectoryListener = (eventType: string, filename: string | null) => void;
type FileListener = (current: Stats, previous: Stats) => void;
export type DirectoryWatchOptions = {
  recursive?: boolean;
  persistent?: boolean;
  /** Filters subscriber-relative names; null remains an invalidation hint. */
  filter?: (filename: string) => boolean;
};
export type WatcherHubOptions = {
  watchDirectory?: (path: string, listener: DirectoryListener, onError: (error: Error) => void, options?: DirectoryWatchOptions) => Pick<FSWatcher, 'close'>;
  watchFile?: (path: string, intervalMs: number, listener: FileListener, onError: (error: Error) => void) => void;
  unwatchFile?: (path: string, listener?: FileListener) => void;
  normalizeKey?: (path: string) => string;
};
type DirectorySubscription = { path: string; listener: DirectoryListener; onError?: (error: Error) => void; options: DirectoryWatchOptions };
type DirectoryEntry = { key: string; root: string; recursive: boolean; persistent: boolean; watcher: Pick<FSWatcher, 'close'>; subscribers: Map<symbol, DirectorySubscription> };
type FileSubscription = { listener: FileListener; onError?: (error: Error) => void; intervalMs: number };
type FileEntry = { path: string; intervalMs: number; subscribers: Map<symbol, FileSubscription>; dispatch: FileListener };
export type WatcherHubDiagnostics = { directoryWatchers: number; fileWatchers: number; subscriptions: number; keys: string[] };

function inside(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
}

function defaultWatchDirectory(path: string, listener: DirectoryListener, onError: (error: Error) => void, options: DirectoryWatchOptions = {}): Pick<FSWatcher, 'close'> {
  let closed = false;
  let epoch = 0;
  const attach = () => {
    const owner = ++epoch;
    const watcher = watch(path, { recursive: options.recursive ?? false, persistent: options.persistent ?? true },
      (type, name) => { if (!closed && owner === epoch) listener(type, name); });
    watcher.on('error', error => { if (!closed && owner === epoch) onError(error); });
    return watcher;
  };
  let watcher: FSWatcher | undefined = attach();
  // Recursive sources can be replaced as a whole. Monitor just their root
  // identity, not every file, and resume the same subscriptions after recreation.
  const monitor: FileListener = (current, previous) => {
    if (closed || (current.ino === previous.ino && current.dev === previous.dev && current.birthtimeMs === previous.birthtimeMs && current.nlink === previous.nlink)) return;
    epoch++; watcher?.close(); watcher = undefined;
    if (current.nlink === 0) { listener('rename', null); return; }
    try { watcher = attach(); listener('rename', null); } catch (error) { onError(error as Error); }
  };
  if (options.recursive) watchFile(path, { interval: 1000, persistent: false }, monitor);
  return { close() {
    if (closed) return;
    closed = true; watcher?.close();
    if (options.recursive) unwatchFile(path, monitor);
  } };
}

export class WatcherHub {
  private readonly directoryEntries = new Map<string, DirectoryEntry>();
  private readonly directoryOwners = new Map<symbol, DirectoryEntry>();
  private readonly fileEntries = new Map<string, FileEntry>();
  private readonly normalizeKey: (path: string) => string;
  private readonly watchDirectoryBackend: NonNullable<WatcherHubOptions['watchDirectory']>;
  private readonly watchFileBackend: NonNullable<WatcherHubOptions['watchFile']>;
  private readonly unwatchFileBackend: NonNullable<WatcherHubOptions['unwatchFile']>;

  constructor(options: WatcherHubOptions = {}) {
    this.normalizeKey = options.normalizeKey ?? (path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path));
    this.watchDirectoryBackend = options.watchDirectory ?? defaultWatchDirectory;
    this.watchFileBackend = options.watchFile ?? ((path, interval, listener) => { watchFile(path, { interval }, listener); });
    this.unwatchFileBackend = options.unwatchFile ?? ((path, listener) => { if (listener) unwatchFile(path, listener); });
  }

  subscribeDirectory(path: string, listener: DirectoryListener, onError?: (error: Error) => void, options: DirectoryWatchOptions = {}): WatcherHubHandle {
    const root = this.normalizeKey(path); const recursive = options.recursive ?? false; const persistent = options.persistent ?? true;
    const key = `${recursive ? 'recursive' : 'directory'}:${persistent}:${root}`;
    let entry = [...this.directoryEntries.values()].find(value => value.persistent === persistent
      && ((value.root === root && (value.recursive || !recursive)) || (value.recursive && inside(value.root, root))));
    if (!entry) {
      const subscribers = new Map<symbol, DirectorySubscription>();
      const created: DirectoryEntry = { key, root, recursive, persistent, subscribers, watcher: { close() {} } };
      created.watcher = this.watchDirectoryBackend(root, (event, filename) => {
        if (this.directoryEntries.get(key) !== created) return;
        for (const [token, sub] of [...subscribers]) {
          if (this.directoryOwners.get(token) !== created) continue;
          let name: string | null = null;
          if (filename !== null) {
            const absolute = resolve(root, filename);
            if (!inside(sub.path, absolute)) continue;
            name = relative(sub.path, absolute);
            if (!sub.options.recursive && name.includes(sep)) continue;
            if (sub.options.filter && !sub.options.filter(name)) continue;
          }
          sub.listener(event, name);
        }
      }, error => {
        if (this.directoryEntries.get(key) !== created) return;
        for (const [token, sub] of [...subscribers]) if (this.directoryOwners.get(token) === created) sub.onError?.(error);
      }, { recursive, persistent });
      this.directoryEntries.set(key, created); entry = created;
      // A later ancestor replaces compatible child watchers only after its own
      // backend is ready. Routing continues to use each subscriber's own root.
      if (recursive) for (const previous of [...this.directoryEntries.values()]) {
        if (previous === created || previous.persistent !== persistent || !inside(root, previous.root)) continue;
        for (const [token, sub] of previous.subscribers) { subscribers.set(token, sub); this.directoryOwners.set(token, created); }
        this.directoryEntries.delete(previous.key); previous.watcher.close();
      }
    }
    const token = Symbol('directory-subscription');
    entry.subscribers.set(token, { path: root, listener, onError, options: { ...options } }); this.directoryOwners.set(token, entry);
    return { key: root, close: () => {
      const owner = this.directoryOwners.get(token);
      if (!owner) return;
      this.directoryOwners.delete(token); owner.subscribers.delete(token);
      if (owner.subscribers.size === 0) { this.directoryEntries.delete(owner.key); owner.watcher.close(); }
    } };
  }

  subscribeFile(path: string, listener: FileListener, options: { intervalMs?: number; onError?: (error: Error) => void } = {}): WatcherHubHandle {
    const key = this.normalizeKey(path);
    const intervalMs = Math.max(50, Math.floor(options.intervalMs ?? 250));
    if (!Number.isFinite(intervalMs)) throw new RangeError('intervalMs must be finite');
    let entry = this.fileEntries.get(key);
    if (!entry) { entry = { path: key, intervalMs: 0, subscribers: new Map(), dispatch() {} }; this.fileEntries.set(key, entry); }
    const owner = entry; const token = Symbol('file-subscription');
    owner.subscribers.set(token, { listener, onError: options.onError, intervalMs });
    const update = () => {
      const interval = Math.min(...[...owner.subscribers.values()].map(sub => sub.intervalMs));
      if (owner.intervalMs === interval) return;
      const oldInterval = owner.intervalMs; const oldDispatch = owner.dispatch;
      if (owner.intervalMs) this.unwatchFileBackend(key, owner.dispatch);
      owner.intervalMs = interval;
      const dispatch: FileListener = (current, previous) => {
        if (this.fileEntries.get(key) !== owner || owner.dispatch !== dispatch) return;
        for (const [id, sub] of [...owner.subscribers]) if (owner.subscribers.has(id)) sub.listener(current, previous);
      };
      owner.dispatch = dispatch;
      const notifyError = (error: Error) => {
        if (this.fileEntries.get(key) !== owner || owner.dispatch !== dispatch) return;
        for (const sub of [...owner.subscribers.values()]) sub.onError?.(error);
      };
      try { this.watchFileBackend(key, interval, dispatch, notifyError); }
      catch (error) {
        owner.intervalMs = oldInterval; owner.dispatch = oldDispatch;
        if (oldInterval) this.watchFileBackend(key, oldInterval, oldDispatch, failure => {
          if (this.fileEntries.get(key) === owner && owner.dispatch === oldDispatch) for (const sub of [...owner.subscribers.values()]) sub.onError?.(failure);
        });
        throw error;
      }
    };
    try { update(); } catch (error) { owner.subscribers.delete(token); if (!owner.subscribers.size) this.fileEntries.delete(key); throw error; }
    return { key, close: () => {
      if (this.fileEntries.get(key) !== owner || !owner.subscribers.delete(token)) return;
      if (owner.subscribers.size) update();
      else { this.fileEntries.delete(key); this.unwatchFileBackend(key, owner.dispatch); }
    } };
  }

  getDiagnostics(): WatcherHubDiagnostics {
    return { directoryWatchers: this.directoryEntries.size, fileWatchers: this.fileEntries.size,
      subscriptions: this.directoryOwners.size + [...this.fileEntries.values()].reduce((sum, entry) => sum + entry.subscribers.size, 0),
      keys: [...this.directoryEntries.values()].map(entry => entry.root).concat([...this.fileEntries.keys()]).sort() };
  }
  resetForTest(): void {
    const directories = [...this.directoryEntries.values()]; const files = [...this.fileEntries.values()];
    this.directoryEntries.clear(); this.directoryOwners.clear(); this.fileEntries.clear();
    for (const entry of directories) entry.watcher.close();
    for (const entry of files) this.unwatchFileBackend(entry.path, entry.dispatch);
  }
}

const WATCHER_HUB_GLOBAL_KEY = Symbol.for('openclaw.watcherHub');
export function getWatcherHub(): WatcherHub {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[WATCHER_HUB_GLOBAL_KEY];
  if (existing instanceof WatcherHub) return existing;
  const created = new WatcherHub(); globalStore[WATCHER_HUB_GLOBAL_KEY] = created; return created;
}
export function resetWatcherHubForTest(): void { getWatcherHub().resetForTest(); }
