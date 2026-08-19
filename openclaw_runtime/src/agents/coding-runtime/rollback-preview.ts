/**
 * P1 UFTK: read-only rollback diff preview.
 *
 * Builds one unified diff from the current disk state back to the write-journal
 * pre-image for each retained entry. No target file or journal sidecar is
 * modified here.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { CodingRollbackFileOutcome, FileVersion } from "../../../../shared/coding-runtime/types.js";
import type { WriteJournalEntry } from "../tools/write-journal.js";
import { hashFileContent } from "../tools/write-journal.js";
import { generateUnifiedPatch } from "../sessions/tools/edit-diff.js";
import { decodeTextFile } from "../sessions/tools/text-file-codec.js";

export type RollbackPreview = {
  diff: string;
  files: CodingRollbackFileOutcome[];
};

async function readVersion(absPath: string, relPath: string): Promise<FileVersion | undefined> {
  try {
    const st = await stat(absPath);
    if (!st.isFile()) return undefined;
    const bytes = await readFile(absPath);
    return {
      path: relPath,
      contentHash: hashFileContent(bytes),
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
  } catch {
    return undefined;
  }
}

function patchForEntry(
  relPath: string,
  currentBytes: Buffer | undefined,
  restoredBytes: Buffer | undefined,
): string {
  if (!currentBytes && !restoredBytes) return "";
  try {
    const currentText = currentBytes
      ? decodeTextFile(currentBytes, relPath).text
      : "";
    const restoredText = restoredBytes
      ? decodeTextFile(restoredBytes, relPath).text
      : "";
    if (currentText === restoredText) return "";
    const fileStatus = !restoredBytes ? "deleted" : !currentBytes ? "added" : "modified";
    return generateUnifiedPatch(relPath, currentText, restoredText, 3, fileStatus);
  } catch {
    return `diff --git a/${relPath} b/${relPath}\nBinary files ${relPath} differ\n`;
  }
}

/** Compute the read-only unified preview for one retained journal entry set. */
export async function buildRollbackPreview(
  entries: WriteJournalEntry[],
): Promise<RollbackPreview> {
  const ordered = [...entries].sort((a, b) => b.seq - a.seq);
  const files: CodingRollbackFileOutcome[] = [];
  const diffs: string[] = [];

  for (const entry of ordered) {
    const currentBytes = existsSync(entry.absPath) ? await readFile(entry.absPath) : undefined;
    const restoredBytes =
      entry.hadPrior && existsSync(entry.snapshotPath)
        ? await readFile(entry.snapshotPath)
        : undefined;
    const beforeVersion = await readVersion(entry.absPath, entry.relPath);
    const afterVersion =
      entry.hadPrior && existsSync(entry.snapshotPath)
        ? await readVersion(entry.snapshotPath, entry.relPath)
        : undefined;
    const beforeHash = beforeVersion?.contentHash ?? null;
    const afterHash = afterVersion?.contentHash ?? null;
    files.push({
      path: entry.relPath,
      status: entry.hadPrior ? "restored" : "removed",
      beforeHash,
      afterHash,
      ...(beforeVersion ? { beforeVersion } : {}),
      ...(afterVersion ? { afterVersion } : {}),
    });
    const diff = patchForEntry(entry.relPath, currentBytes, restoredBytes);
    if (diff) diffs.push(diff);
  }

  // A missing snapshot means the preview cannot prove the restore bytes.
  for (const entry of ordered) {
    if (entry.hadPrior && !existsSync(entry.snapshotPath)) {
      throw new Error(`journal snapshot missing: ${entry.snapshotPath}`);
    }
  }

  return { diff: diffs.join("\n"), files };
}
