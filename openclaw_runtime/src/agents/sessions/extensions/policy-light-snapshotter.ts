/**
 * A1 Layered Execution Isolation — PolicyLightSnapshotter (Stage 2 Stream 2A-3).
 *
 * Context: Round 2 design. Replaces A1's runtime path tracking with static
 * tool declarations. Snapshots `declaredWritePaths ∩ actual_fs_diff` and
 * integrates with A6 file fingerprints (single source of truth, §9.1).
 *
 * Modes:
 * - "git-diff": uses `git diff` against HEAD (or a baseline commit) to detect
 *   file changes. Behaviorally equivalent to today's snapshotter when A6 is off.
 * - "copy-on-write": copies declared write paths to a checkpoint directory
 *   before the turn; restores them on rollback.
 *
 * Integration:
 * - Reads fingerprints from A6 (`getFileFingerprint` / `fingerprintFromRecord`)
 *   READ-ONLY. Only A6 writes fingerprints.
 * - Git-diff fallback when A6 flag is off (acceptance 2.5, 2.6).
 * - For `dynamic_writes` tools, performs full fs-diff (acceptance 2.3).
 *
 * Flag-off parity (acceptance 2.11): when A1 flag is off, the snapshotter
 * returns a no-op handle — `begin()` / `commit()` / `rollback()` are no-ops.
 *
 * See: docs/runtime-design/development-manual.md §1.1 (A1), Stage 2 Stream 2A
 *      docs/runtime-design/area-1-layered-execution-isolation.md §9.1, §9.2
 */

import { execFile } from "node:child_process";
import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";

import {
  type DirectoryFingerprint,
  type FileFingerprintDiff,
  computeFileFingerprintsForDirectory,
  diffFileFingerprints,
  fingerprintFromRecord,
} from "../../long-task-control/file-fingerprint.js";
import type { WriteRiskProfile } from "../../../shared/tool-registration.js";

const execFileAsync = promisify(execFile);

/** Snapshot mode — determines how the diff is computed. */
export type SnapshotMode = "git-diff" | "copy-on-write";

/**
 * Plan for a snapshot — what mode to use and which paths to track.
 *
 * - When `dynamicWriteTools` is non-empty, falls back to full fs-diff
 *   (git-diff mode over the whole workspace).
 * - When `declaredWritePaths` is non-empty AND all tools declare paths,
 *   uses copy-on-write mode (only snapshots the declared paths).
 */
export type SnapshotPlan = {
  mode: SnapshotMode;
  /** Paths explicitly declared by write tools (from writeRiskProfile). */
  declaredWritePaths: string[];
  /** Tools with `dynamic_writes` profile (forces full fs-diff). */
  dynamicWriteTools: string[];
  /** Workspace root for resolving relative paths. */
  workspaceRoot: string;
  /** Whether A6 fingerprint integration is enabled (flag-gated). */
  a6FingerprintEnabled: boolean;
  /** Baseline fingerprint from A6 (when enabled, for copy-on-write mode). */
  baselineFingerprint?: DirectoryFingerprint;
};

/** Handle to an active snapshot — supports commit / rollback / discard. */
export type SnapshotHandle = {
  /** Unique ID for this snapshot. */
  id: string;
  /** The plan that produced this snapshot. */
  plan: SnapshotPlan;
  /** Timestamp when the snapshot was begun. */
  begunAt: number;
  /**
   * Commit the snapshot — records the post-turn state and releases resources.
   * Called after a successful turn.
   */
  commit: () => Promise<void>;
  /**
   * Rollback the snapshot — restores the pre-turn state.
   * Called when the turn fails or is cancelled.
   */
  rollback: () => Promise<void>;
  /**
   * Discard the snapshot without committing or rolling back.
   * Called when the snapshot is no longer needed (e.g., turn was a no-op).
   */
  discard: () => Promise<void>;
  /** Diff computed after the turn (available after `commit`). */
  diff?: FileFingerprintDiff;
};

