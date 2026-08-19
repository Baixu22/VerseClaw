/**
 * P6B UFTK: two-phase git checkpoint restore.
 *
 * `prepare` resolves the checkpoint tree, computes the exact in-scope path set,
 * scans for structural conflicts, takes the safety snapshot, and holds both the
 * P6A workspace restore barrier and write locks on the affected paths. Nothing
 * has touched the worktree at this point, so a prepare-stage failure leaves the
 * target byte-unchanged.
 *
 * `apply` is the only phase that mutates the worktree, and it reuses the single
 * `applyCheckpointToWorktree` primitive, so scoped and whole-tree restores share
 * one implementation and neither can use `git reset --hard` or `git clean -f`.
 *
 * `settle` releases the locks and reports the outcome. When apply fails partway,
 * settle first tries to roll the affected paths back from the safety snapshot;
 * if that rollback cannot be completed the result is `recovery_required` with
 * `safetyRef`/`recoveryRef` so the user's content is always reachable. A restore
 * never reports success it did not achieve, and never silently discards content:
 * with the safety flag off, dirty in-scope content is a `conflict` rather than an
 * overwrite.
 *
 * git checkpoints do not replace write-journal rollback; this module imports
 * neither the journal nor the FTS rollback path.
 */
import { randomUUID } from "node:crypto";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { CodingRuntimeError } from "./coding-runtime-error.js";
import {
  acquireWorkspaceRestoreBarrier,
  type CodingRuntimeFileLockHandle,
} from "./file-lock-manager.js";
import {
  acquireCheckpointRestoreLock,
  applyCheckpointToWorktree,
  buildCheckpointRestorePlan,
  decodeCheckpointMetadata,
  findCheckpointRestoreConflicts,
  FULL_CHECKPOINT_SCOPE,
  type GitCheckpointRestorePlan,
  type GitCheckpointRestoreResult,
  type GitCheckpointScope,
  type GitCheckpointService,
  normalizeCheckpointScope,
  readCheckpointCommitMessage,
  resolveCheckpointTreePaths,
  resolveGitCheckpointSupport,
  runGitCheckpointCommand,
  scopeIsCoveredByCheckpointScope,
  splitCheckpointNullSeparated,
} from "./git-checkpoint.js";
import {
  captureRestoreSafetySnapshot,
  computeAtRiskPaths,
  restoreFromRecoveryDir,
  type SafetySnapshotResult,
} from "./git-checkpoint-safety.js";

export type RestoreTransactionOptions = {
  /** Restrict the restore to these paths. Requires the pathScoped flag. */
  paths?: readonly string[];
  /**
   * Override the resolved safety-snapshot flag for this call. Left undefined the
   * service's `safetySnapshotEnabled` value is used.
   */
  safety?: boolean;
  /** Override the raw byte backup directory. Defaults under the state dir. */
  recoveryDir?: string;
};

export type PreparedRestore = {
  restoreId: string;
  checkpointId: string;
  root: string;
  plan: Omit<GitCheckpointRestorePlan, "conflicts">;
  atRiskPaths: string[];
  safety: SafetySnapshotResult;
  diagnostic: NonNullable<GitCheckpointRestoreResult["diagnostic"]>;
  release: () => Promise<void>;
};

export type PrepareRestoreOutcome =
  | { status: "prepared"; prepared: PreparedRestore }
  | { status: "rejected"; result: GitCheckpointRestoreResult };

/**
 * Transactional restore over an existing `GitCheckpointService`. The service
 * stays the owner of workspace/flag/state configuration; this class only adds
 * the two-phase protocol on top of it.
 */
export class GitCheckpointTransactionService {
  readonly #service: GitCheckpointService;
  readonly #safetySnapshotEnabled: boolean;

  constructor(options: {
    service: GitCheckpointService;
    /** P6B flag `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled`. Default false. */
    safetySnapshotEnabled?: boolean;
  }) {
    this.#service = options.service;
    this.#safetySnapshotEnabled = options.safetySnapshotEnabled ?? false;
  }

  async restoreCheckpoint(
    checkpointId: string,
    options: RestoreTransactionOptions = {},
  ): Promise<GitCheckpointRestoreResult> {
    const prepared = await this.prepare(checkpointId, options);
    if (prepared.status === "rejected") return prepared.result;
    return await this.applyAndSettle(prepared.prepared);
  }

