/**
 * P1 UFTK: unified atomic file write.
 *
 * Writes go through a temp file in the target directory, fsync, close, and
 * rename. There is intentionally no delete-target-then-rename fallback: if a
 * platform cannot replace the target atomically the write fails closed and
 * the original target is left untouched.
 */
import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { restoreLineEndings, type LineEnding } from "../sessions/tools/edit-diff.js";
import { encodeTextFile, type TextFileEncoding } from "../sessions/tools/text-file-codec.js";

export function atomicWriteTempPath(targetPath: string, id = randomUUID()): string {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  return path.join(dir, `${base}.uftk-${id}.tmp`);
}

export type AtomicTextWriteOptions = {
  encoding?: TextFileEncoding;
  /**
   * Line endings to restore into `text` before encoding. Omit to preserve the
   * caller's exact string bytes (the existing `write` tool UTF-8 contract).
   */
  lineEndings?: LineEnding | readonly LineEnding[];
};

/** Encode text with the same codec/line-ending rules as the existing tools. */
export function encodeAtomicText(text: string, options: AtomicTextWriteOptions = {}): Buffer {
  const encoding = options.encoding ?? "utf8";
  const withEndings =
    options.lineEndings === undefined ? text : restoreLineEndings(text, options.lineEndings);
  return encodeTextFile(withEndings, encoding);
}

/**
 * Atomically replace `targetPath` with `data`.
 *
 * @throws if open/write/fsync/close/rename fails. The temp file is removed on
 * every failure path and the existing target is never removed before rename.
 */
export async function writeFileAtomic(targetPath: string, data: Buffer | string): Promise<void> {
  const resolvedTarget = path.resolve(targetPath);
  const tempPath = atomicWriteTempPath(resolvedTarget);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "wx", 0o666);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Node uses MoveFileExW(MOVEFILE_REPLACE_EXISTING) on Windows. If that
    // fails (EPERM/EEXIST/EBUSY), fail closed; never unlink the target first.
    await rename(tempPath, resolvedTarget);
    codingObservability.recordAtomicWrite(true);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await rm(tempPath, { force: true }).catch(() => {});
    codingObservability.recordAtomicWrite(false);
    throw error;
  }
}

/** Atomically write decoded text using text-file-codec + edit-diff line endings. */
export async function writeTextFileAtomic(
  targetPath: string,
  text: string,
  options: AtomicTextWriteOptions = {},
): Promise<void> {
  await writeFileAtomic(targetPath, encodeAtomicText(text, options));
}
