import { resolve } from 'node:path';
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
          expect.objectContaining({ path: 'src/app file.ts' }),
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
        return { stdout: 'diff --git a/src/app.ts b/src/app.ts\n-old\n+new\n' };
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
      resolve(process.cwd(), '..', 'Project-feature-demo'),
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
      resolve(process.cwd(), '..', 'Project-release'),
      'release',
    ]);
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
});
