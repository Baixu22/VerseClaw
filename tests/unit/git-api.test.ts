import { basename, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
}));

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
    }

    get(key: string) {
      return key === 'approvals' ? storeState.approvals : undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') storeState.approvals = Array.isArray(value) ? [...value] : [];
    }
  }
  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

function workspace(permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function mockExec(handler: (command: string, args: string[]) => { code?: number; stdout?: string; stderr?: string }) {
  execFileMock.mockImplementation((command: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
    const result = handler(command, args);
    const error = result.code && result.code !== 0 ? { code: result.code } : null;
    callback(error, result.stdout ?? '', result.stderr ?? '');
  });
}

/** requireRepoContext resolves the repo root first; every handler must answer it. */
function isRepoRootProbe(args: string[]): boolean {
  return args[0] === 'rev-parse' && args[1] === '--show-toplevel';
}

describe('git api', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    storeState.approvals = [];
    activeWorkspace.profile = workspace();
  });

  it('parses porcelain v2 status into branch and change buckets', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') {
        return {
          stdout: [
            '# branch.oid abc',
            '# branch.head main',
            '# branch.upstream origin/main',
            '# branch.ab +2 -1',
            '1 .M N... 100644 100644 100644 abc abc src/app file.ts',
            '? src/new file.ts',
            '',
          ].join('\0'),
        };
      }
      if (args[0] === 'diff' && args.includes('--numstat')) {
        return { stdout: args.includes('--cached') ? '' : '2\t1\tsrc/app file.ts\0' };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().status()).resolves.toMatchObject({
      success: true,
      status: {
        branch: 'main',
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        clean: false,
        unstagedCount: 1,
        untrackedCount: 1,
        changes: expect.arrayContaining([
          expect.objectContaining({ path: 'src/app file.ts', additions: 2, deletions: 1 }),
          expect.objectContaining({ path: 'src/new file.ts' }),
        ]),
      },
    });
  });

  it('returns side-by-side content with staged file diffs', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') {
        return {
          stdout: [
            '# branch.head main',
            '1 M. N... 100644 100644 100644 abc def src/app.ts',
            '',
          ].join('\0'),
        };
      }
      if (args[0] === 'diff' && args[1] === '--cached') {
        return {
          stdout: [
            'diff --git a/src/app.ts b/src/app.ts',
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            '',
          ].join('\n'),
        };
      }
      if (args[0] === 'show' && args[1] === 'HEAD:src/app.ts') return { stdout: 'old\n' };
      if (args[0] === 'show' && args[1] === ':src/app.ts') return { stdout: 'new\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().fileDiff({ path: 'src/app.ts', mode: 'staged' })).resolves.toMatchObject({
      success: true,
      path: 'src/app.ts',
      mode: 'staged',
      patch: expect.stringContaining('+new'),
      original: 'old\n',
      modified: 'new\n',
      patchArtifacts: [expect.objectContaining({
        schema: 'GitPatchArtifact/v1',
        file: 'src/app.ts',
        status: 'modified',
        contentKind: 'text',
        completeness: 'complete',
      })],
    });
  });

  it('fails closed when a file diff exceeds the local Git patch limit', async () => {
    const oversizedPatch = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      `-${'a'.repeat(180_000)}`,
      '+new',
      '',
    ].join('\n');
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') {
        return {
          stdout: [
            '# branch.head main',
            '1 .M N... 100644 100644 100644 abc def src/app.ts',
            '',
          ].join('\0'),
        };
      }
      if (args[0] === 'diff' && !args.includes('--numstat')) return { stdout: oversizedPatch };
      if (args[0] === 'show') return { stdout: 'old\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().fileDiff({ path: 'src/app.ts', mode: 'unstaged' })).resolves.toMatchObject({
      success: true,
      path: 'src/app.ts',
      tooLarge: true,
      original: undefined,
      modified: undefined,
      patchArtifacts: [expect.objectContaining({
        schema: 'GitPatchArtifact/v1',
        file: 'src/app.ts',
        status: 'modified',
        contentKind: 'unknown',
        hunks: [],
        completeness: 'unavailable',
      })],
    });
  });

  it('downgrades a parsed file patch when trusted Git status is missing', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      if (args[0] === 'diff' && !args.includes('--numstat')) {
        return {
          stdout: [
            'diff --git a/src/app.ts b/src/app.ts',
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            '',
          ].join('\n'),
        };
      }
      if (args[0] === 'show') return { stdout: 'old\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().fileDiff({ path: 'src/app.ts', mode: 'unstaged' })).resolves.toMatchObject({
      success: true,
      patchArtifacts: [expect.objectContaining({
        file: 'src/app.ts',
        status: 'unknown',
        contentKind: 'unknown',
        completeness: 'unavailable',
      })],
    });
  });

  it('blocks normal writes in read-only mode before git add', async () => {
    activeWorkspace.profile = workspace('readOnly');
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().stage({ paths: ['src/app.ts'] })).resolves.toMatchObject({
      success: false,
      blocked: true,
      reason: 'Read-only workspace mode blocks Git write operations.',
    });
    expect(execFileMock).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add']), expect.anything(), expect.anything());
  });

  it('requires approval for dangerous push and consumes approved requests', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'push') return { stdout: 'pushed\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const first = await gitApi.push({ remote: 'origin', branch: 'main' });
    expect(first).toMatchObject({ success: false, blocked: true, approvalRequired: true });

    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.push({ remote: 'origin', branch: 'main', approvalId: first.approval?.id })).resolves.toMatchObject({
      success: true,
      stdout: 'pushed\n',
    });
  });

  it('explains why a dangerous git operation is graded that way in the approval reason', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    // Push names the target and flags that the branch is shared.
    const push = await gitApi.push({ remote: 'origin', branch: 'main' });
    expect(push.approval?.reason).toContain('origin/main');
    expect(push.approval?.reason).toContain('shared branch');

    // A feature branch is still gated, but is not claimed to be shared.
    const feature = await gitApi.push({ remote: 'origin', branch: 'feat/x' });
    expect(feature.approval?.reason).toContain('origin/feat/x');
    expect(feature.approval?.reason).not.toContain('shared branch');

    // With no explicit branch the reason falls back to the current branch.
    const bare = await gitApi.push({});
    expect(bare.approval?.reason).toContain('the default remote/main');
  });

  it('states the refspec scope when no target branch can be determined', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      // Detached HEAD: porcelain reports no branch name, so the prompt must
      // describe the configured push default instead of naming a branch.
      if (args[0] === 'status') return { stdout: '' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    const bare = await createGitApi().push({});
    expect(bare.approval?.reason).toContain('push default');
    expect(bare.approval?.reason).toContain('more than one ref');
  });

  it('distinguishes reset --hard from reset --soft in the approval reason', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const hard = await gitApi.reset({ mode: 'hard', ref: 'origin/main' });
    expect(hard.approval?.reason).toContain('discards uncommitted changes');
    expect(hard.approval?.reason).toContain('origin/main');

    const soft = await gitApi.reset({ mode: 'soft', ref: 'origin/main' });
    expect(soft.approval?.reason).toContain('working tree files are kept');
  });

  it('requires approval before reverting a tracked file and restores index plus worktree after approval', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') {
        return {
          stdout: [
            '# branch.head main',
            '1 .M N... 100644 100644 100644 abc abc src/app.ts',
            '',
          ].join('\0'),
        };
      }
      if (args[0] === 'restore') return { stdout: 'restored\n' };
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const first = await gitApi.revertFile({ path: 'src/app.ts' });
    expect(first).toMatchObject({ success: false, blocked: true, approvalRequired: true });
    expect(calls).not.toContainEqual(['restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/app.ts']);

    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.revertFile({ path: 'src/app.ts', approvalId: first.approval?.id })).resolves.toMatchObject({
      success: true,
      stdout: 'restored\n',
    });
    expect(calls).toContainEqual(['restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/app.ts']);
  });

  it('uses git clean for approved untracked file reverts', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'status') {
        return {
          stdout: [
            '# branch.head main',
            '? src/new.ts',
            '',
          ].join('\0'),
        };
      }
      if (args[0] === 'clean') return { stdout: 'Removing src/new.ts\n' };
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const first = await gitApi.revertFile({ path: 'src/new.ts' });
    expect(first).toMatchObject({ success: false, blocked: true, approvalRequired: true });

    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.revertFile({ path: 'src/new.ts', approvalId: first.approval?.id })).resolves.toMatchObject({
      success: true,
      stdout: 'Removing src/new.ts\n',
    });
    expect(calls).toContainEqual(['clean', '-f', '--', 'src/new.ts']);
  });

  it('lists stashes and creates a stash with message and untracked files', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'stash' && args[1] === 'list') return { stdout: 'stash@{0}\tOn main\tWIP demo\n' };
      if (args[0] === 'stash' && args[1] === 'push') return { stdout: 'Saved working directory\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    await expect(gitApi.stashList()).resolves.toMatchObject({
      success: true,
      stashes: [
        {
          index: 0,
          selector: 'stash@{0}',
          branch: 'On main',
          message: 'WIP demo',
        },
      ],
    });
    await expect(gitApi.stashPush({ message: 'checkpoint', includeUntracked: true })).resolves.toMatchObject({
      success: true,
      stdout: 'Saved working directory\n',
    });
    expect(calls).toContainEqual(['stash', 'push', '-m', 'checkpoint', '--include-untracked']);
  });

  it('requires dangerous approval for stash apply and pop', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'stash' && args[1] === 'apply') return { stdout: 'applied stash\n' };
      if (args[0] === 'stash' && args[1] === 'pop') return { stdout: 'dropped stash\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const applyFirst = await gitApi.stashApply({ selector: 'stash@{0}' });
    expect(applyFirst).toMatchObject({ success: false, blocked: true, approvalRequired: true });
    expect(calls).not.toContainEqual(['stash', 'apply', 'stash@{0}']);

    await createPermissionsApi().decideApproval({ id: applyFirst.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.stashApply({ selector: 'stash@{0}', approvalId: applyFirst.approval?.id })).resolves.toMatchObject({
      success: true,
      stdout: 'applied stash\n',
    });
    expect(calls).toContainEqual(['stash', 'apply', 'stash@{0}']);

    const popFirst = await gitApi.stashPop({ selector: 'stash@{0}' });
    expect(popFirst).toMatchObject({ success: false, blocked: true, approvalRequired: true });
    expect(calls).not.toContainEqual(['stash', 'pop', 'stash@{0}']);

    await createPermissionsApi().decideApproval({ id: popFirst.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.stashPop({ selector: 'stash@{0}', approvalId: popFirst.approval?.id })).resolves.toMatchObject({
      success: true,
      stdout: 'dropped stash\n',
    });
    expect(calls).toContainEqual(['stash', 'pop', 'stash@{0}']);
  });

  it('only allows worktree remove for paths registered with the repository', async () => {
    const registeredWorktree = resolve(process.cwd(), '..', 'Project-feature');
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: [
            `worktree ${process.cwd()}`,
            'HEAD abc',
            'branch refs/heads/main',
            `worktree ${registeredWorktree}`,
            'HEAD def',
            'branch refs/heads/feature',
            '',
          ].join('\0'),
        };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    await expect(gitApi.worktreeRemove({ path: resolve(process.cwd(), '..', 'not-a-worktree') })).rejects.toThrow(
      'worktree path is not registered with this repository',
    );
    await expect(gitApi.worktreeRemove({ path: registeredWorktree })).resolves.toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
    });
  });

  it('adds a worktree by creating a new branch with the correct argument order', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'worktree' && args[1] === 'add') return { stdout: 'prepared worktree\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/demo',
      startPoint: 'main',
      checkoutNewBranch: true,
    })).resolves.toMatchObject({ success: true });

    expect(calls).toContainEqual([
      'worktree',
      'add',
      '-b',
      'feature/demo',
      resolve(process.cwd(), '..', `${basename(process.cwd())}-feature-demo`),
      'main',
    ]);
  });

  it('adds a worktree for an existing branch without -b', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'worktree' && args[1] === 'add') return { stdout: 'prepared worktree\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'release',
      checkoutNewBranch: false,
    })).resolves.toMatchObject({ success: true });

    expect(calls).toContainEqual([
      'worktree',
      'add',
      resolve(process.cwd(), '..', `${basename(process.cwd())}-release`),
      'release',
    ]);
  });

  it('defaults new worktree start point to HEAD when omitted', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'worktree' && args[1] === 'add') return { stdout: 'prepared worktree\n' };
      if (args[0] === 'status') return { stdout: '# branch.head main\0' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/head-default',
      checkoutNewBranch: true,
    })).resolves.toMatchObject({ success: true });

    expect(calls).toContainEqual([
      'worktree',
      'add',
      '-b',
      'feature/head-default',
      resolve(process.cwd(), '..', `${basename(process.cwd())}-feature-head-default`),
      'HEAD',
    ]);
  });

  it('blocks new worktree creation when the target branch already exists', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'branch' && args[1] === '--list') return { stdout: 'feature/existing\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/existing',
      checkoutNewBranch: true,
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      reason: 'Branch already exists. Choose Existing branch or use a new branch name.',
    });
    expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(false);
  });

  it('blocks existing-branch worktree creation when that branch is already checked out', async () => {
    const registeredWorktree = resolve(process.cwd(), '..', 'Project-feature');
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: [
            `worktree ${process.cwd()}`,
            'HEAD abc',
            'branch refs/heads/main',
            `worktree ${registeredWorktree}`,
            'HEAD def',
            'branch refs/heads/feature/existing',
            '',
          ].join('\0'),
        };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/existing',
      checkoutNewBranch: false,
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      reason: `Branch is already checked out at ${registeredWorktree}.`,
    });
    expect(calls.some((args) => args[0] === 'worktree' && args[1] === 'add')).toBe(false);
  });

  it('requires dangerous approval for custom worktree paths outside the workspace and repo sibling area', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/risky',
      path: resolve(process.cwd(), '..', '..', 'outside-worktree'),
      checkoutNewBranch: true,
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
    });
    expect(execFileMock).not.toHaveBeenCalledWith('git', expect.arrayContaining(['add', '-b']), expect.anything(), expect.anything());
  });

  it('treats a drive-root parent as unsafe: custom sibling paths still require approval', async () => {
    // Simulate a repository directly under a volume root so the sibling-area
    // heuristic cannot accidentally bless the entire drive.
    const repoRoot = resolve(process.platform === 'win32' ? 'C:/repo' : '/repo');
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: repoRoot + '\n' };
      return { stdout: "" };
    });
    const { createGitApi } = await import('@electron/services/git-api');

    await expect(createGitApi().worktreeAdd({
      branch: 'feature/risky',
      path: process.platform === 'win32' ? 'D:/outside-worktree' : '/outside-worktree',
      checkoutNewBranch: true,
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
    });
    expect(execFileMock.mock.calls.some((call) => call[1]?.[0] === 'worktree' && call[1]?.[1] === 'add')).toBe(false);
  });

  it('creates GitHub PRs with explicit base/head/draft args after dangerous approval', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    mockExec((command, args) => {
      calls.push({ command, args });
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return {
          stdout: JSON.stringify({
            number: 42,
            title: 'Ship Git panel',
            state: 'OPEN',
            headRefName: 'feature/git-panel',
            baseRefName: 'main',
            isDraft: true,
          }),
        };
      }
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();

    const payload = {
      title: 'Ship Git panel',
      body: 'Ready for review',
      base: 'main',
      head: 'feature/git-panel',
      draft: true,
    };
    const first = await gitApi.prCreate(payload);
    expect(first).toMatchObject({ success: false, blocked: true, approvalRequired: true });
    expect(calls.some((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create')).toBe(false);

    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    await expect(gitApi.prCreate({ ...payload, approvalId: first.approval?.id })).resolves.toMatchObject({
      success: true,
      pullRequest: expect.objectContaining({
        number: 42,
        headRefName: 'feature/git-panel',
        baseRefName: 'main',
        isDraft: true,
      }),
    });
    expect(calls).toContainEqual({
      command: 'gh',
      args: [
        'pr',
        'create',
        '--title',
        'Ship Git panel',
        '--body',
        'Ready for review',
        '--base',
        'main',
        '--head',
        'feature/git-panel',
        '--draft',
        '--json',
        'number,title,state,author,headRefName,baseRefName,url,isDraft,updatedAt',
      ],
    });
  });

  it('preflights missing base branch with actionable error before creating a PR', async () => {
    const ghCalls: string[][] = [];
    mockExec((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { stdout: `${process.cwd()}\n` };
      }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        // refs/heads/missing-base does not exist; anything else resolves.
        return args[3]?.includes('missing-base') ? { code: 128 } : { stdout: `${process.cwd()}\n` };
      }
      if (command === 'gh') ghCalls.push(args);
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().prCreate({
      title: 'T',
      body: 'B',
      base: 'missing-base',
      head: 'feature/x',
    });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('likely_cause');
    expect(result.reason).toContain('missing-base');
    expect(ghCalls.length).toBe(0); // gh never invoked: preflight failed first
  });

  it('reuses an existing open PR for the head branch instead of creating a duplicate', async () => {
    const ghCalls: string[][] = [];
    mockExec((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { stdout: `${process.cwd()}\n` };
      }
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: `${process.cwd()}\n` };
      }
      if (command === 'gh') {
        ghCalls.push(args);
        if (args[0] === 'pr' && args[1] === 'list') {
          return {
            stdout: JSON.stringify([
              { number: 7, title: 'Existing', state: 'OPEN', headRefName: 'feature/x', baseRefName: 'main', url: 'https://example/pr/7', isDraft: false },
            ]),
          };
        }
      }
      return { stdout: '' };
    });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    const gitApi = createGitApi();
    const payload = { title: 'T', body: 'B', base: 'main', head: 'feature/x' };
    const first = await gitApi.prCreate(payload);
    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    const second = await gitApi.prCreate({ ...payload, approvalId: first.approval?.id });

    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.reused).toBe(true);
      expect(second.pullRequest?.number).toBe(7);
    }
    // gh pr create never called — the open PR was reused.
    expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'create')).toBe(false);
    expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'list')).toBe(true);
  });

  it('hardens git exec: hooks disabled, no locks, no prompts, fsmonitor off, bounded timeout', async () => {
    const seenOptions: unknown[] = [];
    execFileMock.mockImplementation((command: string, args: string[], options: unknown, callback: (...args: unknown[]) => void) => {
      seenOptions.push(options);
      callback(null, '', '');
    });
    const { createGitApi } = await import('@electron/services/git-api');
    await Promise.resolve(createGitApi().status()).catch(() => undefined);

    expect(seenOptions.length).toBeGreaterThan(0);
    for (const raw of seenOptions) {
      const options = raw as { env?: NodeJS.ProcessEnv; timeout?: number; killSignal?: string };
      expect(options.env?.GIT_OPTIONAL_LOCKS).toBe('0');
      expect(options.env?.GIT_TERMINAL_PROMPT).toBe('0');
      expect(options.env?.GIT_CONFIG_COUNT).toBe('2');
      expect(options.env?.GIT_CONFIG_KEY_0).toBe('core.hooksPath');
      expect(options.env?.GIT_CONFIG_VALUE_0).toBeTruthy();
      expect(options.env?.GIT_CONFIG_KEY_1).toBe('core.fsmonitor');
      expect(options.env?.GIT_CONFIG_VALUE_1).toBe('false');
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.killSignal).toBeTruthy();
    }
  });

  it('resolves merge-base between HEAD and a base branch', async () => {
    mockExec((command, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { stdout: process.cwd() };
      }
      if (args[0] === 'merge-base') {
        return { stdout: 'abc123def456\n' };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().mergeBase({ base: 'main' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.mergeBase).toBe('abc123def456');

    const lastCall = execFileMock.mock.calls[execFileMock.mock.calls.length - 1];
    expect(lastCall[0]).toBe('git');
    expect(lastCall[1]).toEqual(['merge-base', 'HEAD', 'main']);
  });

  it('returns reflog entries for the complete repository lifecycle', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'reflog') {
        return {
          stdout: [
            'abcdef123456\tabcdef1\t1710000000\tHEAD@{0}\tcheckout: moving from main to feature/demo',
            '123456abcdef\t123456a\t1709999000\trefs/heads/feature/demo@{1}\tcommit: ship audit timeline',
            '',
          ].join('\n'),
        };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    await expect(createGitApi().reflog({ limit: 50 })).resolves.toMatchObject({
      success: true,
      entries: [
        expect.objectContaining({ selector: 'HEAD@{0}', shortHash: 'abcdef1', subject: 'checkout: moving from main to feature/demo', date: 1710000000000 }),
        expect.objectContaining({ selector: 'refs/heads/feature/demo@{1}', subject: 'commit: ship audit timeline' }),
      ],
    });
    const reflogCall = execFileMock.mock.calls.find((call) => call[1]?.[0] === 'reflog');
    expect(reflogCall?.[1]).toContain('--max-count=51');
    const reflogResult = await createGitApi().reflog({ limit: 1 });
    expect(reflogResult.entries).toHaveLength(1);
    expect(reflogResult.truncated).toBe(true);
  });

  it('routes merge, rebase, and reset through dangerous Git approval', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${process.cwd()}\n` };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    const merge = await api.merge({ ref: 'main' });
    expect(merge).toMatchObject({ success: false, approvalRequired: true, blocked: true });
    const approvalId = merge.approval?.id;
    expect(approvalId).toBeTruthy();
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    await createPermissionsApi().decideApproval({ id: approvalId ?? '', decision: 'approved' });
    await expect(api.merge({ ref: 'main', approvalId })).resolves.toMatchObject({ success: true });
    const rebase = await api.rebase({ ref: 'main' });
    expect(rebase.approval?.id).toBeTruthy();
    await createPermissionsApi().decideApproval({ id: rebase.approval?.id ?? '', decision: 'approved' });
    await expect(api.rebase({ ref: 'main', approvalId: rebase.approval?.id })).resolves.toMatchObject({ success: true });
    const reset = await api.reset({ ref: 'HEAD', mode: 'mixed' });
    expect(reset.approval?.id).toBeTruthy();
    await createPermissionsApi().decideApproval({ id: reset.approval?.id ?? '', decision: 'approved' });
    await expect(api.reset({ ref: 'HEAD', mode: 'mixed', approvalId: reset.approval?.id })).resolves.toMatchObject({ success: true });
    expect(execFileMock.mock.calls.some((call) => call[1]?.[0] === 'rebase' && call[1]?.[1] === 'main')).toBe(true);
    expect(execFileMock.mock.calls.some((call) => call[1]?.[0] === 'reset' && call[1]?.[1] === '--mixed')).toBe(true);
  });

  it('rejects unsafe or missing refs for merge-base', async () => {
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    await expect(api.mergeBase({ base: '' })).rejects.toThrow('base is required');
    await expect(api.mergeBase({ base: 'a..b' })).rejects.toThrow(/Invalid git ref/);
  });

  it('applyPatch preflight reports conflicts without approval or writes', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--check')) {
        // Verbatim git 2.51 output for a patch whose context no longer matches.
        return {
          code: 1,
          stdout: 'Checking patch src/app.ts...\n',
          stderr: 'error: while searching for:\nold\n\nerror: patch failed: src/app.ts:1\nerror: src/app.ts: patch does not apply\n',
        };
      }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().applyPatch({
      patch: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
      mode: 'preflight',
    });
    expect(result.preflight).toBe(true);
    expect(result.success).toBe(false);
    expect(result.conflictedPaths).toEqual(['src/app.ts']);
    // No synthetic placeholder may leak into a path list callers render.
    expect(result.conflictedPaths).not.toContain('__all__');
    expect(execFileMock.mock.calls.some((call) => call[1]?.[0] === 'apply' && !call[1]?.includes('--check'))).toBe(false);
    const store = await import('@electron/services/permissions-api');
    const approvals = await store.createPermissionsApi().approvals({});
    expect(approvals.approvals).toHaveLength(0);
  });

  it('applyPatch apply mode requires dangerous approval then writes', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--numstat')) {
        return { stdout: '1\t1\tsrc/app.ts\u0000' };
      }
      if (args[0] === 'apply' && !args.includes('--check')) {
        // Verbatim git 2.51 success output: "Applied patch <path> cleanly.",
        // not "Applied patch to <path>."
        return { stdout: 'Checking patch src/app.ts...\nApplied patch src/app.ts cleanly.\n' };
      }
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    const patch = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new';

    const first = await api.applyPatch({ patch, mode: 'apply' });
    expect(first).toMatchObject({ success: false, blocked: true, approvalRequired: true, preflight: false });
    // Nothing may be written before approval: --check and --numstat inspect only.
    const mutatingApply = (args: string[] | undefined): boolean =>
      args?.[0] === 'apply' && !args.includes('--check') && !args.includes('--numstat');
    expect(execFileMock.mock.calls.some((call) => mutatingApply(call[1]))).toBe(false);
    // The prompt must name the files the patch touches, not just the operation.
    expect(first.approval?.paths).toEqual(['src/app.ts']);
    expect(first.approval?.reason).toContain('src/app.ts');

    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    const approvalId = first.approval?.id ?? '';
    await createPermissionsApi().decideApproval({ id: approvalId, decision: 'approved' });
    const second = await api.applyPatch({ patch, mode: 'apply', approvalId });
    expect(second.success).toBe(true);
    expect(second.appliedPaths).toEqual(['src/app.ts']);
    expect(second.preflight).toBe(false);
    // approval is single-use
    const approvalsAfter = await createPermissionsApi().approvals({ includeExpired: true });
    const consumed = approvalsAfter.approvals.find((a) => a.id === approvalId);
    expect(consumed?.status).toBe('expired');
  });

  it('applyPatch reports skipped and applied paths from real git output', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--numstat')) {
        return { stdout: '1\t1\tsrc/skipped.ts\u0000-\t-\tassets/logo.png\u0000' };
      }
      if (args[0] === 'apply' && !args.includes('--check')) {
        return {
          stdout: [
            "Skipped patch 'src/skipped.ts'.",
            'Applied patch assets/logo.png cleanly.',
            '',
          ].join('\n'),
        };
      }
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    const patch = 'diff --git a/src/skipped.ts b/src/skipped.ts\n--- a/src/skipped.ts\n+++ b/src/skipped.ts\n@@ -1 +1 @@\n-a\n+b';
    const first = await api.applyPatch({ patch, mode: 'apply' });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    const result = await api.applyPatch({ patch, mode: 'apply', approvalId: first.approval?.id });

    expect(result.skippedPaths).toEqual(['src/skipped.ts']);
    expect(result.appliedPaths).toEqual(['assets/logo.png']);
  });

  it('applyPatch counts a --reject partial apply as conflicted, not applied', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--numstat')) return { stdout: '1\t1\ta.txt\u0000' };
      if (args[0] === 'apply' && !args.includes('--check')) {
        // git reports the failed hunk, then applies what it could.
        return {
          code: 1,
          stdout: 'Applying patch a.txt with 1 reject...\nApplied patch a.txt cleanly.\n',
          stderr: 'error: patch failed: a.txt:1\n',
        };
      }
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    const patch = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y';
    const first = await api.applyPatch({ patch, mode: 'apply' });
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    await createPermissionsApi().decideApproval({ id: first.approval?.id ?? '', decision: 'approved' });
    const result = await api.applyPatch({ patch, mode: 'apply', approvalId: first.approval?.id });

    // A file whose hunks were rejected is not fully applied, so it must not be
    // reported as applied even though git prints both lines for it.
    expect(result.conflictedPaths).toEqual(['a.txt']);
    expect(result.appliedPaths).toEqual([]);
  });

  it('applyPatch fails closed on a conflicting patch without requesting approval', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--check')) {
        return { code: 1, stderr: 'error: patch failed: src/app.ts:1\nerror: src/app.ts: patch does not apply\n' };
      }
      if (args[0] === 'apply') throw new Error('apply must not run after a failed --check');
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().applyPatch({
      patch: 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
      mode: 'apply',
    });

    expect(result).toMatchObject({ success: false, preflight: false });
    expect(result.conflictedPaths).toEqual(['src/app.ts']);
    expect(result.appliedPaths).toEqual([]);
    // No approval is spent on an operation that cannot succeed.
    const store = await import('@electron/services/permissions-api');
    expect((await store.createPermissionsApi().approvals({})).approvals).toHaveLength(0);
  });

  it('applyPatch approval is bound to the patch content, not just the target files', async () => {
    mockExec((_command, args) => {
      if (args[0] === 'rev-parse') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'apply' && args.includes('--numstat')) return { stdout: '1\t1\tsrc/app.ts\u0000' };
      if (args[0] === 'apply' && !args.includes('--check')) {
        return { stdout: 'Applied patch src/app.ts cleanly.\n' };
      }
      if (args[0] === 'status') return { stdout: '# branch.head main\u0000' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    const approvedPatch = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+reviewed';
    // Same file, different content: reusing the approval here would let an
    // agent swap in unreviewed changes after the user approved a specific diff.
    const swappedPatch = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+swapped';

    const first = await api.applyPatch({ patch: approvedPatch, mode: 'apply' });
    const approvalId = first.approval?.id ?? '';
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
    await createPermissionsApi().decideApproval({ id: approvalId, decision: 'approved' });

    await expect(api.applyPatch({ patch: swappedPatch, mode: 'apply', approvalId }))
      .resolves.toMatchObject({ success: false, approvalRequired: true });
    await expect(api.applyPatch({ patch: approvedPatch, mode: 'apply', approvalId }))
      .resolves.toMatchObject({ success: true });
  });

  it('applyPatch rejects non-diff input before any git call', async () => {
    mockExec(() => { throw new Error('git should not be called'); });
    const { createGitApi } = await import('@electron/services/git-api');
    await expect(createGitApi().applyPatch({ patch: 'not a diff', mode: 'preflight' })).rejects.toThrow('unified diff');
  });

  it('diffToBase derives the upstream branch and reports how the base was resolved', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
        return { stdout: 'origin/main\n' };
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'base999\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) {
        return { stdout: 'M\u0000src/app.ts\u0000A\u0000src/new.ts\u0000' };
      }
      if (args[0] === 'diff') return { stdout: 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('upstream');
    expect(result.base).toBe('origin/main');
    expect(result.mergeBase).toBe('base999');
    expect(result.files.map((file) => [file.path, file.changeKind])).toEqual([
      ['src/app.ts', 'M'],
      ['src/new.ts', 'A'],
    ]);
  });

  it('diffToBase falls back to origin/HEAD when the branch has no upstream', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { stdout: 'origin/trunk\n' };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'base777\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) return { stdout: '' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.resolution).toBe('remote-default');
    expect(result.base).toBe('origin/trunk');
    expect(result.files).toEqual([]);
  });

  it('diffToBase reports unavailable instead of guessing when no remote ancestor exists', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('unavailable');
    expect(result.base).toBeUndefined();
    expect(result.reason).toContain('cannot derive a remote base');
  });

  it('diffToBase prefers origin over a nearer non-origin ancestor', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      if (args[0] === 'for-each-ref') {
        return { stdout: 'refs/remotes/fork/main\nrefs/remotes/origin/main\n' };
      }
      if (args[0] === 'remote') return { stdout: 'fork\norigin\n' };
      // fork/main is nearer (1 commit) than origin/main (3 commits).
      if (args[0] === 'rev-list') return { stdout: args[2]?.startsWith('fork/') ? '1\n' : '3\n' };
      if (args[0] === 'merge-base') return { stdout: 'mb1\n' };
      if (args[0] === 'diff') return { stdout: '' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    // Provenance beats proximity: a base is a label the user reads, so the
    // canonical remote wins even though fork/main is fewer commits away.
    expect(result.resolution).toBe('remote-ancestor');
    expect(result.base).toBe('origin/main');
  });

  it('diffToBase falls back to configured remote order when there is no origin', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      if (args[0] === 'for-each-ref') {
        return { stdout: 'refs/remotes/alpha/main\nrefs/remotes/zzz/main\n' };
      }
      // `git remote` prints alphabetically, but this order is what git reports;
      // zzz listed first must win over the alphabetically earlier alpha.
      if (args[0] === 'remote') return { stdout: 'zzz\nalpha\n' };
      if (args[0] === 'rev-list') return { stdout: '2\n' };
      if (args[0] === 'merge-base') return { stdout: 'mb2\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.resolution).toBe('remote-ancestor');
    expect(result.base).toBe('zzz/main');
  });

  it('diffToBase finds a base in a repo whose only remote is not named origin', async () => {
    // `git remote add upstream <url> && git fetch upstream` never creates
    // refs/remotes/upstream/HEAD, so no symbolic-ref probe can find a base here
    // even though refs/remotes/upstream/main plainly exists.
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      if (args[0] === 'for-each-ref') return { stdout: 'refs/remotes/upstream/main\n' };
      if (args[0] === 'remote') return { stdout: 'upstream\n' };
      if (args[0] === 'rev-list') return { stdout: '4\n' };
      if (args[0] === 'merge-base') return { stdout: 'mb3\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.success).toBe(true);
    expect(result.resolution).toBe('remote-ancestor');
    expect(result.base).toBe('upstream/main');
    expect(result.mergeBase).toBe('mb3');
  });

  it('diffToBase ignores */HEAD pseudo-refs when scanning for a base', async () => {
    const revListRefs: string[] = [];
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      if (args[0] === 'for-each-ref') {
        // git emits the pseudo-ref alongside the branch it points at, at an
        // identical distance, so keeping it lets a tie-break pick the alias.
        return { stdout: 'refs/remotes/upstream/HEAD\nrefs/remotes/upstream/main\n' };
      }
      if (args[0] === 'remote') return { stdout: 'upstream\n' };
      if (args[0] === 'rev-list') { revListRefs.push(args[2] ?? ''); return { stdout: '1\n' }; }
      if (args[0] === 'merge-base') return { stdout: 'mb4\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.base).toBe('upstream/main');
    expect(revListRefs).toEqual(['upstream/main..HEAD']);
  });

  it('diffToBase skips unsafe scanned refs and reports unavailable when none remain', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return { code: 128, stderr: 'no upstream' };
      if (args[0] === 'symbolic-ref') return { code: 1, stderr: 'not a symbolic ref' };
      if (args[0] === 'for-each-ref') {
        // '..' and a trailing slash are rejected by isSafeGitRef, so nothing
        // survives the scan and the result must stay unavailable.
        return { stdout: 'refs/remotes/evil/a..b\nrefs/remotes/evil/trailing/\n' };
      }
      if (args[0] === 'rev-list') throw new Error('unsafe refs must never reach argv');
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase();

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('unavailable');
    expect(result.reason).toContain('cannot derive a remote base');
  });

  it('diffToBase reads line counts from one numstat call and skips per-file diffs', async () => {
    const perFileDiffs: string[][] = [];
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'mb5\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) {
        return { stdout: 'M\u0000src/app.ts\u0000A\u0000src/new.ts\u0000' };
      }
      if (args[0] === 'diff' && args.includes('--numstat')) {
        return { stdout: '3\t1\tsrc/app.ts\u00007\t0\tsrc/new.ts\u0000' };
      }
      if (args[0] === 'diff') { perFileDiffs.push(args); return { stdout: 'diff --git a/x b/x\n' }; }
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase({ base: 'main' });

    // Default is counts-only: a header consumer must not pay one subprocess
    // per file just to render a total.
    expect(perFileDiffs).toEqual([]);
    expect(result.totals).toEqual({ files: 2, additions: 10, deletions: 1 });
    expect(result.files.map((file) => [file.path, file.additions, file.deletions])).toEqual([
      ['src/app.ts', 3, 1],
      ['src/new.ts', 7, 0],
    ]);
    expect(result.files.every((file) => file.patch === '')).toBe(true);
  });

  it('diffToBase returns patches only when asked, and marks binary files', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'mb6\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) {
        return { stdout: 'R100\u0000src/old.ts\u0000src/new.ts\u0000A\u0000assets/logo.png\u0000' };
      }
      if (args[0] === 'diff' && args.includes('--numstat')) {
        // Renames emit an empty third field then both paths; binary shows '-'.
        return { stdout: '0\t0\t\u0000src/old.ts\u0000src/new.ts\u0000-\t-\tassets/logo.png\u0000' };
      }
      if (args[0] === 'diff') return { stdout: `patch for ${args[args.length - 1]}` };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase({ base: 'main', includePatches: true });

    expect(result.files.map((file) => file.path)).toEqual(['src/new.ts', 'assets/logo.png']);
    expect(result.files[0]).toMatchObject({ additions: 0, deletions: 0, patch: 'patch for src/new.ts' });
    // Binary files have no line counts, so they must report null rather than 0
    // and must not be summed into the totals.
    expect(result.files[1]).toMatchObject({ additions: null, deletions: null, binary: true });
    expect(result.totals).toEqual({ files: 2, additions: 0, deletions: 0 });
  });

  it('diffToBase reports unavailable when base and HEAD share no common ancestor', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { code: 1, stderr: 'no merge base' };
      if (args[0] === 'diff') throw new Error('diff must not run without a merge base');
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase({ base: 'release' });

    expect(result.success).toBe(false);
    expect(result.resolution).toBe('unavailable');
    expect(result.reason).toContain('no common ancestor');
  });

  it('diffToBase rejects unsafe explicit base refs and reports a missing ref as unavailable', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { code: 1, stdout: '' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();

    await expect(api.diffToBase({ base: 'a..b' })).rejects.toThrow(/Invalid git ref/);
    const missing = await api.diffToBase({ base: 'nope' });
    expect(missing.resolution).toBe('unavailable');
    expect(missing.reason).toContain('base ref not found');
  });

  it('diffToBase keeps the destination path for renames in name-status output', async () => {
    mockExec((_command, args) => {
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'base555\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) {
        return { stdout: 'R100\u0000src/old.ts\u0000src/new.ts\u0000M\u0000src/app.ts\u0000' };
      }
      if (args[0] === 'diff') return { stdout: 'diff --git a/x b/x\n' };
      return { stdout: '' };
    });
    const { createGitApi } = await import('@electron/services/git-api');
    const result = await createGitApi().diffToBase({ base: 'main' });

    expect(result.resolution).toBe('explicit');
    expect(result.files.map((file) => [file.path, file.changeKind])).toEqual([
      ['src/new.ts', 'R'],
      ['src/app.ts', 'M'],
    ]);
  });

  it('diffToBase never writes: no approval is requested and no mutating git runs', async () => {
    const calls: string[][] = [];
    mockExec((_command, args) => {
      calls.push(args);
      if (isRepoRootProbe(args)) return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'abc123\n' };
      if (args[0] === 'merge-base') return { stdout: 'base111\n' };
      if (args[0] === 'diff' && args.includes('--name-status')) return { stdout: 'M\u0000src/app.ts\u0000' };
      if (args[0] === 'diff') return { stdout: 'diff --git a/x b/x\n' };
      return { stdout: '' };
    });
    const store = await import('@electron/services/permissions-api');
    const { createGitApi } = await import('@electron/services/git-api');
    await createGitApi().diffToBase({ base: 'main' });

    const approvals = await store.createPermissionsApi().approvals({});
    expect(approvals.approvals).toHaveLength(0);
    const mutating = new Set(['apply', 'add', 'restore', 'commit', 'checkout', 'reset', 'clean', 'merge', 'rebase', 'push']);
    expect(calls.filter((args) => mutating.has(args[0] ?? ''))).toEqual([]);
  });

});
