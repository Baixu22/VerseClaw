import { openExternalSafe } from '../utils/safe-open-external';
import { capToolResultText } from '@shared/agent-resource-limits';
import { BoundedCache, Singleflight } from '../../shared/resources/index.js';
import { execFile } from '../utils/counted-child-process';
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  GitBranch,
  GitChangeBucket,
  GitCommitInfo,
  GitApplyPatchPayload,
  GitApplyPatchResult,
  GitBaseDiffFile,
  GitDiffToBasePayload,
  GitDiffToBaseResult,
  GitDiffMode,
  GitFileChange,
  GitOperationResult,
  GitReflogEntry,
  GitRepositoryStatus,
  GitStashEntry,
  GitWorktree,
  GithubPrSummary,
} from '@shared/types/git';
import {
  GIT_PATCH_ARTIFACT_SCHEMA,
  isGitPatchArtifactV1,
  type GitPatchArtifactV1,
  type GitPatchFileStatus,
} from '@shared/types/remote-forge';
import { adaptUnifiedDiffToGitPatchArtifacts } from '@shared/remote-forge/unified-diff-adapter';
import { createRemoteForgeErrorV1 } from '@shared/remote-forge/error-envelope';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type {
  GitBranchCreatePayload,
  GitBranchCheckoutPayload,
  GitCommitPayload,
  GitFetchPayload,
  GitFileDiffPayload,
  GitLogPayload,
  GitMergePayload,
  GitRebasePayload,
  GitResetPayload,
  GitReflogPayload,
  GitMergeBasePayload,
  GitPathPayload,
  GitPathsPayload,
  GitPullPayload,
  GitPushPayload,
  GitStashPayload,
  GitStashRefPayload,
  GitWorktreeAddPayload,
  GithubPrCreateInput,
  GithubPrListPayload,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionAudit,
} from './permissions-api';
import { createWorkspacesApi, getActiveWorkspaceProfile } from './workspaces-api';
import { isPathInsideWorkspace, isPathInsideWorkspaceResolved, requireWorkspace } from './workspace-permissions';
import { assertGitNativeRoot } from '../../shared/git-native-root';

type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type RepoContext = {
  workspace: WorkspaceProfile;
  workspaceRoot: string;
  repoRoot: string;
};

type GitRisk = 'none' | 'write' | 'dangerous';

type DiffStat = {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};


const MAX_OUTPUT_CHARS = 250_000;
const MAX_PATCH_CHARS = 180_000;
const DEFAULT_GH_LIMIT = 30;

function trimOutput(value: string, limit = MAX_OUTPUT_CHARS): string {
  return capToolResultText(value, limit).text;
}

function parseNum(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function mergeDiffStat(base: DiffStat | undefined, next: DiffStat): DiffStat {
  if (!base) return next;
  const binary = base.binary || next.binary;
  return {
    additions: base.additions == null || next.additions == null ? null : base.additions + next.additions,
    deletions: base.deletions == null || next.deletions == null ? null : base.deletions + next.deletions,
    binary,
  };
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizePaths(value: unknown): string[] {
  if (typeof value === 'string') return [value].filter((entry) => entry.trim());
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GH_LIMIT;
  return Math.max(1, Math.min(Math.floor(value), 100));
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function createRequestHash(action: string, workspace: WorkspaceProfile, args: unknown): string {
  return `${workspace.id}:${workspace.activeSessionKey}:git:${action}:${JSON.stringify(args)}`;
}

/** Hardened git/gh exec wrapper (borrowed from Codex git-utils info.rs):
 * - GIT_OPTIONAL_LOCKS=0: status/diff scans never take the index lock
 * - core.hooksPath=/dev/null|NUL: repository config cannot run arbitrary hooks
 * - stdin: null (no interactive prompts)
 * - bounded timeout + kill: slow/frozen git must not hang the UI
 */


const GIT_EXEC_TIMEOUT_MS = 15_000;
const GIT_HOOKS_NULL = process.platform === 'win32' ? 'NUL' : '/dev/null';

function execBinary(command: 'git' | 'gh', args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolveResult) => {
    const options: ExecFileOptionsWithStringEncoding = {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        ...(command === 'git'
          ? {
              GIT_CONFIG_COUNT: '2',
              GIT_CONFIG_KEY_0: 'core.hooksPath',
              GIT_CONFIG_VALUE_0: GIT_HOOKS_NULL,
              GIT_CONFIG_KEY_1: 'core.fsmonitor',
              GIT_CONFIG_VALUE_1: 'false',
            }
          : {}),
      },
      timeout: GIT_EXEC_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    };
    const child = execFile(
      command,
      args,
      options,
      (error: ExecFileException | null, stdout: string, stderr: string) => {
      const maybeCode = error && typeof error.code === 'number'
        ? error.code
        : error ? 1 : 0;
      resolveResult({
        exitCode: maybeCode,
        stdout: trimOutput(typeof stdout === 'string' ? stdout : String(stdout ?? '')),
        stderr: trimOutput(typeof stderr === 'string' ? stderr : String(stderr ?? '')),
      });
    });
    // stdin: null — execFile has no stdio option, so destroy the inherited
    // pipe immediately: git can never read interactive input (matches the
    // Codex Stdio::null() wrapper; GIT_TERMINAL_PROMPT=0 is belt-and-suspenders).
    child.stdin?.destroy();
    // belt-and-suspenders: execFile's timeout kills the child, but on Windows
    // grandchildren (git's own helpers) may outlive it; nothing else to do.
    void child;
  });
}

export async function git(args: string[], cwd: string): Promise<ExecResult> {
  return execBinary('git', args, cwd);
}

async function gh(args: string[], cwd: string): Promise<ExecResult> {
  return execBinary('gh', args, cwd);
}

async function gitTextAt(ctx: RepoContext, ref: 'HEAD' | ':' | 'INDEX', gitPath: string): Promise<string> {
  const spec = ref === 'INDEX' || ref === ':' ? `:${gitPath}` : `${ref}:${gitPath}`;
  const result = await git(['show', spec], ctx.workspaceRoot);
  return result.exitCode === 0 ? result.stdout : '';
}

async function workingTreeText(absolutePath: string): Promise<string> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    return '';
  }
}

function diffContent(value: string, tooLarge: boolean): string | undefined {
  if (tooLarge || value.length > MAX_PATCH_CHARS) return undefined;
  return value;
}

function untrackedPatch(gitPath: string, modified: string): string {
  const lines = modified.length > 0 ? modified.split(/\r?\n/) : [];
  if (lines.length === 0) {
    return [
      `diff --git a/${gitPath} b/${gitPath}`,
      'new file mode 100644',
    ].join('\n');
  }
  const body = lines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    body,
  ].filter((line, index) => index < 5 || line.length > 0).join('\n');
}

function statusForPatch(change: GitFileChange, mode: GitDiffMode): GitPatchFileStatus {
  if (change.conflicted) return 'unmerged';
  if (change.untracked) return 'added';
  const code = change.status[mode === 'staged' ? 0 : 1];
  if (code === 'A') return 'added';
  if (code === 'D') return 'deleted';
  if (code === 'R') return change.originalPath ? 'renamed' : 'unknown';
  if (code === 'C') return change.originalPath ? 'copied' : 'unknown';
  if (code === 'U') return 'unmerged';
  if (code === 'M' || code === 'T') return 'modified';
  return 'unknown';
}

function unavailablePatchArtifact(params: {
  change?: GitFileChange;
  file: string;
  mode: GitDiffMode;
  message: string;
}): GitPatchArtifactV1 {
  const status = params.change ? statusForPatch(params.change, params.mode) : 'unknown';
  const artifact: GitPatchArtifactV1 = {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    file: params.file,
    status,
    ...(status === 'renamed' || status === 'copied'
      ? { oldPath: params.change?.originalPath, newPath: params.change?.path }
      : {}),
    contentKind: 'unknown',
    hunks: [],
    completeness: 'unavailable',
    message: params.message,
  };
  if (isGitPatchArtifactV1(artifact)) return artifact;
  return {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    file: params.file,
    status: 'unknown',
    contentKind: 'unknown',
    hunks: [],
    completeness: 'unavailable',
    message: params.message,
  };
}

function relevantChanges(changes: GitFileChange[], mode: GitDiffMode): GitFileChange[] {
  return changes.filter((change) => mode === 'staged'
    ? change.staged || change.conflicted
    : change.unstaged || change.untracked || change.conflicted);
}

function findTrustedChange(artifact: GitPatchArtifactV1, changes: GitFileChange[]): GitFileChange | undefined {
  return changes.find((change) => change.path === artifact.file
    || change.path === artifact.newPath
    || change.path === artifact.oldPath);
}

function projectGitPatch(params: {
  patch: string;
  mode: GitDiffMode;
  changes: GitFileChange[];
  tooLarge: boolean;
  requestedPath?: string;
}): { patchArtifacts: GitPatchArtifactV1[]; patchArtifactError?: import('@shared/types/remote-forge').RemoteForgeErrorV1 } {
  const requestId = `git-patch-${randomUUID()}`;
  const changes = relevantChanges(params.changes, params.mode);
  const fallbackChanges = params.requestedPath
    ? changes.filter((change) => change.path === params.requestedPath)
    : changes;
  const unavailableMessage = params.tooLarge
    ? 'Local Git patch exceeds the producer limit.'
    : 'Local Git patch could not be parsed safely.';

  if (!params.patch.trim()) return { patchArtifacts: [] };
  if (params.tooLarge) {
    const patchArtifacts = fallbackChanges.map((change) => unavailablePatchArtifact({
      change,
      file: change.path,
      mode: params.mode,
      message: unavailableMessage,
    }));
    return patchArtifacts.length > 0
      ? { patchArtifacts }
      : {
          patchArtifacts: [],
          patchArtifactError: createRemoteForgeErrorV1({ code: 'truncated_response', requestId }),
        };
  }

  const adapted = adaptUnifiedDiffToGitPatchArtifacts({
    patch: params.patch,
    sourceCompleteness: 'complete',
  });
  if (adapted.kind === 'unavailable') {
    const patchArtifacts = fallbackChanges.map((change) => unavailablePatchArtifact({
      change,
      file: change.path,
      mode: params.mode,
      message: unavailableMessage,
    }));
    return patchArtifacts.length > 0
      ? { patchArtifacts }
      : {
          patchArtifacts: [],
          patchArtifactError: createRemoteForgeErrorV1({ code: 'incomplete_response', requestId }),
        };
  }

  return {
    patchArtifacts: adapted.artifacts.map((artifact) => {
      const trusted = findTrustedChange(artifact, changes);
      const trustedStatus = trusted ? statusForPatch(trusted, params.mode) : 'unknown';
      if (!trusted || trustedStatus === 'unknown' || trustedStatus !== artifact.status) {
        return unavailablePatchArtifact({
          change: trusted,
          file: artifact.file,
          mode: params.mode,
          message: 'Local Git status does not match the parsed patch.',
        });
      }
      return artifact;
    }),
  };
}