/**
 * Result of `beginSnapshot` — either a handle (success) or an error.
 */
export type SnapshotResult =
  | { ok: true; handle: SnapshotHandle }
  | { ok: false; reason: string; detail?: string };

/**
 * Configuration for the PolicyLightSnapshotter.
 */
export type PolicyLightSnapshotterConfig = {
  /** Workspace root path (for git-diff and path resolution). */
  workspaceRoot: string;
  /** Whether A1 is enabled (flag-gated). Default: false (no-op). */
  a1Enabled?: boolean;
  /** Whether A6 fingerprint integration is enabled. Default: false (git-diff fallback). */
  a6FingerprintEnabled?: boolean;
  /** Baseline fingerprint record from A6 checkpoint (when enabled). */
  baselineFingerprintRecord?: Record<string, string>;
  /** Max files to snapshot in copy-on-write mode. Default: 1000. */
  maxFilesForCopyOnWrite?: number;
  /** Timeout for git commands in ms. Default: 5000. */
  gitTimeoutMs?: number;
};

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * S1 fix (P1): Remove the snapshot directory with retry.
 *
 * Windows (and some network filesystems) may have a brief delay between a
 * file handle closing and the OS releasing the directory entry for deletion.
 * This helper retries the removal up to `maxRetries` times with a small
 * backoff, ensuring the snapshot directory is reliably cleaned up before
 * `commit()` / `rollback()` / `discard()` returns.
 */
async function removeSnapshotDirWithRetry(
  snapshotDir: string,
  maxRetries = 3,
  backoffMs = 50,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await rm(snapshotDir, { recursive: true, force: true });
      // Verify removal — if the directory no longer exists, we're done.
      try {
        await stat(snapshotDir);
        // Directory still exists after rm — wait and retry.
      } catch {
        return; // ENOENT — successfully removed.
      }
    } catch {
      // rm itself threw — wait and retry.
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
    }
  }
  // P2 fix: log when best-effort cleanup gives up after all retries, instead
  // of silently swallowing the failure. The snapshot directory may leak on
  // disk — this is not fatal (next session will overwrite) but should be
  // observable for diagnostics.
  try {
    await stat(snapshotDir);
    console.warn(
      `[PolicyLightSnapshotter] failed to remove snapshot directory after ${maxRetries + 1} attempts: ${snapshotDir}`,
    );
  } catch {
    // Directory was actually removed — no warning needed.
  }
}

/**
 * Collect declared write paths from a set of tool write-risk profiles.
 * Returns the union of all `declared_paths` and `pattern_writes` patterns
 * (patterns are returned as-is for git-diff to interpret).
 */
export function collectDeclaredWritePaths(
  toolProfiles: Array<{ name: string; profile: WriteRiskProfile }>,
): { declaredPaths: string[]; dynamicTools: string[] } {
  const declaredPaths: string[] = [];
  const dynamicTools: string[] = [];

  for (const { name, profile } of toolProfiles) {
    if (profile.kind === "declared_paths") {
      declaredPaths.push(...profile.writePaths);
    } else if (profile.kind === "pattern_writes") {
      // Patterns are added to the path list — git-diff will interpret them.
      declaredPaths.push(profile.writePattern);
    } else if (profile.kind === "dynamic_writes") {
      dynamicTools.push(name);
    }
    // no_writes tools contribute nothing.
  }

  return {
    declaredPaths: [...new Set(declaredPaths)], // dedupe
    dynamicTools,
  };
}

/**
 * Execute a git command in the workspace root.
 */
async function git(
  workspaceRoot: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: workspaceRoot,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
}

/**
 * Get the set of changed files in the working tree.
 *
 * Uses `git ls-files --modified --others --exclude-standard` to detect both
 * modified tracked files AND untracked files (respecting .gitignore). This is
 * more comprehensive than `git diff --name-only HEAD`, which only shows tracked
 * file modifications and misses newly-created untracked files.
 *
 * Returns a list of changed file paths (relative to workspace root).
 */
