/**
 * Filesystem watcher helpers.
 *
 * Centralizes retry timing and close/error handling for agent file watchers.
 */
import { type FSWatcher, type WatchListener } from "node:fs";
import { getWatcherHub, type WatcherHubHandle } from "../../../../shared/resources/watcher-hub.js";
export type { WatcherHubHandle };

export const FS_WATCH_RETRY_DELAY_MS = 5000;

export function closeWatcher(watcher: FSWatcher | WatcherHubHandle | null | undefined): void {
  if (!watcher) {
    return;
  }

  try {
    watcher.close();
  } catch {
    // Ignore watcher close errors
  }
}

export function watchWithErrorHandler(
  path: string,
  listener: WatchListener<string>,
  onError: () => void,
): WatcherHubHandle | null {
  try {
    return getWatcherHub().subscribeDirectory(path, listener as (eventType: string, filename: string | null) => void, onError);
  } catch {
    onError();
    return null;
  }
}
