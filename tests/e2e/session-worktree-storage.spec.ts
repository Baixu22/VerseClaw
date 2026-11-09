import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, publishGatewayStatus, test } from './fixtures/electron';

async function invoke(page: Page, module: string, action: string, payload?: unknown) {
  return page.evaluate(async ({ module, action, payload }) => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module, action, payload }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!result.ok) throw new Error(result.error?.message);
    return result.data;
  }, { module, action, payload });
}

async function openWorktrees(page: Page) {
  const trigger = page.getByTestId('session-worktree-trigger');
  if (!await trigger.isVisible()) {
    const project = page.getByTestId('welcome-project-trigger');
    const parent = await project.isVisible() ? project : page.getByTestId('chat-header-environment-project').getByRole('button').first();
    await parent.focus(); await parent.press('Enter');
  }
  await expect(trigger).toBeVisible(); await trigger.focus(); await trigger.press('Enter');
}

test('real repository, isolated worktree, storage command and settings in light/dark/narrow layouts', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  // The desktop test profile uses the workspace scratch area on this host.
  // A discovery ceiling keeps the fixture independent of the enclosing repo.
  const scratch = join(process.cwd(), '.tmp');
  await mkdir(scratch, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light', env: { GIT_CEILING_DIRECTORIES: scratch } });
  const root = join(await mkdtemp(join(scratch, 'storage-acceptance-')), 'workspace-demo');
  await mkdir(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'codex', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash', git: 'real', hostStorage: 'real', gateway: 'mocked idle transport' };
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      gatewayRpcByMethod: { 'sessions.list': { sessions: [] }, 'chat.history': { messages: [] }, '*': {} },
      hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', identity: { name: 'Main' } }] } },
    });
    const page = await getStableWindow(app);
    await page.setViewportSize({ width: 1280, height: 800 });
    const created = await invoke(page, 'workspaces', 'create', { rootPath: root, name: 'Workspace demo', agentId: 'main', activeSessionKey: 'agent:main:storage-demo', permissionMode: 'acceptEdits' });
    const original = created.activeWorkspace as { id: string; activeSessionKey: string };
    await page.reload();
    await publishGatewayStatus(app, { state: 'running', gatewayReady: true, port: 18789 });
    await openWorktrees(page);
    await page.getByTestId('session-git-init').click();
    await expect.poll(() => { try { return git('rev-parse', '--is-inside-work-tree'); } catch { return ''; } }).toBe('true');
    report.repositoryInitialized = true;
    await page.keyboard.press('Escape');
    git('config', 'user.name', 'Storage Acceptance'); git('config', 'user.email', 'acceptance@example.invalid');
    await writeFile(join(root, 'README.md'), '# Workspace demo\n');
    git('add', '.'); git('commit', '-m', 'Initial files');
    await page.reload();
    await publishGatewayStatus(app, { state: 'running', gatewayReady: true, port: 18789 });
    await openWorktrees(page);
    await page.getByTestId('session-worktree-create').click();
    await page.getByTestId('session-worktree-branch').fill('codex/storage-demo');
    await page.screenshot({ path: testInfo.outputPath('worktree-create-light.png') });
    await page.getByTestId('session-worktree-submit').click();
    await expect(page.getByTestId('session-worktree-menu')).not.toBeVisible();
    const active = await invoke(page, 'workspaces', 'getActive');
    const worktree = active.activeWorkspace as { id: string; rootPath: string; activeSessionKey: string };
    expect(worktree.rootPath).not.toBe(root);
    expect(worktree.activeSessionKey).not.toBe(original.activeSessionKey);
    expect(await readFile(join(worktree.rootPath, 'README.md'), 'utf8')).toContain('Workspace demo');
    expect(git('worktree', 'list', '--porcelain')).toContain('refs/heads/codex/storage-demo');
    report.worktreeCreated = true; report.independentSession = true;
    // Drafts and selection survive leaving and returning to a checkout.
    await page.getByTestId('chat-composer-input').fill('Draft for this worktree');
    await expect.poll(async () => {
      const data = await invoke(page, 'workspaces', 'getActive');
      return (data.activeWorkspace as { state?: { draftInput?: string } })?.state?.draftInput;
    }).toBe('Draft for this worktree');
    await openWorktrees(page);
    await page.getByTestId('session-worktree-menu').getByRole('button').filter({ hasText: /Local/ }).click();
    await expect.poll(async () => (await invoke(page, 'workspaces', 'getActive')).activeWorkspaceId).toBe(original.id);
    await expect(page.getByTestId('welcome-project-trigger')).toContainText('Workspace demo');
    await expect(page.getByTestId('welcome-project-menu')).toHaveCount(0);
    await openWorktrees(page);
    await page.getByTestId('session-worktree-menu').getByRole('button').filter({ hasText: 'codex/storage-demo' }).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Draft for this worktree');
    report.draftRestored = true;
    await invoke(page, 'workspaces', 'update', { id: worktree.id, permissionMode: 'acceptEdits' });
    const terminalScope = { workspaceId: worktree.id, sessionKey: worktree.activeSessionKey };
    let terminal = await invoke(page, 'terminal', 'open', terminalScope);
    if (terminal.approvalRequired) {
      const approvalId = (terminal.approval as { id: string }).id;
      await invoke(page, 'permissions', 'decideApproval', { id: approvalId, decision: 'approved' });
      terminal = await invoke(page, 'terminal', 'open', { ...terminalScope, approvalId });
    }
    expect(terminal.success).toBe(true);
    expect(terminal.sessionId).toBeTruthy();
    const idlePath = join(dirname(root), 'idle-checkout');
    git('worktree', 'add', '-b', 'codex/cleanup-demo', idlePath);
    // driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash
    // Real local-only commit: removing its checkout must retain a recoverable branch.
    const unpublishedContent = 'U5 local-only committed work\n';
    await writeFile(join(idlePath, 'unpublished.txt'), unpublishedContent);
    git('-C', idlePath, 'add', 'unpublished.txt');
    git('-C', idlePath, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Unpublished U5 work');
    const unpublishedHead = git('-C', idlePath, 'rev-parse', 'HEAD');
    expect(git('-C', idlePath, 'status', '--porcelain')).toBe('');
    expect(git('remote')).toBe('');
    report.unpublishedBeforeRemoval = { head: unpublishedHead, branch: 'codex/cleanup-demo', clean: true, remotes: [] };
    await page.getByTestId('chat-composer-input').fill('/storage');
    await expect(page.getByTestId('chat-slash-command-option-storage')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('storage-page')).toBeVisible();
    await expect(page.getByTestId('storage-worktrees')).toContainText('codex/storage-demo', { timeout: 30_000 });
    await expect(page.getByTestId('settings-nav-storage')).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: testInfo.outputPath('storage-light.png') });
    const sessionRow = page.getByTestId('storage-sessions').locator('.sp-row').filter({ hasText: 'codex/storage-demo' });
    await sessionRow.getByRole('button', { name: 'Release', exact: true }).click();
    await expect(page.getByTestId('storage-confirm')).toBeVisible();
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
    await page.screenshot({ path: testInfo.outputPath('resource-release-confirm.png') });
    await page.getByTestId('storage-confirm').click();
    await expect(page.getByTestId('storage-confirm')).not.toBeVisible();
    await expect(sessionRow.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
    const afterRelease = await invoke(page, 'terminal', 'list', { workspaceId: worktree.id, sessionKey: worktree.activeSessionKey });
    expect(afterRelease.sessions).toEqual([]);
    report.realTerminalReleased = true;
    await page.getByTestId('storage-worktrees').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('worktrees-light.png') });
    const idleRow = page.getByTestId('storage-worktrees').locator('.sp-row').filter({ hasText: 'codex/cleanup-demo' });
    await idleRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByTestId('storage-confirm')).toBeVisible();
    const dialog = page.getByRole('dialog');
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBeLessThan(500);
    expect(bounds?.x).toBeGreaterThan(300);
    expect(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('worktree-remove-confirm.png') });
    await page.getByTestId('storage-confirm').click();
    await expect(page.getByTestId('storage-confirm')).not.toBeVisible();
    await expect.poll(() => git('worktree', 'list', '--porcelain')).not.toContain('refs/heads/codex/cleanup-demo');
    expect(git('branch', '--list', 'codex/cleanup-demo')).toContain('codex/cleanup-demo');
    expect(git('rev-parse', 'refs/heads/codex/cleanup-demo')).toBe(unpublishedHead);
    const recoveredPath = join(dirname(root), 'recovered-checkout');
    git('worktree', 'add', recoveredPath, 'codex/cleanup-demo');
    expect(await readFile(join(recoveredPath, 'unpublished.txt'), 'utf8')).toBe(unpublishedContent);
    report.unpublishedAfterRemoval = { head: git('-C', recoveredPath, 'rev-parse', 'HEAD'),
      retainedRef: 'refs/heads/codex/cleanup-demo', recoveredContent: await readFile(join(recoveredPath, 'unpublished.txt'), 'utf8') };
    report.worktreeRemovedWithBranchRetained = true;
    await page.getByTestId('storage-refresh').scrollIntoViewIfNeeded();
    report.slashAndSettings = true;
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
    for (const [theme, width, height] of [['dark', 1280, 800], ['light', 760, 560]] as const) {
      await page.evaluate((theme) => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
      await page.setViewportSize({ width, height });
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: testInfo.outputPath(`storage-${theme}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    // Navigation entry reaches the same route after leaving the command view.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('settings-nav-general').click();
    await page.getByTestId('settings-nav-storage').click();
    await expect(page.getByTestId('storage-worktrees')).toContainText('codex/storage-demo');
    report.settingsEntry = true;
    const storage = await invoke(page, 'sessionStorage', 'snapshot');
    expect(typeof storage.applicationMemoryBytes).toBe('number');
    report.snapshot = storage;
    await writeFile(testInfo.outputPath('acceptance.json'), JSON.stringify(report, null, 2));
  } catch (error) {
    const page = await getStableWindow(app).catch(() => null);
    if (page) {
      await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
      await writeFile(testInfo.outputPath('failure-text.txt'), await page.locator('body').innerText().catch(() => 'window closed'));
      await writeFile(testInfo.outputPath('host-calls.json'), JSON.stringify(await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls: unknown[] }).__verseClawE2eHostCalls).catch(() => []), null, 2));
      await writeFile(testInfo.outputPath('actual-workspace.json'), JSON.stringify(await invoke(page, 'workspaces', 'getActive').catch((cause) => String(cause)), null, 2));
    }
    throw error;
  } finally { await closeElectronApp(app); }
});