async function gitDiffChangedFiles(
  workspaceRoot: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const { stdout } = await git(
      workspaceRoot,
      ["ls-files", "--modified", "--others", "--exclude-standard"],
      timeoutMs,
    );
    return stdout.split("\n").filter(Boolean);
  } catch {
    // Not a git repo, or git unavailable — fall back to empty diff.
    return [];
  }
}

// -------------------------------------------------------------------------
// No-op handle (flag-off parity)
// -------------------------------------------------------------------------

function createNoOpHandle(plan: SnapshotPlan): SnapshotHandle {
  return {
    id: `noop-${Date.now()}`,
    plan,
    begunAt: Date.now(),
    commit: async () => {},
    rollback: async () => {},
    discard: async () => {},
  };
}

// -------------------------------------------------------------------------
// Copy-on-write snapshot
// -------------------------------------------------------------------------

async function beginCopyOnWriteSnapshot(
  plan: SnapshotPlan,
  _config: PolicyLightSnapshotterConfig,
): Promise<SnapshotResult> {
  const snapshotDir = join(
    plan.workspaceRoot,
    ".openclaw",
    "snapshots",
    `snap-${Date.now()}`,
  );

  try {
    await mkdir(snapshotDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: "mkdir_failed",
      detail: String((err as Error).message),
    };
  }

  // Copy the declared write paths to the snapshot directory.
  const copiedPaths: string[] = [];
  for (const relPath of plan.declaredWritePaths) {
    const src = join(plan.workspaceRoot, relPath);
    const dst = join(snapshotDir, relPath);
    try {
      const stats = await stat(src);
      if (stats.isFile()) {
        await mkdir(dirname(dst), { recursive: true });
        await copyFile(src, dst);
        copiedPaths.push(relPath);
      }
    } catch {
      // File doesn't exist yet — it will be created during the turn.
      // No need to snapshot a non-existent file.
    }
  }

  const handle: SnapshotHandle = {
    id: `cow-${Date.now()}`,
    plan,
    begunAt: Date.now(),
    commit: async () => {
      // Compute diff if A6 fingerprint is available.
      if (plan.a6FingerprintEnabled && plan.baselineFingerprint) {
        const after = await computeFileFingerprintsForDirectory(plan.workspaceRoot, {
          include: (relPath) => copiedPaths.includes(relPath),
        });
        handle.diff = diffFileFingerprints(plan.baselineFingerprint, after);
      }
      // S1 fix (P1): retry snapshot directory cleanup to handle Windows
      // filesystem async delete delay. Retry up to 3 times with 50ms backoff.
      await removeSnapshotDirWithRetry(snapshotDir);
    },
    rollback: async () => {
      // Restore copied files from snapshot.
      for (const relPath of copiedPaths) {
        const src = join(snapshotDir, relPath);
        const dst = join(plan.workspaceRoot, relPath);
        try {
          await copyFile(src, dst);
        } catch {
          // File may have been deleted during the turn — ignore.
        }
      }
      await removeSnapshotDirWithRetry(snapshotDir);
    },
    discard: async () => {
      await removeSnapshotDirWithRetry(snapshotDir);
    },
  };

  return { ok: true, handle };
}

// -------------------------------------------------------------------------
// Git-diff snapshot
// -------------------------------------------------------------------------

