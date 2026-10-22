import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  VG_CANDIDATE_SCHEMA,
  type VerseGitCandidateManifest,
  type VerseGitCandidateRef,
  type VerseGitCandidateResult,
  type VerseGitCandidateSnapshot,
} from "../../../shared/types/versegit.js";

export type CreateCandidateWorker = {
  taskNodeId: string;
  worktreePath: string;
  worktreeRole: string;
  declaredWriteSet: readonly string[];
  parentOrder: number;
  expectedStateDigest?: string;
};
export type FreezeCandidateOptions = {
  baseRoot: string;
  workers: readonly CreateCandidateWorker[];
  expectedBaseOid?: string;
  allowedRuntimeIgnorePaths?: readonly string[];
};
type GitResult = { status: number | null; stdout: string; stderr: string };
type MainState = { headOid: string; refs: VerseGitCandidateRef[]; status: string; digest: string };
const GIT_TIMEOUT_MS = 20_000;
function hardenedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
    GIT_AUTHOR_NAME: "Codex Agent",
    GIT_AUTHOR_EMAIL: "agent@example.invalid",
    GIT_COMMITTER_NAME: "Codex Agent",
    GIT_COMMITTER_EMAIL: "agent@example.invalid",
    ...extra,
  };
}
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    env: hardenedEnv(env),
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function git(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const result = runGit(args, cwd, env);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function normalizePath(value: string): string { return value.replaceAll("\\\\", "/").replace(/^\.\//u, ""); }
function refsFor(root: string): VerseGitCandidateRef[] {
  const raw = git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"], root);
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [ref, oid] = line.split(" ");
    return { ref: ref!, oid: oid! };
  });
}
function mainState(root: string): MainState {
  const headOid = git(["rev-parse", "HEAD"], root);
  const refs = refsFor(root);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], root);
  const digest = `sha256:${sha(JSON.stringify({ headOid, refs, status }))}`;
  return { headOid, refs, status, digest };
}
function refsEqual(left: readonly VerseGitCandidateRef[], right: readonly VerseGitCandidateRef[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function listChangedFiles(root: string): { changed: string[]; untracked: string[] } {
  const changedRaw = git(["diff", "--name-only", "HEAD"], root);
  const untrackedRaw = git(["ls-files", "--others", "--exclude-standard"], root);
  return {
    changed: [...new Set(changedRaw.split(/\r?\n/u).filter(Boolean).map(normalizePath))].sort(),
    untracked: [...new Set(untrackedRaw.split(/\r?\n/u).filter(Boolean).map(normalizePath))].sort(),
  };
}
function snapshotTree(root: string, baseOid: string, indexFile: string): string {
  git(["read-tree", baseOid], root, { GIT_INDEX_FILE: indexFile });
  const add = runGit(["add", "-A", "--", "."], root, { GIT_INDEX_FILE: indexFile });
  if (add.status !== 0) throw new Error(add.stderr.trim() || "worker snapshot add failed");
  return git(["write-tree"], root, { GIT_INDEX_FILE: indexFile });
}
function workerStateDigest(root: string, baseOid: string, indexFile: string): string {
  return `sha256:${sha(JSON.stringify({ head: git(["rev-parse", "HEAD"], root), tree: snapshotTree(root, baseOid, indexFile), changed: listChangedFiles(root) }))}`;
}
function pathWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
function rejected(params: {
  reason: string;
  issues: string[];
  mainBefore: MainState;
  mainAfter: MainState;
}): VerseGitCandidateResult {
  return {
    status: "rejected",
    reason: params.reason,
    issues: params.issues,
    mainBefore: params.mainBefore as unknown as Record<string, unknown>,
    mainAfter: params.mainAfter as unknown as Record<string, unknown>,
    refsBefore: params.mainBefore.refs,
    refsAfter: params.mainAfter.refs,
  };
}

export function freezeOrchestrationCandidate(options: FreezeCandidateOptions): VerseGitCandidateResult {
  const baseRoot = realpathSync(options.baseRoot);
  const before = mainState(baseRoot);
  if (options.expectedBaseOid && options.expectedBaseOid !== before.headOid) {
    return rejected({ reason: "base_drift", issues: [`expected ${options.expectedBaseOid}, got ${before.headOid}`], mainBefore: before, mainAfter: mainState(baseRoot) });
  }
  if (before.status.trim()) {
    return rejected({ reason: "main_worktree_dirty", issues: ["base worktree contains tracked or untracked user changes"], mainBefore: before, mainAfter: mainState(baseRoot) });
  }
  const parentOrder = new Set<number>();
  const tempRoot = mkdtempSync(path.join(tmpdir(), "versegit-candidate-"));
  let currentCommit = before.headOid;
  const snapshots: VerseGitCandidateSnapshot[] = [];
  try {
    for (const worker of [...options.workers].sort((left, right) => left.parentOrder - right.parentOrder)) {
      if (parentOrder.has(worker.parentOrder)) return rejected({ reason: "duplicate_parent_order", issues: [String(worker.parentOrder)], mainBefore: before, mainAfter: mainState(baseRoot) });
      parentOrder.add(worker.parentOrder);
      const workerRoot = realpathSync(worker.worktreePath);
      if (!pathWithin(baseRoot, workerRoot)) return rejected({ reason: "workspace_mismatch", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      const headOid = git(["rev-parse", "HEAD"], workerRoot);
      if (headOid !== before.headOid) return rejected({ reason: "worker_base_mismatch", issues: [`${worker.worktreeRole}:${headOid}`], mainBefore: before, mainAfter: mainState(baseRoot) });
      const files = listChangedFiles(workerRoot);
      const declared = new Set(worker.declaredWriteSet.map(normalizePath));
      const outside = files.changed.filter((file) => !declared.has(file));
      if (files.untracked.some((file) => !declared.has(file))) {
        return rejected({ reason: "untracked", issues: files.untracked.filter((file) => !declared.has(file)), mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      if (outside.length > 0) {
        return rejected({ reason: "write_set_mismatch", issues: outside, mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      const indexFile = path.join(tempRoot, `index-${worker.parentOrder}`);
      const preSnapshotDigest = workerStateDigest(workerRoot, headOid, indexFile);
      if (worker.expectedStateDigest && worker.expectedStateDigest !== preSnapshotDigest) {
        return rejected({ reason: "worker_refresh_required", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      const treeOid = snapshotTree(workerRoot, headOid, indexFile);
      const commitOid = git(["commit-tree", treeOid, "-p", headOid, "-m", `worker snapshot ${worker.taskNodeId}`], baseRoot);
      const postSnapshotDigest = workerStateDigest(workerRoot, headOid, path.join(tempRoot, `index-verify-${worker.parentOrder}`));
      if (preSnapshotDigest !== postSnapshotDigest) {
        return rejected({ reason: "worker_refresh_required", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      snapshots.push({ taskNodeId: worker.taskNodeId, parentOrder: worker.parentOrder, worktreeRole: worker.worktreeRole, headOid, baseOid: before.headOid, statusDigest: preSnapshotDigest, changedFiles: files.changed, treeOid, commitOid });
      const merged = runGit(["merge-tree", "--write-tree", "--messages", currentCommit, commitOid], baseRoot);
      if (merged.status !== 0) {
        const after = mainState(baseRoot);
        return { status: "conflict", reason: "merge_conflict", issues: merged.stdout.trim().split(/\r?\n/u).slice(1).filter(Boolean), mainBefore: before as unknown as Record<string, unknown>, mainAfter: after as unknown as Record<string, unknown>, refsBefore: before.refs, refsAfter: after.refs };
      }
      const candidateTreeOid = merged.stdout.trim().split(/\r?\n/u)[0]!;
      currentCommit = git(["commit-tree", candidateTreeOid, "-p", currentCommit, "-p", commitOid, "-m", `candidate step ${worker.taskNodeId}`], baseRoot);
    }
    const candidateTreeOid = git(["rev-parse", `${currentCommit}^{tree}`], baseRoot);
    const inputDigest = `sha256:${sha(JSON.stringify({ baseOid: before.headOid, snapshots, allowedRuntimeIgnorePaths: options.allowedRuntimeIgnorePaths ?? [] }))}`;
    const candidateId = `vgc_${sha(JSON.stringify({ inputDigest, candidateCommitOid: currentCommit, candidateTreeOid })).slice(0, 24)}`;
    const materializedPath = path.join(baseRoot, ".openclaw", "candidates", candidateId);
    if (existsSync(materializedPath)) return rejected({ reason: "candidate_path_exists", issues: [candidateId], mainBefore: before, mainAfter: mainState(baseRoot) });
    mkdirSync(path.dirname(materializedPath), { recursive: true });
    const addWorktree = runGit(["worktree", "add", "--detach", materializedPath, currentCommit], baseRoot);
    if (addWorktree.status !== 0) return rejected({ reason: "materialize_failed", issues: [addWorktree.stderr.trim()], mainBefore: before, mainAfter: mainState(baseRoot) });
    const after = mainState(baseRoot);
    const refsUnchanged = refsEqual(before.refs, after.refs);
    if (!refsUnchanged || before.headOid !== after.headOid || before.status !== after.status) {
      return rejected({ reason: "main_worktree_changed", issues: ["candidate freeze mutated or raced with host state"], mainBefore: before, mainAfter: after });
    }
    const manifest: VerseGitCandidateManifest = {
      schema: VG_CANDIDATE_SCHEMA,
      candidateId,
      baseOid: before.headOid,
      baseTreeOid: git(["rev-parse", `${before.headOid}^{tree}`], baseRoot),
      workerSnapshots: snapshots,
      candidateCommitOid: currentCommit,
      candidateTreeOid,
      refsBefore: before.refs,
      refsAfter: after.refs,
      mainStateBeforeDigest: before.digest,
      mainStateAfterDigest: after.digest,
      mainUnchanged: before.digest === after.digest,
      verificationCwdRole: "host-disposable-candidate",
      materializedPathRole: "candidate-verification-worktree",
      allowedRuntimeIgnorePaths: [...(options.allowedRuntimeIgnorePaths ?? [])],
      inputDigest,
    };
    return { status: "frozen", manifest, materializedPath, issues: [] };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
