/**
 * P7 UFTK: undo an exec's *workspace file* side effects.
 *
 * The input is a P3 `CodingExecEvent`: its `sideEffects` list names the files an
 * exec added, modified or deleted. Those paths become the scope of a P6B
 * path-scoped restore against a checkpoint taken before the exec ran. There is
 * no second restore implementation here -- everything goes through
 * `GitCheckpointTransactionService`, so the safety snapshot, conflict handling
 * and `recovery_required` reporting are the accepted P6B ones.
 *
 * What this module promises, precisely:
 *
 * - Only workspace file side effects are undone. Network calls, database writes,
 *   remote pushes and dependency installs outside the workspace are NOT undone
 *   and are never claimed to be. A side effect this module cannot prove is a
 *   workspace file is refused, not attempted.
 * - Refusals are structured and leave the workspace byte-unchanged.
 * - The side-effect path set must be covered by the target checkpoint's recorded
 *   scope (P6B invariant 8, enforced by `scopeIsCoveredByCheckpointScope`).
 *   Restoring a path a checkpoint never covered would *delete* it, on the
 *   grounds that the checkpoint "does not have it". Undoing an exec must never
 *   turn into that, so an uncovered path set is refused outright. A caller can
 *   opt into the covered subset with `allowPartial`, which reports exactly what
 *   it skipped -- narrowing is always explicit, never silent.
 * - Raw command text stays out of this module. It reads only the redacted
 *   command surface (`commandId` / `commandHash`) that P3 persists, so an undo
 *   cannot become a back door that lands raw commands on disk.
 */
import {
  type CodingExecEvent,
  type CodingFileSideEffect,
} from "../../../../shared/coding-runtime/types.js";
import {
  decodeCheckpointMetadata,
  type GitCheckpointRestoreResult,
  type GitCheckpointScope,
  type GitCheckpointService,
  listIgnoredCheckpointPaths,
  normalizeCheckpointScope,
  readCheckpointCommitMessage,
  scopeIsCoveredByCheckpointScope,
} from "./git-checkpoint.js";
import { GitCheckpointTransactionService } from "./git-checkpoint-transaction.js";

export type ExecUndoStatus =
  /** Every targeted side effect was reverted. */
  | "undone"
  /** Nothing to undo: the event recorded a complete diff with no file changes. */
  | "noop"
  | "disabled"
  /**
   * Refused because file-level undo cannot be proven correct: a path is not a
   * workspace file, the event's side-effect diff is incomplete, or the scope is
   * not covered by the checkpoint.
   */
  | "unsupported"
  | "not_found"
  | "conflict"
  | "failed"
  | "recovery_required";

export type ExecUndoRejection = {
  path: string;
  reason: string;
};

export type ExecUndoResult = {
  status: ExecUndoStatus;
  checkpointId: string;
  /** Redacted exec identity. Never the raw command. */
  commandId?: string;
  commandHash?: string;
  /** Workspace-relative paths the undo actually targeted. */
  paths: string[];
  /** Side effects deliberately not undone, each with the reason. */
  rejected: ExecUndoRejection[];
  /** Covered paths skipped because `allowPartial` narrowed the scope. */
  skipped?: string[];
  reason?: string;
  error?: { code: string; message: string };
  /** The underlying P6B restore outcome, when a restore was attempted. */
  restore?: GitCheckpointRestoreResult;
  safetyRef?: string;
  recoveryRef?: string;
};

export type ExecUndoOptions = {
  /**
   * Proceed over the subset of side-effect paths that are actually undoable --
   * covered by the checkpoint and representable in a git tree -- instead of
   * refusing the whole undo. The narrowed-out paths are reported in `skipped`.
   * Default false: a partial undo leaves the workspace matching neither the
   * pre-exec nor the post-exec state, so it has to be asked for.
   */
  allowPartial?: boolean;
  /** Override the raw byte backup directory for the safety snapshot. */
  recoveryDir?: string;
};