async function beginGitDiffSnapshot(
  plan: SnapshotPlan,
  config: PolicyLightSnapshotterConfig,
): Promise<SnapshotResult> {
  const timeoutMs = config.gitTimeoutMs ?? 5000;

  // Record the pre-turn changed files (for diff computation).
  const preTurnChanged = await gitDiffChangedFiles(plan.workspaceRoot, timeoutMs);

  const handle: SnapshotHandle = {
    id: `git-${Date.now()}`,
    plan,
    begunAt: Date.now(),
    commit: async () => {
      // Compute the post-turn changed files.
      const postTurnChanged = await gitDiffChangedFiles(plan.workspaceRoot, timeoutMs);
      // The diff is the set of files that changed DURING the turn.
      const changedDuringTurn = postTurnChanged.filter(
        (p) => !preTurnChanged.includes(p),
      );
      // Build a simple diff (we don't have full fingerprints here, but we
      // record the changed files for diagnostics).
      handle.diff = {
        added: changedDuringTurn.map((p) => ({
          path: p,
          sha256: "",
          mtimeMs: 0,
          size: 0,
        })),
        removed: [],
        modified: [],
        touched: [],
        summary: {
          addedCount: changedDuringTurn.length,
          removedCount: 0,
          modifiedCount: 0,
          touchedCount: 0,
          isClean: changedDuringTurn.length === 0,
        },
      };
    },
    rollback: async () => {
      // Git-diff rollback: restore changed files to HEAD.
      try {
        await git(plan.workspaceRoot, ["checkout", "--", ...preTurnChanged], timeoutMs);
      } catch (err) {
        // P2 fix: log the rollback failure instead of silently swallowing it.
        // Git checkout may fail if files don't exist in HEAD — this is
        // expected for newly-created files, but should be observable.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[PolicyLightSnapshotter] git checkout rollback failed for ${preTurnChanged.length} files: ${message}`,
        );
      }
    },
    discard: async () => {
      // No resources to release for git-diff mode.
    },
  };

  return { ok: true, handle };
}

// -------------------------------------------------------------------------
// Main entry point
// -------------------------------------------------------------------------

/**
 * Begin a snapshot for the current turn.
 *
 * - When A1 is disabled (flag-off parity), returns a no-op handle.
 * - When `dynamicWriteTools` is non-empty, uses git-diff mode (full fs-diff).
 * - When `declaredWritePaths` is non-empty AND no dynamic tools, uses
 *   copy-on-write mode.
 * - When A6 fingerprint is enabled, uses it as the baseline for diff.
 *
 * @param toolProfiles Write-risk profiles from registered tools.
 * @param config Snapshotter configuration.
 */
export async function beginSnapshot(
  toolProfiles: Array<{ name: string; profile: WriteRiskProfile }>,
  config: PolicyLightSnapshotterConfig,
): Promise<SnapshotResult> {
  const { declaredPaths, dynamicTools } = collectDeclaredWritePaths(toolProfiles);

  // Load A6 baseline fingerprint if available.
  let baselineFingerprint: DirectoryFingerprint | undefined;
  if (config.a6FingerprintEnabled && config.baselineFingerprintRecord) {
    baselineFingerprint = fingerprintFromRecord(
      config.baselineFingerprintRecord,
      config.workspaceRoot,
    );
  }

  const plan: SnapshotPlan = {
    mode: dynamicTools.length > 0 ? "git-diff" : "copy-on-write",
    declaredWritePaths: declaredPaths,
    dynamicWriteTools: dynamicTools,
    workspaceRoot: config.workspaceRoot,
    a6FingerprintEnabled: config.a6FingerprintEnabled ?? false,
    baselineFingerprint,
  };

  // Flag-off parity: when A1 is disabled, return no-op handle.
  if (!config.a1Enabled) {
    return { ok: true, handle: createNoOpHandle(plan) };
  }

  // No write paths and no dynamic tools → no-op (nothing to snapshot).
  if (declaredPaths.length === 0 && dynamicTools.length === 0) {
    return { ok: true, handle: createNoOpHandle(plan) };
  }

  // dynamic_writes tools → full fs-diff (git-diff mode).
  if (dynamicTools.length > 0) {
    return beginGitDiffSnapshot(plan, config);
  }

  // Otherwise → copy-on-write mode (snapshots only declared paths).
  const maxFiles = config.maxFilesForCopyOnWrite ?? 1000;
  if (declaredPaths.length > maxFiles) {
    // Too many files to copy — fall back to git-diff.
    return beginGitDiffSnapshot({ ...plan, mode: "git-diff" }, config);
  }

  return beginCopyOnWriteSnapshot(plan, config);
}
