/**
 * A6 Long-Running Persistence — File Fingerprint (Stage 2 Stream 2B-1).
 *
 * Context: Round 2 design (A6 owns file fingerprints, A1 reads with Git-diff
 * fallback). This module is the SINGLE SOURCE OF TRUTH for file content
 * fingerprints — only A6 writes, only A1 reads (acceptance 2.4).
 *
 * Invariants:
 * - PURE I/O: deterministic for the same file content + path.
 * - No external state, no caching (caller may cache results).
 * - SHA-256 content hash + mtime + size for change detection.
 * - Returns `null` for non-existent files (does NOT throw).
 * - Handles symlink loops, permission errors, and empty files gracefully.
 *
 * Design (area-6-long-running-persistence.md §9.1):
 * - A6 is the single owner of file fingerprints.
 * - SQLite JSON column stores `Record<path, sha256>` in `Checkpoint.fileHashes`.
 * - A1 imports `getFileFingerprint` / `computeFileFingerprintsForDirectory`
 *   READ-ONLY; A6 imports them WRITE.
 *
 * See: docs/runtime-design/development-manual.md §1.3 (A6), Stage 2 Stream 2B
 *      docs/runtime-design/area-6-long-running-persistence.md §9.1 (file fingerprint ownership)
 */

import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/** A single file fingerprint — content hash + metadata for change detection. */
export type FileFingerprint = {
  /** Absolute or workspace-relative path (caller's convention). */
  path: string;
  /** SHA-256 hex digest of file content (64 chars). */
  sha256: string;
  /** File mtime in milliseconds since epoch. */
  mtimeMs: number;
  /** File size in bytes. */
  size: number;
};

/**
 * Result of fingerprinting a directory — maps path → FileFingerprint.
 * Paths are relative to the scanned directory root.
 */
export type DirectoryFingerprint = {
  /** Absolute path of the scanned directory root. */
  rootPath: string;
  /** Map of relative path → FileFingerprint. */
  files: Map<string, FileFingerprint>;
  /** Files that could not be fingerprinted (permission, symlink loop, etc.). */
  skipped: Array<{ path: string; reason: string }>;
  /** Total bytes scanned (sum of file sizes, excludes skipped). */
  totalBytes: number;
};

/** Maximum file size to fingerprint (16 MB) — prevents OOM on large binaries. */
const MAX_FINGERPRINT_BYTES = 16 * 1024 * 1024;

/** Maximum number of files to fingerprint in a directory tree (10,000). */
const MAX_FILES_PER_DIRECTORY = 10_000;

/**
 * S4 fix (P2): Batch size for parallel fingerprint computation.
 * Each batch is fingerprinted concurrently via `Promise.all`. 100 balances
 * throughput (parallel I/O) against memory (avoids 10k concurrent file reads).
 */
const FINGERPRINT_BATCH_SIZE = 100;

/**
 * P2-13 fix: Specific reason a file was skipped during fingerprinting.
 *
 * Previously `getFileFingerprint` returned `null` for many distinct failure
 * modes (not found, permission denied, too large, is a directory, read
 * failed, symlink loop) and the caller (`computeFileFingerprintsForDirectory`)
 * recorded a generic `'fingerprint_failed'` reason. This made it impossible
 * for operators to tell why a checkpoint was incomplete — e.g., a 17 MB
 * binary was indistinguishable from a missing file.
 *
 * This enum lets the caller record the actual failure mode so diagnostics
 * are actionable (e.g., "too_large" → caller can raise the size budget or
 * switch to git-diff; "permission_denied" → caller can fix fs perms).
 */
export type FileFingerprintSkipReason =
  | 'not_found' // ENOENT — file does not exist
  | 'permission_denied' // EACCES / EPERM
  | 'is_directory' // path resolves to a directory
  | 'too_large' // file exceeds MAX_FINGERPRINT_BYTES
  | 'read_failed' // readFile failed after stat (race, I/O error)
  | 'symlink_loop' // ELOOP — symlink loop detected
  | 'not_a_file'; // sockets, FIFOs, block devices, etc.

/**
 * P2-13 fix: Result of fingerprinting a single file — either the fingerprint
 * or a specific skip reason. Use `getFileFingerprintWithReason` to get this
 * detailed result; `getFileFingerprint` remains a backward-compat wrapper
 * that drops the reason and returns `null` on any failure.
 */