async function requireRepoContextForWorkspace(workspace: WorkspaceProfile): Promise<RepoContext> {
  const workspaceRoot = resolve(workspace.rootPath);
  const repo = await git(['rev-parse', '--show-toplevel'], workspaceRoot);
  if (repo.exitCode !== 0 || !repo.stdout.trim()) {
    throw new Error(repo.stderr.trim() || 'Active workspace is not a Git repository');
  }
  const repoRoot = resolve(repo.stdout.trim());
  assertGitNativeRoot(workspaceRoot, repoRoot);
  return { workspace, workspaceRoot, repoRoot };
}

async function requireRepoContext(): Promise<RepoContext> {
  return requireRepoContextForWorkspace(requireWorkspace(await getActiveWorkspaceProfile()));
}

async function getRepoContextOrNull(workspace?: WorkspaceProfile): Promise<RepoContext | null> {
  try {
    return workspace
      ? await requireRepoContextForWorkspace(workspace)
      : await requireRepoContext();
  } catch {
    return null;
  }
}

function resolveGitPath(ctx: RepoContext, rawPath: string): { absolutePath: string; gitPath: string } {
  const absolutePath = resolve(isAbsolute(rawPath) ? rawPath : join(ctx.repoRoot, rawPath));
  if (!isPathInsideWorkspace(absolutePath, ctx.workspaceRoot)) {
    throw new Error('Git path must stay inside the active workspace');
  }
  return {
    absolutePath,
    gitPath: toPosixPath(relative(ctx.repoRoot, absolutePath)),
  };
}

function resolveWorkspacePath(ctx: RepoContext, rawPath: string): string {
  return resolve(isAbsolute(rawPath) ? rawPath : join(ctx.workspaceRoot, rawPath));
}

function isPathInsideRepoSiblingArea(target: string, repoRoot: string): boolean {
  const parent = dirname(repoRoot);
  // A drive/volume root is never a safe sibling container: every path on the
  // drive would otherwise pass the relative() check below, letting worktreeAdd
  // create directories anywhere on the volume without explicit approval.
  if (parent === resolve(parent, '..')) return false;
  const relativePath = relative(parent, target);
  const repoFolder = basename(repoRoot);
  return Boolean(relativePath)
    && !relativePath.startsWith('..')
    && !isAbsolute(relativePath)
    && relativePath.startsWith(`${repoFolder}-`)
    && !relativePath.includes(sep);
}

function isConflictStatus(status: string): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status);
}

function bucketFor(change: Omit<GitFileChange, 'bucket'>): GitChangeBucket {
  if (change.conflicted) return 'conflicted';
  if (change.untracked) return 'untracked';
  if (change.staged) return 'staged';
  return 'unstaged';
}

function gitChangeFromStatus(ctx: RepoContext, input: {
  path: string;
  originalPath?: string;
  x: string;
  y: string;
  untracked?: boolean;
}): GitFileChange | null {
  const absolutePath = resolve(ctx.repoRoot, input.path);
  if (!isPathInsideWorkspace(absolutePath, ctx.workspaceRoot)) return null;
  const status = input.untracked ? '??' : `${input.x}${input.y}`;
  const untracked = input.untracked === true;
  const conflicted = isConflictStatus(status);
  const staged = !untracked && input.x !== '.' && !conflicted;
  const unstaged = !untracked && input.y !== '.' && !conflicted;
  const change = {
    path: toPosixPath(input.path),
    absolutePath,
    originalPath: input.originalPath,
    status,
    staged,
    unstaged,
    untracked,
    conflicted,
  };
  return { ...change, bucket: bucketFor(change) };
}

function fieldAfter(record: string, fieldCount: number): string | undefined {
  let index = -1;
  for (let field = 0; field < fieldCount; field += 1) {
    index = record.indexOf(' ', index + 1);
    if (index === -1) return undefined;
  }
  return record.slice(index + 1);
}

function parsePorcelainStatus(ctx: RepoContext, output: string): GitRepositoryStatus {
  let branch: string | undefined;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  const changes: GitFileChange[] = [];
  const records = output.split('\0').filter(Boolean);

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length).trim();
      detached = head === '(detached)';
      branch = detached ? undefined : head;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = record.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith('? ')) {
      const change = gitChangeFromStatus(ctx, { path: record.slice(2), x: '?', y: '?', untracked: true });
      if (change) changes.push(change);
      continue;
    }
    if (record.startsWith('u ')) {
      const path = fieldAfter(record, 10);
      if (!path) continue;
      const change = gitChangeFromStatus(ctx, { path, x: 'U', y: 'U' });
      if (change) changes.push({ ...change, conflicted: true, bucket: 'conflicted' });
      continue;
    }
    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const status = record.slice(2, 4);
      const pathPart = fieldAfter(record, record.startsWith('2 ') ? 9 : 8);
      if (!pathPart) continue;
      const originalPath = record.startsWith('2 ') && records[i + 1] && !records[i + 1].startsWith('# ')
        ? records[i + 1]
        : undefined;
      if (originalPath) i += 1;
      const change = gitChangeFromStatus(ctx, {
        path: pathPart,
        originalPath,
        x: status[0] ?? '.',
        y: status[1] ?? '.',
      });
      if (change) changes.push(change);
    }
  }

  const stagedCount = changes.filter((change) => change.staged).length;
  const unstagedCount = changes.filter((change) => change.unstaged).length;
  const untrackedCount = changes.filter((change) => change.untracked).length;
  const conflictedCount = changes.filter((change) => change.conflicted).length;
  return {
    isRepository: true,
    workspaceRoot: ctx.workspaceRoot,
    repoRoot: ctx.repoRoot,
    branch,
    detached,
    upstream,
    ahead,
    behind,
    clean: changes.length === 0,
    hasConflicts: conflictedCount > 0,
    changes,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictedCount,
  };
}

function parseNumstat(output: string): Map<string, DiffStat> {
  const stats = new Map<string, DiffStat>();
  const records = output.includes('\0')
    ? output.split('\0').filter(Boolean)
    : output.split(/\r?\n/).filter(Boolean);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const fields = record.split('\t');
    if (fields.length < 3) continue;
    const additions = parseNum(fields[0] ?? '');
    const deletions = parseNum(fields[1] ?? '');
    let path = fields.slice(2).join('\t');
    if (!path && records[index + 1]) {
      // With -z, rename records can emit the old and new paths as following NUL records.
      index += 1;
      path = records[index + 1] ?? records[index];
      if (records[index + 1]) index += 1;
    }
    if (!path) continue;
    const statEntry = {
      additions,
      deletions,
      binary: additions == null || deletions == null,
    };
    stats.set(path, mergeDiffStat(stats.get(path), statEntry));
  }
  return stats;
}

async function readDiffStats(ctx: RepoContext): Promise<Map<string, DiffStat>> {
  const [unstaged, staged] = await Promise.all([
    git(['diff', '--numstat', '-z'], ctx.workspaceRoot),
    git(['diff', '--cached', '--numstat', '-z'], ctx.workspaceRoot),
  ]);
  const merged = new Map<string, DiffStat>();
  for (const result of [unstaged, staged]) {
    if (result.exitCode !== 0) continue;
    for (const [path, statEntry] of parseNumstat(result.stdout)) {
      merged.set(path, mergeDiffStat(merged.get(path), statEntry));
    }
  }
  return merged;
}

async function untrackedFileStat(change: GitFileChange): Promise<DiffStat | null> {
  try {
    const fileStat = await stat(change.absolutePath);
    if (!fileStat.isFile() || fileStat.size > MAX_PATCH_CHARS) {
      return { additions: null, deletions: null, binary: true };
    }
    const content = await readFile(change.absolutePath, 'utf8');
    const additions = content.length === 0 ? 0 : content.replace(/\r\n/g, '\n').split('\n').length;
    return { additions, deletions: 0, binary: false };
  } catch {
    return null;
  }
}

async function enrichStatusWithDiffStats(ctx: RepoContext, status: GitRepositoryStatus): Promise<GitRepositoryStatus> {
  const diffStats = await readDiffStats(ctx).catch(() => new Map<string, DiffStat>());
  const changes = await Promise.all(status.changes.map(async (change) => {
    const statEntry = diffStats.get(change.path) ?? (change.untracked ? await untrackedFileStat(change) : null);
    if (!statEntry) return change;
    return {
      ...change,
      additions: statEntry.additions,
      deletions: statEntry.deletions,
      binary: statEntry.binary,
    };
  }));
  return { ...status, changes };
}

type GitStatusCacheEntry = { status: GitRepositoryStatus; repoRoot: string | null; source: string };
const GIT_STATUS_CACHE_TTL_MS = 5_000;
const gitStatusCache = new BoundedCache<string, GitStatusCacheEntry>({
  maxEntries: 16,
  ttlMs: GIT_STATUS_CACHE_TTL_MS,
});
const gitStatusFlight = new Singleflight<string, GitStatusCacheEntry>();
let gitStatusGeneration = 0;

function gitStatusCacheKey(workspace: WorkspaceProfile): string {
  const root = resolve(workspace.rootPath);
  return `git-workspace:${process.platform === 'win32' ? root.toLowerCase() : root}`;
}

