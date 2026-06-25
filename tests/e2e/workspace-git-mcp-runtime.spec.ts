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
    } finally {
      await closeElectronApp(app);
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
