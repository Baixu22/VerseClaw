import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

async function invoke(page: Page, module: string, action: string, payload?: unknown) {
  return page.evaluate(async ({ module, action, payload }) => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module, action, payload }) as { ok: boolean; data: Record<string, unknown> };
    if (!result.ok) throw new Error(`${module}.${action} failed`);
    return result.data;
  }, { module, action, payload });
}

test('checkout, transcript, children and drafts follow the selected conversation', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const scratch = process.env.CLAWX_E2E_FIXTURE_ROOT ?? join(process.cwd(), '.tmp');
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'session-navigation-'));
  const mainRoot = join(dir, 'main');
  const treeRoot = join(dir, 'worktree');
  await mkdir(mainRoot);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: mainRoot, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'UI Acceptance'); git('config', 'user.email', 'ui@example.invalid');
  await writeFile(join(mainRoot, 'README.md'), '# Navigation fixture\n');
  git('add', '.'); git('commit', '-m', 'Fixture');
  git('worktree', 'add', '-b', 'feature/cards', treeRoot);
  git('branch', 'feature/alternate');
  const keys = { main: 'agent:main:nav-main', child: 'agent:main:nav-child', unfiled: 'agent:main:nav-unfiled', tree: 'agent:main:nav-tree', older: 'agent:main:nav-older' };
  const sessions = [
    { key: keys.main, displayName: 'Main conversation', updatedAt: 40 },
    { key: keys.child, displayName: 'Explore card layout', parentSessionKey: keys.main, forkedFromParent: true, updatedAt: 30 },
    { key: keys.unfiled, displayName: 'New runtime child', parentSessionKey: keys.main, forkedFromParent: true, updatedAt: 25 },
    { key: keys.tree, displayName: 'Worktree conversation', updatedAt: 20 },
    { key: keys.older, displayName: 'Earlier worktree review', updatedAt: 10 },
  ];
  const histories = Object.fromEntries(sessions.map((session) => [session.key, [{ role: 'user', content: `History: ${session.displayName}`, timestamp: 1772100000 }]]));
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, env: { GIT_CEILING_DIRECTORIES: scratch } });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      gatewayRpcByMethod: { 'sessions.list': { success: true, result: { sessions } } },
      gatewayRpc: Object.fromEntries(Object.entries(histories).flatMap(([sessionKey, messages]) => [200, 1000].map((limit) => [JSON.stringify(['chat.history', { limit, maxChars: 500000, sessionKey }]), { success: true, result: { messages } }]))),
      hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', mainSessionKey: keys.main }], defaultAgentId: 'main' } },
    });
    await app.evaluate(() => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: { module?: string; action?: string }) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const observations: unknown[] = [];
      (globalThis as unknown as { __navigationGitResults: unknown[] }).__navigationGitResults = observations;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request) => {
        const result = await original(event, request);
        if (request.module === 'git' && request.action === 'checkoutBranch') observations.push(result);
        return result;
      });
    });
    const page = await getStableWindow(app);
    const capture = async (name: string) => {
      // Escape restores the trigger's keyboard focus (and its tooltip). Focus
      // the surface being reviewed before capturing the settled interaction.
      if (await page.getByTestId('chat-session-navigation-search').isVisible()) {
        await page.getByTestId('chat-session-navigation-search').focus();
      } else if (await page.locator('[data-testid="welcome-branch-menu"][data-state="open"]').isVisible()) {
        await page.getByTestId('welcome-branch-menu').getByRole('textbox').focus();
      } else {
        await page.getByTestId('chat-composer-input').focus();
      }
      await page.mouse.move(6, 6);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: testInfo.outputPath(name) });
    };
    await page.setViewportSize({ width: 1280, height: 800 });
    // Seed persistent workspace state while Chat is unmounted, so its active
    // draft autosave cannot race the fixture's direct owner writes.
    await page.evaluate(() => { window.location.hash = '#/settings'; });
    await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);
    const a = (await invoke(page, 'workspaces', 'create', { rootPath: mainRoot, name: 'Navigation · main', agentId: 'main', activeSessionKey: keys.main, permissionMode: 'acceptEdits' })).activeWorkspace as { id: string };
    const b = (await invoke(page, 'workspaces', 'create', { rootPath: treeRoot, name: 'Navigation · worktree', agentId: 'main', activeSessionKey: keys.tree, permissionMode: 'acceptEdits' })).activeWorkspace as { id: string };
    for (const [id, sessionKey, draft] of [[a.id, keys.main, 'Main draft'], [a.id, keys.child, 'Child draft'], [b.id, keys.tree, 'Worktree draft'], [b.id, keys.older, 'Older draft']]) {
      await invoke(page, 'workspaces', 'saveState', { id, sessionKey, state: { draftInput: draft } });
    }
    await invoke(page, 'workspaces', 'switch', { id: a.id });
    const seeded = await invoke(page, 'workspaces', 'list');
    await writeFile(testInfo.outputPath('seeded-workspaces.json'), JSON.stringify(seeded, null, 2));
    await page.evaluate(() => { window.location.hash = '#/'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Main draft');
    await expect(page.getByTestId('chat-user-message-bubble')).toHaveText('History: Main conversation');
    await expect(page.getByTestId('chat-header-branch')).toContainText('main');
    await page.getByTestId('session-family-toggle-' + keys.main).click();
    await expect(page.getByTestId('sidebar-session-' + keys.child)).toBeVisible();
    await capture('light-parent-family.png');
    await expect(page.getByTestId('chat-header-session-name')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('chat-header-session-name').click();
    await expect(page.getByTestId('chat-header-session-name')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('chat-header-session-name')).toHaveClass(/is-open/);
    await expect(page.getByTestId('chat-session-navigation-menu')).toContainText('Conversations in this workspace');
    await expect(page.getByTestId('chat-session-derived-' + keys.child)).toHaveCount(1);
    await expect(page.getByTestId('chat-session-derived-' + keys.child)).toHaveAttribute('data-derived', 'true');
    await expect(page.getByTestId('chat-session-item-' + keys.child)).toHaveCount(0);
    await capture('light-parent-sessions.png');
    await page.getByTestId('chat-session-derived-' + keys.child).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child draft');
    await page.getByTestId('chat-header-session-name').click();
    await expect(page.getByTestId('session-family-source')).toContainText('Main conversation');
    await capture('light-child-source.png');
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Main draft');
    await page.getByTestId('chat-header-session-name').click();
    await page.getByTestId('chat-session-derived-' + keys.unfiled).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
    await expect(page.getByTestId('chat-user-message-bubble')).toHaveText('History: New runtime child');
    expect((await invoke(page, 'workspaces', 'getActive')).activeWorkspaceId).toBe(a.id);
    await page.getByTestId('chat-header-session-name').click();
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Main draft');

    // Navigate before the 250ms draft debounce: both write and restore must
    // retain their original workspace/session ownership.
    await page.getByTestId('chat-composer-input').fill('Main draft immediately before switching');
    await page.getByTestId('sidebar-session-' + keys.older).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Older draft');
    await expect(page.getByTestId('chat-user-message-bubble')).toHaveText('History: Earlier worktree review');
    await expect(page.getByTestId('chat-header-branch')).toContainText('feature/cards');
    await expect(page.getByTestId('session-worktree-trigger')).toHaveAttribute('data-git-kind', 'worktree');
    expect((await invoke(page, 'workspaces', 'getActive')).activeWorkspaceId).toBe(b.id);

    await page.getByTestId('welcome-branch-trigger').click();
    await page.getByTestId('welcome-branch-item-feature-alternate').click();
    await expect(page.getByTestId('welcome-branch-menu')).toHaveCount(0);
    await expect(page.getByTestId('chat-header-branch')).toContainText('feature/alternate');
    await expect(page.getByTestId('composer-git-trigger')).toContainText('feature/alternate');
    if (!await page.getByTestId('session-activity-panel').isVisible()) await page.getByTestId('chat-session-activity-toggle').click();
    await expect(page.getByTestId('session-activity-head-branch')).toContainText('feature/alternate');
    await page.getByTestId('session-activity-close').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Older draft');
    await page.getByTestId('sidebar-session-' + keys.main).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Main draft immediately before switching');
    await expect(page.getByTestId('chat-header-branch')).toContainText('main');
    await page.getByTestId('session-worktree-trigger').click();
    await page.getByTestId('session-worktree-menu').getByRole('button').filter({ hasText: 'feature/alternate' }).click();
    await expect(page.getByTestId('chat-header-session-name')).toContainText('Earlier worktree review');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Older draft');
    await expect(page.getByTestId('session-worktree-trigger')).toHaveAttribute('data-git-kind', 'worktree');

    const snapshot = await invoke(page, 'workspaces', 'list');
    const profiles = snapshot.profiles as Array<{ id: string; sessionStates: Record<string, unknown> }>;
    expect(profiles.find((p) => p.id === a.id)!.sessionStates).not.toHaveProperty(keys.older);
    expect(profiles.find((p) => p.id === b.id)!.sessionStates).not.toHaveProperty(keys.main);
    if (await page.getByTestId('session-activity-close').isVisible()) await page.getByTestId('session-activity-close').click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      for (const width of [1280, 960]) {
        await page.setViewportSize({ width, height: 800 });
        await capture(`${theme}-${width}-worktree-session.png`);
        await page.getByTestId('chat-header-session-name').click();
        await expect(page.getByTestId('chat-session-navigation-menu')).toBeInViewport();
        await expect(page.getByTestId(`chat-session-item-${keys.older}`)).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('chat-session-navigation-menu').getByTestId('chat-session-checkpoints')).toHaveCount(0);
        await capture(`${theme}-${width}-sessions.png`);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('chat-session-navigation-menu')).toHaveCount(0);
        await page.getByTestId('welcome-branch-trigger').click();
        await expect(page.getByTestId('welcome-branch-menu')).toBeInViewport();
        await expect(page.getByTestId('welcome-branch-item-feature-alternate')).toBeVisible();
        await expect(page.getByTestId('welcome-branch-menu')).toHaveCSS('filter', 'none');
        await capture(`${theme}-${width}-branches.png`);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('welcome-branch-menu')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
    await writeFile(testInfo.outputPath('navigation-evidence.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', git: 'real', workspaceStorage: 'real', gateway: 'fixture', profiles, sessionKeys: keys }, null, 2));
  } catch (error) {
    const page = await getStableWindow(app);
    await writeFile(testInfo.outputPath('failed-workspaces.json'), JSON.stringify(await invoke(page, 'workspaces', 'list'), null, 2));
    await writeFile(testInfo.outputPath('host-calls.json'), JSON.stringify(await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls: unknown[] }).__verseClawE2eHostCalls), null, 2));
    await writeFile(testInfo.outputPath('git-results.json'), JSON.stringify(await app.evaluate(() => (globalThis as unknown as { __navigationGitResults: unknown[] }).__navigationGitResults), null, 2));
    throw error;
  } finally { await closeElectronApp(app); }
});
