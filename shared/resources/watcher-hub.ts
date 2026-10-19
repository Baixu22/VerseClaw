/**
 * Root-keyed filesystem watcher hub.
 *
 * Multiple subscribers watching the same directory or file share one OS-level
 * watcher. The hub does not debounce events; subscribers keep their own
 * semantics and only own one handle per watched key.
 */
import { watch, watchFile, unwatchFile, type FSWatcher, type Stats } from 'node:fs';
import { resolve } from 'node:path';

export type WatcherHubError = Error;

export type WatcherHubHandle = {
  readonly key: string;
  close: () => void;
};

export type WatcherHubOptions = {
  watchDirectory?: (path: string, listener: (eventType: string, filename: string | null) => void, onError: (error: WatcherHubError) => void) => FSWatcher;
  watchFile?: (path: string, intervalMs: number, listener: (current: Stats, previous: Stats) => void, onError: (error: WatcherHubError) => void) => void;
  unwatchFile?: (path: string) => void;
  normalizeKey?: (path: string) => string;
};

type DirectoryEntry = {
  watcher: FSWatcher;
  listeners: Set<(eventType: string, filename: string | null) => void>;
  errorListeners: Set<(error: WatcherHubError) => void>;
};

type FileEntry = {
  path: string;
  intervalMs: number;
  listeners: Set<(current: Stats, previous: Stats) => void>;
  errorListeners: Set<(error: WatcherHubError) => void>;
};

export type WatcherHubDiagnostics = {
  directoryWatchers: number;
  fileWatchers: number;
  subscriptions: number;
  keys: string[];
};

const DEFAULT_FILE_INTERVAL_MS = 250;

function defaultWatchDirectory(
  path: string,
  listener: (eventType: string, filename: string | null) => void,
  onError: (error: WatcherHubError) => void,
): FSWatcher {
  const watcher = watch(path, (eventType, filename) => listener(eventType, filename));
  watcher.on('error', onError);
  return watcher;
}

function defaultWatchFile(
  path: string,
  intervalMs: number,
  listener: (current: Stats, previous: Stats) => void,
  onError: (error: WatcherHubError) => void,
): void {
  watchFile(path, { interval: intervalMs }, listener);
  // fs.watchFile does not expose an error callback; a missing file is reported
  // by the listener's zero-stat sample on subsequent polls.
  void onError;
}

function defaultUnwatchFile(path: string): void {
  unwatchFile(path);
}

export class WatcherHub {
  private readonly directoryEntries = new Map<string, DirectoryEntry>();
  private readonly fileEntries = new Map<string, FileEntry>();
  private readonly normalizeKey: (path: string) => string;
  private readonly watchDirectoryBackend: NonNullable<WatcherHubOptions['watchDirectory']>;
  private readonly watchFileBackend: NonNullable<WatcherHubOptions['watchFile']>;
  private readonly unwatchFileBackend: NonNullable<WatcherHubOptions['unwatchFile']>;

  constructor(options: WatcherHubOptions = {}) {
    this.normalizeKey = options.normalizeKey ?? ((path) => resolve(path));
    this.watchDirectoryBackend = options.watchDirectory ?? defaultWatchDirectory;
    this.watchFileBackend = options.watchFile ?? defaultWatchFile;
    this.unwatchFileBackend = options.unwatchFile ?? defaultUnwatchFile;
  }

  subscribeDirectory(
    path: string,
    listener: (eventType: string, filename: string | null) => void,
    onError?: (error: WatcherHubError) => void,
  ): WatcherHubHandle {
    const key = this.normalizeKey(path);
    let entry = this.directoryEntries.get(key);
    if (!entry) {
      const listeners = new Set<(eventType: string, filename: string | null) => void>();
      const errorListeners = new Set<(error: WatcherHubError) => void>();
      const watcher = this.watchDirectoryBackend(
        key,
        (eventType, filename) => { for (const subscriber of listeners) subscriber(eventType, filename); },
        (error) => { for (const subscriber of errorListeners) subscriber(error); },
      );
      entry = { watcher, listeners, errorListeners };
      this.directoryEntries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (onError) entry.errorListeners.add(onError);
    return {
      key,
      close: () => {
        const current = this.directoryEntries.get(key);
        if (!current) return;
        current.listeners.delete(listener);
        if (onError) current.errorListeners.delete(onError);
        if (current.listeners.size === 0 && current.errorListeners.size === 0) {
          current.watcher.close();
          this.directoryEntries.delete(key);
        }
      },
    };
  }

  subscribeFile(
    path: string,
    listener: (current: Stats, previous: Stats) => void,
    options: { intervalMs?: number; onError?: (error: WatcherHubError) => void } = {},
  ): WatcherHubHandle {
    const key = this.normalizeKey(path);
    const intervalMs = Math.max(50, Math.floor(options.intervalMs ?? DEFAULT_FILE_INTERVAL_MS));
    let entry = this.fileEntries.get(key);
    if (!entry) {
      const listeners = new Set<(current: Stats, previous: Stats) => void>();
      const errorListeners = new Set<(error: WatcherHubError) => void>();
      this.watchFileBackend(
        key,
        intervalMs,
        (current, previous) => { for (const subscriber of listeners) subscriber(current, previous); },
        (error) => { for (const subscriber of errorListeners) subscriber(error); },
      );
      entry = { path: key, intervalMs, listeners, errorListeners };
      this.fileEntries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (options.onError) entry.errorListeners.add(options.onError);
    return {
      key,
      close: () => {
        const current = this.fileEntries.get(key);
        if (!current) return;
        current.listeners.delete(listener);
        if (options.onError) current.errorListeners.delete(options.onError);
        if (current.listeners.size === 0 && current.errorListeners.size === 0) {
          this.unwatchFileBackend(key);
          this.fileEntries.delete(key);
        }
      },
    };
  }

  getDiagnostics(): WatcherHubDiagnostics {
    const directoryKeys = [...this.directoryEntries.keys()];
    const fileKeys = [...this.fileEntries.keys()];
    const subscriptions = [...this.directoryEntries.values()].reduce((sum, entry) => sum + entry.listeners.size, 0)
      + [...this.fileEntries.values()].reduce((sum, entry) => sum + entry.listeners.size, 0);
    return {
      directoryWatchers: this.directoryEntries.size,
      fileWatchers: this.fileEntries.size,
      subscriptions,
      keys: [...directoryKeys, ...fileKeys].sort(),
    };
  }

  resetForTest(): void {
    for (const entry of this.directoryEntries.values()) entry.watcher.close();
    for (const entry of this.fileEntries.values()) this.unwatchFileBackend(entry.path);
    this.directoryEntries.clear();
    this.fileEntries.clear();
  }
}

const WATCHER_HUB_GLOBAL_KEY = Symbol.for('openclaw.watcherHub');
export function getWatcherHub(): WatcherHub {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[WATCHER_HUB_GLOBAL_KEY];
  if (existing instanceof WatcherHub) return existing;
  const created = new WatcherHub();
  globalStore[WATCHER_HUB_GLOBAL_KEY] = created;
  return created;
}

export function resetWatcherHubForTest(): void {
  getWatcherHub().resetForTest();
}