/**
 * P6B UFTK: git checkpoint lifecycle.
 *
 * Adds the read and management surface around the private checkpoint refs:
 * labelled listing, tree-to-tree diff, patch export, retention and prune. All of
 * it is gated behind `runtime.coding.uftk.gitCheckpoint.lifecycle.enabled` and
 * none of it mutates the worktree or the index -- prune only deletes refs.
 *
 * Retention never deletes a protected checkpoint: the caller's `protectedIds`
 * and the newest checkpoint are always kept, so the checkpoint a caller is
 * currently working against cannot be pruned out from under it.
 *
 * P7 (carry-over A): pre-restore safety refs live in a sibling namespace
 * (`GIT_CHECKPOINT_SAFETY_REF_PREFIX`) that this retention surface never
 * enumerates, so no policy can reap them. That exclusion is enforced twice
 * over: `retainCheckpoints` reads only the checkpoint prefix, and every ref
 * deletion is asserted to be inside the namespace the caller asked to reclaim.
 * Safety refs are reclaimable only through the explicitly named
 * `retainSafetyCheckpoints`, and only under a policy that names an age or a
 * count — an empty policy reclaims nothing.
 *
 * Object garbage collection is a separate, explicit call. Deleting a ref only
 * makes its objects unreachable; reclaiming them is left to git's own
 * maintenance unless a caller deliberately asks for it. Safety refs keep their
 * objects reachable, so `collectGarbage` cannot discard safety content either.
 */
import { CodingRuntimeError } from "./coding-runtime-error.js";
import {
  GIT_CHECKPOINT_REF_PREFIX,
  GIT_CHECKPOINT_SAFETY_REF_PREFIX,
  type GitCheckpointRecord,
  type GitCheckpointService,
  readCheckpointRecords,
  runGitCheckpointCommand,
} from "./git-checkpoint.js";

export type LifecycleStatus = "ok" | "disabled" | "unsupported" | "not_found" | "failed";

export type CheckpointListResult = {
  status: LifecycleStatus;
  checkpoints: GitCheckpointRecord[];
  reason?: string;
};

export type CheckpointDiffResult = {
  status: LifecycleStatus;
  /** `git diff --name-status` rows between the two checkpoint trees. */
  changes: Array<{ status: string; path: string }>;
  /** `git diff --shortstat` summary line, when git produced one. */
  summary?: string;
  reason?: string;
};

export type CheckpointPatchResult = {
  status: LifecycleStatus;
  patch?: string;
  reason?: string;
};

export type RetentionPolicy = {
  /** Keep at most this many checkpoints, newest first. */
  maxCount?: number;
  /** Drop checkpoints older than this age in milliseconds. */
  maxAgeMs?: number;
  /** Never delete these ids, whatever the other rules say. */
  protectedIds?: readonly string[];
  /** Report what would be deleted without deleting anything. */
  dryRun?: boolean;
};

export type RetentionResult = {
  status: LifecycleStatus;
  /** Checkpoints deleted (or, for a dry run, that would be deleted). */
  pruned: string[];
  /** Checkpoints kept, including everything protected. */
  kept: string[];
  dryRun: boolean;
  reason?: string;
};

export type GarbageCollectResult = {
  status: LifecycleStatus;
  /** True when git's prune ran. */
  pruned: boolean;
  reason?: string;
};

/**
 * Lifecycle operations over an existing `GitCheckpointService`. The service
 * remains the owner of workspace/flag/state configuration.
 */
export class GitCheckpointLifecycleService {
  readonly #service: GitCheckpointService;
  readonly #lifecycleEnabled: boolean;

  constructor(options: {
    service: GitCheckpointService;
    /** P6B flag `runtime.coding.uftk.gitCheckpoint.lifecycle.enabled`. Default false. */
    lifecycleEnabled?: boolean;
  }) {
    this.#service = options.service;
    this.#lifecycleEnabled = options.lifecycleEnabled ?? false;
  }

