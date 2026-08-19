/** UAS-04: leased preflight, application-level rollback, and journal recovery. */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { formatErrorMessage } from "../infra/errors.js";
import { PATH_ALIAS_POLICIES, type PathAliasPolicy } from "../infra/path-alias-guards.js";
import {
  discardWriteJournalEntries,
  hashFileContent,
  journalEntryId,
  setWriteJournalBatchState,
  snapshotPreparedWrite,
  writeJournalRecoveryRef,
  type WriteJournalEntry,
} from "./tools/write-journal.js";
import { applyUpdateHunk } from "./apply-patch-update.js";
import { normalizePatchLockPath as lockKey } from "./apply-patch-batch-lock.js";
export { resetCodingRuntimeFileLocksForTest as __resetBatchLocks } from "./coding-runtime/file-lock-manager.js";
import { acquireCodingRuntimeFileLocks } from "./coding-runtime/file-lock-manager.js";
import type { FileVersion } from "../../../shared/coding-runtime/types.js";
import { CodingRuntimeError } from "./coding-runtime/coding-runtime-error.js";
import { buildVersionConflictDiff } from "./coding-runtime/turn-diff.js";
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
};

type ResolvedTarget = {
  displayPath: string;
  resolvedPath: string;
};

type ResolvedHunk =
  | { kind: "add"; hunk: Extract<Hunk, { kind: "add" }>; target: ResolvedTarget }
  | { kind: "delete"; hunk: Extract<Hunk, { kind: "delete" }>; target: ResolvedTarget }
  | {
      kind: "update";
      hunk: Extract<Hunk, { kind: "update" }>;
      target: ResolvedTarget;
      moveTarget?: ResolvedTarget;
    };

type PreparedHunk =
  | { kind: "add"; target: ResolvedTarget; contents: string }
  | { kind: "delete"; target: ResolvedTarget }
  | {
      kind: "update";
      target: ResolvedTarget;
      newContent: Buffer | string;
      moveTarget?: ResolvedTarget;
    };

type OriginalPathState = ResolvedTarget & {
  existed: boolean;
  decoded?: DecodedTextFile;
  encoded?: Buffer | string;
  version?: { contentHash: string; mtimeMs: number; size: number };
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
  release: () => void;
};

export type PreflightPathOps = {
  resolvePath: (
    filePath: string,
    aliasPolicy?: PathAliasPolicy,
  ) => Promise<{ resolved: string; display: string }>;
  assertParentPath: (filePath: string) => Promise<void>;
};

async function resolveHunks(
  hunks: Hunk[],
  options: ApplyPatchBatchOptions,
  pathOps: PreflightPathOps,
): Promise<ResolvedHunk[]> {
  const resolved: ResolvedHunk[] = [];
  for (const hunk of hunks) {
    if (options.signal?.aborted) {
      throwAbort();
    }
    if (hunk.kind === "add") {
      const target = await pathOps.resolvePath(hunk.path);
      await pathOps.assertParentPath(hunk.path);
      resolved.push({
        kind: "add",
        hunk,
        target: { displayPath: target.display, resolvedPath: target.resolved },
      });
      continue;
    }
    if (hunk.kind === "delete") {
      const target = await pathOps.resolvePath(hunk.path, PATH_ALIAS_POLICIES.unlinkTarget);
      resolved.push({
        kind: "delete",
        hunk,
        target: { displayPath: target.display, resolvedPath: target.resolved },
      });
      continue;
    }

    const target = await pathOps.resolvePath(hunk.path);
    let moveTarget: ResolvedTarget | undefined;
    if (hunk.movePath) {
      const move = await pathOps.resolvePath(hunk.movePath);
      await pathOps.assertParentPath(hunk.movePath);
      moveTarget = { displayPath: move.display, resolvedPath: move.resolved };
    }
    resolved.push({
      kind: "update",
      hunk,
      target: { displayPath: target.display, resolvedPath: target.resolved },
      ...(moveTarget ? { moveTarget } : {}),
    });
  }
  return resolved;
}

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
    const encoded = encodeDecodedFile(decoded);
    const stat = await fileOps.stat?.(target.resolvedPath).catch(() => undefined) ?? undefined;
    const bytes = typeof encoded === "string" ? Buffer.from(encoded, "utf8") : encoded;
    originals.set(lockKey(target.resolvedPath), {
      ...target,
      existed: true,
      decoded,
      encoded,
      version: {
        contentHash: hashFileContent(bytes),
        mtimeMs: stat?.mtimeMs ?? 0,
        size: stat?.size ?? bytes.byteLength,
      },
    });
  }
  return originals;
}

function normalizedVersionPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function versionPathsMatch(left: string, right: string): boolean {
  return normalizedVersionPath(left) === normalizedVersionPath(right);
}

function findOriginalForBaseVersion(
  originals: Map<string, OriginalPathState>,
  expected: FileVersion,
): OriginalPathState | undefined {
  for (const original of originals.values()) {
    if (
      versionPathsMatch(original.displayPath, expected.path) ||
      versionPathsMatch(path.relative(process.cwd(), original.resolvedPath), expected.path)
    ) {
      return original;
    }
  }
  return undefined;
}

function fileVersionMatches(expected: FileVersion, current: OriginalPathState["version"]): boolean {
  if (!current) return false;
  if (expected.contentHash !== current.contentHash) return false;
  if (expected.size !== current.size) return false;
  // mtimeMs is skipped when the fileOps layer cannot stat (sandbox/custom
  // ops); contentHash + size still provide the optimistic-concurrency guard.
  return current.mtimeMs === 0 || expected.mtimeMs === current.mtimeMs;
}

function assertApplyPatchBaseVersions(
  originals: Map<string, OriginalPathState>,
  baseVersions: readonly FileVersion[] | undefined,
): void {
  if (!baseVersions || baseVersions.length === 0) return;
  for (const expected of [...baseVersions].toSorted((a, b) =>
    normalizedVersionPath(a.path).localeCompare(normalizedVersionPath(b.path)),
  )) {
    const original = findOriginalForBaseVersion(originals, expected);
    const current = original?.version;
    if (fileVersionMatches(expected, current)) continue;
    const pathLabel =
      original?.displayPath ??
      normalizedVersionPath(expected.path);
    throw new CodingRuntimeError({
      code: "E_CONFLICT",
      message: `Base version changed for ${pathLabel}`,
      path: pathLabel,
      baseVersion: expected,
      ...(current
        ? {
            currentVersion: {
              path: pathLabel,
              ...current,
            },
          }
        : {}),
      diff: buildVersionConflictDiff({
        path: pathLabel,
        baseVersion: expected,
        ...(current
          ? {
              currentVersion: {
                path: pathLabel,
                ...current,
              },
            }
          : {}),
        ...(original?.decoded !== undefined ? { currentText: original.decoded.text } : {}),
      }),
    });
  }
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
      kind: "apply_patch",
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

/** Resolve and precompute the complete patch while holding every target lease. */
export async function preflightPatch(
  hunks: Hunk[],
  options: ApplyPatchBatchOptions,
  fileOps: PatchFileOps,
  pathOps: PreflightPathOps,
): Promise<PreparedPatchBatch> {
  const resolved = await resolveHunks(hunks, options, pathOps);
  const targets = collectTargets(resolved);
  const lockHandle = await acquireCodingRuntimeFileLocks(
    targets.map((target) => target.resolvedPath),
    {
      mode: "write",
      owner: options.journal?.sessionId?.trim() || `apply_patch:${process.pid}`,
    },
  );
  const release = () => {
    void lockHandle.release();
  };
  try {
    const originals = await readOriginals(targets, fileOps);
    assertApplyPatchBaseVersions(originals, options.baseVersions);
    const prepared = await precomputeHunks(resolved, originals, options);
    const batchId = options.journal?.requestId?.trim() || randomUUID();
    const journalEntries = createJournalEntries(batchId, originals, options);
    return { batchId, hunks: prepared, originals, journalEntries, release };
  } catch (error) {
    release();
    throw error;
  }
}

function recordSummary(
  summary: ApplyPatchSummary,
  seen: Record<keyof ApplyPatchSummary, Set<string>>,
  bucket: keyof ApplyPatchSummary,
  value: string,
): void {
  if (!seen[bucket].has(value)) {
    seen[bucket].add(value);
    summary[bucket].push(value);
  }
}

function journalEvidence(
  batch: PreparedPatchBatch,
  batchState: PatchBatchState,
): ApplyPatchJournalEvidence | undefined {
  const first = batch.journalEntries[0];
  if (!first) {
    return undefined;
  }
  const sessionId = first.lineage?.sessionId ?? "default";
  return {
    batchId: batch.batchId,
    batchState,
    undoable: batchState === "committed" || batchState === "recovery_required",
    snapshots: batch.journalEntries.map((entry) => ({
      seq: entry.seq,
      journalEntryId: journalEntryId(sessionId, entry.seq),
      path: entry.relPath,
      hadPrior: entry.hadPrior,
    })),
  };
}

async function rollbackTouchedPaths(
  touchedKeys: string[],
  originals: Map<string, OriginalPathState>,
  fileOps: PatchFileOps,
): Promise<string[]> {
  const unrestored: string[] = [];
  const restored = new Set<string>();
  for (const key of touchedKeys.toReversed()) {
    if (restored.has(key)) {
      continue;
    }
    restored.add(key);
    const original = originals.get(key);
    if (!original) {
      unrestored.push(key);
      continue;
    }
    try {
      if (original.existed) {
        await ensureParentDir(original.resolvedPath, fileOps);
        await fileOps.writeFile(original.resolvedPath, original.encoded!);
      } else if (await fileOps.exists(original.resolvedPath)) {
        await fileOps.remove(original.resolvedPath);
      }
    } catch {
      unrestored.push(original.resolvedPath);
    }
  }
  return unrestored;
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

    setWriteJournalBatchState(batch.journalEntries, "committed");
    return {
      summary,
      text: formatCommittedSummary(summary),
      batchState: "committed",
      modifiedFiles: [...summary.added, ...summary.modified, ...summary.deleted],
      ...(journalEvidence(batch, "committed")
        ? { journal: journalEvidence(batch, "committed") }
        : {}),
    };
  } catch (applyError) {
    const unrestored = await rollbackTouchedPaths(touchedKeys, batch.originals, fileOps);
    const batchState: PatchBatchState =
      unrestored.length === 0 ? "rolled_back" : "recovery_required";
    setWriteJournalBatchState(batch.journalEntries, batchState);
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
        : `Patch failed and rollback was incomplete; recovery_required. Recovery ref: ${recoveryRef}. Error: ${formatErrorMessage(applyError)}`;
    return {
      summary: { added: [], modified: [], deleted: [] },
      text,
      batchState,
      ...(recoveryRef ? { recoveryRef } : {}),
      modifiedFiles,
      ...(journalEvidence(batch, batchState)
        ? { journal: journalEvidence(batch, batchState) }
        : {}),
    };
  } finally {
    batch.release();
  }
}

function formatCommittedSummary(summary: ApplyPatchSummary): string {
  const lines = ["Success. Updated the following files:"];
  for (const file of summary.added) lines.push(`A ${file}`);
  for (const file of summary.modified) lines.push(`M ${file}`);
  for (const file of summary.deleted) lines.push(`D ${file}`);
  return lines.join("\n");
}

async function ensureParentDir(filePath: string, fileOps: PatchFileOps): Promise<void> {
  const parent = path.dirname(filePath);
  if (parent && parent !== ".") {
    await fileOps.mkdirp(parent);
  }
}

function throwAbort(): never {
  const error = new Error("Aborted");
  error.name = "AbortError";
  throw error;
}
