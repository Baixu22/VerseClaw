/**
 * P7 UFTK: automatic checkpoints at turn / long-task boundaries.
 *
 * Default off. When enabled, a checkpoint is created before a turn's work
 * begins, labelled with the `requestId` so the restore point is traceable back
 * to the request that motivated it. Retention reuses the P6B lifecycle surface
 * rather than adding a second retention policy.
 *
 * Three properties this module treats as non-negotiable:
 *
 * 1. **An auto checkpoint never breaks the turn it precedes.** Every failure
 *    path returns a structured result and warns; nothing throws into the caller.
 *    A missing restore point is a degraded turn, not a failed one.
 * 2. **Retention never reaps a safety ref.** Auto checkpoints are exactly the
 *    pressure that makes retention aggressive, and a safety ref is the only copy
 *    of a user's pre-restore content. Safety refs live in a namespace the
 *    retention surface does not enumerate (P7 carry-over A), and the checkpoint
 *    just created is additionally passed as `protectedIds` so a policy cannot
 *    delete the restore point it was created for.
 * 3. **It does not replace write-journal rollback.** This module imports neither
 *    the journal nor the FTS rollback path.
 *
 * Concurrency (P7 carry-over C): checkpoint creation does not mutate the index
 * or worktree, so it takes no write lock and cannot starve or be starved by UFTK
 * writers. A restore *does* hold the P6A workspace barrier, and the barrier is a
 * workspace-scoped writer lock, so an auto checkpoint issued during a restore
 * waits behind it rather than reading a half-applied tree.
 */
import { codingObservability } from "../../context-engine/coding-observability.js";
import { acquireCodingRuntimeFileLocks } from "./file-lock-manager.js";
import {
  type GitCheckpointRecord,
  type GitCheckpointService,
  sanitizeCheckpointLabel,
} from "./git-checkpoint.js";
import type {
  GitCheckpointLifecycleService,
  RetentionPolicy,
  RetentionResult,
} from "./git-checkpoint-lifecycle.js";

export type AutoCheckpointTrigger = "turn" | "long-task";

export type AutoCheckpointStatus =
  | "created"
  | "disabled"
  /** Deliberately not created: duplicate request, or inside the minimum interval. */
  | "skipped"
  | "unsupported"
  | "failed";

export type AutoCheckpointResult = {
  status: AutoCheckpointStatus;
  trigger: AutoCheckpointTrigger;
  requestId: string;
  checkpointId?: string;
  label?: string;
  checkpoint?: GitCheckpointRecord;
  reason?: string;
  /** Retention outcome, present only when a retention policy is configured. */
  retention?: RetentionResult;
};

export type AutoCheckpointOptions = {
  /** Restrict the checkpoint to these paths. Whole-tree when omitted. */
  paths?: readonly string[];
  /** Extra label detail, e.g. a long-task name. */
  detail?: string;
};

/** `<trigger>` + `<requestId>` is the contract: a label always names its request. */
export function buildAutoCheckpointLabel(params: {
  trigger: AutoCheckpointTrigger;
  requestId: string;
  detail?: string;
}): string {
  const parts = [`uftk-auto-${params.trigger}`, params.requestId];
  if (params.detail?.trim()) parts.push(params.detail.trim());
  return sanitizeCheckpointLabel(parts.join(" "));
}

export class AutoCheckpointService {
  readonly #service: GitCheckpointService;
  readonly #lifecycle: GitCheckpointLifecycleService | undefined;
  readonly #enabled: boolean;
  readonly #retention: RetentionPolicy | undefined;
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  /** requestId -> checkpoint id, so one request yields at most one checkpoint per trigger. */
  readonly #seen = new Map<string, string>();
  #lastCreatedAtMs = 0;

  constructor(options: {
    service: GitCheckpointService;
    /** Required for retention; omit to skip retention entirely. */
    lifecycle?: GitCheckpointLifecycleService;
    /** P7 flag `runtime.coding.uftk.autoCheckpoint.enabled`. Default false. */
    autoCheckpointEnabled?: boolean;
    /** Applied after each successful creation. Omit to never prune. */
    retention?: RetentionPolicy;
    /**
     * Floor on how often automatic checkpoints are created. Turn boundaries can
     * arrive in bursts, and a whole-tree checkpoint is not free.
     */
    minIntervalMs?: number;
    /** Injectable clock for deterministic interval tests. */
    now?: () => number;
  }) {
    this.#service = options.service;
    this.#lifecycle = options.lifecycle;
    this.#enabled = options.autoCheckpointEnabled ?? false;
    this.#retention = options.retention;
    this.#minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.#now = options.now ?? (() => Date.now());
  }

  /** Checkpoint before a turn's work begins. */
  async checkpointForTurn(
    params: { requestId: string } & AutoCheckpointOptions,
  ): Promise<AutoCheckpointResult> {
    return await this.#checkpoint("turn", params);
  }

  /** Checkpoint before a long-running task begins. */
  async checkpointForLongTask(
    params: { requestId: string } & AutoCheckpointOptions,
  ): Promise<AutoCheckpointResult> {
    return await this.#checkpoint("long-task", params);
  }

