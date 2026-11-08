/** UAS-04: leased preflight, application-level rollback, and journal recovery. */
import { randomUUID } from "node:crypto";
import { formatErrorMessage } from "../infra/errors.js";
import {
  discardWriteJournalEntries,
  journalDirFor,
  setWriteJournalBatchState,
  snapshotPreparedWrite,
  writeJournalRecoveryRef,
  type WriteJournalEntry,
} from "./tools/write-journal.js";
import { applyUpdateHunk } from "./apply-patch-update.js";
import { recordApplyPatchEffectReceipt } from "./apply-patch-effect-receipt.js";
import {
  buildPreviewEntries,
  verifyPatchPreviewBinding,
  type ChangeSummaryEntry,
  type PreviewEntrySource,
  type VerifiedPatchPreview,
} from "./apply-patch-preview-binding.js";
import {
  ensureParentDir,
  formatCommittedSummary,
  journalEvidence,
  recordSummary,
  resolveHunks,
  rollbackTouchedPaths,
  throwAbort,
  type OriginalPathState,
  type PreflightPathOps,
  type ResolvedHunk,
  type ResolvedTarget,
} from "./apply-patch-preflight-support.js";
export type { PreflightPathOps } from "./apply-patch-preflight-support.js";
import {
  acquirePatchBatchLocks,
  normalizePatchLockPath as lockKey,
} from "./apply-patch-batch-lock.js";
export { __resetBatchLocks } from "./apply-patch-batch-lock.js";
import type {
  ApplyPatchBatchOptions,
  ApplyPatchSummary,
  Hunk,
  PatchFileOps,
} from "./apply-patch-types.js";
import { encodeTextFile, type DecodedTextFile } from "./sessions/tools/text-file-codec.js";

export type PatchBatchState = "prepared" | "committed" | "rolled_back" | "recovery_required";

export type ApplyPatchJournalEvidence = {
  batchId: string;
  batchState: PatchBatchState;
  undoable: boolean;
  /** Provenance for a commit that a read-only preview was verified against. */
  preview?: VerifiedPatchPreview;
  snapshots: Array<{
    seq: number;
    journalEntryId: string;
    path: string;
    hadPrior: boolean;
  }>;
};

export type ApplyPatchBatchResult = {
  summary: ApplyPatchSummary;
  text: string;
  batchState: PatchBatchState;
  recoveryRef?: string;
  modifiedFiles: string[];
  journal?: ApplyPatchJournalEvidence;
  /** Known file effect is distinct from the journal's durable terminal state. */
  effectApplied?: boolean;
  journalStatePersisted?: boolean;
};

type PreparedHunk =
  | { kind: "add"; target: ResolvedTarget; contents: string }
  | { kind: "delete"; target: ResolvedTarget }
  | {
      kind: "update";
      target: ResolvedTarget;
      newContent: Buffer | string;
      /** Pre-encoding post-image, so preview verification is encoding-independent. */
      newText: string;
      moveTarget?: ResolvedTarget;
    };

type VirtualPathState = {
  exists: boolean;
  decoded?: DecodedTextFile;
};

export type PreparedPatchBatch = {
  batchId: string;
  hunks: PreparedHunk[];
  originals: Map<string, OriginalPathState>;
  journalEntries: WriteJournalEntry[];
  /** Pre/post identity of every target, recomputed from what preflight actually read. */
  previewEntries: ChangeSummaryEntry[];
  release: () => void;
};

function collectTargets(hunks: ResolvedHunk[]): ResolvedTarget[] {
  const targets = new Map<string, ResolvedTarget>();
  for (const hunk of hunks) {
    targets.set(lockKey(hunk.target.resolvedPath), hunk.target);
    if (hunk.kind === "update" && hunk.moveTarget) {
      targets.set(lockKey(hunk.moveTarget.resolvedPath), hunk.moveTarget);
    }
  }
  return [...targets.values()].sort((a, b) =>
    lockKey(a.resolvedPath).localeCompare(lockKey(b.resolvedPath)),
  );
}

function encodeDecodedFile(file: DecodedTextFile): Buffer | string {
  if (file.encoding === "utf8") {
    return file.text;
  }
  if (file.encoding === "utf8-bom") {
    return `\uFEFF${file.text}`;
  }
  return encodeTextFile(file.text, file.encoding);
}

