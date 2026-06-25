import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { shell } from 'electron';
import type {
  GitBranch,
  GitChangeBucket,
  GitDiffMode,
  GitFileChange,
  GitOperationResult,
  GitRepositoryStatus,
  GitStashEntry,
  GitWorktree,
  GithubPrSummary,
} from '@shared/types/git';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type {
  GitBranchCreatePayload,
  GitBranchCheckoutPayload,
  GitCommitPayload,
  GitFetchPayload,
  GitFileDiffPayload,
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
import { getActiveWorkspaceProfile } from './workspaces-api';
import { isPathInsideWorkspace, requireWorkspace } from './workspace-permissions';

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
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[output truncated]`;
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

function execBinary(command: 'git' | 'gh', args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const maybeCode = error && typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : error ? 1 : 0;
      resolveResult({
        exitCode: maybeCode,
        stdout: trimOutput(typeof stdout === 'string' ? stdout : String(stdout ?? '')),
        stderr: trimOutput(typeof stderr === 'string' ? stderr : String(stderr ?? '')),
      });
    });
  });
}

async function git(args: string[], cwd: string): Promise<ExecResult> {
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

async function requireRepoContext(): Promise<RepoContext> {
  const workspace = requireWorkspace(await getActiveWorkspaceProfile());
  const workspaceRoot = resolve(workspace.rootPath);
  const repo = await git(['rev-parse', '--show-toplevel'], workspaceRoot);
  if (repo.exitCode !== 0 || !repo.stdout.trim()) {
    throw new Error(repo.stderr.trim() || 'Active workspace is not a Git repository');
  }
  const repoRoot = resolve(repo.stdout.trim());
  return { workspace, workspaceRoot, repoRoot };
}

async function getRepoContextOrNull(): Promise<RepoContext | null> {
  try {
    return await requireRepoContext();
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
  const relativePath = relative(parent, target);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
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

export async function readCurrentGitStatus(): Promise<GitRepositoryStatus> {
  const workspace = requireWorkspace(await getActiveWorkspaceProfile());
  const ctx = await getRepoContextOrNull();
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

async function enforcePermission(input: {
  workspace: WorkspaceProfile;
  action: string;
  risk: GitRisk;
  approvalId?: string;
  command: string;
  paths?: string[];
}): Promise<GitOperationResult | null> {
  if (input.risk === 'none') return null;
  const requestHash = createRequestHash(input.action, input.workspace, {
    command: input.command,
    paths: input.paths ?? [],
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
      reason: 'This Git/GitHub operation can rewrite or publish repository state and requires approval.',
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
  }
  return null;
}

async function withGitOperation(
  action: string,
  risk: GitRisk,
  args: string[],
  payload: { approvalId?: string; paths?: string[] } = {},
): Promise<GitOperationResult> {
  const ctx = await requireRepoContext();
  const blocked = await enforcePermission({
    workspace: ctx.workspace,
    action,
    risk,
    approvalId: payload.approvalId,
    command: `git ${args.join(' ')}`,
    paths: payload.paths,
  });
  if (blocked) return blocked;
  const result = await git(args, ctx.workspaceRoot);
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

function parseWorktrees(output: string): GitWorktree[] {
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

export function createGitApi(): CompleteHostServiceRegistry['git'] {
  return {
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
      return {
        success: result.exitCode === 0,
        changes: (await readCurrentGitStatus()).changes,
        patch: trimOutput(result.stdout, MAX_PATCH_CHARS),
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
        return {
          success: true,
          path: path.gitPath,
          mode,
          patch: trimOutput(patch, MAX_PATCH_CHARS),
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
      return {
        success: result.exitCode === 0,
        path: path.gitPath,
        mode,
        patch: trimOutput(result.stdout, MAX_PATCH_CHARS),
        original: binary ? undefined : diffContent(original, tooLarge),
        modified: binary ? undefined : diffContent(modified, tooLarge),
        tooLarge,
        binary,
        error: result.exitCode === 0 ? undefined : result.stderr,
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
    worktrees: async () => {
      const ctx = await requireRepoContext();
      const result = await git(['worktree', 'list', '--porcelain', '-z'], ctx.workspaceRoot);
      return { success: result.exitCode === 0, worktrees: parseWorktrees(result.stdout), error: result.exitCode === 0 ? undefined : result.stderr };
    },
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
      return withGitOperation('worktreeAdd', customOutsideSafeArea ? 'dangerous' : 'write', args, {
        approvalId: payload.approvalId,
        paths: [target],
      });
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
      return withGitOperation('worktreeRemove', 'dangerous', ['worktree', 'remove', target], {
        approvalId: payload.approvalId,
        paths: [target],
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
      return withGitOperation('push', 'dangerous', args, { approvalId: body.approvalId });
    },
    githubAuthStatus: async () => {
      const ctx = await requireRepoContext();
      const result = await gh(['auth', 'status'], ctx.workspaceRoot);
      const userMatch = result.stdout.match(/Logged in to .* account ([^\s]+)/i) ?? result.stderr.match(/Logged in to .* account ([^\s]+)/i);
      const hosts = [...new Set(`${result.stdout}\n${result.stderr}`.match(/github\.[^\s)]+|github\.com/g) ?? [])];
      return {
        success: true,
        available: result.exitCode !== 1 || !/not found|ENOENT/i.test(result.stderr),
        authenticated: result.exitCode === 0,
        user: userMatch?.[1],
        hosts,
        error: result.exitCode === 0 ? undefined : result.stderr || result.stdout,
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
      await shell.openExternal(url);
      return { success: true, stdout: url };
    },
  };
}
