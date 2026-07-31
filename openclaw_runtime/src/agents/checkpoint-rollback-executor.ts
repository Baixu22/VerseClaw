/**
 * A3 checkpoint-rollback executor — production implementation of
 * `ReplayRollbackDeps` for `executeReplayRollback`.
 *
 * Design (avoid over-engineering):
 * - File restore uses the existing write-journal (`write-journal.ts`, C2-8),
 *   NOT a new git transaction: every mutation recorded with
 *   `createdAtMs >= checkpoint.createdAt` is rolled back. This reuses the
 *   journal that already snapshots every edit/write/apply_patch pre-image.
 * - Worktree isolation: when the checkpoint metadata carries a worktree id,
 *   the worktree root (via `worktree-service`) is used as the journal root so
 *   journal entries recorded inside the worktree are restored too.
 * - Event-log replay is NOT implemented (no runtime event-log executor
 *   exists); the dep returns an explicit failure so callers fall back to the
 *   legacy checkpoint path instead of pretending.
 * - `recordOutcome` writes to the mission trace/audit surface via the
 *   injected `recordOutcome` callback (defaults to console when absent).
 */
import path from "node:path";
import {
  getLongTaskCheckpointById,
  type LongTaskCheckpointRecord,
} from "./long-task-control/store.js";
import {
  getOrCreateWriteJournal,
  undoLastWrites,
} from "./tools/write-journal.js";
import {
  listWorktreeDirs,
  type WorktreeRecord,
} from "./worktree-service.js";
import type {
  ReplayRollbackDeps,
  ReplayRollbackResult,
  ReplayRollbackTarget,
} from "./replay-rollback-authority.js";

export type CheckpointRollbackExecutorOptions = {
  /** Workspace root for journal resolution. */
  workspaceRoot: string;
  /** Optional session id override (journal key). Defaults to checkpoint.sessionKey. */
  sessionId?: string;
  /** Optional outcome sink (audit/telemetry). Defaults to console. */
  recordOutcome?: (result: ReplayRollbackResult) => void;
  /** Optional clock override for tests. */
  now?: () => number;
};

function isCheckpointRecord(value: unknown): value is LongTaskCheckpointRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as LongTaskCheckpointRecord;
  return (
    typeof record.id === "string" &&
    typeof record.sessionKey === "string" &&
    typeof record.checkpoint === "object" &&
    record.checkpoint !== null &&
    record.checkpoint.schemaVersion === 1 &&
    typeof record.checkpoint.createdAt === "string" &&
    Array.isArray(record.checkpoint.filesTouched) &&
    Array.isArray(record.checkpoint.testsRun)
  );
}

/** Validate a checkpoint record is structurally usable for rollback. */
export async function validateCheckpointRecord(
  checkpoint: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isCheckpointRecord(checkpoint)) {
    return {
      ok: false,
      reason: "checkpoint is not a usable LongTaskCheckpointRecord (schemaVersion=1, sessionKey, createdAt, filesTouched, testsRun required)",
    };
  }
  const at = Date.parse(checkpoint.checkpoint.createdAt);
  if (Number.isNaN(at)) {
    return { ok: false, reason: `checkpoint.createdAt is not a parseable date: ${checkpoint.checkpoint.createdAt}` };
  }
  return { ok: true };
}

/**
 * Roll back every journal entry recorded at/after the checkpoint's createdAt.
 * Entries older than the checkpoint are preserved. Mirrors the "restore
 * workspace to checkpoint instant" semantics of Cline's
 * `applyCheckpointToWorktree`, but on the journal (host-agnostic, no git repo
 * requirement) — and additionally restores created files (journal hadPrior=false).
 */
