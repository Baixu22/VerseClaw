/**
 * P6B UFTK: pre-restore safety snapshot.
 *
 * A restore may overwrite or delete working-tree content that exists in no
 * checkpoint. Before any worktree mutation, this module captures the affected
 * paths twice over:
 *
 * 1. a git safety checkpoint (`safetyRef`) covering the in-scope pre-restore
 *    state, which is exact for everything git can represent; and
 * 2. raw byte copies (`recoveryRef`) of just the *at-risk* files -- the ones
 *    that would actually be overwritten or deleted -- which also covers content
 *    a tree cannot hold, such as ignored files.
 *
 * At-risk detection is content-exact: a file is at risk only when it exists on
 * disk and either its bytes differ from the checkpoint blob or the restore
 * would remove it. Creating a missing file destroys nothing and is not at risk.
 * Cost is therefore linear in the changed in-scope files, not in repository
 * size.
 *
 * P7 (carry-over A): the safety ref is written under
 * `GIT_CHECKPOINT_SAFETY_REF_PREFIX`, a sibling namespace of the ordinary
 * checkpoint prefix. The lifecycle retention/prune surface enumerates only the
 * checkpoint prefix, so no retention policy — however aggressive, and however
 * many checkpoints P7's auto-checkpoint has created — can delete the ref that
 * holds a user's pre-restore content. Reclaiming safety refs is a separate,
 * explicit call.
 *
 * The raw backup lives under the OpenClaw state dir by default, not inside the
 * workspace. Writing it into the workspace could add a new untracked entry and
 * break the "paths outside the restore scope keep an identical `git status`"
 * invariant; the same reasoning already puts the checkpoint lock files there.
 * Callers that want the copy discoverable inside the repo can pass an explicit
 * `recoveryDir`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CodingRuntimeError } from "./coding-runtime-error.js";
import {
  GIT_CHECKPOINT_SAFETY_REF_PREFIX,
  type GitCheckpointScope,
  runGitCheckpointCommand,
  safeJoinCheckpointRoot,
  writeCheckpointCommit,
} from "./git-checkpoint.js";

export type SafetySnapshotStatus = "captured" | "disabled" | "failed";

export type SafetySnapshotResult = {
  status: SafetySnapshotStatus;
  /** Private ref of the safety checkpoint holding the in-scope pre-restore state. */
  safetyRef?: string;
  safetyCheckpointId?: string;
  /** Directory holding raw byte copies of the at-risk files. */
  recoveryRef?: string;
  /** Paths whose bytes were copied into `recoveryRef`. */
  backedUpPaths?: string[];
  reason?: string;
  error?: { code: string; message: string };
};

/**
 * Paths a restore would destroy: in-scope files whose current bytes differ from
 * the checkpoint blob, plus in-scope files the restore removes.
 */