async function readOriginals(
  targets: ResolvedTarget[],
  fileOps: PatchFileOps,
): Promise<Map<string, OriginalPathState>> {
  const originals = new Map<string, OriginalPathState>();
  for (const target of targets) {
    const existed = await fileOps.exists(target.resolvedPath);
    if (!existed) {
      originals.set(lockKey(target.resolvedPath), { ...target, existed: false });
      continue;
    }
    const decoded = await fileOps.readFile(target.resolvedPath).catch((error: unknown) => {
      throw new Error(
        `Failed to read patch target ${target.resolvedPath}: ${formatErrorMessage(error)}`,
      );
    });
    originals.set(lockKey(target.resolvedPath), {
      ...target,
      existed: true,
      decoded,
      encoded: encodeDecodedFile(decoded),
    });
  }
  return originals;
}

async function precomputeHunks(
  hunks: ResolvedHunk[],
  originals: Map<string, OriginalPathState>,
  options: ApplyPatchBatchOptions,
): Promise<PreparedHunk[]> {
  const virtual = new Map<string, VirtualPathState>();
  for (const [key, original] of originals) {
    virtual.set(key, { exists: original.existed, decoded: original.decoded });
  }

  const prepared: PreparedHunk[] = [];
  for (const resolved of hunks) {
    if (options.signal?.aborted) {
      throwAbort();
    }
    const targetKey = lockKey(resolved.target.resolvedPath);
    if (resolved.kind === "add") {
      virtual.set(targetKey, {
        exists: true,
        decoded: { text: resolved.hunk.contents, encoding: "utf8" },
      });
      prepared.push({ kind: "add", target: resolved.target, contents: resolved.hunk.contents });
      continue;
    }
    if (resolved.kind === "delete") {
      if (!virtual.get(targetKey)?.exists) {
        throw new Error(`Failed to delete missing file ${resolved.target.resolvedPath}`);
      }
      virtual.set(targetKey, { exists: false });
      prepared.push({ kind: "delete", target: resolved.target });
      continue;
    }

    const source = virtual.get(targetKey);
    if (!source?.exists || !source.decoded) {
      throw new Error(
        `Failed to read file to update ${resolved.target.resolvedPath}: file not found`,
      );
    }
    const applied = await applyUpdateHunk(resolved.target.resolvedPath, resolved.hunk.chunks, {
      readFile: async () => source.decoded!.text,
    });
    const nextDecoded: DecodedTextFile = { text: applied, encoding: source.decoded.encoding };
    const newContent = encodeDecodedFile(nextDecoded);
    if (resolved.moveTarget && lockKey(resolved.moveTarget.resolvedPath) !== targetKey) {
      virtual.set(targetKey, { exists: false });
      virtual.set(lockKey(resolved.moveTarget.resolvedPath), {
        exists: true,
        decoded: nextDecoded,
      });
    } else {
      virtual.set(targetKey, { exists: true, decoded: nextDecoded });
    }
    prepared.push({
      kind: "update",
      target: resolved.target,
      newContent,
      newText: applied,
      ...(resolved.moveTarget ? { moveTarget: resolved.moveTarget } : {}),
    });
  }
  return prepared;
}

function createJournalEntries(
  batchId: string,
  originals: Map<string, OriginalPathState>,
  options: ApplyPatchBatchOptions,
): WriteJournalEntry[] {
  const journal = options.journal;
  if (!journal || journal.enabled === false) {
    return [];
  }
  const entries: WriteJournalEntry[] = [];
  for (const original of originals.values()) {
    const entry = snapshotPreparedWrite({
      workspaceRoot: journal.workspaceRoot,
      sessionId: journal.sessionId,
      filePath: original.resolvedPath,
      toolName: "apply_patch",
      requestId: journal.requestId,
      flags: journal.flags,
      batch: { id: batchId, state: "prepared" },
      hadPrior: original.existed,
      ...(original.encoded !== undefined ? { priorContent: original.encoded } : {}),
    });
    if (entry) {
      entries.push(entry);
    }
  }
  if (entries.length !== originals.size) {
    discardWriteJournalEntries(entries);
    return [];
  }
  return entries;
}

