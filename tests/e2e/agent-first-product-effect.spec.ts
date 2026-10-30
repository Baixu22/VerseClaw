import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway } from './fixtures/fp-p1-harness';

type Task = { id: string; status: string; statusExplain?: string };
type TaskResult = { success: boolean; task: Task };

async function portClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

for (const profile of [1, 2, 3]) {
  test(`agent-driven real product effects in isolated profile ${profile}`, async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
    test.setTimeout(480_000);
    let app = await launchElectronApp({ skipSetup: true, theme: 'light' });
    let gatewayPort: number | null = null;
    const steps: Array<{ action: string; state: unknown }> = [];
    const identity = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
      tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8', windowsHide: true }).trim(),
    };
    try {
      let page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      gatewayPort = await startGateway(app);
      const gateway = await hostInvoke<{ state: string; gatewayReady?: boolean; port?: number }>(app, 'gateway', 'status');
      expect(gateway.gatewayReady === true || gateway.state === 'running').toBe(true);
      steps.push({ action: 'real-gateway-running', state: gateway });
      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toBeEnabled();
      await composer.fill(`Agent First profile ${profile} draft`);
      await expect(composer).toHaveValue(`Agent First profile ${profile} draft`);
      await composer.fill('');
      steps.push({ action: 'input-and-clear-draft', state: await composer.inputValue() });

      await page.getByTestId('sidebar-nav-settings').click();
      const themes = page.getByTestId('settings-theme-mode').getByRole('radiogroup', { name: 'Theme' });
      await themes.getByRole('radio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('verse-claw-settings') ?? '{}').state?.theme)).toBe('dark');
      steps.push({ action: 'theme-ui', state: 'dark' });
      await expect(hostInvoke(app, 'settings', 'set', { key: 'not-a-real-setting', value: true })).rejects.toThrow();
      steps.push({ action: 'invalid-setting-denied', state: true });

      await expect(hostInvoke(app, 'agentBrowser', 'createTask', { name: 'Invalid URL', url: 'file:///outside-workspace', objective: 'invalid-input control', mode: 'headless', profile: 'default' })).rejects.toThrow();
      const created = await hostInvoke<TaskResult>(app, 'agentBrowser', 'createTask', { name: `AF governed task ${profile}`, url: 'https://example.com', objective: 'permission-state readback only; no navigation', mode: 'headless', profile: 'default' });
      expect(created.task.status).toBe('waiting-approval');
      await expect(hostInvoke(app, 'agentBrowser', 'runTask', { taskId: created.task.id })).rejects.toThrow(/approval/i);
      const rejected = await hostInvoke<TaskResult>(app, 'agentBrowser', 'rejectTask', { taskId: created.task.id });
      expect(rejected.task.status).toBe('cancelled');
      steps.push({ action: 'approval-bypass-blocked-and-rejected', state: rejected.task });

      const candidate = await hostInvoke<TaskResult>(app, 'agentBrowser', 'createTask', { name: `AF cancellable task ${profile}`, url: 'https://example.com', objective: 'cancel without navigation', mode: 'headless', profile: 'default' });
      const cancelled = await hostInvoke<TaskResult>(app, 'agentBrowser', 'cancelTask', { taskId: candidate.task.id });
      expect(cancelled.task.status).toBe('cancelled');
      const list = await hostInvoke<{ tasks: Task[] }>(app, 'agentBrowser', 'tasks');
      expect(list.tasks.find((task) => task.id === created.task.id)?.status).toBe('cancelled');
      expect(list.tasks.find((task) => task.id === candidate.task.id)?.status).toBe('cancelled');
      steps.push({ action: 'cancel-final-owner-state', state: list.tasks.filter((task) => [created.task.id, candidate.task.id].includes(task.id)) });

      const workspaceRoot = join(homeDir, 'approval-workspace');
      await mkdir(workspaceRoot, { recursive: true });
      const fixtureGit = (...args: string[]) => execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8', windowsHide: true }).trim();
      fixtureGit('init', '-q'); fixtureGit('config', 'user.name', 'Agent Fixture'); fixtureGit('config', 'user.email', 'fixture@example.invalid');
      await writeFile(join(workspaceRoot, 'effect.txt'), 'before\n'); fixtureGit('add', 'effect.txt'); fixtureGit('commit', '-qm', 'fixture base');
      await writeFile(join(workspaceRoot, 'effect.txt'), 'after\n');
      const workspace = await hostInvoke<{ activeWorkspaceId: string }>(app, 'workspaces', 'create', { name: `AF approval ${profile}`, rootPath: workspaceRoot, agentId: 'main', permissionMode: 'acceptEdits' });
      expect(workspace.activeWorkspaceId).toBeTruthy();
      type GitResult = { success: boolean; approvalRequired?: boolean; approval?: { id: string } };
      const denied = await hostInvoke<GitResult>(app, 'git', 'revertFile', { path: 'effect.txt' });
      expect(denied.success).toBe(false); expect(denied.approvalRequired).toBe(true);
      expect(await readFile(join(workspaceRoot, 'effect.txt'), 'utf8')).toBe('after\n');
      await hostInvoke(app, 'permissions', 'decideApproval', { id: denied.approval!.id, decision: 'denied' });
      expect(await readFile(join(workspaceRoot, 'effect.txt'), 'utf8')).toBe('after\n');
      const requested = await hostInvoke<GitResult>(app, 'git', 'revertFile', { path: 'effect.txt' });
      expect(requested.approvalRequired).toBe(true);
      await hostInvoke(app, 'permissions', 'decideApproval', { id: requested.approval!.id, decision: 'approved' });
      const restored = await hostInvoke<GitResult>(app, 'git', 'revertFile', { path: 'effect.txt', approvalId: requested.approval!.id });
      expect(restored.success).toBe(true); expect(await readFile(join(workspaceRoot, 'effect.txt'), 'utf8')).toBe('before\n');
      steps.push({ action: 'real-permission-reject-approve-undo', state: { denied, requested, restored, file: await readFile(join(workspaceRoot, 'effect.txt'), 'utf8') } });
      await page.screenshot({ path: testInfo.outputPath('profile-before-restart.png') });
      await hostInvoke(app, 'gateway', 'stop');
      await expect.poll(() => portClosed(gatewayPort!)).toBe(true);
      await closeElectronApp(app);

      app = await launchElectronApp({ skipSetup: true });
      page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('verse-claw-settings') ?? '{}').state?.theme)).toBe('dark');
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-theme-mode').getByRole('radio', { name: 'Light' }).click();
      await expect(page.locator('html')).toHaveClass(/light/);
      steps.push({ action: 'restart-persistence-and-undo', state: 'light restored after observing dark persistence' });
      await page.screenshot({ path: testInfo.outputPath('profile-after-restart.png') });
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
      await closeElectronApp(app);
      await expect.poll(() => portClosed(gatewayPort!)).toBe(true);
      await writeFile(testInfo.outputPath('product-effect.json'), JSON.stringify({ schemaVersion: 'AgentFirstProductEffect/v1', driven_by: 'agent', actor: 'codex/playwright-product-proxy', profile, identity, homeDir, userDataDir, gatewayPort, steps, finalState: { theme: 'light', taskStates: ['cancelled', 'cancelled'] }, cleanup: { appExitCode: app.process().exitCode, gatewayPortClosed: true }, limitations: ['source-host product effects; no live model or package verdict'] }, null, 2));
    } finally {
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
      await closeElectronApp(app).catch(() => undefined);
    }
  });
}
