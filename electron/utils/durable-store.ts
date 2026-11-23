/**
 * Unified local-persistence entry point (Electron main process).
 *
 * Historically the repository carried two independent atomic-write
 * implementations:
 *
 *   - `electron/utils/atomic-write.ts` — Electron-side: temp + fsync +
 *     rename, a `.bak` sibling, a `*.clawx-write-meta` version sidecar, and a
 *     cross-process `O_EXCL` file lock for read-modify-write cycles.
 *   - `openclaw_runtime`'s `@openclaw/fs-safe` + `replaceFileAtomic` — runtime
 *     side, with fsync-based durable writes.
 *
 * Both are correct, but a caller could pick either one and silently get a
 * different durability contract (notably: no `.bak` recovery, no lock). This
 * module is the single supported import surface for Electron-side durable
 * persistence so that durability behaviour is uniform.
 *
 * Rules enforced by this entry point and by harness rule
 * `local-data-fail-closed-config`:
 *
 *   1. Config that is rewritten through read-modify-write MUST be read
 *      through `readJsonStrict`, which recovers from `.bak` and throws on
 *      unrecoverable corruption instead of returning an empty projection.
 *   2. Writes go through `writeJsonAtomic` (temp + fsync + rename + `.bak`).
 *   3. Read-modify-write cycles hold `withConfigFileLock`.
 *
 * Append-only logs (audit/event JSONL) intentionally have a separate helper
 * because they must never be rewritten in place: a torn tail line is skipped
 * by the reader rather than losing the whole file.
 */

// ── Atomic primitives (re-exported so callers need only one import) ──────────

export {
  AtomicWriteError,
  ConfigVersionConflictError,
  backupPathFor,
  cleanupStaleTempFiles,
  lockPathFor,
  metaPathFor,
  readJsonAtomic,
  withFileLock,
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonAtomic,
  type AtomicWriteErrorCode,
  type AtomicWriteOptions,
  type AtomicWriteResult,
  type FileLockOptions,
  type ReadJsonAtomicResult,
  type WriteMeta,
} from './atomic-write';

import { access } from 'node:fs/promises';
import { backupPathFor, readJsonAtomic, writeJsonAtomic, withFileLock } from './atomic-write';

/**
 * Durability-presence check.
 *
 * Callers use this to distinguish "genuinely absent" (safe to default) from
 * "present but unreadable" (must fail closed) — the distinction the
 * fail-closed rule depends on.
 */
export async function durableFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Read a config that will be rewritten through read-modify-write.
 *
 * Behaviour:
 *   - absent file        -> returns `options.fallback` (nothing to lose)
 *   - corrupt file       -> recovers from `.bak`, then writes it back
 *   - corrupt, no `.bak` -> throws `AtomicWriteError { code: 'CORRUPT' }`
 *
 * Never returns an empty projection as a stand-in for corruption.
 */
export async function readJsonStrict<T>(
  filePath: string,
  options?: { fallback?: T },
): Promise<T> {
  const exists = await durableFileExists(filePath);
  if (!exists && !await durableFileExists(backupPathFor(filePath))) {
    if (options && 'fallback' in options) return options.fallback as T;
    // No fallback supplied and the file is absent: surface it as a read error
    // rather than inventing an empty object.
    return readJsonAtomic<T>(filePath).then((r) => r.data);
  }
  const result = await readJsonAtomic<T>(filePath);
  return result.data;
}

/**
 * Run a read-modify-write cycle under the cross-process file lock so
 * concurrent writers cannot lose updates. The callback receives the current
 * parsed value and returns the value to persist.
 *
 * The callback must mutate and return the object it was given; returning
 * `undefined` skips the write (useful for read-only probes that still need
 * mutual exclusion).
 */
export async function updateJsonAtomic<T>(
  filePath: string,
  mutate: (current: T) => Promise<T | undefined> | T | undefined,
  options?: { fallback?: T },
): Promise<{ changed: boolean; value: T }> {
  return withFileLock(filePath, async () => {
    const current = await readJsonStrict<T>(filePath, options);
    const next = await mutate(current);
    if (next === undefined) return { changed: false, value: current };
    await writeJsonAtomic(filePath, next);
    return { changed: true, value: next };
  });
}
