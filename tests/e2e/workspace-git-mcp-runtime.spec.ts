import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);

type HostInvokeResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function readGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createDirtyGitRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'verse-claw-git-mcp-'));
  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'e2e@example.test']);
  await runGit(repoDir, ['config', 'user.name', 'Verse Claw E2E']);
  await writeFile(join(repoDir, 'tracked.txt'), 'before\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.txt']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await writeFile(join(repoDir, 'tracked.txt'), 'before\nafter\n', 'utf8');
  return repoDir;
}

async function hostInvoke<T>(
  page: Awaited<ReturnType<typeof getStableWindow>>,
  module: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(async (request) => {
    const bridge = (window as unknown as {
      verseClaw?: {
        hostInvoke: <R>(input: Record<string, unknown>) => Promise<HostInvokeResponse<R>>;
      };
    }).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge unavailable');
    const response = await bridge<T>({
      id: crypto.randomUUID(),
      module: request.module,
      action: request.action,
      ...(request.payload ? { payload: request.payload } : {}),
    });
    if (!response.ok) throw new Error(response.error?.message || 'hostInvoke failed');
    return response.data as T;
  }, { module, action, payload });
}

test.describe('Workspace Git MCP runtime', () => {
  test('routes built-in clawx-git tools through the real Main Git service', async ({ launchElectronApp }) => {
    try {
      await execFileAsync('git', ['--version']);
    } catch {
      test.skip(true, 'Git CLI is not available in this environment');
    }

    const repoDir = await createDirtyGitRepo();
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      await hostInvoke(page, 'workspaces', 'create', {
        name: 'Git MCP Runtime',
        rootPath: repoDir,
      });

      const tools = await hostInvoke<{ tools: Array<{ name: string }> }>(page, 'mcp', 'listTools', {
        serverId: 'clawx-git',
      });
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'git_status',
        'git_file_diff',
        'git_diff_to_base',
        'git_apply_patch',
        'git_stage',
        'git_revert_file',
      ]));

      const status = await hostInvoke<{
        success: boolean;
        result: { status: { changes: Array<{ path: string; unstaged?: boolean }> } };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_status',
      });
      expect(status.success).toBe(true);
      expect(status.result.status.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'tracked.txt', unstaged: true }),
      ]));

      const diff = await hostInvoke<{
        success: boolean;
        result: { patch: string };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_file_diff',
        args: { path: 'tracked.txt', mode: 'unstaged' },
      });
      expect(diff.success).toBe(true);
      expect(diff.result.patch).toContain('+after');

      const stage = await hostInvoke<{
        success: boolean;
        result: { success: boolean };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_stage',
        args: { paths: ['tracked.txt'] },
      });
      expect(stage).toMatchObject({ success: true, result: { success: true } });

      const revert = await hostInvoke<{
        success: boolean;
        result: { approvalRequired?: boolean; blocked?: boolean };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_revert_file',
        args: { path: 'tracked.txt' },
      });
      expect(revert).toMatchObject({
        success: true,
        result: {
          blocked: true,
          approvalRequired: true,
        },
      });

      // This repo has no remote, so no base can be derived: the comparison
      // must report unavailable rather than fall back to an arbitrary ref.
      const noRemote = await hostInvoke<{
        success: boolean;
        result: { success: boolean; resolution: string; base?: string; reason?: string };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_diff_to_base',
      });
      expect(noRemote.result).toMatchObject({ success: false, resolution: 'unavailable' });
      expect(noRemote.result.base).toBeUndefined();
      expect(noRemote.result.reason).toBeTruthy();

      // An explicit base that does exist resolves and reports real changes.
      const firstCommit = await readGit(repoDir, ['rev-parse', 'HEAD']);
      await runGit(repoDir, ['add', 'tracked.txt']);
      await runGit(repoDir, ['commit', '-m', 'Second commit']);
      await runGit(repoDir, ['branch', 'baseline', firstCommit]);

      const explicit = await hostInvoke<{
        success: boolean;
        result: {
          success: boolean;
          resolution: string;
          base?: string;
          mergeBase?: string;
          files: Array<{ path: string; changeKind: string; patch: string }>;
        };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_diff_to_base',
        args: { base: 'baseline' },
      });
      expect(explicit.result).toMatchObject({
        success: true,
        resolution: 'explicit',
        base: 'baseline',
        mergeBase: firstCommit,
      });
      expect(explicit.result.files).toEqual([
        expect.objectContaining({ path: 'tracked.txt', changeKind: 'M' }),
      ]);
      expect(explicit.result.files[0]?.patch).toContain('+after');
    } finally {
      await closeElectronApp(app);
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test('applyPatch reports applied and conflicted paths against a real repo', async ({ launchElectronApp }) => {
    try {
      await execFileAsync('git', ['--version']);
    } catch {
      test.skip(true, 'Git CLI is not available in this environment');
    }

    const repoDir = await createDirtyGitRepo();
    await runGit(repoDir, ['add', 'tracked.txt']);
    await runGit(repoDir, ['commit', '-m', 'Second commit']);
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      await hostInvoke(page, 'workspaces', 'create', { name: 'Git Apply Patch', rootPath: repoDir });

      // applyPatch against a real repo: the path lists come from parsing git's
      // own output, so only an end-to-end run proves the parser matches the
      // installed git rather than an assumed message format.
      const applicablePatch = [
        'diff --git a/tracked.txt b/tracked.txt',
        '--- a/tracked.txt',
        '+++ b/tracked.txt',
        '@@ -1,2 +1,3 @@',
        ' before',
        ' after',
        '+appended',
        '',
      ].join('\n');

      const preflight = await hostInvoke<{
        success: boolean;
        result: {
          success: boolean;
          preflight: boolean;
          appliedPaths: string[];
          conflictedPaths: string[];
        };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_apply_patch',
        args: { patch: applicablePatch, mode: 'preflight' },
      });
      expect(preflight.result).toMatchObject({ success: true, preflight: true });
      expect(preflight.result.conflictedPaths).toEqual([]);
      // Preflight must not write, so the file still has its pre-patch content.
      expect(await readGit(repoDir, ['show', 'HEAD:tracked.txt'])).not.toContain('appended');

      // Apply mode is gated: the prompt must name the file the patch touches.
      const gated = await hostInvoke<{
        success: boolean;
        result: {
          success: boolean;
          blocked?: boolean;
          approvalRequired?: boolean;
          approval?: { paths?: string[]; reason?: string };
        };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_apply_patch',
        args: { patch: applicablePatch, mode: 'apply' },
      });
      expect(gated.result).toMatchObject({ success: false, blocked: true, approvalRequired: true });
      expect(gated.result.approval?.paths).toEqual(['tracked.txt']);
      expect(gated.result.approval?.reason).toContain('tracked.txt');

      // A patch whose context does not match must report the conflicting path
      // and must not request an approval it could never use.
      const conflicting = await hostInvoke<{
        success: boolean;
        result: {
          success: boolean;
          preflight: boolean;
          conflictedPaths: string[];
          approvalRequired?: boolean;
        };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_apply_patch',
        args: {
          mode: 'apply',
          patch: [
            'diff --git a/tracked.txt b/tracked.txt',
            '--- a/tracked.txt',
            '+++ b/tracked.txt',
            '@@ -1,2 +1,2 @@',
            '-content that is not in the file',
            '-nor is this',
            '+replacement',
            '+second replacement',
            '',
          ].join('\n'),
        },
      });
      expect(conflicting.result.success).toBe(false);
      // No approval is requested for a patch that cannot apply. The key is
      // absent rather than undefined once the result crosses IPC.
      expect(conflicting.result.approvalRequired).toBeFalsy();
      expect(conflicting.result.conflictedPaths).toEqual(['tracked.txt']);
    } finally {
      await closeElectronApp(app);
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  test('diffToBase derives a base from a non-origin remote with no declared default', async ({ launchElectronApp }) => {
    try {
      await execFileAsync('git', ['--version']);
    } catch {
      test.skip(true, 'Git CLI is not available in this environment');
    }

    // `git remote add upstream <url> && git fetch upstream` never creates
    // refs/remotes/upstream/HEAD, so probing for a declared default branch
    // finds nothing. Only a real repo makes that condition true — a mock would
    // just be asserting the shape we already assumed.
    const originDir = await mkdtemp(join(tmpdir(), 'verse-claw-git-upstream-'));
    await runGit(originDir, ['init', '--bare']);

    const repoDir = await mkdtemp(join(tmpdir(), 'verse-claw-git-nonorigin-'));
    await runGit(repoDir, ['init']);
    await runGit(repoDir, ['config', 'user.email', 'e2e@example.test']);
    await runGit(repoDir, ['config', 'user.name', 'Verse Claw E2E']);
    await writeFile(join(repoDir, 'shared.txt'), 'base\n', 'utf8');
    await runGit(repoDir, ['add', 'shared.txt']);
    await runGit(repoDir, ['commit', '-m', 'Base commit']);
    await runGit(repoDir, ['branch', '-M', 'main']);
    await runGit(repoDir, ['remote', 'add', 'upstream', originDir]);
    await runGit(repoDir, ['push', 'upstream', 'main']);
    await runGit(repoDir, ['fetch', 'upstream']);
    // `git push` without -u sets no tracking branch, so the @{upstream} probe
    // finds nothing and the scan is what has to resolve the base.
    await writeFile(join(repoDir, 'shared.txt'), 'base\nlocal change\n', 'utf8');
    await runGit(repoDir, ['commit', '-am', 'Local commit ahead of upstream']);

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      await hostInvoke(page, 'workspaces', 'create', { name: 'Git Non Origin', rootPath: repoDir });

      const result = await hostInvoke<{
        success: boolean;
        result: {
          success: boolean;
          resolution: string;
          base?: string;
          mergeBase?: string;
          totals?: { files: number; additions: number; deletions: number };
          files: Array<{ path: string; changeKind: string; additions?: number | null }>;
        };
      }>(page, 'mcp', 'callTool', {
        serverId: 'clawx-git',
        toolName: 'git_diff_to_base',
      });

      expect(result.result).toMatchObject({
        success: true,
        resolution: 'remote-ancestor',
        base: 'upstream/main',
      });
      expect(result.result.mergeBase).toBeTruthy();
      expect(result.result.files).toEqual([
        expect.objectContaining({ path: 'shared.txt', changeKind: 'M', additions: 1 }),
      ]);
      expect(result.result.totals).toEqual({ files: 1, additions: 1, deletions: 0 });
    } finally {
      await closeElectronApp(app);
      await rm(repoDir, { recursive: true, force: true });
      await rm(originDir, { recursive: true, force: true });
    }
  });
});
