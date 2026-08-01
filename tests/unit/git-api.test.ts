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
    await createGitApi().status().catch(() => undefined);

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

  it('rejects unsafe or missing refs for merge-base', async () => {
    const { createGitApi } = await import('@electron/services/git-api');
    const api = createGitApi();
    await expect(api.mergeBase({ base: '' })).rejects.toThrow('base is required');
    await expect(api.mergeBase({ base: 'a..b' })).rejects.toThrow(/Invalid git ref/);
  });
});
