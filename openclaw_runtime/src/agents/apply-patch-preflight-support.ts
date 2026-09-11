/**
 * Leaf helpers split out of `apply-patch-preflight.ts` so that file stays under
 * the 500-line ceiling enforced by `check:loc`. Behavior-preserving: these are
 * the same functions, moved verbatim apart from their exports.
 */
import path from "node:path";
import { PATH_ALIAS_POLICIES, type PathAliasPolicy } from "../infra/path-alias-guards.js";
import { journalEntryId } from "./tools/write-journal.js";
import type {
  ApplyPatchBatchOptions,
  ApplyPatchSummary,
  Hunk,
  PatchFileOps,
} from "./apply-patch-types.js";
import type { VerifiedPatchPreview } from "./apply-patch-preview-binding.js";
import type {
  ApplyPatchJournalEvidence,
  PatchBatchState,
  PreparedPatchBatch,
} from "./apply-patch-preflight.js";

export type ResolvedTarget = {
  displayPath: string;
  resolvedPath: string;
};

export type ResolvedHunk =
  | { kind: "add"; hunk: Extract<Hunk, { kind: "add" }>; target: ResolvedTarget }
  | { kind: "delete"; hunk: Extract<Hunk, { kind: "delete" }>; target: ResolvedTarget }
  | {
      kind: "update";
      hunk: Extract<Hunk, { kind: "update" }>;
      target: ResolvedTarget;
      moveTarget?: ResolvedTarget;
    };

export type PreflightPathOps = {
  resolvePath: (
    filePath: string,
    aliasPolicy?: PathAliasPolicy,
  ) => Promise<{ resolved: string; display: string }>;
  assertParentPath: (filePath: string) => Promise<void>;
};

export type OriginalPathState = ResolvedTarget & {
  existed: boolean;
  decoded?: import("./sessions/tools/text-file-codec.js").DecodedTextFile;
  encoded?: Buffer | string;
};

export function recordSummary(
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

export function journalEvidence(
  batch: PreparedPatchBatch,
  batchState: PatchBatchState,
  preview?: VerifiedPatchPreview,
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
    ...(preview ? { preview } : {}),
    snapshots: batch.journalEntries.map((entry) => ({
      seq: entry.seq,
      journalEntryId: journalEntryId(sessionId, entry.seq),
      path: entry.relPath,
      hadPrior: entry.hadPrior,
    })),
  };
}

export function formatCommittedSummary(summary: ApplyPatchSummary): string {
  const lines = ["Success. Updated the following files:"];
  for (const file of summary.added) lines.push(`A ${file}`);
  for (const file of summary.modified) lines.push(`M ${file}`);
  for (const file of summary.deleted) lines.push(`D ${file}`);
  return lines.join("\n");
}

export async function ensureParentDir(
  filePath: string,
  fileOps: PatchFileOps,
): Promise<void> {
  const parent = path.dirname(filePath);
  if (parent && parent !== ".") {
    await fileOps.mkdirp(parent);
  }
}

export function throwAbort(): never {
  const error = new Error("Aborted");
  error.name = "AbortError";
  throw error;
}

export async function resolveHunks(
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

/**
 * Best-effort restoration after a mid-batch failure. Paths are restored newest
 * first and each key only once; anything that cannot be put back is reported so
 * the caller can escalate `rolled_back` to `recovery_required`.
 */
export async function rollbackTouchedPaths(
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
