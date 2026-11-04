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
import { existsSync } from "node:fs";
import path from "node:path";
import {
  getLongTaskCheckpointById,
  type LongTaskCheckpointRecord,
} from "./long-task-control/store.js";
import {
  getOrCreateWriteJournal,
  journalDirFor,
  undoLastWrites,
  type WriteJournalEntry,
} from "./tools/write-journal.js";
import { acquirePatchBatchLocks } from "./apply-patch-batch-lock.js";
import { resolveCheckpointJournalBoundary } from "./checkpoint-diff.js";
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
export async function applyCheckpointToJournal(params: {
  workspaceRoot: string;
  checkpoint: LongTaskCheckpointRecord;
  /**
   * Journal session id — the agent session UUID (`options.sessionId` at
   * tool-creation time). Required: the canonical session key addresses a
   * *different* journal directory, so there is no safe fallback (#176).
   */
  sessionId?: string;
  now?: () => number;
}): Promise<{ restored: string[]; errors: string[]; journalDir: string }> {
  const journalSessionId = params.sessionId?.trim();
  if (!journalSessionId) {
    // #176: this used to fall back to `checkpoint.sessionKey` (e.g.
    // "agent:main:main"), which silently pointed at an empty directory and
    // reported a successful restore that changed nothing.
    return {
      restored: [],
      errors: [
        "journal_session_id_missing: pass the agent session id (UUID); the canonical session key addresses a different journal directory (#176)",
      ],
      journalDir: "",
    };
  }
  const journalDir = journalDirFor(params.workspaceRoot, journalSessionId);
  if (!existsSync(journalDir)) {
    // #176: fail closed. "No journal for this session id" is a key mismatch or
    // a session that never journaled a write; either way it is not a
    // successful restore, and it must not report as one.
    return {
      restored: [],
      errors: [`no_journal_for_session: ${journalDir}`],
      journalDir,
    };
  }
  const journal = getOrCreateWriteJournal(params.workspaceRoot, journalSessionId);
  const toUndo = selectCheckpointUndoEntries({
    workspaceRoot: params.workspaceRoot,
    checkpoint: params.checkpoint,
    sessionId: journalSessionId,
  });
  if (toUndo.length === 0) {
    return { restored: [], errors: [], journalDir: journal.rootDir };
  }
  // undoLastWrites pops from the tail. Because journal entries are seq-ordered
  // and the checkpoint is a suffix boundary, undoing `toUndo.length` steps from
  // the tail restores exactly the post-checkpoint writes.
  return undoCheckpointWrites({
    workspaceRoot: params.workspaceRoot,
    sessionId: journalSessionId,
    entries: toUndo.map((entry) => ({ seq: entry.seq, relPath: entry.relPath })),
  });
}

/**
 * #175: the journal entries a rollback to this checkpoint instant would undo,
 * oldest first.
 *
 * Single implementation of the selection rule: the executor and the lock
 * acquisition in `createCheckpointRollbackDeps` both call it, so the boundary
 * the rollback uses and the paths it locks can never drift apart.
 *
 * Seq boundary (monotonic, immune to same-millisecond ambiguity) takes
 * precedence when the checkpoint was stamped with `metadata.journalSeq`
 * (mission-control tick-end checkpoints); createdAt filtering remains the
 * fallback for unstamped/legacy checkpoints.
 */
export function selectCheckpointUndoEntries(params: {
  workspaceRoot: string;
  checkpoint: LongTaskCheckpointRecord;
  sessionId: string;
}): WriteJournalEntry[] {
  const journal = getOrCreateWriteJournal(params.workspaceRoot, params.sessionId);
  const seqBoundary = resolveCheckpointJournalBoundary(params.checkpoint);
  if (seqBoundary !== undefined) {
    return journal.entries.filter((entry) => entry.seq > seqBoundary);
  }
  const at = Date.parse(params.checkpoint.checkpoint.createdAt);
  return journal.entries.filter((entry) => entry.createdAtMs >= at);
}

/**
 * #175: apply a *pre-computed* rollback selection.
 *
 * `applyCheckpointToJournal` computes the selection and delegates here. Splitting
 * it out is what makes the issue's interleaving testable without a test-only hook
 * in the production path: a caller that computed its selection earlier can hand
 * it over after a concurrent write landed, and the identity check inside
 * `undoLastWrites` turns that into an explicit abort — `concurrent_write_detected`
 * — instead of popping the concurrent entry as "the Nth from the tail".
 *
 * `entries` is the oldest-first selection; it is reversed here because the undo
 * pops newest-first. An empty selection is a no-op, never "undo one".
 */
export async function undoCheckpointWrites(params: {
  workspaceRoot: string;
  sessionId: string;
  entries: readonly { seq: number; relPath: string }[];
}): Promise<{ restored: string[]; errors: string[]; journalDir: string }> {
  const newestFirst = [...params.entries].reverse();
  if (newestFirst.length === 0) {
    return {
      restored: [],
      errors: [],
      journalDir: journalDirFor(params.workspaceRoot, params.sessionId),
    };
  }
  const outcome = await undoLastWrites({
    workspaceRoot: params.workspaceRoot,
    sessionId: params.sessionId,
    steps: newestFirst.length,
    expectedEntries: newestFirst,
    workspaceOnly: true,
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
      // #175: hold the same file leases a writer holds, so a write cannot
      // interleave between the selection and the undo. Writers lock their
      // resolved target paths (`write-journal.ts`), and `apply_patch` locks in
      // its preflight, so locking the entries we are about to undo serializes
      // the rollback against both.
      const journalSessionIdForLock = options.sessionId?.trim();
      const lockTargets = journalSessionIdForLock
        ? selectCheckpointUndoEntries({
            workspaceRoot: journalRoot,
            checkpoint: record,
            sessionId: journalSessionIdForLock,
          }).map((entry) => entry.absPath)
        : [];
      const releaseLocks = await acquirePatchBatchLocks(lockTargets);
      let outcome: { restored: string[]; errors: string[]; journalDir: string };
      try {
        outcome = await applyCheckpointToJournal({
          workspaceRoot: journalRoot,
          checkpoint: record,
          sessionId: options.sessionId,
          now,
        });
      } finally {
        releaseLocks();
      }
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
