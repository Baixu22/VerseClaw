/**
 * Per-file mutation queue.
 *
 * Serializes edits/writes targeting the same real file while allowing independent files to mutate in parallel.
 *
 * Delegates to the workspace `fileMutation` lease kind so per-file
 * serialization shares one FIFO/capacity/timeout kernel with the workspace
 * search and exec budgets (issue #167) instead of a second scheduler. A
 * non-positive timeout keeps the original unbounded wait for a same-file
 * holder rather than failing a legitimate long write.
 */
import { normalizeWorkspaceLeaseKey, withWorkspaceResourceLease } from "../../resource-leases.js";
import type { ResourceWaitOptions } from "../../../../../shared/resources/wait.js";

/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>, options: ResourceWaitOptions = {}): Promise<T> {
  return withWorkspaceResourceLease("fileMutation", normalizeWorkspaceLeaseKey(filePath), fn, {
    timeoutMs: 0,
    ...options,
  });
}