  /**
   * Phase 1. Resolves everything the apply needs and acquires all exclusion.
   * Guarantees zero worktree change: every rejection here happens before any
   * mutation.
   */
  async prepare(
    checkpointId: string,
    options: RestoreTransactionOptions = {},
  ): Promise<PrepareRestoreOutcome> {
    const internals = this.#service.internals;
    const reject = (result: GitCheckpointRestoreResult): PrepareRestoreOutcome => ({
      status: "rejected",
      result,
    });

    if (options.paths !== undefined && !internals.pathScopedEnabled) {
      return reject({
        status: "disabled",
        checkpointId,
        reason:
          "path-scoped restore is disabled (runtime.coding.uftk.gitCheckpoint.pathScoped.enabled)",
      });
    }

    const support = await resolveGitCheckpointSupport({
      root: this.#service.workspaceRoot,
      enabled: internals.enabled,
      warn: internals.warn,
      timeoutMs: internals.gitTimeoutMs,
      env: internals.env,
    });
    if (!support.ok) {
      return reject({
        status: support.code === "E_GIT_CHECKPOINT_DISABLED" ? "disabled" : "unsupported",
        checkpointId,
        reason: support.reason,
      });
    }
    const root = support.layout.root;

    let requestedScope: GitCheckpointScope;
    try {
      requestedScope =
        options.paths !== undefined
          ? normalizeCheckpointScope(root, options.paths)
          : FULL_CHECKPOINT_SCOPE;
    } catch (caught) {
      return reject(failureResult(checkpointId, caught));
    }

    const nested = support.resolveNestedPolicy(requestedScope, "restore");
    if (!nested.ok) {
      return reject({ status: "unsupported", checkpointId, reason: nested.reason });
    }

    let treePaths: string[];
    try {
      treePaths = await resolveCheckpointTreePaths({
        root,
        checkpointId,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
    } catch {
      return reject({
        status: "not_found",
        checkpointId,
        reason: `checkpoint ${checkpointId} does not resolve to a git tree`,
        error: {
          code: "E_GIT_CHECKPOINT_NOT_FOUND",
          message: `checkpoint not found: ${checkpointId}`,
        },
      });
    }

    let scope: GitCheckpointScope;
    try {
      const recordedScope = decodeCheckpointMetadata(
        await readCheckpointCommitMessage({
          root,
          checkpointId,
          env: internals.env,
          timeoutMs: internals.gitTimeoutMs,
        }),
      ).scope;
      if (options.paths === undefined) {
        scope = recordedScope;
      } else {
        const coverage = scopeIsCoveredByCheckpointScope(requestedScope, recordedScope);
        if (!coverage.covered) {
          const detail =
            `requested restore scope is not covered by checkpoint ${checkpointId} ` +
            `(scope: ${recordedScope.paths.join(", ")}); uncovered: ${coverage.uncovered.join(", ")}`;
          internals.warn(`coding-git-checkpoint: ${detail}`);
          return reject({
            status: "failed",
            checkpointId,
            reason: detail,
            error: { code: "E_GIT_CHECKPOINT_FAILED", message: detail },
          });
        }
        scope = requestedScope;
      }
    } catch (caught) {
      return reject(failureResult(checkpointId, caught));
    }

    // Acquire exclusion before reading worktree state so the plan cannot be
    // invalidated by a concurrent writer between plan and apply.
    //
    // The P6A workspace barrier is a workspace-scoped writer lock: it already
    // excludes every UFTK read/write lock under the root, so no per-path locks
    // are taken here. Taking them under the barrier would conflict with the
    // barrier itself. The cross-process restore lock is acquired second, in the
    // same order `GitCheckpointService.restoreCheckpoint` uses, so the two
    // restore paths cannot deadlock against each other.
    const barrierStartedAt = Date.now();
    let barrier: CodingRuntimeFileLockHandle;
    try {
      barrier = await acquireWorkspaceRestoreBarrier(root, {
        owner: `uftk-git-restore-txn:${process.pid}`,
        timeoutMs: internals.restoreLockTimeoutMs,
      });
    } catch (caught) {
      return reject(lockFailureResult(checkpointId, caught));
    }
    codingObservability.recordRestoreBarrierWaitMs(Date.now() - barrierStartedAt);

    const releasables: Array<{ release: () => Promise<void> }> = [barrier];
    const release = async (): Promise<void> => {
      for (const handle of releasables.toReversed()) {
        await handle.release().catch(() => {});
      }
      releasables.length = 0;
    };

    try {
      releasables.push(
        await acquireCheckpointRestoreLock({
          root,
          env: internals.env,
          timeoutMs: internals.restoreLockTimeoutMs,
        }),
      );
    } catch (caught) {
      await release();
      return reject(lockFailureResult(checkpointId, caught));
    }

    try {
      const beforeTracked = splitCheckpointNullSeparated(
        await runGitCheckpointCommand({
          args: ["ls-files", "-z"],
          cwd: root,
          env: internals.env,
          timeoutMs: internals.gitTimeoutMs,
        }),
      );
      const beforeUntracked = splitCheckpointNullSeparated(
        await runGitCheckpointCommand({
          args: ["ls-files", "--others", "--exclude-standard", "-z"],
          cwd: root,
          env: internals.env,
          timeoutMs: internals.gitTimeoutMs,
        }),
      );
      const beforeStatus = await runGitCheckpointCommand({
        args: ["status", "--porcelain=v1", "-z"],
        cwd: root,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });

      const plan = buildCheckpointRestorePlan({
        scope,
        treePaths,
        beforeTracked,
        beforeUntracked,
      });
      const diagnostic = {
        beforeStatus,
        beforeTracked,
        beforeUntracked,
        targetPaths: treePaths,
        scope,
        removedPaths: plan.removePaths,
        ...(nested.skipped.length > 0 ? { skippedNestedRepos: nested.skipped } : {}),
      };

      const conflicts = await findCheckpointRestoreConflicts(root, plan.restorePaths);
      if (conflicts.length > 0) {
        const detail = conflicts.slice(0, 3).join("; ");
        internals.warn(`coding-git-checkpoint: restore ${checkpointId} conflict: ${detail}`);
        await release();
        return reject({
          status: "conflict",
          checkpointId,
          reason: detail,
          error: { code: "E_GIT_CHECKPOINT_CONFLICT", message: detail },
          diagnostic,
        });
      }

      const atRiskPaths = await computeAtRiskPaths({
        root,
        checkpointId,
        restorePaths: plan.restorePaths,
        removePaths: plan.removePaths,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });

      const safetyEnabled = options.safety ?? this.#safetySnapshotEnabled;
      // With safety off we refuse to destroy content rather than overwrite it.
      if (!safetyEnabled && atRiskPaths.length > 0) {
        const detail =
          `refusing to overwrite ${atRiskPaths.length} dirty in-scope path(s) without a safety ` +
          `snapshot (enable runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled): ` +
          atRiskPaths.slice(0, 3).join(", ");
        internals.warn(`coding-git-checkpoint: restore ${checkpointId} conflict: ${detail}`);
        await release();
        return reject({
          status: "conflict",
          checkpointId,
          reason: detail,
          error: { code: "E_GIT_CHECKPOINT_CONFLICT", message: detail },
          diagnostic,
        });
      }

      const restoreId = randomUUID();
      const safety = await captureRestoreSafetySnapshot({
        root,
        restoreId,
        scope,
        atRiskPaths,
        enabled: safetyEnabled,
        stateDir: internals.stateDir,
        ...(options.recoveryDir ? { recoveryDir: options.recoveryDir } : {}),
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
        warn: internals.warn,
      });
      if (safety.status === "failed") {
        await release();
        return reject({
          status: "failed",
          checkpointId,
          reason: safety.reason ?? "safety snapshot failed",
          error: safety.error ?? {
            code: "E_GIT_CHECKPOINT_FAILED",
            message: "safety snapshot failed",
          },
          diagnostic,
        });
      }

      // Write locks on the affected paths are deliberately NOT taken: the
      // workspace barrier held above already excludes every UFTK lock under the
      // root, and a nested per-path acquisition would conflict with it.

      return {
        status: "prepared",
        prepared: {
          restoreId,
          checkpointId,
          root,
          plan,
          atRiskPaths,
          safety,
          diagnostic,
          release,
        },
      };
    } catch (caught) {
      await release();
      return reject(failureResult(checkpointId, caught));
    }
  }

  /** Phases 2 and 3: mutate the worktree, then settle the outcome. */
  async applyAndSettle(prepared: PreparedRestore): Promise<GitCheckpointRestoreResult> {
    const internals = this.#service.internals;
    const safetyRefs = {
      ...(prepared.safety.safetyRef ? { safetyRef: prepared.safety.safetyRef } : {}),
      ...(prepared.safety.recoveryRef ? { recoveryRef: prepared.safety.recoveryRef } : {}),
    };
    try {
      await applyCheckpointToWorktree({
        root: prepared.root,
        checkpointId: prepared.checkpointId,
        plan: prepared.plan,
        stateDir: internals.stateDir,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      return {
        status: "restored",
        checkpointId: prepared.checkpointId,
        diagnostic: prepared.diagnostic,
        ...safetyRefs,
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      internals.warn(
        `coding-git-checkpoint: restore ${prepared.checkpointId} apply failed: ${message}`,
      );
      const rolledBack = await this.#rollback(prepared);
      if (rolledBack.ok) {
        return {
          status: "failed",
          checkpointId: prepared.checkpointId,
          reason: `${message} (rolled back from safety snapshot)`,
          error: {
            code:
              caught instanceof CodingRuntimeError
                ? caught.code
                : "E_GIT_CHECKPOINT_FAILED",
            message,
          },
          diagnostic: prepared.diagnostic,
          ...safetyRefs,
        };
      }
      const detail = `${message}; safety rollback incomplete: ${rolledBack.reason}`;
      internals.warn(
        `coding-git-checkpoint: restore ${prepared.checkpointId} requires recovery: ${detail}`,
      );
      return {
        status: "recovery_required",
        checkpointId: prepared.checkpointId,
        reason: detail,
        error: { code: "E_GIT_CHECKPOINT_RECOVERY_REQUIRED", message: detail },
        diagnostic: prepared.diagnostic,
        ...safetyRefs,
      };
    } finally {
      await prepared.release();
    }
  }

  /**
   * Best-effort return to the pre-restore state of the affected paths using the
   * safety snapshot. Never reports success it cannot demonstrate.
   */
  async #rollback(prepared: PreparedRestore): Promise<{ ok: true } | { ok: false; reason: string }> {
    const internals = this.#service.internals;
    if (!prepared.safety.safetyCheckpointId) {
      return { ok: false, reason: "no safety snapshot was captured" };
    }
    try {
      const safetyTreePaths = await resolveCheckpointTreePaths({
        root: prepared.root,
        checkpointId: prepared.safety.safetyCheckpointId,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      // Reverse the apply over exactly the paths the apply could have touched.
      const touched = new Set([...prepared.plan.restorePaths, ...prepared.plan.removePaths]);
      const rollbackPlan = {
        scope: prepared.plan.scope,
        treePaths: safetyTreePaths,
        restorePaths: safetyTreePaths.filter((relPath) => touched.has(relPath)),
        removePaths: [...touched].filter((relPath) => !safetyTreePaths.includes(relPath)),
      };
      await applyCheckpointToWorktree({
        root: prepared.root,
        checkpointId: prepared.safety.safetyCheckpointId,
        plan: rollbackPlan,
        stateDir: internals.stateDir,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      if (prepared.safety.recoveryRef && prepared.safety.backedUpPaths?.length) {
        // Ignored files never enter the safety tree; replay their raw bytes.
        const replay = await restoreFromRecoveryDir({
          root: prepared.root,
          recoveryRef: prepared.safety.recoveryRef,
          paths: prepared.safety.backedUpPaths,
        });
        if (replay.failed.length > 0) {
          return {
            ok: false,
            reason: `raw recovery replay failed for ${replay.failed.length} path(s)`,
          };
        }
      }
      return { ok: true };
    } catch (caught) {
      return {
        ok: false,
        reason: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }
}

function failureResult(checkpointId: string, caught: unknown): GitCheckpointRestoreResult {
  const message = caught instanceof Error ? caught.message : String(caught);
  return {
    status: "failed",
    checkpointId,
    reason: message,
    error: {
      code: caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED",
      message,
    },
  };
}

function lockFailureResult(checkpointId: string, caught: unknown): GitCheckpointRestoreResult {
  const message = caught instanceof Error ? caught.message : String(caught);
  return {
    status: "failed",
    checkpointId,
    reason: message,
    error: {
      code: caught instanceof CodingRuntimeError ? caught.code : "E_LOCK_TIMEOUT",
      message,
    },
  };
}