async function gitStatusSource(workspace: WorkspaceProfile): Promise<string> {
  const paths = [resolve(workspace.rootPath), join(resolve(workspace.rootPath), '.git')];
  return JSON.stringify(await Promise.all(paths.map(async path => {
    try { const value = await stat(path); return [value.dev, value.ino, value.birthtimeMs, value.mtimeMs, value.size]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  })));
}

/** Read-through cache for the read-only status surface; mutations invalidate its repo prefix. */
export function invalidateGitStatusCache(repoRoot: string): number {
  gitStatusGeneration++;
  const target = resolve(repoRoot);
  return gitStatusCache.invalidate((_key, entry) => entry.repoRoot === target);
}

export function clearGitStatusCacheForTest(): void {
  gitStatusGeneration++;
  gitStatusCache.clear();
}

async function readUncachedGitStatus(
  workspace: WorkspaceProfile,
  ctx: RepoContext | null,
): Promise<GitRepositoryStatus> {
  if (!ctx) {
    return {
      isRepository: false,
      workspaceRoot: resolve(workspace.rootPath),
      ahead: 0,
      behind: 0,
      clean: true,
      hasConflicts: false,
      changes: [],
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      error: 'Active workspace is not a Git repository',
    };
  }
  const result = await git(['status', '--porcelain=v2', '-z', '--branch'], ctx.workspaceRoot);
  if (result.exitCode !== 0) throw new Error(result.stderr || 'git status failed');
  return enrichStatusWithDiffStats(ctx, parsePorcelainStatus(ctx, result.stdout));
}

export async function resolveGitCommitAtOrBefore(isoTimestamp: string): Promise<string | null> {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) throw new Error('A valid ISO timestamp is required');
  const ctx = await requireRepoContext();
  const result = await git(['rev-list', '-1', `--before=${new Date(parsed).toISOString()}`, 'HEAD'], ctx.workspaceRoot);
  if (result.exitCode !== 0) return null;
  const commit = result.stdout.trim();
  return commit || null;
}
export async function readCurrentGitStatus(ownerWorkspace?: WorkspaceProfile): Promise<GitRepositoryStatus> {
  const workspace = ownerWorkspace ?? requireWorkspace(await getActiveWorkspaceProfile());
  const key = gitStatusCacheKey(workspace);
  const source = await gitStatusSource(workspace);
  const cached = gitStatusCache.get(key);
  if (cached?.source === source) return cached.status;
  if (cached) gitStatusCache.delete(key);
  const generation = gitStatusGeneration;
  const entry = await gitStatusFlight.run(`${generation}:${key}:${source}`, async () => {
    const ctx = await getRepoContextOrNull(workspace);
    const loaded = {
      status: await readUncachedGitStatus(workspace, ctx),
      repoRoot: ctx ? resolve(ctx.repoRoot) : null,
      source,
    };
    if (loaded.repoRoot && generation === gitStatusGeneration && source === await gitStatusSource(workspace)) gitStatusCache.set(key, loaded);
    return loaded;
  });
  // Non-repository workspaces are cheap to re-check and must not hide a later
  // `git init`; only real repositories enter the bounded cache.
  if (!entry.repoRoot) return entry.status;
  return entry.status;
}

export async function readWorkspaceGitWorktrees(ownerWorkspace?: WorkspaceProfile) {
  const ctx = ownerWorkspace ? await requireRepoContextForWorkspace(ownerWorkspace) : await requireRepoContext();
  const result = await git(['worktree', 'list', '--porcelain', '-z'], ctx.workspaceRoot);
  return { success: result.exitCode === 0, worktrees: parseWorktrees(result.stdout), error: result.exitCode === 0 ? undefined : result.stderr };
}

export async function enforcePermission(input: {
  workspace: WorkspaceProfile;
  action: string;
  risk: GitRisk;
  approvalId?: string;
  command: string;
  paths?: string[];
  /** Extra grading facts appended to the approval reason so the dialog explains
   * why this specific operation is dangerous, not just that it is. */
  grading?: string[];
  targetIdentity?: string;
}): Promise<GitOperationResult | null> {
  if (input.risk === 'none') return null;
  const requestHash = createRequestHash(input.action, input.workspace, {
    command: input.command,
    paths: input.paths ?? [],
    ...(input.targetIdentity ? { targetIdentity: input.targetIdentity } : {}),
  });

  if (input.risk === 'dangerous') {
    if (input.approvalId) {
      const approved = await consumeApprovedPermissionApproval({
        id: input.approvalId,
        workspaceId: input.workspace.id,
        source: 'git',
        command: input.command,
        paths: input.paths,
        requestHash,
      });
      if (approved) return null;
    }
    const approval = await createPermissionApproval({
      workspace: input.workspace,
      source: 'git',
      risk: 'dangerous',
      command: input.command,
      cwd: input.workspace.rootPath,
      paths: input.paths,
      requestHash,
      reason: [
        'This Git/GitHub operation can rewrite or publish repository state and requires approval.',
        ...(input.grading ?? []),
      ].join(' '),
    });
    return {
      success: false,
      blocked: true,
      approvalRequired: true,
      approval,
      reason: approval.reason,
    };
  }

  if (input.workspace.permissionMode === 'readOnly') {
    return { success: false, blocked: true, reason: 'Read-only workspace mode blocks Git write operations.' };
  }
  if (input.workspace.permissionMode === 'plan') {
    return { success: false, blocked: true, reason: 'Plan workspace mode blocks Git write operations.' };
  }
  if (input.workspace.permissionMode === 'fullAccess') {
    void recordPermissionAudit({
      workspace: input.workspace,
      source: 'git',
      risk: 'write',
      command: input.command,
      cwd: input.workspace.rootPath,
      paths: input.paths,
      requestHash,
      reason: 'Git write operation allowed in full-access workspace mode.',
    });
  } else if (input.workspace.permissionMode === 'acceptEdits') {
    // P2-001: keep acceptEdits write path explicit in the approval audit trail.
    void recordPermissionAudit({
      workspace: input.workspace,
      source: 'git',
      risk: 'write',
      command: input.command,
      cwd: input.workspace.rootPath,
      paths: input.paths,
      requestHash,
      reason: 'Git write operation allowed under acceptEdits workspace mode.',
    });
  }
  return null;
}