/**
 * Structural view of the prepared batch for the commit gate.
 *
 * Every field comes from what this path itself resolved, read and precomputed —
 * never from the caller. `baseEncoded` is the target's pre-batch bytes (so the
 * gate notices a file that changed on disk since the preview) and `postText` is
 * the decoded post-image (so it stays comparable with a preview reader that only
 * ever saw text). One entry per prepared hunk, matching the preview's own shape.
 */
function previewSources(
  prepared: readonly PreparedHunk[],
  originals: Map<string, OriginalPathState>,
): PreviewEntrySource[] {
  return prepared.map((hunk) => {
    const original = originals.get(lockKey(hunk.target.resolvedPath));
    const baseEncoded = original?.existed ? original.encoded : undefined;
    const base = baseEncoded === undefined ? {} : { baseEncoded };
    if (hunk.kind === "add") {
      return { change: "add", path: hunk.target.displayPath, ...base, postText: hunk.contents };
    }
    if (hunk.kind === "delete") {
      return { change: "delete", path: hunk.target.displayPath, ...base };
    }
    return {
      change: "update",
      path: hunk.target.displayPath,
      ...(hunk.moveTarget ? { movePath: hunk.moveTarget.displayPath } : {}),
      ...base,
      postText: hunk.newText,
    };
  });
}

