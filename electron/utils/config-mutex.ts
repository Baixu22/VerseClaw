/**
 * Async mutex for serializing read-modify-write operations on
 * ~/.openclaw/openclaw.json.
 *
 * Multiple code paths (channel-config, openclaw-auth, openclaw-proxy,
 * skill-config, agent-config) perform async read → modify → write against
 * the same JSON file.  Without coordination, Node's event-loop can
 * interleave two I/O sequences so that the second writer reads stale data
 * and overwrites the first writer's changes (classic TOCTOU race).
 *
 * The mutex is **reentrant**: if a function already holding the lock calls
 * another function that also calls `withConfigLock`, the inner call will
 * pass through without blocking.  This prevents deadlocks when e.g.
 * `deleteAgentConfig` (locked) calls `deleteAgentChannelAccounts` (also locked).
 *
 * Cross-process: when a `lockPath` is provided (or the default openclaw.json
 * path is used), an exclusive lockfile is acquired in addition to the
 * in-process mutex so concurrent Electron / CLI / gateway writers do not
 * clobber each other.
 *
 * Usage:
 *   import { withConfigLock } from './config-mutex';
 *
 *   await withConfigLock(async () => {
 *       const cfg = await readConfig();
 *       cfg.foo = 'bar';
 *       await writeConfig(cfg);
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { join } from 'path';
import { homedir } from 'os';
import { withFileLock, type FileLockOptions } from './atomic-write';

/** Tracks whether the current async context already holds the config lock. */
const lockContext = new AsyncLocalStorage<boolean>();

class ConfigMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<() => void> {
        if (!this.locked) {
            this.locked = true;
            return this.createRelease();
        }
        return new Promise<() => void>((resolve) => {
            this.queue.push(() => resolve(this.createRelease()));
        });
    }

    private createRelease(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.queue.shift();
            if (next) {
                next();
            } else {
                this.locked = false;
            }
        };
    }
}

/** Singleton mutex shared across all openclaw.json writers. */
const configMutex = new ConfigMutex();

export function getDefaultOpenClawConfigPath(): string {
    return join(homedir(), '.openclaw', 'openclaw.json');
}

export type WithConfigLockOptions = FileLockOptions & {
    /**
     * Target config path used for the cross-process lockfile.
     * Defaults to ~/.openclaw/openclaw.json.
     * Pass `null` to skip cross-process locking (in-process only).
     */
    lockTargetPath?: string | null;
};

/**
 * Execute `fn` while holding the config mutex.
 * Ensures only one read-modify-write cycle on openclaw.json runs at a time.
 *
 * **Reentrant**: if the current async context already holds the lock
 * (i.e. an outer `withConfigLock` is on the call stack), `fn` runs
 * immediately without re-acquiring the lock.
 *
 * Cross-process exclusive lock is acquired on the target path unless
 * `lockTargetPath: null` is passed.
 */
export async function withConfigLock<T>(
    fn: () => Promise<T>,
    options: WithConfigLockOptions = {},
): Promise<T> {
    // If we're already inside a withConfigLock call, skip re-acquiring
    if (lockContext.getStore()) {
        return fn();
    }

    const release = await configMutex.acquire();
    try {
        return await lockContext.run(true, async () => {
            const lockTarget =
                options.lockTargetPath === null
                    ? null
                    : (options.lockTargetPath ?? getDefaultOpenClawConfigPath());

            if (!lockTarget) {
                return fn();
            }

            return withFileLock(
                lockTarget,
                fn,
                {
                    timeoutMs: options.timeoutMs,
                    pollMs: options.pollMs,
                    staleMs: options.staleMs,
                },
            );
        });
    } finally {
        release();
    }
}
