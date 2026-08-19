/**
 * P7 UFTK: bridge between git checkpoint restore and `worktree-service`.
 *
 * The point of this module is to stop two git capability surfaces from drifting
 * apart. `worktree-service.ts` already owns the merge queue, the
 * `MergeConflictPolicy` and the review-diff surface; `git-checkpoint*.ts` owns
 * checkpoints and restores. A restore that overwrites paths a worker's pending
 * merge is about to land is a conflict the merge queue should have a say in, so
 * this bridge asks the queue first and applies its policy to the answer.
 *
 * What it deliberately does NOT do: run the merge. `processMergeQueue` copies
 * worktree content into the base root, so using it to "probe" for conflicts
 * would apply a worker's files as a side effect of asking a question. The bridge
 * therefore *reads* the queue (`getMergeQueue`) and lets the P6B transaction
 * remain the only thing that writes to the worktree. There is no second merge
 * implementation here, and no second restore implementation either.
 *
 * Conflict handling is honest in one specific way: an overlap never results in
 * the restore proceeding anyway. All three conflict policies leave the worktree
 * byte-unchanged; they differ only in the disposition reported, because
 * "escalate" and "return to worker" are routing decisions, not permission to
 * discard the worker's content.
 */
import type { FactStore } from "../../context-engine/factstore/store.js";
import { reviewDiff } from "../../context-engine/views/verify/review-diff-view.js";
import {
  type MergeConflictPolicy,
  type MergeQueueItem,
  normalizeWorktreeRelPath,
  type WorktreeService,
} from "../worktree-service.js";
import {
  type GitCheckpointRestoreResult,
  type GitCheckpointService,
  isPathUnderScopeEntry,
} from "./git-checkpoint.js";
import {
  GitCheckpointTransactionService,
  type PreparedRestore,
} from "./git-checkpoint-transaction.js";

export type BridgeRestoreStatus =
  | "restored"
  | "disabled"
  | "unsupported"
  | "not_found"
  /** Either a pending worktree merge overlaps the restore, or the restore itself conflicted. */
  | "conflict"
  | "failed"
  | "recovery_required";

export type WorktreeMergeOverlap = {
  worktreeId: string;
  /** Paths in both the pending merge and the restore's effective scope. */
  paths: string[];
  queueStatus: MergeQueueItem["status"];
};

/** How the conflict policy routed an overlap. The restore is refused either way. */
export type OverlapDisposition = "mark_conflict" | "return_worker" | "escalate_lead";

export type BridgeRestoreResult = {
  status: BridgeRestoreStatus;
  checkpointId: string;
  /** Paths the restore would have touched (checkout + removal). */
  paths: string[];
  overlaps: WorktreeMergeOverlap[];
  disposition?: OverlapDisposition;
  /** Review surface for the affected paths, when a FactStore was supplied. */
  review?: { changedFiles: string[]; relatedTests: string[]; riskLevel: string; findings: string[] };
  reason?: string;
  error?: { code: string; message: string };
  restore?: GitCheckpointRestoreResult;
  safetyRef?: string;
  recoveryRef?: string;
};

export type BridgeRestoreOptions = {
  paths?: readonly string[];
  /** Overrides the service default for this call. */
  conflictPolicy?: MergeConflictPolicy;
  /** Enables the review-diff surface for the affected paths. */
  factStore?: FactStore;
  recoveryDir?: string;
};

/**
 * Find pending merges whose changed files overlap a restore's path set.
 *
 * Both sides are normalized through `normalizeWorktreeRelPath` so the queue's
 * path shape and the checkpoint's POSIX-relative shape are compared on equal
 * terms. Directory containment counts in both directions: a queued `src/a.ts`
 * overlaps a restore of `src/`, and vice versa.
 */
export function findWorktreeMergeOverlaps(params: {
  queue: readonly MergeQueueItem[];
  paths: readonly string[];
}): WorktreeMergeOverlap[] {
  const restorePaths = params.paths.map((entry) => normalizeWorktreeRelPath(entry));
  const overlaps: WorktreeMergeOverlap[] = [];
  for (const item of params.queue) {
    // Only work that is still going to land can be disturbed by a restore.
    if (item.status !== "pending" && item.status !== "rework") continue;
    const hits = new Set<string>();
    for (const queued of item.changedFiles) {
      const normalizedQueued = normalizeWorktreeRelPath(queued);
      for (const restorePath of restorePaths) {
        if (
          isPathUnderScopeEntry(normalizedQueued, restorePath) ||
          isPathUnderScopeEntry(restorePath, normalizedQueued)
        ) {
          hits.add(normalizedQueued);
        }
      }
    }
    if (hits.size > 0) {
      overlaps.push({
        worktreeId: item.worktreeId,
        paths: [...hits].sort((a, b) => a.localeCompare(b)),
        queueStatus: item.status,
      });
    }
  }
  return overlaps;
}

/**
 * Restore a checkpoint with the worktree merge queue as the conflict authority.
 */
export class CheckpointWorktreeBridge {
  readonly #service: GitCheckpointService;
  readonly #transaction: GitCheckpointTransactionService;
  readonly #worktrees: WorktreeService;
  readonly #defaultConflictPolicy: MergeConflictPolicy;