  /** Checkpoint ids this service created, oldest first. */
  createdCheckpointIds(): string[] {
    return [...this.#seen.values()];
  }

  async #checkpoint(
    trigger: AutoCheckpointTrigger,
    params: { requestId: string } & AutoCheckpointOptions,
  ): Promise<AutoCheckpointResult> {
    const internals = this.#service.internals;
    const requestId = params.requestId.trim() || "unknown";
    const base = { trigger, requestId };

    if (!this.#enabled) {
      return {
        ...base,
        status: "disabled",
        reason: "automatic checkpoints are disabled (runtime.coding.uftk.autoCheckpoint.enabled)",
      };
    }
    if (!internals.pathScopedEnabled) {
      // Labels ride the P6B path-scoped surface, and an auto checkpoint without
      // its requestId label is not traceable, so degrade loudly instead.
      return {
        ...base,
        status: "disabled",
        reason:
          "automatic checkpoints need labelled checkpoints (runtime.coding.uftk.gitCheckpoint.pathScoped.enabled)",
      };
    }

    const dedupeKey = `${trigger}:${requestId}`;
    const existing = this.#seen.get(dedupeKey);
    if (existing) {
      return {
        ...base,
        status: "skipped",
        checkpointId: existing,
        reason: `request ${requestId} already has a ${trigger} checkpoint`,
      };
    }

    const nowMs = this.#now();
    if (this.#minIntervalMs > 0 && this.#lastCreatedAtMs > 0) {
      const sinceMs = nowMs - this.#lastCreatedAtMs;
      if (sinceMs < this.#minIntervalMs) {
        return {
          ...base,
          status: "skipped",
          reason: `within the ${this.#minIntervalMs}ms automatic-checkpoint interval (${sinceMs}ms since the last one)`,
        };
      }
    }

    const label = buildAutoCheckpointLabel({
      trigger,
      requestId,
      ...(params.detail ? { detail: params.detail } : {}),
    });

    let created;
    try {
      created = await this.#service.createCheckpoint({
        label,
        ...(params.paths ? { paths: params.paths } : {}),
      });
    } catch (caught) {
      // Creation is best-effort by design: a turn must not fail because its
      // restore point could not be taken.
      const message = caught instanceof Error ? caught.message : String(caught);
      internals.warn(`coding-auto-checkpoint: ${trigger} checkpoint threw: ${message}`);
      return { ...base, status: "failed", label, reason: message };
    }

    if (created.status !== "created" || !created.checkpoint) {
      const status: AutoCheckpointStatus =
        created.status === "disabled"
          ? "disabled"
          : created.status === "unsupported"
            ? "unsupported"
            : "failed";
      if (status !== "disabled") {
        internals.warn(
          `coding-auto-checkpoint: ${trigger} checkpoint ${created.status}: ${created.reason ?? "no reason given"}`,
        );
      }
      return {
        ...base,
        status,
        label,
        ...(created.reason ? { reason: created.reason } : {}),
      };
    }

    this.#seen.set(dedupeKey, created.checkpoint.id);
    this.#lastCreatedAtMs = nowMs;

    const retention = await this.#applyRetention(created.checkpoint.id);

    return {
      ...base,
      status: "created",
      checkpointId: created.checkpoint.id,
      label,
      checkpoint: created.checkpoint,
      ...(retention ? { retention } : {}),
    };
  }

  /**
   * Apply retention, protecting the checkpoint just created. Safety refs are in
   * a namespace this surface does not enumerate, so no policy reaches them.
   */
  async #applyRetention(justCreatedId: string): Promise<RetentionResult | undefined> {
    if (!this.#retention || !this.#lifecycle) return undefined;
    const internals = this.#service.internals;
    try {
      const result = await this.#lifecycle.retainCheckpoints({
        ...this.#retention,
        protectedIds: [...(this.#retention.protectedIds ?? []), justCreatedId],
      });
      if (result.status !== "ok" && result.status !== "disabled") {
        internals.warn(
          `coding-auto-checkpoint: retention ${result.status}: ${result.reason ?? "no reason given"}`,
        );
      }
      // Drop ids we created that retention has now removed, so the dedupe map
      // does not hand out a checkpoint that no longer resolves.
      if (result.pruned.length > 0 && !result.dryRun) {
        const pruned = new Set(result.pruned);
        for (const [key, id] of [...this.#seen]) {
          if (pruned.has(id)) this.#seen.delete(key);
        }
      }
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      internals.warn(`coding-auto-checkpoint: retention threw: ${message}`);
      return undefined;
    }
  }
}

/**
 * Wait until no restore holds the workspace barrier, then run `fn`.
 *
 * Auto checkpoint creation is read-only with respect to the index and worktree,
 * so it does not need a write lock. But reading the tree *during* a restore would
 * snapshot a half-applied state, so a caller that wants a coherent checkpoint
 * takes a read lease on the workspace first: the P6A scheduler makes that wait
 * for the restore's writer barrier to clear, and the barrier's FIFO ordering
 * means the wait is bounded rather than indefinite.
 */
export async function withWorkspaceQuiesce<T>(
  root: string,
  options: { owner?: string; timeoutMs?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const lease = await acquireCodingRuntimeFileLocks([root], {
    mode: "read",
    scope: "workspace",
    workspaceRoot: root,
    ...(options.owner ? { owner: options.owner } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  codingObservability.recordRestoreBarrierWaitMs(Math.max(0, Date.now() - startedAt));
  try {
    return await fn();
  } finally {
    await lease.release();
  }
}
