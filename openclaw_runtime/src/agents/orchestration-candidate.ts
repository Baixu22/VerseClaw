import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { nativeFilename, readWorktreeFile, worktreeContentHash } from "./worktree-merge-files.js";
import path from "node:path";
import { canonicalWorktreePath, loadWorktreeRegistryScope, worktreeNativeIdentity } from "./worktree-registry.js";
import { assertWorktreeIndexVisible } from "./worktree-service.js";
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
  worktreeGeneration?: string;
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
function normalizePath(value: string): string { return (process.platform === 'win32' ? value.replaceAll("\\", "/") : value).replace(/^\.\//u, ""); }
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
function listChangedFiles(root: string, baseOid = 'HEAD'): { changed: string[]; untracked: string[] } {
  const changed = runGit(["diff", "--name-only", "--no-renames", "-z", baseOid], root);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z"], root);
  if (changed.status !== 0 || untracked.status !== 0) throw new Error('worker_snapshot_unavailable');
  return {
    changed: [...new Set(changed.stdout.split('\0').filter(Boolean).map(normalizePath))].sort(),
    untracked: [...new Set(untracked.stdout.split('\0').filter(Boolean).map(normalizePath))].sort(),
  };
}
function snapshotTree(root: string, baseOid: string, indexFile: string): string {
  git(["read-tree", baseOid], root, { GIT_INDEX_FILE: indexFile });
  const add = runGit(["add", "-A", "--", "."], root, { GIT_INDEX_FILE: indexFile });
  if (add.status !== 0) throw new Error(add.stderr.trim() || "worker snapshot add failed");
  return git(["write-tree"], root, { GIT_INDEX_FILE: indexFile });
}
function workerSnapshotState(root: string, baseOid: string, indexFile: string): { tree: string; digest: string } {
  const state = { head: git(["rev-parse", "HEAD"], root), tree: snapshotTree(root, baseOid, indexFile), changed: listChangedFiles(root) };
  return { tree: state.tree, digest: `sha256:${sha(JSON.stringify(state))}` };
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

function candidateDirectoryClean(root: string, allowedPaths: readonly string[]): boolean {
  try { assertWorktreeIndexVisible(root); } catch { return false; }
  const allowed = allowedPaths.map(file => path.resolve(root, file));
  if (allowed.some(file => file === root || !pathWithin(root, file))) return false;
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=all', '-z'], root);
  if (status.status !== 0 || status.stdout) return false;
  const ignored = runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], root);
  return ignored.status === 0 && ignored.stdout.split('\0').filter(Boolean).every(file =>
    allowed.some(directory => pathWithin(directory, path.resolve(root, file))));
}

/** Reuse permits only target edits represented by the frozen raw postimages. */
export function inspectOrchestrationCandidateTarget(baseRoot: string, manifest: VerseGitCandidateManifest): boolean {
  try {
    assertWorktreeIndexVisible(baseRoot);
    const state = mainState(baseRoot);
    if (state.headOid !== manifest.baseOid && state.headOid !== manifest.candidateCommitOid) return false;
    const key = (file: string) => process.platform === 'win32' ? normalizePath(file).toLowerCase() : normalizePath(file);
    const expected = new Map<string, Set<string | null>>();
    const records = loadWorktreeRegistryScope(baseRoot).records;
    for (const snapshot of manifest.workerSnapshots) {
      if (!snapshot.postimageHashes) return false;
      const record = records.get(snapshot.worktreeRole);
      if (!record || !snapshot.worktreeGeneration || record.generation !== snapshot.worktreeGeneration) return false;
      if (record.mergeResult?.status === 'merged' && snapshot.changedFiles.some(file => {
        const actual = process.platform === 'win32' && nativeFilename(baseRoot, file) !== file ? null : readWorktreeFile(baseRoot, file);
        return worktreeContentHash(actual) !== snapshot.postimageHashes![file];
      })) return false;
      for (const [file, hash] of Object.entries(snapshot.postimageHashes)) {
        const values = expected.get(key(file)) ?? new Set<string | null>(); values.add(hash); expected.set(key(file), values);
      }
    }
    const changed = listChangedFiles(baseRoot, manifest.baseOid);
    const staged = runGit(['diff', '--cached', '--name-only', '--no-renames', '-z', manifest.baseOid], baseRoot);
    if (staged.status !== 0) return false;
    const stagedFiles = staged.stdout.split('\0').filter(Boolean).map(normalizePath);
    return [...new Set([...changed.changed, ...changed.untracked, ...stagedFiles])].every(file =>
      expected.get(key(file))?.has(worktreeContentHash(readWorktreeFile(baseRoot, file))) === true)
      && stagedFiles.every(file => runGit(['diff', '--cached', '--quiet', manifest.candidateCommitOid, '--', file], baseRoot).status === 0);
  } catch { return false; }
}

/** Recheck the frozen owner output before choosing the verifier's execution directory. */
export function inspectOrchestrationCandidate(candidate: { manifest: VerseGitCandidateManifest; materializedPath: string }): boolean {
  try {
    const identity = candidate.manifest.materializedIdentity;
    if (!identity || canonicalWorktreePath(candidate.materializedPath) !== identity.rootPath
      || worktreeNativeIdentity(candidate.materializedPath, 'git') !== identity.nativeIdentity) return false;
    const root = realpathSync(candidate.materializedPath);
    return canonicalWorktreePath(git(['rev-parse', '--show-toplevel'], root)) === identity.rootPath
      && git(['rev-parse', 'HEAD'], root) === candidate.manifest.candidateCommitOid
      && git(['rev-parse', 'HEAD^{tree}'], root) === candidate.manifest.candidateTreeOid
      && candidateDirectoryClean(root, candidate.manifest.allowedRuntimeIgnorePaths)
      && candidate.manifest.workerSnapshots.every(snapshot => snapshot.postimageHashes
        && Object.keys(snapshot.postimageHashes).length === new Set(snapshot.changedFiles).size
        && snapshot.changedFiles.every(file => Object.hasOwn(snapshot.postimageHashes!, file)
          && worktreeContentHash(readWorktreeFile(root, file)) === snapshot.postimageHashes![file]));
  } catch { return false; }
}

/** Frozen raw postimages retain the worker's bytes across Git text and smudge filters. */
export function orchestrationCandidatePostimages(baseRoot: string, manifest: VerseGitCandidateManifest, files: readonly string[]): Record<string, string | null> {
  git(['cat-file', '-e', manifest.candidateCommitOid], baseRoot);
  const hashes = new Map<string, string | null>();
  for (const snapshot of manifest.workerSnapshots) {
    if (!snapshot.postimageHashes) throw new Error('worktree_candidate_hashes_unavailable');
    for (const [file, hash] of Object.entries(snapshot.postimageHashes)) {
      if (hashes.has(file) && hashes.get(file) !== hash) throw new Error('worktree_candidate_postimage_conflict:' + file);
      hashes.set(file, hash);
    }
  }
  return Object.fromEntries(files.map(file => {
    if (!hashes.has(file)) throw new Error('worktree_candidate_file_unavailable:' + file);
    return [file, hashes.get(file)!];
  }));
}

export function freezeOrchestrationCandidate(options: FreezeCandidateOptions): VerseGitCandidateResult {
  const baseRoot = realpathSync(options.baseRoot);
  assertWorktreeIndexVisible(baseRoot);
  const before = mainState(baseRoot);
  if (options.expectedBaseOid && options.expectedBaseOid !== before.headOid) {
    return rejected({ reason: "base_drift", issues: [`expected ${options.expectedBaseOid}, got ${before.headOid}`], mainBefore: before, mainAfter: mainState(baseRoot) });
  }
  if (before.status.trim()) {
    return rejected({ reason: "main_worktree_dirty", issues: ["base worktree contains tracked or untracked user changes"], mainBefore: before, mainAfter: mainState(baseRoot) });
  }
  const parentOrder = new Set<number>();
  const tempRoot = mkdtempSync(path.join(tmpdir(), "versegit-candidate-"));
  const commitDate = git(['show', '-s', '--format=%cI', before.headOid], baseRoot);
  const snapshotCommitEnv = { GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate };
  let currentCommit = before.headOid;
  const snapshots: VerseGitCandidateSnapshot[] = [];
  try {
    for (const worker of [...options.workers].sort((left, right) => left.parentOrder - right.parentOrder)) {
      if (parentOrder.has(worker.parentOrder)) return rejected({ reason: "duplicate_parent_order", issues: [String(worker.parentOrder)], mainBefore: before, mainAfter: mainState(baseRoot) });
      parentOrder.add(worker.parentOrder);
      const workerRoot = realpathSync(worker.worktreePath);
      assertWorktreeIndexVisible(workerRoot);
      if (!pathWithin(baseRoot, workerRoot)) return rejected({ reason: "workspace_mismatch", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      const headOid = git(["rev-parse", "HEAD"], workerRoot);
      if (runGit(['merge-base', '--is-ancestor', before.headOid, headOid], workerRoot).status !== 0) return rejected({ reason: "worker_base_mismatch", issues: [`${worker.worktreeRole}:${headOid}`], mainBefore: before, mainAfter: mainState(baseRoot) });
      const files = listChangedFiles(workerRoot, before.headOid);
      const identity = (file: string) => {
        const normalized = normalizePath(file);
        return nativeFilename(existsSync(path.join(workerRoot, normalized)) ? workerRoot : baseRoot, normalized);
      };
      const declared = new Set(worker.declaredWriteSet.map(identity));
      const outside = files.changed.filter((file) => !declared.has(identity(file)));
      if (files.untracked.some((file) => !declared.has(identity(file)))) {
        return rejected({ reason: "untracked", issues: files.untracked.filter((file) => !declared.has(identity(file))), mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      if (outside.length > 0) {
        return rejected({ reason: "write_set_mismatch", issues: outside, mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      const changedFiles = [...new Set([...files.changed, ...files.untracked])].sort();
      const postimageHashes = Object.fromEntries(changedFiles.map(file => [file, worktreeContentHash(readWorktreeFile(workerRoot, file))]));
      const indexFile = path.join(tempRoot, `index-${worker.parentOrder}`);
      const preSnapshotState = workerSnapshotState(workerRoot, headOid, indexFile);
      const preSnapshotDigest = preSnapshotState.digest;
      if (worker.expectedStateDigest && worker.expectedStateDigest !== preSnapshotDigest) {
        return rejected({ reason: "worker_refresh_required", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      const treeOid = preSnapshotState.tree;
      const treeChanges = runGit(['diff', '--name-only', '--no-renames', '-z', before.headOid, treeOid], baseRoot);
      if (treeChanges.status !== 0) throw new Error('worker_snapshot_unavailable');
      const frozenPaths = treeChanges.stdout.split('\0').filter(Boolean).map(normalizePath);
      if (frozenPaths.some(file => !declared.has(identity(file)))) return rejected({ reason: 'write_set_mismatch', issues: frozenPaths.filter(file => !declared.has(identity(file))), mainBefore: before, mainAfter: mainState(baseRoot) });
      if (frozenPaths.some(file => !Object.hasOwn(postimageHashes, file))) return rejected({ reason: 'worker_refresh_required', issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      const commitOid = git(["commit-tree", treeOid, "-p", headOid, "-m", `worker snapshot ${worker.taskNodeId}`], baseRoot, snapshotCommitEnv);
      const postSnapshotDigest = workerSnapshotState(workerRoot, headOid, path.join(tempRoot, `index-verify-${worker.parentOrder}`)).digest;
      if (preSnapshotDigest !== postSnapshotDigest || changedFiles.some(file => worktreeContentHash(readWorktreeFile(workerRoot, file)) !== postimageHashes[file])) {
        return rejected({ reason: "worker_refresh_required", issues: [worker.worktreeRole], mainBefore: before, mainAfter: mainState(baseRoot) });
      }
      snapshots.push({ taskNodeId: worker.taskNodeId, parentOrder: worker.parentOrder, worktreeRole: worker.worktreeRole,
        ...(worker.worktreeGeneration ? { worktreeGeneration: worker.worktreeGeneration } : {}),
        headOid, baseOid: before.headOid, statusDigest: preSnapshotDigest, changedFiles, postimageHashes, treeOid, commitOid });
      const merged = runGit(["merge-tree", "--write-tree", "--messages", currentCommit, commitOid], baseRoot);
      if (merged.status !== 0) {
        const after = mainState(baseRoot);
        return { status: "conflict", reason: "merge_conflict", issues: merged.stdout.trim().split(/\r?\n/u).slice(1).filter(Boolean), mainBefore: before as unknown as Record<string, unknown>, mainAfter: after as unknown as Record<string, unknown>, refsBefore: before.refs, refsAfter: after.refs };
      }
      const candidateTreeOid = merged.stdout.trim().split(/\r?\n/u)[0]!;
      currentCommit = git(["commit-tree", candidateTreeOid, "-p", currentCommit, "-p", commitOid, "-m", `candidate step ${worker.taskNodeId}`], baseRoot, snapshotCommitEnv);
    }
    const candidateTreeOid = git(["rev-parse", `${currentCommit}^{tree}`], baseRoot);
    const inputDigest = `sha256:${sha(JSON.stringify({ baseOid: before.headOid, snapshots, allowedRuntimeIgnorePaths: options.allowedRuntimeIgnorePaths ?? [] }))}`;
    const candidateId = `vgc_${sha(JSON.stringify({ inputDigest, candidateCommitOid: currentCommit, candidateTreeOid })).slice(0, 24)}`;
    let candidatesRoot = baseRoot;
    for (const directory of ['.openclaw', 'candidates']) {
      candidatesRoot = path.join(candidatesRoot, directory);
      if (existsSync(candidatesRoot)) {
        const entry = lstatSync(candidatesRoot);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('candidate_parent_redirected');
      } else mkdirSync(candidatesRoot);
      if (!pathWithin(baseRoot, realpathSync(candidatesRoot))) throw new Error('candidate_parent_outside_workspace');
    }
    const materializedPath = path.join(candidatesRoot, candidateId);
    if (existsSync(materializedPath)) {
      if (lstatSync(materializedPath).isSymbolicLink()
        || git(['rev-parse', 'HEAD'], materializedPath) !== currentCommit
        || git(['rev-parse', 'HEAD^{tree}'], materializedPath) !== candidateTreeOid
        || !candidateDirectoryClean(materializedPath, options.allowedRuntimeIgnorePaths ?? [])) {
        return rejected({ reason: "candidate_path_exists", issues: [candidateId], mainBefore: before, mainAfter: mainState(baseRoot) });
      }
    } else {
      const addWorktree = runGit(["worktree", "add", "--detach", materializedPath, currentCommit], baseRoot);
      if (addWorktree.status !== 0) return rejected({ reason: "materialize_failed", issues: [addWorktree.stderr.trim()], mainBefore: before, mainAfter: mainState(baseRoot) });
    }
    if (!pathWithin(baseRoot, realpathSync(materializedPath))) throw new Error('candidate_path_outside_workspace');
    const after = mainState(baseRoot);
    const refsUnchanged = refsEqual(before.refs, after.refs);
    if (!refsUnchanged || before.headOid !== after.headOid || before.status !== after.status) {
      return rejected({ reason: "main_worktree_changed", issues: ["candidate freeze mutated or raced with host state"], mainBefore: before, mainAfter: after });
    }
    if (canonicalWorktreePath(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], materializedPath))
      !== canonicalWorktreePath(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], baseRoot))) {
      return rejected({ reason: 'candidate_owner_mismatch', issues: [candidateId], mainBefore: before, mainAfter: mainState(baseRoot) });
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
      materializedIdentity: { rootPath: canonicalWorktreePath(materializedPath), nativeIdentity: worktreeNativeIdentity(materializedPath, 'git') },
      allowedRuntimeIgnorePaths: [...(options.allowedRuntimeIgnorePaths ?? [])],
      inputDigest,
    };
    if (!inspectOrchestrationCandidate({ manifest, materializedPath })) {
      return rejected({ reason: 'candidate_postimage_mismatch', issues: [candidateId], mainBefore: before, mainAfter: mainState(baseRoot) });
    }
    return { status: "frozen", manifest, materializedPath, issues: [] };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