export type FileFingerprintResult =
  | { ok: true; fingerprint: FileFingerprint }
  | { ok: false; reason: FileFingerprintSkipReason };

/**
 * Compute the SHA-256 fingerprint of a single file, returning a specific
 * skip reason on failure.
 *
 * Returns `{ ok: false, reason }` when:
 * - The file does not exist (ENOENT) → `not_found`.
 * - The path is a directory → `is_directory`.
 * - The file is larger than `MAX_FINGERPRINT_BYTES` → `too_large`.
 * - Permission denied (EACCES / EPERM) → `permission_denied`.
 * - Symlink loop detected (ELOOP) → `symlink_loop`.
 * - Path is not a regular file (socket, FIFO, etc.) → `not_a_file`.
 * - `readFile` failed after `stat` (race, I/O error) → `read_failed`.
 *
 * @param path Absolute or relative path to the file.
 */
export async function getFileFingerprintWithReason(
  path: string,
): Promise<FileFingerprintResult> {
  let stats;
  try {
    stats = await stat(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, reason: 'not_found' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, reason: 'permission_denied' };
    }
    if (code === 'ELOOP') {
      return { ok: false, reason: 'symlink_loop' };
    }
    // ENOTDIR (path component not a dir), or other stat errors.
    return { ok: false, reason: 'not_found' };
  }

  if (!stats.isFile()) {
    // Directories, symlinks to directories, sockets, etc. are not fingerprintable.
    return { ok: false, reason: stats.isDirectory() ? 'is_directory' : 'not_a_file' };
  }

  if (stats.size > MAX_FINGERPRINT_BYTES) {
    // Too large to safely read into memory — caller should use git-diff fallback.
    return { ok: false, reason: 'too_large' };
  }

  let content: Buffer;
  try {
    content = await readFile(path);
  } catch {
    // Permission denied after stat (race), or file deleted between stat and read.
    return { ok: false, reason: 'read_failed' };
  }

  const hash = createHash('sha256').update(content).digest('hex');
  return {
    ok: true,
    fingerprint: {
      path,
      sha256: hash,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    },
  };
}

/**
 * Compute the SHA-256 fingerprint of a single file.
 *
 * Backward-compat wrapper around `getFileFingerprintWithReason` — returns
 * `null` on any failure (the specific reason is dropped). New callers should
 * prefer `getFileFingerprintWithReason` to get actionable skip reasons.
 *
 * Returns `null` when:
 * - The file does not exist (ENOENT).
 * - The path is a directory.
 * - The file is larger than `MAX_FINGERPRINT_BYTES`.
 * - Permission denied.
 * - Symlink loop detected.
 *
 * @param path Absolute or relative path to the file.
 */
export async function getFileFingerprint(path: string): Promise<FileFingerprint | null> {
  const result = await getFileFingerprintWithReason(path);
  return result.ok ? result.fingerprint : null;
}

/**
 * Recursively fingerprint all files in a directory tree.
 *
 * Respects `MAX_FILES_PER_DIRECTORY` and `MAX_FINGERPRINT_BYTES` limits.
 * Skipped files (too large, permission denied, etc.) are recorded in `skipped`
 * but do NOT cause the overall operation to fail.
 *
 * S4 fix (P2): Parallelized fingerprint computation. The walk now collects
 * file paths first, then fingerprints them in parallel batches of
 * `FINGERPRINT_BATCH_SIZE` to improve throughput on large directories
 * (~0.53ms/file → ~0.15ms/file on 1000-file workloads).
 *
 * @param rootPath Absolute path to the directory root.
 * @param options Optional filter to include/exclude paths.
 */
