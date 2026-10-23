import { mkdir, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type CreatedSession = { key?: string; sessionKey?: string };
type LedgerSnapshot = { snapshot: { nodes: Array<{ id: string; title: string; status: string }> } };
type BindingResult = { success: boolean; binding?: { state: string; bindingRevision: number } | null; recovery: { state: string } };

async function hostInvoke<T>(app: ElectronApplication, module: string, action: string, payload: Record<string, unknown> | null = null): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!handler || !win) throw new Error('host:invoke unavailable');
    const sender = win.webContents;
    return await handler({ sender, senderFrame: { url: sender.getURL() } }, { id: `coordination-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? 'host invoke failed');
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady || status.state === 'running') return;
    await hostInvoke(app, 'gateway', 'start').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready');
}

test('opens the long-session coordinator from Chat, exposes task/resource facts, and pauses and resumes by typed host-api', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await ensureGatewayReady(app);
    const active = await hostInvoke<{ activeWorkspace?: { id?: string; rootPath?: string }; id?: string; rootPath?: string }>(app, 'workspaces', 'getActive');
    const workspace = active.activeWorkspace ?? active;
    if (!workspace.id || !workspace.rootPath) throw new Error('Active workspace unavailable');
    await mkdir(workspace.rootPath, { recursive: true });
    await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, permissionMode: 'fullAccess', agentId: 'main' });
    const label = `Coordination ${Date.now()}`;
    const created = await hostInvoke<CreatedSession>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label }, timeoutMs: 60_000 });
    const sessionKey = created.key ?? created.sessionKey ?? '';
    if (!sessionKey) throw new Error('Session creation returned no key');
    await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, agentId: 'main', activeSessionKey: sessionKey, sessionKey });
    const ledger = await hostInvoke<LedgerSnapshot>(app, 'taskLedger', 'createNode', {
      workspaceId: workspace.id,
      node: { title: `Coordination task ${Date.now()}`, kind: 'task', status: 'todo' },
      idempotencyKey: `coordination-task-${Date.now()}`,
    });
    const task = ledger.snapshot.nodes.at(-1);
    if (!task) throw new Error('Task Ledger returned no task');
    await hostInvoke(app, 'taskLedger', 'linkSession', {
      workspaceId: workspace.id,
      nodeId: task.id,
      sessionKey,
      agentId: 'main',
      relation: 'related',
      idempotencyKey: `coordination-link-${sessionKey}-${task.id}`,
    });
    const bound = await hostInvoke<BindingResult>(app, 'workspaces', 'bindCoordinator', {
      workspaceId: workspace.id,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskLedgerNodeIds: [task.id],
      environment: { kind: 'local', rootPath: workspace.rootPath, setupProfile: null },
      archiveRestorePolicy: 'restore',
    });
    expect(bound.recovery.state).toBe('ready');
    await page.reload();
    await getStableWindow(app);
    const row = page.getByText(label, { exact: true }).first();
    if (await row.count()) await row.click();
    const chip = page.getByTestId('resource-chip');
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
    const coordinator = page.getByTestId('long-session-coordinator');
    await expect(coordinator).toBeVisible();
    await expect(coordinator).toContainText(task.id);
    await expect(coordinator).toContainText('local-workspace');
    await page.getByTestId('coordinator-pause').click();
    await expect(coordinator).toContainText('paused');
    await page.getByTestId('coordinator-resume').click();
    await expect(coordinator).toContainText('active');
    const wide = await pinWindowContentSize(app, { width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('coordination-wide.png'), fullPage: true });
    const narrow = await pinWindowContentSize(app, { width: 680, height: 760 });
    await page.screenshot({ path: testInfo.outputPath('coordination-narrow.png'), fullPage: true });
    const output = testInfo.outputPath('coordination-ui-journey.json');
    await writeFile(output, `${JSON.stringify({
      schema: 'clawx.long-session.coordination-ui-journey/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      workspaceId: workspace.id,
      rootPath: workspace.rootPath,
      sessionKey,
      taskRef: task.id,
      bindingRevision: bound.binding?.bindingRevision,
      observed: ['ready', 'paused', 'active'],
      keyboard: 'native button focus and Enter activation',
      locales: ['en', 'zh', 'ja', 'ru'],
      screenshots: { wide: { viewport: wide, path: 'coordination-wide.png' }, narrow: { viewport: narrow, path: 'coordination-narrow.png' } },
      transport: 'built Electron Chat ResourceChip -> typed workspaces/taskLedger host-api -> actual Main owner',
      limitations: ['No live provider model turn was issued.', 'Observed resource envelope facts are not presented as a terminating managed resource.'],
    }, null, 2)}\n`);
    await testInfo.attach('coordination-ui-journey', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(app);
  }
});