async function withGitOperation(
  action: string,
  risk: GitRisk,
  args: string[],
  payload: { approvalId?: string; paths?: string[]; grading?: string[]; context?: RepoContext; removalTarget?: string } = {},
): Promise<GitOperationResult> {
  const ctx = payload.context ?? await requireRepoContext();
  const inspectRemoval = async () => {
    try {
      const { inspectUiWorktreeRemoval } = await import('./task-system-service');
      return inspectUiWorktreeRemoval(ctx.repoRoot, payload.removalTarget!, (await createWorkspacesApi().list()).profiles);
    } catch (error) { return { blocked: true as const,
      reason: `UI_CLEANUP_OWNER_UNAVAILABLE: ${String(error)}; owner=Workspace/session lifecycle; entry=/settings/storage` }; }
  };
  const before = payload.removalTarget ? await inspectRemoval() : null;
  if (before?.blocked) return { success: false, blocked: true, reason: before.reason };
  const blocked = await enforcePermission({
    workspace: ctx.workspace,
    action,
    risk,
    approvalId: payload.approvalId,
    command: `git ${args.join(' ')}`,
    paths: payload.paths,
    grading: payload.grading,
    targetIdentity: before && !before.blocked ? before.identity : undefined,
  });
  if (blocked) return blocked;
  if (payload.removalTarget) {
    const current = await inspectRemoval();
    if (current.blocked) return { success: false, blocked: true, reason: current.reason };
    if (before && !before.blocked && current.identity !== before.identity)
      return { success: false, blocked: true, reason: 'UI_CLEANUP_TARGET_CHANGED; entry=/settings/storage; refresh the owning session' };
    const { removeUiWorktree } = await import('./task-system-service');
    const profiles = (await createWorkspacesApi().list()).profiles;
    const removal = removeUiWorktree(ctx.repoRoot, payload.removalTarget, profiles, current.identity);
    if (removal.success) invalidateGitStatusCache(ctx.repoRoot);
    return { ...removal, status: removal.success ? await readCurrentGitStatus().catch(() => undefined) : undefined };
  }
  const result = await git(args, ctx.workspaceRoot);
  if (result.exitCode === 0) invalidateGitStatusCache(ctx.repoRoot);
  return {
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? await readCurrentGitStatus().catch(() => undefined) : undefined,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function isSafeGitRef(ref: string): boolean {
  return SAFE_GIT_REF_PATTERN.test(ref)
    && !ref.includes('..')
    && !ref.includes('//')
    && !ref.endsWith('/')
    && !ref.endsWith('.lock')
    && ref.length <= 250;
}

/** Branches whose history is conventionally shared, so publishing or rewriting
 * them affects everyone rather than just the local checkout. Used only to
 * explain the grading in the approval prompt; it never changes the decision. */
const PROTECTED_BRANCH_NAMES = new Set(['main', 'master', 'develop', 'release', 'trunk']);

function isProtectedBranchName(branch: string): boolean {
  const leaf = branch.replace(/^refs\/heads\//, '').split('/').pop() ?? '';
  return PROTECTED_BRANCH_NAMES.has(leaf.toLowerCase())
    || branch.startsWith('release/')
    || branch.startsWith('hotfix/');
}

/** Describe what a push actually targets so the approval prompt states the
 * blast radius: which branch, and whether that branch is a shared one. */
function gradePushTarget(params: {
  remote?: string;
  branch?: string;
  currentBranch?: string;
}): string[] {
  const grading: string[] = [];
  const target = params.branch || params.currentBranch;
  const remote = params.remote || 'the default remote';
  if (target) {
    grading.push(`Target: ${remote}/${target}.`);
    if (isProtectedBranchName(target)) {
      grading.push(`${target} is a shared branch, so this publishes work others depend on.`);
    }
    return grading;
  }
  // No explicit branch means git falls back to push.default, which can cover
  // more refs than the user expects.
  grading.push(`Target: ${remote} using the configured push default, which may update more than one ref.`);
  return grading;
}


/** Cap on files reported by diffToBase; a wide branch must not blow up IPC. */
const MAX_BASE_DIFF_FILES = 200;

/** Cap on remote-tracking refs probed for ancestry. Each candidate costs one
 * `git rev-list --count`, so a repo with hundreds of stale remote branches must
 * not turn one base lookup into hundreds of subprocesses. */
const MAX_BASE_CANDIDATES = 100;

type ResolvedBase =
  | { resolution: 'explicit' | 'upstream' | 'remote-default' | 'remote-ancestor'; base: string }
  | { resolution: 'unavailable'; reason: string };

/** Rank a remote by trustworthiness as a comparison base: origin first, then
 * the order `git remote` reported, then anything whose remote is not
 * configured at all. Rank outranks distance when picking a base — a nearer
 * `fork/main` must not displace `origin/main`, because the base is a label the
 * user reads and provenance matters more than proximity. */
function rankRemoteName(remote: string, remoteOrder: string[]): number {
  if (remote === 'origin') return 0;
  const index = remoteOrder.indexOf(remote);
  return index >= 0 ? 1 + index : 1 + remoteOrder.length;
}

/** Derive the nearest remote ancestor to compare HEAD against.
 * Order: explicit ref, HEAD's upstream, the remote's declared default branch,
 * then an ordered scan of remote-tracking refs that are ancestors of HEAD.
 * Returns 'unavailable' with a reason rather than guessing a base, so callers
 * never present a comparison against a ref the user did not choose. */
async function resolveDiffBase(ctx: RepoContext, explicit: string): Promise<ResolvedBase> {
  const verify = async (ref: string): Promise<boolean> => {
    const result = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], ctx.workspaceRoot);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  };

  if (explicit) {
    if (!isSafeGitRef(explicit)) throw new Error(`Invalid git ref: ${explicit}`);
    if (!await verify(explicit)) {
      return { resolution: 'unavailable', reason: `base ref not found: ${explicit}` };
    }
    return { resolution: 'explicit', base: explicit };
  }

  const upstream = await git(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    ctx.workspaceRoot,
  );
  const upstreamRef = upstream.exitCode === 0 ? upstream.stdout.trim() : '';
  if (upstreamRef && isSafeGitRef(upstreamRef) && await verify(upstreamRef)) {
    return { resolution: 'upstream', base: upstreamRef };
  }

  // No upstream (detached HEAD or a never-pushed branch): fall back to the
  // remote's own default branch, which origin/HEAD records locally.
  const remoteHead = await git(
    ['symbolic-ref', '--short', '--quiet', 'refs/remotes/origin/HEAD'],
    ctx.workspaceRoot,
  );
  const remoteHeadRef = remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : '';
  if (remoteHeadRef && isSafeGitRef(remoteHeadRef) && await verify(remoteHeadRef)) {
    return { resolution: 'remote-default', base: remoteHeadRef };
  }

  // Still nothing: scan remote-tracking refs for the nearest ancestor of HEAD.
  // This is the only path that works when the repo has no origin and no remote
  // declared a default branch — `git remote add upstream … && git fetch` never
  // creates refs/remotes/upstream/HEAD, so no symbolic-ref probe can find it.
  //
  // --merged (not --contains): a base must be an ancestor of HEAD. --contains
  // asks the opposite and returns nothing whenever HEAD is ahead, which is the
  // normal state of a feature branch.
  //
  // %(refname) (not :short): the short form renders refs/remotes/origin/HEAD as
  // the bare string "origin", which is not a usable ref.
  const merged = await git(
    ['for-each-ref', '--merged', 'HEAD', '--format=%(refname)', 'refs/remotes/'],
    ctx.workspaceRoot,
  );
  const candidates = (merged.exitCode === 0 ? merged.stdout : '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('refs/remotes/'))
    .map((line) => line.slice('refs/remotes/'.length))
    // Drop the */HEAD pseudo-refs: each duplicates the branch it points at, at
    // an identical distance, so keeping them lets a tie-break pick the alias.
    .filter((ref) => ref.length > 0 && !ref.endsWith('/HEAD'))
    .filter((ref) => isSafeGitRef(ref))
    .slice(0, MAX_BASE_CANDIDATES);

  if (candidates.length === 0) {
    return {
      resolution: 'unavailable',
      reason: 'no upstream branch and no origin/HEAD: cannot derive a remote base',
    };
  }

  const remoteList = await git(['remote'], ctx.workspaceRoot);
  // `git remote` prints alphabetically, not in config order, so origin priority
  // has to be explicit rather than inherited from this list's ordering.
  const remoteOrder = (remoteList.exitCode === 0 ? remoteList.stdout : '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const scored: { ref: string; rank: number; distance: number }[] = [];
  for (const ref of candidates) {
    const counted = await git(['rev-list', '--count', `${ref}..HEAD`], ctx.workspaceRoot);
    if (counted.exitCode !== 0) continue;
    const distance = parseNum(counted.stdout.trim());
    if (distance == null) continue;
    const remoteName = ref.slice(0, ref.indexOf('/'));
    scored.push({ ref, rank: rankRemoteName(remoteName, remoteOrder), distance });
  }

  if (scored.length === 0) {
    return {
      resolution: 'unavailable',
      reason: 'no upstream branch and no origin/HEAD: cannot derive a remote base',
    };
  }

  // Deterministic ordering: an arbitrary winner among equals is untestable.
  scored.sort((left, right) => left.rank - right.rank
    || left.distance - right.distance
    || left.ref.localeCompare(right.ref));
  return { resolution: 'remote-ancestor', base: scored[0]!.ref };
}

/** Parse `git diff --name-status -z A..B` into path + change letter pairs.
 * The -z form is NUL-delimited, and renames/copies emit three fields
 * (letter, source, destination) instead of two. */
function parseNameStatusZ(output: string): { path: string; changeKind: string }[] {
  const fields = output.split('\0').filter((entry) => entry.length > 0);
  const entries: { path: string; changeKind: string }[] = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index] ?? '';
    const letter = rawStatus.charAt(0);
    if (!letter) break;
    // R and C carry a similarity score (R100) and a second path.
    const isRenameOrCopy = letter === 'R' || letter === 'C';
    const pathField = fields[index + (isRenameOrCopy ? 2 : 1)];
    if (typeof pathField !== 'string') break;
    entries.push({ path: pathField, changeKind: letter });
    index += isRenameOrCopy ? 3 : 2;
  }
  return entries;
}


function parseCommitLog(output: string): GitCommitInfo[] {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [hash, shortHash, timestamp, author, ...subjectParts] = line.split('\t');
    if (!hash || !shortHash) return [];
    const seconds = parseNum(timestamp ?? '');
    return [{
      hash,
      shortHash,
      subject: subjectParts.join('\t') || '',
      author: author || undefined,
      date: seconds == null ? undefined : seconds * 1000,
    }];
  });
}

function parseReflog(output: string): GitReflogEntry[] {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [hash, shortHash, timestamp, selector, ...subjectParts] = line.split('\t');
    if (!hash || !shortHash || !selector) return [];
    const seconds = parseNum(timestamp ?? '');
    return [{
      hash,
      shortHash,
      selector,
      subject: subjectParts.join('\t') || '',
      date: seconds == null ? undefined : seconds * 1000,
    }];
  });
}

/** Parses `git apply --verbose` output into applied/skipped/conflicted path
 * lists. The line shapes below are git's own (verified against git 2.51):
 * `Applied patch <path> cleanly.`, `Skipped patch '<path>'.`, and the several
 * `error: …` forms. A path can appear in more than one list under `--reject`,
 * where git reports the failed hunk and then applies the rest, so conflicted
 * wins: the caller must treat that file as not fully applied. */
function parseGitApplyOutput(stdoutText: string, stderrText: string): {
  appliedPaths: string[];
  skippedPaths: string[];
  conflictedPaths: string[];
} {
  const applied = new Set<string>();
  const skipped = new Set<string>();
  const conflicted = new Set<string>();
  const combined = `${stdoutText}\n${stderrText}`;
  for (const rawLine of combined.split(/\r?\n/)) {
    const line = rawLine.trim();
    let match = /^Applied patch (.+?) cleanly\.$/.exec(line);
    if (match?.[1]) { applied.add(match[1]); continue; }
    match = /^Skipped patch '(.+?)'\.$/.exec(line);
    if (match?.[1]) { skipped.add(match[1]); continue; }
    match = /^error: patch failed: (.+?):\d+$/.exec(line)
      // Whole-file failures git reports without a line number.
      || /^error: (.+?): (?:patch does not apply|already exists(?: in working directory)?|does not exist in index|No such file or directory)$/.exec(line);
    if (match?.[1]) { conflicted.add(match[1]); continue; }
    // `--reject` partially applies a file whose hunks failed; the earlier
    // `error: patch failed` line already recorded it as conflicted.
    match = /^Applying patch (.+?) with \d+ reject/.exec(line);
    if (match?.[1]) { conflicted.add(match[1]); continue; }
  }
  for (const path of conflicted) applied.delete(path);
  return {
    appliedPaths: [...applied],
    skippedPaths: [...skipped],
    conflictedPaths: [...conflicted],
  };
}

/** Extract the paths a patch targets from `git apply --numstat -z`, which is
 * NUL-delimited and leaves paths unescaped. Used to name the affected files in
 * the approval prompt, so the user sees what a patch touches before allowing
 * it rather than approving an opaque blob. */
function parseApplyNumstatZ(output: string): string[] {
  const paths: string[] = [];
  for (const record of output.split('\0')) {
    if (!record) continue;
    // Each record is "<added>\t<removed>\t<path>"; counts are '-' for binary.
    const path = record.slice(record.indexOf('\t', record.indexOf('\t') + 1) + 1);
    if (path && !path.includes('\t')) paths.push(path);
  }
  return paths;
}

function parseBranches(output: string): GitBranch[] {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, marker, upstream, commit, updatedAt] = line.split('\t');
    return {
      name,
      current: marker === '*',
      upstream: upstream || undefined,
      commit: commit || undefined,
      updatedAt: updatedAt ? Number(updatedAt) * 1000 : undefined,
    };
  });
}

function parseStashes(output: string): GitStashEntry[] {
  return output.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const [selector, branch, message] = line.split('\t');
    const match = selector.match(/stash@\{(\d+)\}/);
    return {
      index: match ? Number(match[1]) : index,
      selector,
      branch: branch || undefined,
      message: message || '',
    };
  });
}

