/**
 * Checkpoint content diff (Cline checkpoint-diff parity, journal-backed).
 *
 * Shows what restoring a checkpoint would change: for every write-journal
 * entry after the checkpoint boundary (same selection as
 * `applyCheckpointToJournal`), compare the journal pre-image (the file state
 * at the checkpoint instant) against the current file content and produce a
 * unified diff. No git snapshot required — the journal `.pre` snapshots are
 * the source of truth, so this works on non-git workspaces too.
 */
import { existsSync, readFileSync } from "node:fs";
import { getOrCreateWriteJournal, journalDirFor } from "./tools/write-journal.js";
import { generateUnifiedPatch } from "./sessions/tools/edit-diff.js";
import type { LongTaskCheckpointRecord } from "./long-task-control/store.js";

export type CheckpointFileDiffEntry = {
  /** Workspace-relative path of the affected file. */
  filePath: string;
  /** What restoring the checkpoint does to this file. */
  status: "modified" | "created" | "deleted";
  /** Unified diff: checkpoint-side state vs current state. */
  unifiedDiff: string;
};

export type CheckpointDiffResult = {
  files: CheckpointFileDiffEntry[];
  errors: string[];
};

/**
 * Resolve the journal seq boundary stamped on the checkpoint (same rule as
 * `applyCheckpointToJournal`): `metadata.journalSeq` when present, otherwise
 * the createdAt timestamp as a fallback.
 */
export function resolveCheckpointJournalBoundary(
  checkpoint: LongTaskCheckpointRecord,
): number | undefined {
  const metadata = checkpoint.checkpoint.metadata;
  const rawSeq =
    metadata && typeof metadata === "object" && "journalSeq" in metadata
      ? (metadata as Record<string, unknown>).journalSeq
      : undefined;
  return typeof rawSeq === "number" && Number.isFinite(rawSeq) ? rawSeq : undefined;
}

export function checkpointContentDiff(params: {
  workspaceRoot: string;
  checkpoint: LongTaskCheckpointRecord;
  /**
   * Journal session id — the agent session UUID. Required for the same reason
   * as `applyCheckpointToJournal`: the canonical session key addresses a
   * *different* journal directory (#176).
   */
  sessionId?: string;
}): CheckpointDiffResult {
  const journalSessionId = params.sessionId?.trim();
  if (!journalSessionId) {
    return {
      files: [],
      errors: [
        "journal_session_id_missing: pass the agent session id (UUID); the canonical session key addresses a different journal directory (#176)",
      ],
    };
  }
  const journalDir = journalDirFor(params.workspaceRoot, journalSessionId);
  if (!existsSync(journalDir)) {
    // #176: an empty diff was indistinguishable from "nothing to restore",
    // which removed the only warning the operator gets before a restore.
    return { files: [], errors: [`no_journal_for_session: ${journalDir}`] };
  }
  const journal = getOrCreateWriteJournal(params.workspaceRoot, journalSessionId);
  const seqBoundary = resolveCheckpointJournalBoundary(params.checkpoint);
  const at = Date.parse(params.checkpoint.checkpoint.createdAt);
  // Same entry selection as the rollback executor: everything the rollback
  // would undo is exactly what the diff should surface.
  const toUndo =
    seqBoundary !== undefined
      ? journal.entries.filter((entry) => entry.seq > seqBoundary)
      : journal.entries.filter((entry) => entry.createdAtMs >= at);

  const files: CheckpointFileDiffEntry[] = [];
  const errors: string[] = [];
  for (const entry of toUndo) {
    const currentExists = existsSync(entry.absPath);
    let current: string | undefined;
    if (currentExists) {
      try {
        current = readFileSync(entry.absPath, "utf8");
      } catch (error) {
        errors.push(`cannot read ${entry.absPath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    let target: string | undefined;
    if (entry.hadPrior) {
      try {
        target = readFileSync(entry.snapshotPath, "utf8");
      } catch (error) {
        errors.push(`snapshot missing for ${entry.relPath}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    } else {
      // Created after the boundary: the checkpoint instant had no such file.
      target = "";
    }
    if (current === target) {
      continue; // unchanged since the checkpoint instant
    }
    if (!entry.hadPrior && current === undefined) {
      continue; // created then removed again — nothing to show
    }
    const status = entry.hadPrior
      ? current === undefined
        ? "deleted"
        : "modified"
      : "created";
    files.push({
      filePath: entry.relPath,
      status,
      unifiedDiff: generateUnifiedPatch(
        entry.relPath,
        target,
        current ?? "",
        4,
        entry.hadPrior ? "modified" : "added",
      ),
    });
  }
  return { files, errors };
}