/** Resolve and precompute the complete patch while holding every target lease. */
export async function preflightPatch(
  hunks: Hunk[],
  options: ApplyPatchBatchOptions,
  fileOps: PatchFileOps,
  pathOps: PreflightPathOps,
): Promise<PreparedPatchBatch> {
  const resolved = await resolveHunks(hunks, options, pathOps);
  const targets = collectTargets(resolved);
  const release = await acquirePatchBatchLocks(targets.map((target) => target.resolvedPath));
  try {
    const originals = await readOriginals(targets, fileOps);
    const prepared = await precomputeHunks(resolved, originals, options);
    const batchId = options.journal?.requestId?.trim() || randomUUID();
    const journalEntries = createJournalEntries(batchId, originals, options);
    return {
      batchId,
      hunks: prepared,
      originals,
      journalEntries,
      previewEntries: buildPreviewEntries(previewSources(prepared, originals)),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Apply a prepared batch and always release its target leases. */
export async function applyPreparedBatch(
  batch: PreparedPatchBatch,
  options: ApplyPatchBatchOptions,
  fileOps: PatchFileOps,
): Promise<ApplyPatchBatchResult> {
  const summary: ApplyPatchSummary = { added: [], modified: [], deleted: [] };
  const seen: Record<keyof ApplyPatchSummary, Set<string>> = {
    added: new Set(),
    modified: new Set(),
    deleted: new Set(),
  };
  const touchedKeys: string[] = [];
  const touchedDisplays = new Map<string, string>();
  const touch = (target: ResolvedTarget) => {
    const key = lockKey(target.resolvedPath);
    touchedKeys.push(key);
    touchedDisplays.set(key, target.displayPath);
  };

  // The commit gate. It runs while the batch still holds every target lease and
  // before the first write, so a refusal leaves the workspace untouched — there
  // is nothing to roll back. It must still release the leases and discard the
  // prepared snapshots on the way out, because `finally` below is only reached
  // once the mutation loop has been entered.
  let preview: VerifiedPatchPreview | undefined;
  try {
    preview = options.previewId
      ? verifyPatchPreviewBinding({ previewId: options.previewId, entries: batch.previewEntries })
      : undefined;
  } catch (gateError) {
    setWriteJournalBatchState(batch.journalEntries, "rolled_back");
    discardWriteJournalEntries(batch.journalEntries);
    batch.release();
    throw gateError;
  }

  try {
    for (const hunk of batch.hunks) {
      if (options.signal?.aborted) {
        throwAbort();
      }
      if (hunk.kind === "add") {
        await ensureParentDir(hunk.target.resolvedPath, fileOps);
        touch(hunk.target);
        await fileOps.writeFile(hunk.target.resolvedPath, hunk.contents);
        recordSummary(summary, seen, "added", hunk.target.displayPath);
        continue;
      }
      if (hunk.kind === "delete") {
        touch(hunk.target);
        await fileOps.remove(hunk.target.resolvedPath);
        recordSummary(summary, seen, "deleted", hunk.target.displayPath);
        continue;
      }

      const moveTarget = hunk.moveTarget;
      const movesToAnotherPath =
        moveTarget && lockKey(moveTarget.resolvedPath) !== lockKey(hunk.target.resolvedPath);
      const writeTarget = movesToAnotherPath ? moveTarget : hunk.target;
      await ensureParentDir(writeTarget.resolvedPath, fileOps);
      touch(writeTarget);
      await fileOps.writeFile(writeTarget.resolvedPath, hunk.newContent);
      if (movesToAnotherPath) {
        touch(hunk.target);
        await fileOps.remove(hunk.target.resolvedPath);
      }
      recordSummary(summary, seen, "modified", writeTarget.displayPath);
    }

    const journalRequested = options.journal && options.journal.enabled !== false;
    const journalStatePersisted = (!journalRequested || batch.journalEntries.length === batch.originals.size)
      && setWriteJournalBatchState(batch.journalEntries, "committed");
    if (!journalStatePersisted) {
      // The file effects already completed. Rolling them back or replaying them
      // because metadata failed would create a second, unrecorded mutation.
      const recoveryRef = writeJournalRecoveryRef(batch.journalEntries)
        ?? `${journalDirFor(options.journal!.workspaceRoot, options.journal!.sessionId ?? "default")}#batch=${encodeURIComponent(batch.batchId)}`;
      const incompleteEvidence = journalEvidence(batch, "recovery_required", preview);
      await recordApplyPatchEffectReceipt({ journal: incompleteEvidence, summary, recoveryRef });
      return {
        summary,
        text: `File writes completed, but journal terminal state was not persisted; recovery_required. Do not replay this patch. Reconcile using ${recoveryRef}.`,
        batchState: "recovery_required",
        effectApplied: true,
        journalStatePersisted: false,
        recoveryRef,
        modifiedFiles: [...summary.added, ...summary.modified, ...summary.deleted],
        ...(incompleteEvidence ? { journal: incompleteEvidence } : {}),
      };
    }
    const committedEvidence = journalEvidence(batch, "committed", preview);
    await recordApplyPatchEffectReceipt({ journal: committedEvidence, summary });
    return {
      summary,
      text: formatCommittedSummary(summary),
      batchState: "committed",
      effectApplied: true,
      journalStatePersisted: journalRequested ? true : undefined,
      modifiedFiles: [...summary.added, ...summary.modified, ...summary.deleted],
      ...(committedEvidence ? { journal: committedEvidence } : {}),
    };
  } catch (applyError) {
    const unrestored = await rollbackTouchedPaths(touchedKeys, batch.originals, fileOps);
    let batchState: PatchBatchState =
      unrestored.length === 0 ? "rolled_back" : "recovery_required";
    const journalStatePersisted = setWriteJournalBatchState(batch.journalEntries, batchState);
    if (!journalStatePersisted) batchState = "recovery_required";
    if (batchState === "rolled_back") {
      discardWriteJournalEntries(batch.journalEntries);
    }
    const recoveryRef =
      batchState === "recovery_required"
        ? (writeJournalRecoveryRef(batch.journalEntries) ?? `unrestored:${unrestored.join(",")}`)
        : undefined;
    const modifiedFiles = [...touchedDisplays.values()];
    const text =
      batchState === "rolled_back"
        ? `Patch failed and was rolled back: ${formatErrorMessage(applyError)}`
        : unrestored.length === 0
          ? `File effects were rolled back, but journal terminal state was not persisted; recovery_required. Do not replay. Recovery ref: ${recoveryRef}.`
        : `Patch failed and rollback was incomplete; recovery_required. Recovery ref: ${recoveryRef}. Error: ${formatErrorMessage(applyError)}`;
    const failedEvidence = journalEvidence(batch, batchState, preview);
    const failedSummary: ApplyPatchSummary = { added: [], modified: [], deleted: [] };
    await recordApplyPatchEffectReceipt({
      journal: failedEvidence,
      summary: failedSummary,
      ...(recoveryRef ? { recoveryRef } : {}),
    });
    return {
      summary: failedSummary,
      text,
      batchState,
      effectApplied: unrestored.length === 0 ? false : undefined,
      journalStatePersisted,
      ...(recoveryRef ? { recoveryRef } : {}),
      modifiedFiles,
      ...(failedEvidence ? { journal: failedEvidence } : {}),
    };
  } finally {
    batch.release();
  }
}