export async function computeAtRiskPaths(params: {
  root: string;
  checkpointId: string;
  restorePaths: readonly string[];
  removePaths: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<string[]> {
  const atRisk: string[] = [];

  // Removal always destroys content when the file is present.
  for (const relPath of params.removePaths) {
    if (await pathExists(safeJoinCheckpointRoot(params.root, relPath))) {
      atRisk.push(relPath);
    }
  }

  const existing: string[] = [];
  for (const relPath of params.restorePaths) {
    if (await pathExists(safeJoinCheckpointRoot(params.root, relPath))) {
      existing.push(relPath);
    }
  }
  if (existing.length === 0) return dedupeSorted(atRisk);

  const checkpointBlobs = await readTreeBlobHashes({
    root: params.root,
    checkpointId: params.checkpointId,
    paths: existing,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
  const worktreeBlobs = await readWorktreeBlobHashes({
    root: params.root,
    paths: existing,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
  for (const relPath of existing) {
    const checkpointHash = checkpointBlobs.get(relPath);
    const worktreeHash = worktreeBlobs.get(relPath);
    // Unknown on either side means we cannot prove the content is identical, so
    // treat it as at risk rather than risk a silent loss.
    if (!checkpointHash || !worktreeHash || checkpointHash !== worktreeHash) {
      atRisk.push(relPath);
    }
  }
  return dedupeSorted(atRisk);
}

/**
 * The one definition of where a restore's raw byte backups live.
 *
 * This must stay single-sourced with the writer below. P6B shipped a second
 * copy of this path construction in `git-checkpoint-transaction.ts`, and the
 * two had already drifted (one resolved `stateDir`, the other did not) -- on a
 * relative `stateDir` a caller asking "where is my recovery data" would have
 * been handed a different path than the one the snapshot wrote to, on exactly
 * the lookup an operator needs after `recovery_required`.
 */
export function resolveRecoveryDir(stateDir: string, restoreId: string): string {
  return path.join(path.resolve(stateDir), "uftk-recovery", restoreId);
}

/**
 * Capture the safety snapshot for a restore. Returns `disabled` when the
 * safety-snapshot flag is off; the caller is then responsible for refusing to
 * overwrite dirty in-scope content.
 */
export async function captureRestoreSafetySnapshot(params: {
  root: string;
  restoreId: string;
  scope: GitCheckpointScope;
  atRiskPaths: readonly string[];
  enabled: boolean;
  stateDir: string;
  /** Override for the raw byte backup directory. Defaults under `stateDir`. */
  recoveryDir?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  warn: (message: string) => void;
}): Promise<SafetySnapshotResult> {
  if (!params.enabled) {
    return {
      status: "disabled",
      reason:
        "safety snapshot is disabled (runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled)",
    };
  }
  const recoveryRoot = params.recoveryDir
    ? path.resolve(params.recoveryDir)
    : resolveRecoveryDir(params.stateDir, params.restoreId);
  try {
    const safety = await writeCheckpointCommit({
      root: params.root,
      scope: params.scope,
      label: `uftk-safety-snapshot ${params.restoreId}`,
      stateDir: params.stateDir,
      env: params.env,
      timeoutMs: params.timeoutMs,
      // P7 carry-over A: a namespace the lifecycle retention surface never
      // enumerates, so no retention policy can delete this ref.
      refPrefix: GIT_CHECKPOINT_SAFETY_REF_PREFIX,
      // A restore scope legitimately names files that are absent from disk (a
      // deleted file being put back). Their absence is what this snapshot
      // records; it must not be the reason the snapshot fails.
      skipMissingPaths: true,
    });

    const backedUpPaths: string[] = [];
    for (const relPath of params.atRiskPaths) {
      const source = safeJoinCheckpointRoot(params.root, relPath);
      const target = path.join(recoveryRoot, relPath);
      try {
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.copyFile(source, target);
        backedUpPaths.push(relPath);
      } catch (caught) {
        if ((caught as { code?: string } | null)?.code === "ENOENT") continue;
        throw caught;
      }
    }

    return {
      status: "captured",
      safetyRef: safety.ref,
      safetyCheckpointId: safety.commit,
      ...(backedUpPaths.length > 0
        ? { recoveryRef: recoveryRoot, backedUpPaths }
        : {}),
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    params.warn(`coding-git-checkpoint: safety snapshot failed: ${message}`);
    return {
      status: "failed",
      reason: message,
      error: {
        code: caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED",
        message,
      },
    };
  }
}

/**
 * Restore raw byte copies from a recovery directory back into the workspace.
 * Used when an apply phase fails partway and the safety ref alone cannot be
 * replayed (for example when the failure is in git itself).
 */
export async function restoreFromRecoveryDir(params: {
  root: string;
  recoveryRef: string;
  paths: readonly string[];
}): Promise<{ restored: string[]; failed: Array<{ path: string; message: string }> }> {
  const restored: string[] = [];
  const failed: Array<{ path: string; message: string }> = [];
  for (const relPath of params.paths) {
    const source = path.join(params.recoveryRef, relPath);
    const target = safeJoinCheckpointRoot(params.root, relPath);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      restored.push(relPath);
    } catch (caught) {
      failed.push({
        path: relPath,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
  return { restored, failed };
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(absPath);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function dedupeSorted(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function batched<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function readTreeBlobHashes(params: {
  root: string;
  checkpointId: string;
  paths: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const batch of batched(params.paths, 200)) {
    const raw = await runGitCheckpointCommand({
      args: ["ls-tree", "-r", "-z", params.checkpointId, "--", ...batch],
      cwd: params.root,
      env: params.env,
      timeoutMs: params.timeoutMs,
    });
    for (const entry of raw.split("\u0000")) {
      if (!entry) continue;
      // "<mode> <type> <hash>\t<path>"
      const tab = entry.indexOf("\t");
      if (tab < 0) continue;
      const meta = entry.slice(0, tab).split(/\s+/);
      const hash = meta[2];
      const relPath = entry.slice(tab + 1);
      if (hash && relPath) hashes.set(relPath, hash);
    }
  }
  return hashes;
}

async function readWorktreeBlobHashes(params: {
  root: string;
  paths: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const batch of batched(params.paths, 200)) {
    const raw = await runGitCheckpointCommand({
      args: ["hash-object", "--", ...batch],
      cwd: params.root,
      env: params.env,
      timeoutMs: params.timeoutMs,
    });
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // git hash-object emits one hash per input path, in order.
    batch.forEach((relPath, index) => {
      const hash = lines[index];
      if (hash) hashes.set(relPath, hash);
    });
  }
  return hashes;
}