export function parseWorktrees(output: string): GitWorktree[] {
  const entries: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  for (const record of output.split('\0').filter(Boolean)) {
    if (record.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: record.slice('worktree '.length) };
    } else if (current && record.startsWith('HEAD ')) {
      current.head = record.slice('HEAD '.length);
    } else if (current && record.startsWith('branch ')) {
      current.branch = record.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && record === 'bare') {
      current.bare = true;
    } else if (current && record === 'detached') {
      current.detached = true;
    } else if (current && record.startsWith('prunable')) {
      current.prunable = true;
      current.reason = record.slice('prunable'.length).trim() || undefined;
    } else if (current && record.startsWith('locked')) {
      current.locked = true;
      current.reason = record.slice('locked'.length).trim() || current.reason;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function prFromGh(value: Record<string, unknown>): GithubPrSummary {
  const author = isRecord(value.author) ? normalizeString(value.author.login) : undefined;
  return {
    number: typeof value.number === 'number' ? value.number : 0,
    title: normalizeString(value.title) ?? '',
    state: normalizeString(value.state) ?? 'unknown',
    author,
    headRefName: normalizeString(value.headRefName),
    baseRefName: normalizeString(value.baseRefName),
    url: normalizeString(value.url),
    isDraft: value.isDraft === true,
    updatedAt: normalizeString(value.updatedAt),
  };
}

async function getGhPrUrl(number: number, cwd: string): Promise<string | undefined> {
  const result = await gh(['pr', 'view', String(number), '--json', 'url'], cwd);
  if (result.exitCode !== 0) return undefined;
  return normalizeString(parseJson<{ url?: string }>(result.stdout, {}).url);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureValidBranchName(ctx: RepoContext, branch: string): Promise<void> {
  const result = await git(['check-ref-format', '--branch', branch], ctx.workspaceRoot);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Invalid branch name: ${branch}`);
  }
}

async function localBranchExists(ctx: RepoContext, branch: string): Promise<boolean> {
  const result = await git(['branch', '--list', branch, '--format=%(refname:short)'], ctx.workspaceRoot);
  return result.exitCode === 0 && result.stdout.split(/\r?\n/).some((entry) => entry.trim() === branch);
}

async function applyGitPatch(payload: GitApplyPatchPayload, journaled = false): Promise<GitApplyPatchResult> {
      const patch = typeof payload.patch === 'string' ? payload.patch : '';
      if (!patch.trim()) throw new Error('patch is required');
      if (!/^diff --git /m.test(patch)) {
        throw new Error('patch must be a unified diff (git format)');
      }
      const mode: 'preflight' | 'apply' | 'revert' =
        payload.mode === 'revert' ? 'revert' : payload.mode === 'apply' ? 'apply' : 'preflight';
      const ctx = await requireRepoContext();

      const binding = payload.reviewBinding;
      const validateBinding = async () => {
        if (!binding) return;
        if (binding.workspaceId !== ctx.workspace.id || !binding.contextId || !binding.sessionKey
          || binding.patchDigest !== `sha256:${createHash('sha256').update(patch).digest('hex')}`) {
          throw new Error('Invalid review patch binding.');
        }
        const active = await getActiveWorkspaceProfile();
        const head = await git(['rev-parse', 'HEAD'], ctx.workspaceRoot);
        if (active?.id !== binding.workspaceId || active.rootPath !== ctx.workspace.rootPath
          || head.exitCode !== 0 || head.stdout.trim() !== binding.expectedHead) {
          throw new Error('Review destination is stale; refresh its HEAD before applying.');
        }
      };
      if (binding && !journaled && mode !== 'preflight') {
        const rejected = (reason: string): GitApplyPatchResult => ({ success: false, reason,
          appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: false, stale: /stale/.test(reason) });
        if (mode !== 'apply') return rejected('Review patches cannot use reverse apply.');
        const parsed = adaptUnifiedDiffToGitPatchArtifacts({ patch, sourceCompleteness: 'complete' });
        if (parsed.kind !== 'artifacts' || parsed.artifacts.length === 0
          || parsed.artifacts.some((file) => file.completeness !== 'complete' || file.contentKind !== 'text')) {
          return rejected('Review patch must be a complete text patch.');
        }
        const paths = [...new Set(parsed.artifacts.flatMap((file) => [file.file, file.oldPath, file.newPath].filter((p): p is string => Boolean(p))))];
        const absolutePaths: string[] = [];
        for (const path of paths) {
          const resolvedPath = resolveGitPath(ctx, path);
          if (/(^|[\\/])\.(git|openclaw)([\\/]|$)/i.test(path)
            || !(await isPathInsideWorkspaceResolved(resolvedPath.absolutePath, ctx.workspaceRoot))) {
            return rejected('Review patch path is outside the writable workspace.');
          }
          absolutePaths.push(resolvedPath.absolutePath);
        }
        const { journaledGitApply } = await import('../../openclaw_runtime/src/plugin-sdk/journaled-git-apply');
        const outcome = await journaledGitApply({ workspaceRoot: ctx.workspaceRoot, sessionKey: binding.sessionKey,
          paths: absolutePaths, validate: validateBinding,
          preflight: () => applyGitPatch({ ...payload, mode: 'preflight' }, true),
          apply: () => applyGitPatch(payload, true) });
        const result = outcome.result ?? rejected(outcome.error ?? 'Journaled review apply unavailable.');
        return { ...result, preflight: false, writeJournalId: outcome.journalRef,
          recoveryRequired: outcome.recoveryRequired,
          destinationHead: result.success ? binding.expectedHead : undefined };
      }
      try { await validateBinding(); } catch (error) {
        return { success: false, stale: true, reason: String(error), appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: mode === 'preflight' };
      }

      // Write the patch to a temp file so the diff never crosses a shell or argv.
      const tempDir = await mkdtemp(join(tmpdir(), 'verse-claw-apply-'));
      const patchFile = join(tempDir, 'input.patch');
      try {
        await writeFile(patchFile, patch, 'utf8');

        // Preflight first so dangerous approval is only requested for patches
        // that actually parse. Check mode never writes.
        const checkArgs = ['apply', '--check', '--verbose'];
        if (mode === 'revert') checkArgs.push('--reverse');
        const checkResult = await git([...checkArgs, patchFile], ctx.workspaceRoot);
        const checkParsed = parseGitApplyOutput(checkResult.stdout, checkResult.stderr);

        if (mode === 'preflight') {
          // Only real paths go in conflictedPaths. A patch can fail before git
          // attributes the failure to any file (unparsable header, bad binary
          // hunk); success:false plus stderr carries that, and a synthetic
          // path would be rendered as a filename by callers.
          return {
            success: checkResult.exitCode === 0,
            appliedPaths: [],
            skippedPaths: [],
            conflictedPaths: checkParsed.conflictedPaths,
            preflight: true,
            exitCode: checkResult.exitCode,
            stdout: trimOutput(checkResult.stdout),
            stderr: trimOutput(checkResult.stderr),
          };
        }

        // A patch that fails --check cannot apply, so fail closed here rather
        // than spending a dangerous approval on an operation that would abort.
        // git apply without --reject/--3way is all-or-nothing, so nothing was
        // written either way.
        if (checkResult.exitCode !== 0) {
          return {
            success: false,
            appliedPaths: [],
            skippedPaths: [],
            conflictedPaths: checkParsed.conflictedPaths,
            preflight: false,
            exitCode: checkResult.exitCode,
            stdout: trimOutput(checkResult.stdout),
            stderr: trimOutput(checkResult.stderr),
          };
        }

        // Name the files in the approval prompt so the user is not asked to
        // allow an opaque patch. numstat runs on the same temp file that
        // --check just validated, so the list matches what apply will touch.
        const numstatArgs = mode === 'revert'
          ? ['apply', '--numstat', '-z', '--reverse']
          : ['apply', '--numstat', '-z'];
        const numstat = await git([...numstatArgs, patchFile], ctx.workspaceRoot);
        const targetPaths = numstat.exitCode === 0 ? parseApplyNumstatZ(numstat.stdout) : [];

        // Apply/revert mutates the working tree: dangerous approval.
        const runArgs = mode === 'revert'
          ? ['apply', '--reverse', '--verbose']
          : ['apply', '--verbose'];
        // Bind the approval to this exact patch. requestHash is derived from
        // the command string and paths, so without the digest an approval for
        // one patch would be reusable for any other patch touching the same
        // files — including one with entirely different content.
        const patchDigest = createHash('sha256').update(patch, 'utf8').digest('hex').slice(0, 16);
        const command = `git ${[...runArgs, `<patch-file sha256:${patchDigest}>`].join(' ')}${binding ? ` head:${binding.expectedHead} context:${binding.contextId}` : ''}`;
        const blocked = await enforcePermission({
          workspace: ctx.workspace,
          action: mode === 'revert' ? 'applyRevert' : 'applyPatch',
          risk: 'dangerous',
          approvalId: payload.approvalId,
          command,
          paths: targetPaths,
          grading: [
            targetPaths.length > 0
              ? `${mode === 'revert' ? 'Reverts' : 'Applies'} a patch to ${targetPaths.length} file(s): ${targetPaths.join(', ')}.`
              : `${mode === 'revert' ? 'Reverts' : 'Applies'} a patch whose target files could not be enumerated.`,
          ],
        });
        if (blocked) {
          return {
            ...blocked,
            appliedPaths: [],
            skippedPaths: [],
            conflictedPaths: [],
            preflight: false,
          } as GitApplyPatchResult;
        }

        try { await validateBinding(); } catch (error) {
          return { success: false, stale: true, reason: String(error), appliedPaths: [], skippedPaths: [], conflictedPaths: [], preflight: false };
        }
        const result = await git([...runArgs, patchFile], ctx.workspaceRoot);
        const parsed = parseGitApplyOutput(result.stdout, result.stderr);
        return {
          success: result.exitCode === 0,
          appliedPaths: parsed.appliedPaths,
          skippedPaths: parsed.skippedPaths,
          conflictedPaths: parsed.conflictedPaths,
          preflight: false,
          exitCode: result.exitCode,
          stdout: trimOutput(result.stdout),
          stderr: trimOutput(result.stderr),
          status: result.exitCode === 0 ? await readCurrentGitStatus().catch(() => undefined) : undefined,
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

export function createGitApi(): CompleteHostServiceRegistry['git'] {
  return {
    init: async () => {
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      const blocked = await enforcePermission({ workspace, action: 'init', risk: 'write', command: 'git init', paths: [workspace.rootPath] });
      if (blocked) return blocked;
      const existing = await git(['rev-parse', '--show-toplevel'], workspace.rootPath);
      if (existing.exitCode === 0) return { success: true, status: await readCurrentGitStatus() };
      const result = await git(['init'], workspace.rootPath);
      invalidateGitStatusCache(workspace.rootPath);
      return { success: result.exitCode === 0, ...result, status: result.exitCode === 0 ? await readCurrentGitStatus() : undefined };
    },
    capabilities: async () => {
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      const gitVersion = await git(['--version'], workspace.rootPath);
      const ghVersion = await gh(['--version'], workspace.rootPath);
      return {
        success: true,
        git: {
          available: gitVersion.exitCode === 0,
          version: gitVersion.exitCode === 0 ? gitVersion.stdout.split(/\r?\n/)[0] : undefined,
          error: gitVersion.exitCode === 0 ? undefined : gitVersion.stderr || 'git not found',
        },
        gh: {
          available: ghVersion.exitCode === 0,
          version: ghVersion.exitCode === 0 ? ghVersion.stdout.split(/\r?\n/)[0] : undefined,
          error: ghVersion.exitCode === 0 ? undefined : ghVersion.stderr || 'gh not found',
        },
      };
    },
    status: async () => ({ success: true, status: await readCurrentGitStatus() }),
    diff: async (payload) => {
      const ctx = await requireRepoContext();
      const mode = isRecord(payload) && payload.mode === 'staged' ? 'staged' : 'unstaged';
      const args = mode === 'staged' ? ['diff', '--cached'] : ['diff'];
      const result = await git(args, ctx.workspaceRoot);
      const changes = (await readCurrentGitStatus()).changes;
      const tooLarge = result.stdout.length > MAX_PATCH_CHARS;
      const patch = trimOutput(result.stdout, MAX_PATCH_CHARS);
      return {
        success: result.exitCode === 0,
        changes,
        patch,
        tooLarge,
        ...projectGitPatch({ patch, mode, changes, tooLarge }),
        error: result.exitCode === 0 ? undefined : result.stderr,
      };
    },
    fileDiff: async (payload: GitFileDiffPayload) => {
      const ctx = await requireRepoContext();
      const path = resolveGitPath(ctx, payload.path);
      const mode: GitDiffMode = payload.mode === 'staged' ? 'staged' : 'unstaged';
      const status = await readCurrentGitStatus().catch(() => null);
      const change = status?.changes.find((entry) => entry.path === path.gitPath);
      const isUntracked = mode === 'unstaged' && change?.untracked === true;

      if (isUntracked) {
        const modified = await workingTreeText(path.absolutePath);
        const patch = untrackedPatch(path.gitPath, modified);
        const tooLarge = patch.length > MAX_PATCH_CHARS || modified.length > MAX_PATCH_CHARS;
        const changes = status?.changes ?? [];
        return {
          success: true,
          path: path.gitPath,
          mode,
          patch: trimOutput(patch, MAX_PATCH_CHARS),
          ...projectGitPatch({
            patch,
            mode,
            changes,
            tooLarge,
            requestedPath: path.gitPath,
          }),
          original: '',
          modified: diffContent(modified, tooLarge),
          tooLarge,
          binary: false,
        };
      }

      const args = mode === 'staged'
        ? ['diff', '--cached', '--', path.gitPath]
        : ['diff', '--', path.gitPath];
      const result = await git(args, ctx.workspaceRoot);
      const tooLarge = result.stdout.length > MAX_PATCH_CHARS;
      const binary = /Binary files .* differ/.test(result.stdout);
      const original = mode === 'staged'
        ? await gitTextAt(ctx, 'HEAD', path.gitPath)
        : await gitTextAt(ctx, 'INDEX', path.gitPath);
      const modified = mode === 'staged'
        ? await gitTextAt(ctx, 'INDEX', path.gitPath)
        : await workingTreeText(path.absolutePath);
      const changes = status?.changes ?? [];
      return {
        success: result.exitCode === 0,
        path: path.gitPath,
        mode,
        patch: trimOutput(result.stdout, MAX_PATCH_CHARS),
        ...projectGitPatch({
          patch: result.stdout,
          mode,
          changes,
          tooLarge,
          requestedPath: path.gitPath,
        }),
        original: binary ? undefined : diffContent(original, tooLarge),
        modified: binary ? undefined : diffContent(modified, tooLarge),
        tooLarge,
        binary,
        error: result.exitCode === 0 ? undefined : result.stderr,
      };
    },
    applyPatch: (payload: GitApplyPatchPayload) => applyGitPatch(payload),
    diffToBase: async (payload): Promise<GitDiffToBaseResult> => {
      const body = (isRecord(payload) ? payload : {}) as GitDiffToBasePayload;
      const ctx = await requireRepoContext();
      const resolved = await resolveDiffBase(ctx, normalizeString(body.base) ?? '');
      if (resolved.resolution === 'unavailable') {
        return { success: false, resolution: 'unavailable', files: [], reason: resolved.reason };
      }

      const mergeBaseResult = await git(['merge-base', 'HEAD', resolved.base], ctx.workspaceRoot);
      const mergeBase = mergeBaseResult.exitCode === 0 ? mergeBaseResult.stdout.trim() : '';
      if (!mergeBase) {
        // Unrelated histories: a diff would show every file as added, which
        // reads as a real changeset. Report unavailable instead.
        return {
          success: false,
          resolution: 'unavailable',
          base: resolved.base,
          files: [],
          reason: `no common ancestor between HEAD and ${resolved.base}`,
        };
      }

      const scopedPaths = normalizePaths(body.paths).map((entry) => resolveGitPath(ctx, entry).gitPath);
      const pathArgs = scopedPaths.length > 0 ? ['--', ...scopedPaths] : ['--'];
      const nameStatus = await git(
        ['diff', '--name-status', '-z', '--find-renames', mergeBase, 'HEAD', ...pathArgs],
        ctx.workspaceRoot,
      );
      if (nameStatus.exitCode !== 0) {
        return {
          success: false,
          resolution: resolved.resolution,
          base: resolved.base,
          mergeBase,
          files: [],
          error: nameStatus.stderr || nameStatus.stdout,
        };
      }

      const allEntries = parseNameStatusZ(nameStatus.stdout);
      const entries = allEntries.slice(0, MAX_BASE_DIFF_FILES);

      // One --numstat call covers every file's line counts. Patches cost one
      // `git diff` per file, so they are opt-in: a caller rendering a header
      // needs the counts, not 200 patch bodies.
      const numstat = await git(
        ['diff', '--numstat', '-z', '--find-renames', mergeBase, 'HEAD', ...pathArgs],
        ctx.workspaceRoot,
      );
      const stats = numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : new Map<string, DiffStat>();

      const includePatches = body.includePatches === true;
      const files: GitBaseDiffFile[] = [];
      let additions = 0;
      let deletions = 0;
      for (const entry of entries) {
        const stat = stats.get(entry.path);
        if (stat?.additions != null) additions += stat.additions;
        if (stat?.deletions != null) deletions += stat.deletions;

        if (!includePatches) {
          files.push({
            path: entry.path,
            changeKind: entry.changeKind,
            patch: '',
            additions: stat?.additions ?? null,
            deletions: stat?.deletions ?? null,
            binary: stat?.binary || undefined,
          });
          continue;
        }

        const patchResult = await git(
          ['diff', mergeBase, 'HEAD', '--', entry.path],
          ctx.workspaceRoot,
        );
        const tooLarge = patchResult.stdout.length > MAX_PATCH_CHARS;
        files.push({
          path: entry.path,
          changeKind: entry.changeKind,
          patch: trimOutput(patchResult.stdout, MAX_PATCH_CHARS),
          additions: stat?.additions ?? null,
          deletions: stat?.deletions ?? null,
          tooLarge: tooLarge || undefined,
          binary: stat?.binary || /Binary files .* differ/.test(patchResult.stdout) || undefined,
        });
      }

      return {
        success: true,
        resolution: resolved.resolution,
        base: resolved.base,
        mergeBase,
        files,
        totals: { files: files.length, additions, deletions },
        truncated: allEntries.length > entries.length || undefined,
      };
    },
    stage: async (payload: GitPathsPayload) => {
      const ctx = await requireRepoContext();
      const paths = normalizePaths(payload.paths).map((entry) => resolveGitPath(ctx, entry).gitPath);
      if (paths.length === 0) throw new Error('paths are required');
      return withGitOperation('stage', 'write', ['add', '--', ...paths], { approvalId: payload.approvalId, paths });
    },
    unstage: async (payload: GitPathsPayload) => {
      const ctx = await requireRepoContext();
      const paths = normalizePaths(payload.paths).map((entry) => resolveGitPath(ctx, entry).gitPath);
      if (paths.length === 0) throw new Error('paths are required');
      return withGitOperation('unstage', 'write', ['restore', '--staged', '--', ...paths], { approvalId: payload.approvalId, paths });
    },
    revertFile: async (payload: GitPathPayload) => {
      const ctx = await requireRepoContext();
      const rawPath = normalizeString(payload.path);
      if (!rawPath) throw new Error('path is required');
      const path = resolveGitPath(ctx, rawPath);
      const status = await readCurrentGitStatus().catch(() => null);
      const change = status?.changes.find((entry) => entry.path === path.gitPath);
      const args = change?.untracked
        ? ['clean', '-f', '--', path.gitPath]
        : ['restore', '--source=HEAD', '--staged', '--worktree', '--', path.gitPath];
      return withGitOperation('revertFile', 'dangerous', args, {
        approvalId: payload.approvalId,
        paths: [path.gitPath],
      });
    },
    commit: async (payload: GitCommitPayload) => {
      const ctx = await requireRepoContext();
      const message = normalizeString(payload.message);
      if (!message) throw new Error('message is required');
      const paths = normalizePaths(payload.paths).map((entry) => resolveGitPath(ctx, entry).gitPath);
      const blocked = await enforcePermission({
        workspace: ctx.workspace,
        action: 'commit',
        risk: 'write',
        approvalId: payload.approvalId,
        command: 'git commit -F <message-file>',
        paths,
      });
      if (blocked) return blocked;
      const tempDir = await mkdtemp(join(tmpdir(), 'clawx-git-'));
      const messageFile = join(tempDir, 'COMMIT_EDITMSG');
      try {
        await writeFile(messageFile, message, 'utf8');
        const result = await git(['commit', '-F', messageFile, ...(paths.length ? ['--', ...paths] : [])], ctx.workspaceRoot);
        if (result.exitCode === 0) invalidateGitStatusCache(ctx.repoRoot);
        const head = result.exitCode === 0 ? await git(['rev-parse', '--short', 'HEAD'], ctx.workspaceRoot) : null;
        return {
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          commit: head?.stdout.trim() || undefined,
        status: result.exitCode === 0 ? await readCurrentGitStatus().catch(() => undefined) : undefined,
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    branches: async () => {
      const ctx = await requireRepoContext();
      const result = await git([
        'branch',
        '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(objectname:short)%09%(committerdate:unix)',
        '--sort=-committerdate',
      ], ctx.workspaceRoot);
      return { success: result.exitCode === 0, branches: parseBranches(result.stdout), error: result.exitCode === 0 ? undefined : result.stderr };
    },
    log: async (payload) => {
      const ctx = await requireRepoContext();
      const body = (isRecord(payload) ? payload : {}) as GitLogPayload;
      const rawRef = normalizeString(body.ref);
      const ref = rawRef && rawRef !== 'HEAD' ? rawRef : 'HEAD';
      if (ref !== 'HEAD' && !isSafeGitRef(ref)) {
        throw new Error(`Invalid git ref: ${ref}`);
      }
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(Math.floor(body.limit), 100))
        : 20;
      const result = await git([        'log',
        ref,
        `--max-count=${limit}`,
        '--format=%H%x09%h%x09%ct%x09%an%x09%s',
        '--',
      ], ctx.workspaceRoot);
      if (result.exitCode !== 0) {
        return { success: false, commits: [], ref, error: result.stderr || result.stdout };
      }
      let ahead: number | undefined;
      let behind: number | undefined;
      if (ref !== 'HEAD') {
        const counts = await git(['rev-list', '--left-right', '--count', `${ref}...HEAD`, '--'], ctx.workspaceRoot);
        if (counts.exitCode === 0) {
          const [left, right] = counts.stdout.trim().split(/\s+/);
          ahead = parseNum(left ?? '') ?? undefined;
          behind = parseNum(right ?? '') ?? undefined;
        }
      }
      return { success: true, commits: parseCommitLog(result.stdout), ref, ahead, behind };
    },
    reflog: async (payload) => {
      const ctx = await requireRepoContext();
      const body = (isRecord(payload) ? payload : {}) as GitReflogPayload;
      const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(Math.floor(body.limit), 500))
        : 200;
      // Ask for one extra row so a full page can be reported as truncated
      // instead of silently hiding older reference movement.
      const result = await git([
        'reflog',
        '--all',
        `--max-count=${limit + 1}`,
        '--date=unix',
        '--format=%H%x09%h%x09%ct%x09%gd%x09%gs',
      ], ctx.workspaceRoot);
      const allEntries = result.exitCode === 0 ? parseReflog(result.stdout) : [];
      return {
        success: result.exitCode === 0,
        entries: allEntries.slice(0, limit),
        truncated: result.exitCode === 0 ? allEntries.length > limit : undefined,
        error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
      };
    },
    mergeBase: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitMergeBasePayload;
      const base = normalizeString(body.base);
      const rawHead = normalizeString(body.head);
      const head = rawHead && rawHead !== 'HEAD' ? rawHead : 'HEAD';
      if (!base) throw new Error('base is required');
      if (!isSafeGitRef(base) || !isSafeGitRef(head)) {
        throw new Error(`Invalid git ref for merge-base: ${base} ${head}`);
      }
      const ctx = await requireRepoContext();
      const result = await git(['merge-base', head, base], ctx.workspaceRoot);
      if (result.exitCode !== 0 || !result.stdout.trim()) {
        return {
          success: false,
          error: result.stderr.trim() || `No common ancestor between ${head} and ${base}`,
        };
      }
      return { success: true, mergeBase: result.stdout.trim() };
    },
    checkoutBranch: async (payload: GitBranchCheckoutPayload) => {
      const ctx = await requireRepoContext();
      const name = normalizeString(payload.name);
      if (!name) throw new Error('name is required');
      await ensureValidBranchName(ctx, name);
      return withGitOperation('checkoutBranch', 'write', ['checkout', name], { approvalId: payload.approvalId });
    },
    createBranch: async (payload: GitBranchCreatePayload) => {
      const ctx = await requireRepoContext();
      const name = normalizeString(payload.name);
      if (!name) throw new Error('name is required');
      await ensureValidBranchName(ctx, name);
      const args = payload.checkout === false ? ['branch', name] : ['checkout', '-b', name];
      const startPoint = normalizeString(payload.startPoint);
      if (startPoint) args.push(startPoint);
      return withGitOperation('createBranch', 'write', args, { approvalId: payload.approvalId });
    },
    stashList: async () => {
      const ctx = await requireRepoContext();
      const result = await git(['stash', 'list', '--format=%gd%x09%gs%x09%s'], ctx.workspaceRoot);
      return { success: result.exitCode === 0, stashes: parseStashes(result.stdout), error: result.exitCode === 0 ? undefined : result.stderr };
    },
    stashPush: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitStashPayload;
      const args = ['stash', 'push'];
      const message = normalizeString(body.message);
      if (message) args.push('-m', message);
      if (body.includeUntracked) args.push('--include-untracked');
      return withGitOperation('stashPush', 'write', args, { approvalId: body.approvalId });
    },
    stashApply: async (payload: GitStashRefPayload) => {
      const selector = normalizeString(payload.selector);
      if (!selector) throw new Error('selector is required');
      return withGitOperation('stashApply', 'dangerous', ['stash', 'apply', selector], { approvalId: payload.approvalId });
    },
    stashPop: async (payload: GitStashRefPayload) => {
      const selector = normalizeString(payload.selector);
      if (!selector) throw new Error('selector is required');
      return withGitOperation('stashPop', 'dangerous', ['stash', 'pop', selector], { approvalId: payload.approvalId });
    },
    worktrees: () => readWorkspaceGitWorktrees(),
    worktreeAdd: async (payload: GitWorktreeAddPayload) => {
      const ctx = await requireRepoContext();
      const branch = normalizeString(payload.branch);
      if (!branch) throw new Error('branch is required');
      await ensureValidBranchName(ctx, branch);
      const checkoutNewBranch = payload.checkoutNewBranch !== false;
      const startPoint = normalizeString(payload.startPoint) ?? 'HEAD';
      const slug = branch.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'worktree';
      const repoFolder = basename(ctx.repoRoot) || 'workspace';
      const target = payload.path
        ? resolveWorkspacePath(ctx, payload.path)
        : resolve(dirname(ctx.repoRoot), `${repoFolder}-${slug}`);
      if (await pathExists(target)) {
        return {
          success: false,
          blocked: true,
          reason: 'Worktree target path already exists.',
        };
      }
      const listed = await git(['worktree', 'list', '--porcelain', '-z'], ctx.workspaceRoot);
      const knownWorktrees = listed.exitCode === 0 ? parseWorktrees(listed.stdout) : [];
      const branchWorktree = knownWorktrees.find((worktree) => worktree.branch === branch);
      if (!checkoutNewBranch && branchWorktree) {
        return {
          success: false,
          blocked: true,
          reason: `Branch is already checked out at ${branchWorktree.path}.`,
        };
      }
      if (checkoutNewBranch && await localBranchExists(ctx, branch)) {
        return {
          success: false,
          blocked: true,
          reason: 'Branch already exists. Choose Existing branch or use a new branch name.',
        };
      }
      const customOutsideSafeArea = Boolean(payload.path)
        && !isPathInsideWorkspace(target, ctx.workspaceRoot)
        && !isPathInsideRepoSiblingArea(target, ctx.repoRoot);
      const args = ['worktree', 'add'];
      if (checkoutNewBranch) {
        args.push('-b', branch, target, startPoint);
      } else {
        args.push(target, branch);
      }
      const result = await withGitOperation('worktreeAdd', customOutsideSafeArea ? 'dangerous' : 'write', args, {
        approvalId: payload.approvalId,
        paths: [target],
        context: ctx,
      });
      return { ...result, ...(result.success ? { worktree: { path: target, branch } } : {}) };
    },
    worktreeRemove: async (payload: GitPathPayload) => {
      const ctx = await requireRepoContext();
      const rawPath = normalizeString(payload.path);
      if (!rawPath) throw new Error('path is required');
      const target = resolveWorkspacePath(ctx, rawPath);
      const listed = await git(['worktree', 'list', '--porcelain', '-z'], ctx.workspaceRoot);
      const knownWorktree = listed.exitCode === 0
        ? parseWorktrees(listed.stdout).some((worktree) => resolve(worktree.path) === target)
        : false;
      if (!knownWorktree) throw new Error('worktree path is not registered with this repository');
      return withGitOperation('worktreeRemove', 'dangerous', ['worktree', 'remove', '--', target], {
        approvalId: payload.approvalId,
        paths: [target],
        context: ctx, removalTarget: target,
      });
    },
    worktreePrune: async (payload) => withGitOperation(
      'worktreePrune',
      'dangerous',
      ['worktree', 'prune'],
      { approvalId: isRecord(payload) ? normalizeString(payload.approvalId) : undefined },
    ),
    fetch: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitFetchPayload;
      return withGitOperation('fetch', 'write', ['fetch', ...(normalizeString(body.remote) ? [normalizeString(body.remote)!] : [])], {
        approvalId: body.approvalId,
      });
    },
    pull: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitPullPayload;
      const args = ['pull'];
      if (body.rebase) args.push('--rebase');
      const remote = normalizeString(body.remote);
      const branch = normalizeString(body.branch);
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      return withGitOperation('pull', 'dangerous', args, { approvalId: body.approvalId });
    },
    push: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitPushPayload;
      const args = ['push'];
      if (body.setUpstream) args.push('-u');
      const remote = normalizeString(body.remote);
      const branch = normalizeString(body.branch);
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const currentBranch = (await readCurrentGitStatus().catch(() => undefined))?.branch;
      return withGitOperation('push', 'dangerous', args, {
        approvalId: body.approvalId,
        grading: gradePushTarget({ remote, branch, currentBranch }),
      });
    },
    merge: async (payload: GitMergePayload) => {
      const ref = normalizeString(payload.ref);
      if (!ref) throw new Error('ref is required');
      if (!isSafeGitRef(ref)) throw new Error(`Invalid git ref: ${ref}`);
      const args = ['merge'];
      if (payload.noFastForward) args.push('--no-ff');
      args.push(ref);
      return withGitOperation('merge', 'dangerous', args, { approvalId: payload.approvalId });
    },
    rebase: async (payload: GitRebasePayload) => {
      const ref = normalizeString(payload.ref);
      if (!ref) throw new Error('ref is required');
      if (!isSafeGitRef(ref)) throw new Error(`Invalid git ref: ${ref}`);
      const currentBranch = (await readCurrentGitStatus().catch(() => undefined))?.branch;
      return withGitOperation('rebase', 'dangerous', ['rebase', ref], {
        approvalId: payload.approvalId,
        grading: [
          `Rebase rewrites ${currentBranch ? `${currentBranch}'s` : 'the current branch'} commits onto ${ref}, so existing commit hashes change.`,
          ...(currentBranch && isProtectedBranchName(currentBranch)
            ? [`${currentBranch} is a shared branch; rewriting it diverges from anyone who already pulled it.`]
            : []),
        ],
      });
    },
    reset: async (payload) => {
      const body = (isRecord(payload) ? payload : {}) as GitResetPayload;
      const ref = normalizeString(body.ref) ?? 'HEAD';
      const mode = body.mode === 'soft' || body.mode === 'hard' ? body.mode : 'mixed';
      if (ref !== 'HEAD' && !isSafeGitRef(ref)) throw new Error(`Invalid git ref: ${ref}`);
      return withGitOperation('reset', 'dangerous', ['reset', `--${mode}`, ref], {
        approvalId: body.approvalId,
        grading: mode === 'hard'
          ? [`Reset --hard to ${ref} discards uncommitted changes in the working tree and index.`]
          : [`Reset --${mode} to ${ref} moves the branch pointer; working tree files are kept.`],
      });
    },
    githubAuthStatus: async () => {
      const ctx = await requireRepoContext();
      // Prefer machine-readable output when the installed gh supports it
      // (`gh auth status --json`, gh >= 2.32); fall back to parsing the
      // human-readable text otherwise. Text output is a presentation format,
      // so unknown fields degrade to undefined instead of guessing.
      const jsonResult = await gh(['auth', 'status', '--json'], ctx.workspaceRoot);
      if (jsonResult.exitCode === 0) {
        const raw = parseJson<Record<string, unknown>>(jsonResult.stdout, {});
        const hostsRaw = Array.isArray(raw.hosts) ? raw.hosts : [];
        return {
          success: true,
          available: true,
          authenticated: raw.state === 'logged_in' || Boolean(raw.active),
          user: normalizeString(isRecord(raw.user) ? raw.user.login : undefined),
          hosts: hostsRaw.filter((h): h is string => typeof h === 'string' && h.trim().length > 0),
        };
      }
      if (/unknown command|no such flag|not found|ENOENT/i.test(`${jsonResult.stderr}`)) {
        const result = await gh(['auth', 'status'], ctx.workspaceRoot);
        const userMatch = result.stdout.match(/Logged in to .* account ([^\s]+)/i)
          ?? result.stderr.match(/Logged in to .* account ([^\s]+)/i);
        const hosts = [...new Set(`${result.stdout}\n${result.stderr}`.match(/github\.[^\s)]+|github\.com/g) ?? [])];
        return {
          success: true,
          available: result.exitCode !== 1 || !/not found|ENOENT/i.test(result.stderr),
          authenticated: result.exitCode === 0,
          user: userMatch?.[1],
          hosts,
          error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
        };
      }
      // JSON unsupported AND not an old-gh signature: surface as unavailable
      return {
        success: true,
        available: false,
        authenticated: false,
        hosts: [],
        error: jsonResult.stderr || jsonResult.stdout || 'gh auth status failed'
      };
    },
    githubRepo: async () => {
      const ctx = await requireRepoContext();
      const result = await gh(['repo', 'view', '--json', 'owner,name,url,defaultBranchRef'], ctx.workspaceRoot);
      if (result.exitCode !== 0) return { success: false, repository: null, error: result.stderr || result.stdout };
      const raw = parseJson<Record<string, unknown>>(result.stdout, {});
      const owner = isRecord(raw.owner) ? normalizeString(raw.owner.login) : undefined;
      const defaultBranch = isRecord(raw.defaultBranchRef) ? normalizeString(raw.defaultBranchRef.name) : undefined;
      return {
        success: true,
        repository: {
          owner,
          name: normalizeString(raw.name),
          url: normalizeString(raw.url),
          defaultBranch,
        },
      };
    },
    prList: async (payload) => {
      const ctx = await requireRepoContext();
      const body = (isRecord(payload) ? payload : {}) as GithubPrListPayload;
      const state = ['open', 'closed', 'merged', 'all'].includes(String(body.state)) ? String(body.state) : 'open';
      const result = await gh([
        'pr',
        'list',
        '--state',
        state,
        '--limit',
        String(normalizeLimit(body.limit)),
        '--json',
        'number,title,state,author,headRefName,baseRefName,url,isDraft,updatedAt',
      ], ctx.workspaceRoot);
      return {
        success: result.exitCode === 0,
        pullRequests: parseJson<Array<Record<string, unknown>>>(result.stdout, []).map(prFromGh),
        error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
      };
    },
    prView: async (payload) => {
      const ctx = await requireRepoContext();
      const number = typeof payload.number === 'number' ? Math.floor(payload.number) : 0;
      if (number <= 0) throw new Error('number is required');
      const result = await gh([
        'pr',
        'view',
        String(number),
        '--json',
        'number,title,state,author,headRefName,baseRefName,url,isDraft,updatedAt,body',
      ], ctx.workspaceRoot);
      const raw = parseJson<Record<string, unknown>>(result.stdout, {});
      return {
        success: result.exitCode === 0,
        pullRequest: result.exitCode === 0 ? prFromGh(raw) : null,
        body: normalizeString(raw.body),
        error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
      };
    },
    prCreate: async (payload: GithubPrCreateInput) => {
      const ctx = await requireRepoContext();
      const title = normalizeString(payload.title);
      const body = typeof payload.body === 'string' ? payload.body : '';
      if (!title) throw new Error('title is required');
      const args = ['pr', 'create', '--title', title, '--body', body];
      const base = normalizeString(payload.base);
      const head = normalizeString(payload.head);
      // PR preflight (Open SWE parity): base/head branches must exist before
      // creating, with actionable error text instead of a raw gh failure.
      for (const [label, ref] of [['base', base], ['head', head]] as const) {
        if (!ref) continue;
        if (!isSafeGitRef(ref)) {
          return {
            success: false,
            stdout: '',
            stderr: `${label} branch '${ref}' is not a valid git ref`,
            exitCode: 2,
            reason: `invalid ${label} branch '${ref}' (likely_cause: unsafe ref; suggested_action: use a plain branch name)`,
          };
        }
        const local = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], ctx.workspaceRoot);
        const remote = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`], ctx.workspaceRoot);
        if (local.exitCode !== 0 && remote.exitCode !== 0) {
          return {
            success: false,
            stdout: '',
            stderr: `${label} branch '${ref}' not found locally or on origin`,
            exitCode: 2,
            reason: `${label} branch '${ref}' not found (likely_cause: branch does not exist; suggested_action: create/push it or pick an existing ${label})`,
          };
        }
      }
      if (base) args.push('--base', base);
      if (head) args.push('--head', head);
      if (normalizeBoolean(payload.draft)) args.push('--draft');
      const blocked = await enforcePermission({
        workspace: ctx.workspace,
        action: 'prCreate',
        risk: 'dangerous',
        approvalId: payload.approvalId,
        command: `gh ${args.join(' ')}`,
      });
      if (blocked) return blocked;
      // Reuse an existing open PR for the head branch (Open SWE 422 parity)
      // instead of failing with a duplicate-PR error.
      const headForLookup = head || (await readCurrentGitStatus().catch(() => null))?.branch;
      if (headForLookup) {
        const existingList = await gh(['pr', 'list', '--head', headForLookup, '--state', 'open', '--json', 'number,title,state,author,headRefName,baseRefName,url,isDraft,updatedAt'], ctx.workspaceRoot);
        if (existingList.exitCode === 0) {
          const existing = parseJson<Array<Record<string, unknown>>>(existingList.stdout, [])[0];
          if (existing) {
            return {
              success: true,
              stdout: existingList.stdout,
              stderr: '',
              exitCode: 0,
              pullRequest: prFromGh(existing),
              reused: true,
            };
          }
        }
      }
      const result = await gh([...args, '--json', 'number,title,state,author,headRefName,baseRefName,url,isDraft,updatedAt'], ctx.workspaceRoot);
      const raw = parseJson<Record<string, unknown>>(result.stdout, {});
      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        pullRequest: result.exitCode === 0 ? prFromGh(raw) : undefined,
      };
    },
    openPr: async (payload) => {
      const ctx = await requireRepoContext();
      const number = typeof payload.number === 'number' ? Math.floor(payload.number) : 0;
      if (number <= 0) throw new Error('number is required');
      const url = await getGhPrUrl(number, ctx.workspaceRoot);
      if (!url) return { success: false, stderr: 'Unable to resolve pull request URL' };
      await openExternalSafe(url);
      return { success: true, stdout: url };
    },
  };
}
