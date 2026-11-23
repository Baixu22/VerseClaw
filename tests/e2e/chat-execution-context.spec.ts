import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, publishGatewayStatus, test } from './fixtures/electron';

async function invoke(page: Page, module: string, action: string, payload?: unknown) {
  return page.evaluate(async request => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...request }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!response.ok) throw new Error(response.error?.message);
    return response.data;
  }, { module, action, payload });
}

test('execution tray creates a real worktree in two clicks and restores the original draft', async ({ launchElectronApp }, info) => {
  test.setTimeout(240000);
  const scratch = process.env.CLAWX_E2E_FIXTURE_ROOT ?? join(process.cwd(), '.tmp'); await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'execution-tray-'));
  const root = join(directory, 'project'); await mkdir(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'UI Acceptance'); git('config', 'user.email', 'ui@example.invalid');
  await writeFile(join(root, 'README.md'), '# Execution tray fixture\n');
  git('add', '.'); git('commit', '-m', 'Initial fixture'); git('branch', 'feature/alternate');
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark', env: { GIT_CEILING_DIRECTORIES: scratch } });
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'codex-ui', git: 'real', workspace: 'real', gateway: 'mocked idle transport' };
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpcByMethod: { 'sessions.list': { sessions: [] }, 'chat.history': { messages: [] }, '*': {} },
      hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main' }], defaultAgentId: 'main' } },
    });
    const page = await getStableWindow(app);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const initial = await invoke(page, 'workspaces', 'create', { rootPath: root, name: 'ClawX', agentId: 'main', activeSessionKey: 'agent:main:execution-tray', permissionMode: 'acceptEdits' });
    const original = initial.activeWorkspace as { id: string; activeSessionKey: string };
    await page.reload(); await publishGatewayStatus(app, { state: 'running', gatewayReady: true, port: 18789 });
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: { module: string; action: string }) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const state = { release: null as (() => void) | null, calls: [] as unknown[] };
      (globalThis as unknown as { __executionFixture: typeof state }).__executionFixture = state;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request) => {
        if (request.module === 'git' && request.action === 'worktreeAdd') {
          await new Promise<void>(resolve => { state.release = resolve; });
          state.release = null;
          const result = await original(event, request); state.calls.push(result); return result;
        }
        return original(event, request);
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    const input = page.getByTestId('chat-composer-input');
    await expect(page.getByTestId('composer-context-branch')).toHaveText('main');
    await input.fill('Keep this original draft');
    await page.getByTestId('composer-context-more').click();
    const menu = page.getByTestId('session-worktree-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('session-worktree-branch')).toHaveCount(0);
    const create = page.getByTestId('session-worktree-submit'); await expect(create).toBeEnabled();
    await page.screenshot({ path: info.outputPath('dark-default-execution.png') });
    await create.click();
    await expect(menu).toHaveCount(0);
    const progress = page.getByTestId('worktree-creation-progress');
    await expect(progress).toHaveAttribute('data-stage', 'creating');
    await expect(input).toBeHidden();
    await expect(progress.getByRole('progressbar')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('worktree-creating-progress.png') });
    await app.evaluate(() => (globalThis as unknown as { __executionFixture: { release: (() => void) | null } }).__executionFixture.release?.());
    await expect(page.getByTestId('session-worktree-trigger')).toHaveAttribute('data-git-kind', 'worktree');
    const active = (await invoke(page, 'workspaces', 'getActive')).activeWorkspace as { id: string; rootPath: string; activeSessionKey: string };
    expect(active.id).not.toBe(original.id); expect(active.activeSessionKey).not.toBe(original.activeSessionKey);
    await expect(input).toHaveValue('');
    expect(await readFile(join(active.rootPath, 'README.md'), 'utf8')).toContain('Execution tray fixture');
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: active.rootPath, encoding: 'utf8', windowsHide: true }).trim();
    expect(branch).toMatch(/^codex\/task-/); expect(git('worktree', 'list', '--porcelain')).toContain(branch);
    report.created = { path: active.rootPath, branch, session: active.activeSessionKey, clicks: 2 };
    await input.fill('Worktree draft');
    await page.getByTestId('composer-context-more').click(); await page.getByTestId('session-worktree-option-0').click();
    await expect(page.getByTestId('session-worktree-trigger')).toHaveCount(0);
    await expect(input).toHaveValue('Keep this original draft');
    await page.screenshot({ path: info.outputPath('main-directory-without-local-button.png') });
    expect((await invoke(page, 'workspaces', 'getActive')).activeWorkspaceId).toBe(original.id);
    report.originalDraftRestored = true;
    await page.getByTestId('composer-context-branch').click();
    await expect(page.getByTestId('session-worktree-submit')).toHaveCount(0);
    await page.getByTestId('composer-context-branch-search').fill('alternate');
    await expect(page.getByTestId('composer-context-checkout-main')).toHaveCount(0);
    await page.getByTestId('composer-context-checkout-feature/alternate').click();
    await expect(page.getByTestId('composer-context-branch')).toHaveText('feature/alternate');
    expect(git('branch', '--show-current')).toBe('feature/alternate');
    await page.keyboard.press('Escape');
    await page.getByTestId('composer-context-more').click(); await page.getByTestId('session-worktree-option-1').click();
    await expect(input).toHaveValue('Worktree draft');
    report.existingDraftRestored = true;
    await page.getByTestId('composer-context-more').click(); await create.click();
    await expect(progress).toHaveAttribute('data-stage', 'creating');
    await page.getByTestId('worktree-creation-stay').click();
    await expect(page.getByTestId('worktree-creation-stay')).toBeDisabled();
    await page.screenshot({ path: info.outputPath('worktree-stay-progress.png') });
    await app.evaluate(() => (globalThis as unknown as { __executionFixture: { release: (() => void) | null } }).__executionFixture.release?.());
    await expect(progress).toHaveAttribute('data-failed', 'true');
    await expect(progress).toContainText('Read-only workspace mode');
    const retry = page.getByTestId('worktree-creation-retry');
    await page.mouse.move(20, 80);
    await expect(retry).toHaveCSS('background-color', 'rgb(243, 243, 241)');
    await expect(retry).toHaveCSS('color', 'rgb(31, 31, 29)');
    await expect(progress).toHaveCSS('border-top-color', 'rgb(74, 74, 71)');
    await page.screenshot({ path: info.outputPath('worktree-permission-failure.png') });
    await retry.hover(); await expect(retry).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.mouse.move(20, 80);
    await expect(page.getByTestId('chat-page')).toHaveCSS('background-color', 'rgb(247, 247, 245)');
    await expect(progress).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(retry).toHaveCSS('background-color', 'rgb(31, 31, 29)');
    await expect(retry).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(progress).toHaveCSS('border-top-color', 'rgb(223, 223, 218)');
    await page.screenshot({ path: info.outputPath('worktree-permission-failure-light.png') });
    await retry.hover(); await expect(retry).toHaveCSS('background-color', 'rgb(51, 51, 49)');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await invoke(page, 'workspaces', 'update', { id: active.id, permissionMode: 'acceptEdits' });
    await page.getByTestId('worktree-creation-retry').click();
    await expect(progress).toHaveAttribute('data-stage', 'creating');
    await expect(progress).toHaveAttribute('data-failed', 'false');
    await page.getByTestId('worktree-creation-stay').click();
    await app.evaluate(() => (globalThis as unknown as { __executionFixture: { release: (() => void) | null } }).__executionFixture.release?.());
    await expect(progress).toHaveCount(0);
    await expect(input).toHaveValue('Worktree draft');
    await expect(page.getByTestId('worktree-creation-ready')).toBeVisible();
    expect((await invoke(page, 'workspaces', 'getActive')).activeWorkspaceId).toBe(active.id);
    expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(3);
    report.createWithoutSwitching = true;
    report.permissionFailureRetried = true;
    await page.getByTestId('worktree-creation-ready').getByRole('button', { name: 'Dismiss worktree notice' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
      await expect(page.getByTestId('chat-page')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(33, 33, 31)' : 'rgb(247, 247, 245)');
      await expect(page.getByTestId('chat-composer-shell')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(56, 56, 54)' : 'rgb(255, 255, 255)');
      for (const width of [1280, 600, 375]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(page.getByTestId('session-worktree-trigger')).toBeInViewport();
        await expect(page.getByTestId('composer-context-more')).toBeInViewport();
        await expect(page.getByTestId('composer-context-branch')).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByTestId('composer-context-branch').click();
        await expect(page.getByTestId('composer-context-branch-search')).toBeFocused();
        await expect(page.getByTestId('composer-context-branches')).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath(`${theme}-${width}-startup-branches.png`) });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('composer-context-branch')).toBeFocused();
        await page.getByTestId('composer-context-more').click();
        await expect(menu).toBeInViewport(); await expect(menu).toHaveCSS('border-radius', '18px');
        await expect(page.getByTestId('session-worktree-submit')).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`${theme}-${width}-execution-menu.png`) });
        await page.getByTestId('session-worktree-create').click();
        await expect(page.getByTestId('session-worktree-branch')).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${theme}-${width}-advanced.png`) });
        await page.getByTestId('session-worktree-create').click();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('composer-context-more')).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 960, height: 800 });
    await input.fill('Draft protected while running');
    await page.getByTestId('composer-context-branch').click();
    await expect(menu).toBeVisible();
    await app.evaluate(({ BrowserWindow }, key) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:runtime-event', { type: 'run.started', sessionKey: key, runId: 'tray-running', ts: Date.now(), startedAt: Date.now() });
    }, active.activeSessionKey);
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'running-with-draft');
    await expect(page.getByTestId('composer-context-row')).toHaveCount(0);
    await expect(menu).toHaveCount(0);
    await expect(input).toHaveValue('Draft protected while running');
    await page.screenshot({ path: info.outputPath('running-setup-hidden-dark.png') });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(page.getByTestId('chat-page')).toHaveCSS('background-color', 'rgb(247, 247, 245)');
    await expect(page.getByTestId('chat-composer-shell')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByTestId('composer-context-row')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('running-setup-hidden-light.png') });
    await installIpcMocks(app, { gatewayRpcByMethod: {
      'chat.history': { messages: [{ id: 'startup-used', role: 'user', content: 'This conversation has started', timestamp: Date.now() }] },
    } });
    await app.evaluate(({ BrowserWindow }, key) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:runtime-event', { type: 'run.ended', sessionKey: key, runId: 'tray-running', status: 'completed', ts: Date.now(), endedAt: Date.now() });
    }, active.activeSessionKey);
    await page.reload();
    await expect(page.getByTestId('chat-user-message-bubble')).toContainText('This conversation has started');
    await expect(page.getByTestId('composer-context-row')).toHaveCount(0);
    await expect(page.getByTestId('composer-execution-tray')).toBeHidden();
    await installIpcMocks(app, { gatewayRpcByMethod: { 'chat.history': { messages: [] } } });
    await page.getByTestId('sidebar-new-chat').click();
    await expect(page.getByTestId('composer-context-row')).toBeVisible();
    await expect(page.getByTestId('composer-context-branch')).toBeVisible();
    await page.screenshot({ path: info.outputPath('new-session-startup-restored.png') });
    report.runningGuard = true; report.startupOnly = true; report.branchSearch = true; report.errors = errors; expect(errors).toEqual([]);
    await writeFile(info.outputPath('execution-context.json'), JSON.stringify(report, null, 2));
  } finally {
    const calls = await app.evaluate(() => (globalThis as unknown as { __executionFixture?: { calls: unknown[] } }).__executionFixture?.calls ?? []).catch(() => []);
    await writeFile(info.outputPath('worktree-host-results.json'), JSON.stringify(calls, null, 2));
    await closeElectronApp(app);
  }
});