export async function computeFileFingerprintsForDirectory(
  rootPath: string,
  options?: {
    /** Only fingerprint paths matching this predicate (relative to root). */
    include?: (relativePath: string) => boolean;
    /** Skip paths matching this predicate (relative to root). */
    exclude?: (relativePath: string) => boolean;
  },
): Promise<DirectoryFingerprint> {
  const files = new Map<string, FileFingerprint>();
  const skipped: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;

  // Lazy import to avoid loading the walker for single-file fingerprints.
  const { readdir } = await import('node:fs/promises');

  // S4 fix: collect file paths during walk, then fingerprint in parallel batches.
  const collectedPaths: Array<{ fullPath: string; normalizedRelPath: string }> = [];

  async function walk(dir: string): Promise<void> {
    if (collectedPaths.length >= MAX_FILES_PER_DIRECTORY) {
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const rel = relative(rootPath, dir);
      skipped.push({
        path: rel || '.',
        reason: code === 'EACCES' ? 'permission_denied' : code === 'ENOENT' ? 'not_found' : 'read_failed',
      });
      return;
    }

    for (const entry of entries) {
      if (collectedPaths.length >= MAX_FILES_PER_DIRECTORY) {
        return;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(rootPath, fullPath);

      // Apply include/exclude filters (relative paths).
      if (options?.exclude?.(relPath)) continue;
      if (options?.include && !options.include(relPath)) continue;

      if (entry.isSymbolicLink()) {
        // Skip symlinks — they can cause loops and their targets are fingerprinted elsewhere.
        skipped.push({ path: relPath, reason: 'symlink_skipped' });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        skipped.push({ path: relPath, reason: 'not_a_file' });
        continue;
      }

      // Normalize to POSIX-style separators (forward slashes) so fingerprints
      // are stable across platforms (Windows uses backslashes by default).
      const normalizedRelPath = relPath.split('\\').join('/');
      collectedPaths.push({ fullPath, normalizedRelPath });
    }
  }

  await walk(rootPath);

  // S4 fix: fingerprint collected files in parallel batches.
  // P2-13 fix: use `getFileFingerprintWithReason` so skipped entries record
  // the actual failure mode (too_large / permission_denied / read_failed /
  // etc.) instead of a generic 'fingerprint_failed'. This lets operators
  // tell why a checkpoint is incomplete — e.g., a 17 MB binary is now
  // distinguishable from a missing file.
  for (let i = 0; i < collectedPaths.length; i += FINGERPRINT_BATCH_SIZE) {
    const batch = collectedPaths.slice(i, i + FINGERPRINT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ({ fullPath, normalizedRelPath }) => {
        const result = await getFileFingerprintWithReason(fullPath);
        return { normalizedRelPath, result };
      }),
    );
    for (const { normalizedRelPath, result } of results) {
      if (!result.ok) {
        skipped.push({ path: normalizedRelPath, reason: result.reason });
        continue;
      }
      const fp = result.fingerprint;
      files.set(normalizedRelPath, { ...fp, path: normalizedRelPath });
      totalBytes += fp.size;
    }
  }

  return { rootPath, files, skipped, totalBytes };
}

/**
 * Diff two directory fingerprints. Returns the set of changes.
 *
 * Used by A1 (read) and A6 (resume verification) to detect:
 * - Added files (in `after` but not in `before`).
 * - Removed files (in `before` but not in `after`).
 * - Modified files (sha256 differs).
 * - Touched files (mtime differs but sha256 same — usually a re-save).
 *
 * @param before The baseline fingerprint (typically from checkpoint).
 * @param after The current fingerprint (typically a fresh scan).
 */
export function diffFileFingerprints(
  before: DirectoryFingerprint,
  after: DirectoryFingerprint,
): FileFingerprintDiff {
  const added: FileFingerprint[] = [];
  const removed: FileFingerprint[] = [];
  const modified: FileFingerprint[] = [];
  const touched: FileFingerprint[] = [];

  // Detect additions and modifications.
  for (const [path, afterFp] of after.files) {
    const beforeFp = before.files.get(path);
    if (beforeFp === undefined) {
      added.push(afterFp);
    } else if (beforeFp.sha256 !== afterFp.sha256) {
      modified.push(afterFp);
    } else if (beforeFp.mtimeMs !== afterFp.mtimeMs) {
      // Content identical but mtime changed — usually a re-save or touch.
      touched.push(afterFp);
    }
  }

  // Detect removals.
  for (const [path, beforeFp] of before.files) {
    if (!after.files.has(path)) {
      removed.push(beforeFp);
    }
  }

  return {
    added,
    removed,
    modified,
    touched,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      touchedCount: touched.length,
      isClean:
        added.length === 0 &&
        removed.length === 0 &&
        modified.length === 0,
    },
  };
}