export function applyCheckpointToJournal(params: {
  workspaceRoot: string;
  checkpoint: LongTaskCheckpointRecord;
  /** Journal session id. Defaults to the checkpoint's sessionKey (canonical). */
  sessionId?: string;
  now?: () => number;
}): { restored: string[]; errors: string[]; journalDir: string } {
  const at = Date.parse(params.checkpoint.checkpoint.createdAt);
  // The write-journal is keyed by the agent session id (options.sessionId at
  // tool-creation time), NOT the canonical session key. Callers with a
  // concrete session id MUST pass it; the checkpoint sessionKey is only a
  // fallback for tests/back-compat.
  const journal = getOrCreateWriteJournal(
    params.workspaceRoot,
    params.sessionId ?? params.checkpoint.sessionKey,
  );
  // Seq boundary (monotonic, immune to same-millisecond ambiguity) takes
  // precedence when the checkpoint was stamped with `metadata.journalSeq`
  // (mission-control tick-end checkpoints). createdAt-based filtering remains
  // the fallback for unstamped/legacy checkpoints.
  const metadata = params.checkpoint.checkpoint.metadata;
  const rawSeq =
    metadata && typeof metadata === "object" && "journalSeq" in metadata
      ? (metadata as Record<string, unknown>).journalSeq
      : undefined;
  const seqBoundary =
    typeof rawSeq === "number" && Number.isFinite(rawSeq) ? rawSeq : undefined;
  // Entries are seq-ordered; find the cutoff index: all entries after the
  // checkpoint instant must be undone. Undo newest-first (from the tail).
  const toUndo =
    seqBoundary !== undefined
      ? journal.entries.filter((entry) => entry.seq > seqBoundary)
      : journal.entries.filter((entry) => entry.createdAtMs >= at);
  if (toUndo.length === 0) {
    return { restored: [], errors: [], journalDir: journal.rootDir };
  }
  // undoLastWrites pops from the tail. Because journal entries are seq-ordered
  // and the checkpoint is a suffix boundary, undoing `toUndo.length` steps from
  // the tail restores exactly the post-checkpoint writes.
  const outcome = undoLastWrites({
    workspaceRoot: params.workspaceRoot,
    sessionId: params.sessionId ?? params.checkpoint.sessionKey,
    steps: toUndo.length,
  });
  return {
    restored: outcome.restored,
    errors: outcome.errors,
    journalDir: outcome.journalDir,
  };
}

/** Resolve the journal root for a checkpoint (base workspace or worktree root). */
export function resolveCheckpointJournalRoot(
  checkpoint: LongTaskCheckpointRecord,
  workspaceRoot: string,
  worktrees?: WorktreeRecord[],
): string {
  const metadata = checkpoint.checkpoint.metadata;
  const worktreeId =
    metadata && typeof metadata.worktreeId === "string" ? metadata.worktreeId : undefined;
  if (worktreeId && worktrees) {
    const match = worktrees.find((wt) => wt.id === worktreeId);
    if (match) return match.root;
  }
  return workspaceRoot;
}

/**
 * Production `ReplayRollbackDeps` backed by the long-task checkpoint store
 * and the write-journal. The event-log replay path is intentionally not
 * implemented: it returns `replay_failed` so `executeReplayRollback` reports
 * the failure explicitly rather than silently succeeding.
 */
export function createCheckpointRollbackDeps(
  options: CheckpointRollbackExecutorOptions,
): ReplayRollbackDeps {
  const now = options.now ?? Date.now;
  const recordOutcome = options.recordOutcome ?? ((result: ReplayRollbackResult) => {
    if (!result.ok) {
      console.warn(`[checkpoint-rollback] failed: ${result.reason}: ${result.detail}`);
    } else {
      console.info(`[checkpoint-rollback] ${result.mode} -> ${result.rolledBackTo}`);
    }
  });

  return {
    loadCheckpoint: async (checkpointId: string) => {
      const record = getLongTaskCheckpointById(checkpointId);
      return record;
    },
    validateCheckpoint: async (checkpoint: unknown) => validateCheckpointRecord(checkpoint),
    applyCheckpoint: async (checkpoint: unknown) => {
      const record = checkpoint as LongTaskCheckpointRecord;
      const validated = await validateCheckpointRecord(record);
      if (!validated.ok) {
        throw new Error(`checkpoint validation failed: ${validated.reason}`);
      }
      // Worktree-aware root resolution: journal entries written inside a
      // worktree live under the worktree root.
      const worktreeRoots = listWorktreeDirs(options.workspaceRoot).map((root) => {
        const id = path.basename(root);
        const record: WorktreeRecord = {
          id,
          root,
          baseRoot: options.workspaceRoot,
          createdAtMs: 0,
          status: "active",
          backend: "inprocess",
        };
        return record;
      });
      const journalRoot = resolveCheckpointJournalRoot(
        record,
        options.workspaceRoot,
        worktreeRoots,
      );
      const outcome = applyCheckpointToJournal({
        workspaceRoot: journalRoot,
        checkpoint: record,
        sessionId: options.sessionId,
        now,
      });
      if (outcome.errors.length > 0) {
        throw new Error(
          `checkpoint rollback stopped at first failure (${outcome.errors.join("; ")}); journal preserved at ${outcome.journalDir}`,
        );
      }
    },
    replayEventLog: async (fromSeq: number, toSeq: number) => ({
      ok: false,
      reason: `event_log_replay_not_implemented: ${fromSeq}..${toSeq}`,
    }),
    recordOutcome,
  };
}

/** Build the rollback target for a checkpoint id (legacy fallback path). */
export function checkpointRollbackTarget(checkpointId: string): ReplayRollbackTarget {
  return { kind: "checkpoint", checkpointId };
}