/**
 * Classify one side effect as undoable or not. Refusal reasons are the honest
 * ones: a path this module cannot prove is a workspace file under the
 * checkpointable tree.
 */
function classifySideEffect(
  root: string,
  effect: CodingFileSideEffect,
): { ok: true; path: string } | { ok: false; reason: string } {
  const raw = typeof effect.path === "string" ? effect.path.trim() : "";
  if (!raw) return { ok: false, reason: "side effect has no path" };
  if (effect.status !== "added" && effect.status !== "modified" && effect.status !== "deleted") {
    return { ok: false, reason: `unsupported side-effect status: ${String(effect.status)}` };
  }
  try {
    // Reuse the single scope-validation authority: it rejects workspace escapes,
    // the workspace root itself, `.git` and `.openclaw`.
    const scope = normalizeCheckpointScope(root, [raw]);
    const normalized = scope.paths[0];
    if (!normalized) return { ok: false, reason: "side-effect path normalized to nothing" };
    return { ok: true, path: normalized };
  } catch (caught) {
    return {
      ok: false,
      reason: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

/**
 * Resolve an exec event's side effects into an undo scope.
 *
 * A `null` before/after fingerprint means the exec ran without a workspace
 * snapshot, so an empty `sideEffects` list is *absence of evidence*, not
 * evidence of absence. That is reported as incomplete rather than as "nothing
 * changed".
 */
export function resolveExecUndoScope(
  root: string,
  event: CodingExecEvent,
): {
  paths: string[];
  rejected: ExecUndoRejection[];
  /** False when the event cannot support a complete side-effect claim. */
  diffComplete: boolean;
} {
  const diffComplete = event.beforeHash !== null && event.afterHash !== null;
  const paths: string[] = [];
  const rejected: ExecUndoRejection[] = [];
  for (const effect of event.sideEffects ?? []) {
    const classified = classifySideEffect(root, effect);
    if (classified.ok) {
      if (!paths.includes(classified.path)) paths.push(classified.path);
    } else {
      rejected.push({ path: String(effect?.path ?? ""), reason: classified.reason });
    }
  }
  paths.sort((a, b) => a.localeCompare(b));
  return { paths, rejected, diffComplete };
}

/**
 * Undo the workspace file side effects of an exec by restoring a pre-exec
 * checkpoint over exactly those paths.
 */
export class ExecSideEffectUndoService {
  readonly #service: GitCheckpointService;
  readonly #transaction: GitCheckpointTransactionService;
  readonly #execUndoEnabled: boolean;

  constructor(options: {
    service: GitCheckpointService;
    /** P7 flag `runtime.coding.uftk.execUndo.enabled`. Default false. */
    execUndoEnabled?: boolean;
    /** P6B flag `runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled`. Default false. */
    safetySnapshotEnabled?: boolean;
  }) {
    this.#service = options.service;
    this.#execUndoEnabled = options.execUndoEnabled ?? false;
    this.#transaction = new GitCheckpointTransactionService({
      service: options.service,
      ...(options.safetySnapshotEnabled !== undefined
        ? { safetySnapshotEnabled: options.safetySnapshotEnabled }
        : {}),
    });
  }

  async undoExecSideEffects(
    event: CodingExecEvent,
    checkpointId: string,
    options: ExecUndoOptions = {},
  ): Promise<ExecUndoResult> {
    const internals = this.#service.internals;
    const identity = {
      ...(event.commandId ? { commandId: event.commandId } : {}),
      ...(event.commandHash ? { commandHash: event.commandHash } : {}),
    };
    const base = { checkpointId, ...identity };

    if (!this.#execUndoEnabled) {
      return {
        ...base,
        status: "disabled",
        paths: [],
        rejected: [],
        reason: "exec side-effect undo is disabled (runtime.coding.uftk.execUndo.enabled)",
      };
    }
    if (!internals.pathScopedEnabled) {
      return {
        ...base,
        status: "disabled",
        paths: [],
        rejected: [],
        reason:
          "exec side-effect undo needs path-scoped restore (runtime.coding.uftk.gitCheckpoint.pathScoped.enabled)",
      };
    }

    const resolved = resolveExecUndoScope(this.#service.workspaceRoot, event);

    if (!resolved.diffComplete) {
      const detail =
        "exec event carries no workspace snapshot, so its file side effects are unknown; " +
        "refusing to claim an undo";
      internals.warn(`coding-exec-undo: ${detail}`);
      return {
        ...base,
        status: "unsupported",
        paths: [],
        rejected: resolved.rejected,
        reason: detail,
        error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message: detail },
      };
    }

    // A path we could not prove is a workspace file means the undo would be
    // partial in a way the caller did not ask for. Refuse with zero change.
    // These are hard rejections: `allowPartial` does not open them, because a
    // malformed or escaping path is a broken event, not a narrowing choice.
    if (resolved.rejected.length > 0) {
      const detail =
        `${resolved.rejected.length} side effect(s) are not undoable workspace files: ` +
        resolved.rejected
          .slice(0, 3)
          .map((entry) => `${entry.path || "<empty>"} (${entry.reason})`)
          .join("; ");
      internals.warn(`coding-exec-undo: ${detail}`);
      return {
        ...base,
        status: "unsupported",
        paths: resolved.paths,
        rejected: resolved.rejected,
        reason: detail,
        error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message: detail },
      };
    }

    if (resolved.paths.length === 0) {
      return {
        ...base,
        status: "noop",
        paths: [],
        rejected: [],
        reason: "exec recorded a complete diff with no workspace file side effects",
      };
    }

    // Gitignored side effects cannot be undone by a scoped restore at all: a
    // checkpoint tree cannot hold them (`git add` refuses to stage them), and a
    // restore plan derives extraneous paths from `ls-files --others
    // --exclude-standard`, which excludes them. So they are never restored and
    // never removed. Reporting `undone` while such a path survives would claim an
    // undo that demonstrably did not happen -- and P3's snapshot walk includes
    // ignored files, so an exec that touches a build artifact hits this normally.
    // Removing them instead is not on the table: that would delete local `.env`
    // and config files a developer never asked us to touch.
    let ignoredPaths: string[] = [];
    try {
      const ignored = await listIgnoredCheckpointPaths({
        root: this.#service.workspaceRoot,
        paths: resolved.paths,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      ignoredPaths = resolved.paths.filter((entry) => ignored.has(entry));
    } catch {
      // Cannot prove anything: fall through and let the restore report its own
      // failure rather than inventing one here.
    }
    if (ignoredPaths.length > 0 && !options.allowPartial) {
      const detail =
        `${ignoredPaths.length} side effect(s) are gitignored and cannot be undone by a ` +
        `scoped restore: ${ignoredPaths.slice(0, 3).join(", ")}`;
      internals.warn(`coding-exec-undo: ${detail}`);
      return {
        ...base,
        status: "unsupported",
        paths: resolved.paths,
        rejected: resolved.rejected,
        reason: detail,
        error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message: detail },
      };
    }

    // Carry-over B: the side-effect scope has to be covered by the checkpoint.
    // Restoring an uncovered path would delete it, because the plan treats
    // in-scope paths absent from the tree as extraneous.
    let recordedScope: GitCheckpointScope;
    try {
      recordedScope = decodeCheckpointMetadata(
        await readCheckpointCommitMessage({
          root: this.#service.workspaceRoot,
          checkpointId,
          env: internals.env,
          timeoutMs: internals.gitTimeoutMs,
        }),
      ).scope;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return {
        ...base,
        status: "not_found",
        paths: resolved.paths,
        rejected: resolved.rejected,
        reason: `checkpoint ${checkpointId} could not be read: ${message}`,
        error: {
          code: "E_GIT_CHECKPOINT_NOT_FOUND",
          message: `checkpoint not found: ${checkpointId}`,
        },
      };
    }

    let requestedScope: GitCheckpointScope;
    try {
      requestedScope = normalizeCheckpointScope(this.#service.workspaceRoot, resolved.paths);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return {
        ...base,
        status: "unsupported",
        paths: resolved.paths,
        rejected: resolved.rejected,
        reason: message,
        error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message },
      };
    }

    const coverage = scopeIsCoveredByCheckpointScope(requestedScope, recordedScope);
    let targetPaths = [...requestedScope.paths];
    const skippedSet = new Set<string>();

    if (!coverage.covered) {
      if (!options.allowPartial) {
        const detail =
          `exec side-effect paths are not covered by checkpoint ${checkpointId} ` +
          `(scope: ${describeScope(recordedScope)}); uncovered: ${coverage.uncovered.join(", ")}`;
        internals.warn(`coding-exec-undo: ${detail}`);
        return {
          ...base,
          status: "unsupported",
          paths: resolved.paths,
          rejected: resolved.rejected,
          reason: detail,
          error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message: detail },
        };
      }
      for (const entry of coverage.uncovered) skippedSet.add(entry);
      internals.warn(
        `coding-exec-undo: allowPartial narrowed the undo, skipping ${coverage.uncovered.length} ` +
          `uncovered path(s): ${coverage.uncovered.slice(0, 3).join(", ")}`,
      );
    }

    // Reaching here with ignored paths means `allowPartial` was set: they are
    // narrowed out the same way uncovered paths are, and reported.
    for (const entry of ignoredPaths) {
      if (targetPaths.includes(entry)) skippedSet.add(entry);
    }

    if (skippedSet.size > 0) {
      targetPaths = targetPaths.filter((entry) => !skippedSet.has(entry));
    }
    const skipped = [...skippedSet].sort((a, b) => a.localeCompare(b));

    if (targetPaths.length === 0) {
      const detail =
        `no exec side-effect path is undoable against checkpoint ${checkpointId} ` +
        `(scope: ${describeScope(recordedScope)})`;
      internals.warn(`coding-exec-undo: ${detail}`);
      return {
        ...base,
        status: "unsupported",
        paths: resolved.paths,
        rejected: resolved.rejected,
        ...(skipped.length > 0 ? { skipped } : {}),
        reason: detail,
        error: { code: "E_GIT_CHECKPOINT_UNSUPPORTED", message: detail },
      };
    }

    const restore = await this.#transaction.restoreCheckpoint(checkpointId, {
      paths: targetPaths,
      ...(options.recoveryDir ? { recoveryDir: options.recoveryDir } : {}),
    });

    return {
      ...base,
      status: mapRestoreStatus(restore.status),
      paths: targetPaths,
      rejected: resolved.rejected,
      ...(skipped.length > 0 ? { skipped } : {}),
      ...(restore.reason ? { reason: restore.reason } : {}),
      ...(restore.error ? { error: restore.error } : {}),
      restore,
      ...(restore.safetyRef ? { safetyRef: restore.safetyRef } : {}),
      ...(restore.recoveryRef ? { recoveryRef: restore.recoveryRef } : {}),
    };
  }
}

function describeScope(scope: GitCheckpointScope): string {
  return scope.kind === "full" ? "whole tree" : scope.paths.join(", ");
}

/**
 * Map a P6B restore status onto the undo surface. `restored` is the only status
 * that becomes a success; every other outcome keeps its own shape so a caller
 * cannot mistake a conflict or a partial apply for a completed undo.
 */
function mapRestoreStatus(status: GitCheckpointRestoreResult["status"]): ExecUndoStatus {
  switch (status) {
    case "restored":
      return "undone";
    case "disabled":
      return "disabled";
    case "unsupported":
      return "unsupported";
    case "not_found":
      return "not_found";
    case "conflict":
      return "conflict";
    case "recovery_required":
      return "recovery_required";
    default:
      return "failed";
  }
}