/** Result of diffing two directory fingerprints. */
export type FileFingerprintDiff = {
  added: FileFingerprint[];
  removed: FileFingerprint[];
  modified: FileFingerprint[];
  /** Touched = mtime changed but content identical. Usually safe to ignore. */
  touched: FileFingerprint[];
  summary: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    touchedCount: number;
    /** True when no changes detected (added/removed/modified all empty). */
    isClean: boolean;
  };
};

/**
 * Convert a DirectoryFingerprint to the `Record<string, string>` shape stored
 * in `Checkpoint.fileHashes`. Only stores path → sha256 (mtime/size omitted
 * to keep the checkpoint compact).
 */
export function fingerprintToRecord(fp: DirectoryFingerprint): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, file] of fp.files) {
    out[path] = file.sha256;
  }
  return out;
}

/**
 * Reconstruct a partial DirectoryFingerprint from a `Record<string, string>`
 * (e.g., loaded from a checkpoint). Only `path` and `sha256` are populated;
 * `mtimeMs` and `size` are 0 (unknown without re-stat).
 */
export function fingerprintFromRecord(
  record: Record<string, string>,
  rootPath = '',
): DirectoryFingerprint {
  const files = new Map<string, FileFingerprint>();
  for (const [path, sha256] of Object.entries(record)) {
    files.set(path, { path, sha256, mtimeMs: 0, size: 0 });
  }
  return { rootPath, files, skipped: [], totalBytes: 0 };
}

// ---------------------------------------------------------------------------
// Stage 2 Stream 2B-2: A6 checkpoint write helper.
//
// `computeCheckpointFileHashes` is the convenience wrapper called by A6
// checkpoint writers. It fingerprints the given paths and returns a
// `Record<string, string>` ready to inject into `Checkpoint.fileHashes` via
// `buildRuntimeCoreCheckpointFromResumeCheckpoint({ fileHashes })`.
//
// - A6 is the SOLE writer of fileHashes (single source of truth, §9.1).
// - Paths that cannot be fingerprinted (missing, permission denied, too large)
//   are skipped and logged via `console.warn` with the specific reason
//   (P2-13 fix — previously silently dropped). The caller can opt to record
//   them as diagnostics.
// - Returns `{}` when called with an empty path list (flag-off parity).
// ---------------------------------------------------------------------------

/**
 * Compute the `fileHashes` record for a checkpoint from a list of file paths.
 *
 * P1 fix: Parallelized via `FINGERPRINT_BATCH_SIZE` batches (matching
 * `computeFileFingerprintsForDirectory`). Previously this was a serial `for`
 * loop, causing ~5x slowdown on 1000-file checkpoints.
 *
 * P2-13 fix: Files that cannot be fingerprinted (too large, permission
 * denied, missing, etc.) are now logged via `console.warn` with the specific
 * skip reason, so operators can tell why a checkpoint is incomplete.
 * Previously these were silently dropped, leaving the checkpoint's
 * `fileHashes` record silently shorter than the input path list.
 *
 * @param paths Absolute or workspace-relative paths to fingerprint.
 * @returns `Record<path, sha256>` ready for `Checkpoint.fileHashes`.
 */
export async function computeCheckpointFileHashes(
  paths: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // P1 fix: fingerprint in parallel batches (same strategy as
  // computeFileFingerprintsForDirectory). 100 balances I/O parallelism
  // against memory (avoids 10k concurrent file reads).
  for (let i = 0; i < paths.length; i += FINGERPRINT_BATCH_SIZE) {
    const batch = paths.slice(i, i + FINGERPRINT_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (path) => {
        const result = await getFileFingerprintWithReason(path);
        return { path, result };
      }),
    );
    for (const { path, result } of results) {
      if (result.ok) {
        out[path] = result.fingerprint.sha256;
      } else {
        // P2-13 fix: log the specific skip reason so operators know why a
        // checkpoint's `fileHashes` is incomplete. Previously this was
        // silently dropped, making it impossible to distinguish a
        // successful-but-empty checkpoint from a partial-failure one.
        console.warn(
          `[file-fingerprint] skipped ${path}: ${result.reason}`,
        );
      }
    }
  }
  return out;
}