  #gate(): { ok: true } | { ok: false; reason: string } {
    const internals = this.#service.internals;
    if (!internals.enabled) {
      return { ok: false, reason: "git checkpoint is disabled" };
    }
    if (!this.#lifecycleEnabled) {
      return {
        ok: false,
        reason:
          "checkpoint lifecycle is disabled (runtime.coding.uftk.gitCheckpoint.lifecycle.enabled)",
      };
    }
    return { ok: true };
  }

  /** List checkpoints with label, scope, parent and creation time. */
  async listCheckpoints(): Promise<CheckpointListResult> {
    return await this.#list(GIT_CHECKPOINT_REF_PREFIX);
  }

  /**
   * List pre-restore safety refs. Separate from `listCheckpoints` because these
   * are not user-selectable restore targets: they exist so a failed restore's
   * pre-restore content stays reachable.
   */
  async listSafetyCheckpoints(): Promise<CheckpointListResult> {
    return await this.#list(GIT_CHECKPOINT_SAFETY_REF_PREFIX);
  }

  async #list(refPrefix: string): Promise<CheckpointListResult> {
    const gate = this.#gate();
    if (!gate.ok) return { status: "disabled", checkpoints: [], reason: gate.reason };
    const internals = this.#service.internals;
    try {
      const checkpoints = await readCheckpointRecords({
        root: this.#service.workspaceRoot,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
        refPrefix,
      });
      // Millisecond-resolution ordering: git's creatordate cannot separate
      // checkpoints created inside the same second.
      checkpoints.sort((a, b) => b.createdAtMs - a.createdAtMs);
      return { status: "ok", checkpoints };
    } catch (caught) {
      return { status: "unsupported", checkpoints: [], reason: messageOf(caught) };
    }
  }

  /** Diff two checkpoint trees. Cost is linear in the tree difference. */
  async diffCheckpoints(fromId: string, toId: string): Promise<CheckpointDiffResult> {
    const gate = this.#gate();
    if (!gate.ok) return { status: "disabled", changes: [], reason: gate.reason };
    const internals = this.#service.internals;
    try {
      const raw = await runGitCheckpointCommand({
        args: ["diff", "--name-status", "-z", fromId, toId],
        cwd: this.#service.workspaceRoot,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      const changes = parseNameStatusZ(raw);
      let summary: string | undefined;
      try {
        summary =
          (
            await runGitCheckpointCommand({
              args: ["diff", "--shortstat", fromId, toId],
              cwd: this.#service.workspaceRoot,
              env: internals.env,
              timeoutMs: internals.gitTimeoutMs,
            })
          ).trim() || undefined;
      } catch {
        summary = undefined;
      }
      return { status: "ok", changes, ...(summary ? { summary } : {}) };
    } catch (caught) {
      return { status: notFoundOrFailed(caught), changes: [], reason: messageOf(caught) };
    }
  }

  /**
   * Export a checkpoint as a patch. With no `against` the patch is taken from
   * the checkpoint's parent commit, so it reads as "what this checkpoint changed".
   */
  async exportPatch(
    checkpointId: string,
    options: { against?: string } = {},
  ): Promise<CheckpointPatchResult> {
    const gate = this.#gate();
    if (!gate.ok) return { status: "disabled", reason: gate.reason };
    const internals = this.#service.internals;
    try {
      let base = options.against;
      if (!base) {
        try {
          base = (
            await runGitCheckpointCommand({
              args: ["rev-parse", "--verify", `${checkpointId}^`],
              cwd: this.#service.workspaceRoot,
              env: internals.env,
              timeoutMs: internals.gitTimeoutMs,
            })
          ).trim();
        } catch {
          // Root checkpoint: diff against the empty tree so export still works.
          base = EMPTY_TREE_OBJECT;
        }
      }
      const patch = await runGitCheckpointCommand({
        args: ["diff", "--patch", "--binary", base, checkpointId],
        cwd: this.#service.workspaceRoot,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      return { status: "ok", patch };
    } catch (caught) {
      return { status: notFoundOrFailed(caught), reason: messageOf(caught) };
    }
  }

  /**
   * Apply a retention policy. The newest checkpoint and every `protectedIds`
   * entry are always kept. Safety refs are outside the enumerated namespace and
   * therefore never candidates, whatever the policy says.
   */
  async retainCheckpoints(policy: RetentionPolicy = {}): Promise<RetentionResult> {
    return await this.#retainIn(GIT_CHECKPOINT_REF_PREFIX, policy);
  }

  /**
   * Reclaim pre-restore safety refs under an explicit policy. Deliberately a
   * separate, explicitly named call: it is the only way a safety ref is ever
   * deleted, so no ordinary retention or prune path can reach one by accident.
   * The newest safety ref is still protected, so the most recent restore stays
   * recoverable, and an empty policy deletes nothing — reclamation has to be
   * asked for by age or count, never implied.
   */
  async retainSafetyCheckpoints(policy: RetentionPolicy = {}): Promise<RetentionResult> {
    return await this.#retainIn(GIT_CHECKPOINT_SAFETY_REF_PREFIX, policy);
  }

  async #retainIn(refPrefix: string, policy: RetentionPolicy): Promise<RetentionResult> {
    const gate = this.#gate();
    if (!gate.ok) {
      return { status: "disabled", pruned: [], kept: [], dryRun: policy.dryRun ?? false, reason: gate.reason };
    }
    const internals = this.#service.internals;
    const dryRun = policy.dryRun ?? false;
    let records: GitCheckpointRecord[];
    try {
      records = await readCheckpointRecords({
        root: this.#service.workspaceRoot,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
        refPrefix,
      });
    } catch (caught) {
      return { status: "unsupported", pruned: [], kept: [], dryRun, reason: messageOf(caught) };
    }

    const ordered = [...records].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const protectedIds = new Set(policy.protectedIds ?? []);
    // The newest checkpoint is always protected so an in-flight caller's
    // reference cannot disappear.
    if (ordered[0]) protectedIds.add(ordered[0].id);

    const nowMs = Date.now();
    const doomed: GitCheckpointRecord[] = [];
    const kept: GitCheckpointRecord[] = [];
    ordered.forEach((record, index) => {
      if (protectedIds.has(record.id)) {
        kept.push(record);
        return;
      }
      const overCount =
        typeof policy.maxCount === "number" && policy.maxCount >= 0 && index >= policy.maxCount;
      // Age uses git's own creation date, not the millisecond subject stamp.
      // "How old is this?" is a coarse question, and `creatordate` is the field a
      // caller can influence (GIT_AUTHOR_DATE) when back-dating a checkpoint.
      // Ordering above deliberately uses the finer stamp instead, because
      // "which of these is newest" needs sub-second resolution and age does not.
      const createdMs = Date.parse(record.createdAt);
      const overAge =
        typeof policy.maxAgeMs === "number" &&
        policy.maxAgeMs >= 0 &&
        Number.isFinite(createdMs) &&
        nowMs - createdMs > policy.maxAgeMs;
      if (overCount || overAge) {
        doomed.push(record);
      } else {
        kept.push(record);
      }
    });

    if (!dryRun) {
      for (const record of doomed) {
        try {
          // Belt and braces: the enumeration above already bounds the namespace,
          // but assert it at the deletion site so a future refactor that widens
          // the read cannot silently start reaping safety refs.
          assertRefInNamespace(record.ref, refPrefix);
          await runGitCheckpointCommand({
            args: ["update-ref", "-d", record.ref, record.commit],
            cwd: this.#service.workspaceRoot,
            env: internals.env,
            timeoutMs: internals.gitTimeoutMs,
          });
        } catch (caught) {
          return {
            status: "failed",
            pruned: doomed.slice(0, doomed.indexOf(record)).map((item) => item.id),
            kept: kept.map((item) => item.id),
            dryRun,
            reason: messageOf(caught),
          };
        }
      }
    }

    return {
      status: "ok",
      pruned: doomed.map((record) => record.id),
      kept: kept.map((record) => record.id),
      dryRun,
    };
  }

  /** Delete every checkpoint except the protected ones. */
  async pruneCheckpoints(
    options: { protectedIds?: readonly string[]; dryRun?: boolean } = {},
  ): Promise<RetentionResult> {
    return await this.retainCheckpoints({
      maxCount: 0,
      ...(options.protectedIds ? { protectedIds: options.protectedIds } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    });
  }

  /**
   * Explicitly reclaim unreachable objects. Deliberately opt-in and never called
   * by retention/prune: it affects every unreachable object in the repository,
   * not only checkpoint objects.
   */
  async collectGarbage(options: { expire?: string } = {}): Promise<GarbageCollectResult> {
    const gate = this.#gate();
    if (!gate.ok) return { status: "disabled", pruned: false, reason: gate.reason };
    const internals = this.#service.internals;
    try {
      await runGitCheckpointCommand({
        args: ["prune", `--expire=${options.expire ?? "now"}`],
        cwd: this.#service.workspaceRoot,
        env: internals.env,
        timeoutMs: internals.gitTimeoutMs,
      });
      return { status: "ok", pruned: true };
    } catch (caught) {
      return { status: "failed", pruned: false, reason: messageOf(caught) };
    }
  }
}

/** git's well-known empty tree object, used as the base for root checkpoints. */
export const EMPTY_TREE_OBJECT = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export { GIT_CHECKPOINT_REF_PREFIX, GIT_CHECKPOINT_SAFETY_REF_PREFIX };

/**
 * Refuse to delete a ref outside the namespace a caller asked to reclaim. This
 * is what makes "retention cannot delete a safety ref" an enforced invariant
 * rather than a property of the current enumeration.
 */
function assertRefInNamespace(ref: string, refPrefix: string): void {
  if (ref !== refPrefix && !ref.startsWith(`${refPrefix}/`)) {
    throw new CodingRuntimeError({
      code: "E_GIT_CHECKPOINT_FAILED",
      message: `refusing to delete ref outside ${refPrefix}: ${ref}`,
    });
  }
}

function parseNameStatusZ(raw: string): Array<{ status: string; path: string }> {
  // `--name-status -z` emits: <status> NUL <path> NUL [<path2> NUL for renames]
  const fields = raw.split("\0").filter((field) => field.length > 0);
  const changes: Array<{ status: string; path: string }> = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index];
    index += 1;
    if (!status) continue;
    const isRenameOrCopy = status.startsWith("R") || status.startsWith("C");
    const first = fields[index];
    index += 1;
    if (first === undefined) break;
    if (isRenameOrCopy) {
      const second = fields[index];
      index += 1;
      changes.push({ status, path: second ?? first });
    } else {
      changes.push({ status, path: first });
    }
  }
  return changes;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function notFoundOrFailed(caught: unknown): LifecycleStatus {
  if (caught instanceof CodingRuntimeError && caught.code === "E_GIT_CHECKPOINT_NOT_FOUND") {
    return "not_found";
  }
  const message = messageOf(caught).toLowerCase();
  if (
    message.includes("unknown revision") ||
    message.includes("bad object") ||
    message.includes("ambiguous argument")
  ) {
    return "not_found";
  }
  return "failed";
}