  constructor(options: {
    service: GitCheckpointService;
    worktrees: WorktreeService;
    /** P6B flag `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled`. Default false. */
    safetySnapshotEnabled?: boolean;
    /** Matches `worktree-service`'s own safe default. */
    conflictPolicy?: MergeConflictPolicy;
  }) {
    this.#service = options.service;
    this.#worktrees = options.worktrees;
    this.#defaultConflictPolicy = options.conflictPolicy ?? "mark_conflict";
    this.#transaction = new GitCheckpointTransactionService({
      service: options.service,
      ...(options.safetySnapshotEnabled !== undefined
        ? { safetySnapshotEnabled: options.safetySnapshotEnabled }
        : {}),
    });
  }

  async restoreCheckpoint(
    checkpointId: string,
    options: BridgeRestoreOptions = {},
  ): Promise<BridgeRestoreResult> {
    const prepared = await this.#transaction.prepare(checkpointId, {
      ...(options.paths !== undefined ? { paths: options.paths } : {}),
      ...(options.recoveryDir ? { recoveryDir: options.recoveryDir } : {}),
    });
    if (prepared.status === "rejected") {
      const result = prepared.result;
      return {
        status: result.status === "restored" ? "restored" : result.status,
        checkpointId,
        paths: [],
        overlaps: [],
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error ? { error: result.error } : {}),
        restore: result,
      };
    }

    const preparedRestore = prepared.prepared;
    const safetyRefs = {
      ...(preparedRestore.safety.safetyRef ? { safetyRef: preparedRestore.safety.safetyRef } : {}),
      ...(preparedRestore.safety.recoveryRef
        ? { recoveryRef: preparedRestore.safety.recoveryRef }
        : {}),
    };

    // Everything from here until `applyAndSettle` runs while the prepare still
    // holds the P6A workspace barrier and the cross-process restore lock, and
    // `applyAndSettle` is the first thing with a `finally` that releases them. An
    // unexpected throw in between would therefore hold the workspace barrier for
    // the life of the process, blocking every UFTK writer and every later
    // restore. So this region releases on any failure and reports it
    // structurally, the same discipline `prepare` applies to itself.
    let affected: string[];
    let overlaps: WorktreeMergeOverlap[];
    let review: BridgeRestoreResult["review"];
    try {
      affected = affectedPathsOf(preparedRestore);
      overlaps = findWorktreeMergeOverlaps({
        queue: this.#worktrees.getMergeQueue(),
        paths: affected,
      });
      review = options.factStore
        ? buildReview(options.factStore, this.#service.workspaceRoot, affected)
        : undefined;
    } catch (caught) {
      await preparedRestore.release();
      const message = caught instanceof Error ? caught.message : String(caught);
      this.#service.internals.warn(
        `coding-checkpoint-worktree: conflict check failed for ${checkpointId}: ${message}`,
      );
      return {
        status: "failed",
        checkpointId,
        paths: [],
        overlaps: [],
        reason: message,
        error: { code: "E_GIT_CHECKPOINT_FAILED", message },
        ...safetyRefs,
      };
    }

    if (overlaps.length > 0) {
      // Zero change: release everything the prepare acquired without applying.
      await preparedRestore.release();
      const policy = options.conflictPolicy ?? this.#defaultConflictPolicy;
      const detail =
        `restore of ${checkpointId} overlaps ${overlaps.length} pending worktree merge(s): ` +
        overlaps
          .slice(0, 3)
          .map((entry) => `${entry.worktreeId} (${entry.paths.slice(0, 3).join(", ")})`)
          .join("; ");
      this.#service.internals.warn(`coding-checkpoint-worktree: ${detail}`);
      return {
        status: "conflict",
        checkpointId,
        paths: affected,
        overlaps,
        disposition: policy,
        ...(review ? { review } : {}),
        reason: `${policy}:${detail}`,
        error: { code: "E_GIT_CHECKPOINT_CONFLICT", message: detail },
        ...safetyRefs,
      };
    }

    const result = await this.#transaction.applyAndSettle(preparedRestore);
    return {
      status: result.status === "restored" ? "restored" : result.status,
      checkpointId,
      paths: affected,
      overlaps: [],
      ...(review ? { review } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.error ? { error: result.error } : {}),
      restore: result,
      ...(result.safetyRef ? { safetyRef: result.safetyRef } : {}),
      ...(result.recoveryRef ? { recoveryRef: result.recoveryRef } : {}),
    };
  }
}

/** Every path an apply could touch: materialized tree paths plus removals. */
function affectedPathsOf(prepared: PreparedRestore): string[] {
  return [...new Set([...prepared.plan.restorePaths, ...prepared.plan.removePaths])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function buildReview(
  factStore: FactStore,
  repoRoot: string,
  paths: readonly string[],
): BridgeRestoreResult["review"] {
  try {
    const review = reviewDiff(factStore, repoRoot, { changedFiles: [...paths] });
    return {
      changedFiles: review.changedFiles,
      relatedTests: review.relatedTests ?? [],
      riskLevel: review.riskLevel,
      findings: review.findings ?? [],
    };
  } catch {
    // Review is advisory: a failure here must not change the restore decision.
    return undefined;
  }
}
