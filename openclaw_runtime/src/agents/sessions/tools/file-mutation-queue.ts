/**
 * Per-file mutation queue with reader-writer semantics.
 *
 * The original `withFileMutationQueue(filePath, fn)` contract is unchanged and
 * means "write mutex": writers targeting the same real file run strictly one at
 * a time while independent files run in parallel.
 *
 * P2 adds read sharing: `withFileReadQueue` / `{ mode: "read" }` lets readers
 * for the same file run concurrently, but readers exclude writers and writers
 * exclude readers. A queued writer is a barrier so later readers cannot starve
 * it while earlier readers drain.
 *
 * P6A: this module is a compatibility facade over the single process-local RW
 * scheduler in `coding-runtime/lock-core.ts`. The scheduler and key space are
 * shared with `file-lock-manager.ts` and the FTS, so write/edit/apply_patch/FTS
 * never hold two independent queue semantics.
 */
import { canonicalLockKey } from "../../coding-runtime/lock-core.js";
import { acquireLocalLocks, resetLockCoreForTest } from "../../coding-runtime/lock-core.js";
import { CodingRuntimeError } from "../../coding-runtime/coding-runtime-error.js";

export type FileMutationQueueMode = "read" | "write";

export type FileMutationQueueOptions = {
  mode?: FileMutationQueueMode;
  /** Optional bounded wait. The default preserves the original unbounded write behavior. */
  timeoutMs?: number;
};

/**
 * Serialize file mutation operations targeting the same file.
 *
 * Default (and existing) behavior is the write mutex. Pass `{ mode: "read" }`
 * for shared-read semantics.
 */
export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: FileMutationQueueOptions = {},
): Promise<T> {
  const mode = options.mode ?? "write";
  const handle = await acquireLocalLocks([canonicalLockKey(filePath)], mode, {
    owner: `file-mutation-queue:${process.pid}`,
    ...(options.timeoutMs !== undefined && options.timeoutMs !== Number.POSITIVE_INFINITY
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

/** Shared-read entry point. Multiple readers of one file run concurrently. */
export async function withFileReadQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: Omit<FileMutationQueueOptions, "mode"> = {},
): Promise<T> {
  return withFileMutationQueue(filePath, fn, { ...options, mode: "read" });
}

/**
 * Compatibility helper: wrap lock-core timeouts as the historical queue
 * rejection shape when callers need a plain Error (kept for existing tests).
 */
export function __toQueueTimeoutError(error: unknown): Error {
  if (error instanceof CodingRuntimeError && error.code === "E_LOCK_TIMEOUT") {
    return new Error(`Timed out waiting for file mutation queue slot: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Test seam for suites that need a clean in-process queue state. */
export function __resetFileMutationQueues(): void {
  resetLockCoreForTest();
}
