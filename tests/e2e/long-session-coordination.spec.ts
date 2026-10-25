import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string };
type AdmissionReceipt = {
  receiptId: string;
  childSessionKey: string | null;
  childRunId: string | null;
  orchestrationRunId: string | null;
  roleName: string;
};
type CompletionBatch = {
  id: string;
  orchestrationRunId: string;
  terminal: boolean;
  status: string;
  delivery: { state: string };
};
type ActivitySnapshot = { completionBatches: CompletionBatch[] };

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: 'c4-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? 'host invoke failed: ' + module + '.' + action);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let startRequested = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!startRequested && status.state !== 'starting') {
      startRequested = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready');
}

async function createSession(app: ElectronApplication, label: string): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label },
    timeoutMs: 60_000,
  });
  const key = typeof created.key === 'string' ? created.key : created.sessionKey;
  if (typeof key !== 'string') throw new Error('sessions.create returned no key');
  return key;
}

async function readActivity(
  app: ElectronApplication,
  workspaceId: string,
  sessionKey: string,
): Promise<ActivitySnapshot> {
  const result = await hostInvoke<{ snapshot: ActivitySnapshot }>(app, 'sessionActivity', 'snapshot', {
    workspaceId,
    sessionKey,
  });
  return result.snapshot;
}

async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow');
    win.setContentSize(size.width, size.height);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, { width, height });
}

async function setLanguage(app: ElectronApplication, page: Awaited<ReturnType<ElectronApplication['firstWindow']>>, language: string): Promise<void> {
  await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
  await page.reload();
  await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
}

test('real Host/Gateway long-session coordination is reachable through Sidebar and Chat', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  let app: ElectronApplication | undefined;
  const observations: Record<string, unknown> = {
    schema: 'clawx.long-session.c4-ui-journeys/v1',
    driven_by: 'agent',
    actor: 'codex-long-session-c4',
    locales: [],
    screenshots: [],
  };
  const screenshotDir = process.env.CLAWX_C4_SCREENSHOT_DIR;
  try {
    app = await launchElectronApp({ skipSetup: true });
    const initialPage = await getStableWindow(app);
    await ensureGatewayReady(app);
    const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace?.id;
    if (!workspaceId) throw new Error('No active workspace');
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const coordinatorSessionKey = await createSession(app, 'Long-session coordinator ' + Date.now());
    const secondarySessionKey = await createSession(app, 'Ordinary conversation ' + Date.now());
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: coordinatorSessionKey,
      sessionKey: coordinatorSessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string }> } }>(
      app,
      'taskLedger',
      'createNode',
      {
        workspaceId,
        node: { title: 'Long-session coordination journey', kind: 'task', status: 'doing', owner: 'agent' },
      },
    );
    const taskNodeId = ledger.snapshot.nodes.find((node) => node.title === 'Long-session coordination journey')?.id;
    if (!taskNodeId) throw new Error('Task Ledger node missing');
    await hostInvoke(app, 'sessions', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey: coordinatorSessionKey,
      expectedRevision: 0,
      taskRefs: [{ kind: 'task-ledger', nodeId: taskNodeId }],
    });
    const admitted = await hostInvoke<{ receipt: AdmissionReceipt }>(app, 'sessions', 'delegateCoordinator', {
      workspaceId,
      idempotencyKey: 'c4-delegation-' + Date.now(),
      roleName: 'implementer',
      task: 'Produce coordination UI evidence',
      taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
      writeSet: ['src/c4-coordination-fixture.ts'],
      isolation: 'shared',
      backend: 'openclaw-embedded',
    });
    if (!admitted.receipt.childSessionKey) throw new Error('Admission has no child session');
    await hostInvoke(app, 'gateway', 'rpc', {
      method: 'sessions.stop',
      params: { key: admitted.receipt.childSessionKey },
      timeoutMs: 60_000,
    });
    let batch: CompletionBatch | undefined;
    await expect.poll(async () => {
      const activity = await readActivity(app!, workspaceId, coordinatorSessionKey);
      batch = activity.completionBatches.find((entry) => entry.orchestrationRunId === admitted.receipt.orchestrationRunId)
        ?? activity.completionBatches[0];
      return batch?.terminal === true;
    }, { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: secondarySessionKey,
      sessionKey: secondarySessionKey,
    });

    const page = await initialPage;
    await page.reload();
    await page.getByTestId('sidebar').waitFor({ state: 'visible', timeout: 30_000 });
    const coordinatorBadge = page.getByTestId('sidebar-session-coordinator-' + coordinatorSessionKey);
    await expect(coordinatorBadge).toBeVisible();
    await page.getByTestId('sidebar-session-' + coordinatorSessionKey).click();
    await page.getByTestId('chat-composer-input').waitFor({ state: 'visible', timeout: 30_000 });

    const activityToggle = page.getByTestId('chat-session-activity-toggle');
    await expect(activityToggle).toBeVisible({ timeout: 30_000 });
    await activityToggle.click();
    const coordination = page.getByTestId('session-activity-coordination');
    await expect(coordination).toBeVisible({ timeout: 30_000 });
    await expect(coordination).toContainText('Stable main session');
    await expect(coordination).toContainText('Long-session coordination journey');
    await expect(coordination).toContainText('implementer');
    await expect(coordination).toContainText('Completion result');
    await expect(coordination).toContainText(String(batch!.status === 'delivered' ? 'Reported' : 'Failed'));

    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      const widePath = join(screenshotDir, 'coordination-rail-wide.png');
      await page.screenshot({ path: widePath });
      (observations.screenshots as Array<Record<string, unknown>>).push({
        state: 'wide',
        path: widePath,
        viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      });
    }

    await resizeWindow(app, 900, 760);
    await expect(activityToggle).toBeVisible();
    await activityToggle.click();
    await expect(coordination).toBeVisible();
    if (screenshotDir) {
      const narrowPath = join(screenshotDir, 'coordination-rail-narrow.png');
      await page.screenshot({ path: narrowPath });
      (observations.screenshots as Array<Record<string, unknown>>).push({
        state: 'narrow',
        path: narrowPath,
        viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      });
    }
    await resizeWindow(app, 1280, 800);

    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!win) throw new Error('No BrowserWindow');
      win.minimize();
      await new Promise((resolve) => setTimeout(resolve, 300));
      win.restore();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await expect(coordination).toBeVisible();

    const taskRow = page.getByTestId('session-activity-coordination-task-' + taskNodeId);
    await expect(taskRow).toHaveAttribute('type', 'button');
    await taskRow.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/task-ledger/);
    await page.goBack();
    await page.getByTestId('chat-composer-input').waitFor({ state: 'visible', timeout: 30_000 });
    if (!(await page.getByTestId('session-activity-coordination').isVisible().catch(() => false))) {
      await page.getByTestId('chat-session-activity-toggle').click();
    }
    await expect(page.getByTestId('session-activity-coordination')).toBeVisible();

    const workRow = page.locator('[data-testid^="session-activity-coordination-work-"]').first();
    await expect(workRow).toBeVisible();
    await workRow.click();
    await expect(page.getByTestId('artifact-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible({ timeout: 30_000 });

    const panelClose = page.locator('[data-testid^="artifact-panel-tab-close-"]').first();
    if (await panelClose.isVisible().catch(() => false)) await panelClose.click();

    const localeCases = [
      { language: 'en', title: 'Long session' },
      { language: 'zh', title: '长期协作' },
      { language: 'ja', title: '長期セッション' },
      { language: 'ru', title: 'Долгая сессия' },
    ];
    for (const localeCase of localeCases) {
      await setLanguage(app, page, localeCase.language);
      await page.getByTestId('sidebar-session-' + coordinatorSessionKey).click();
      await page.getByTestId('chat-session-activity-toggle').click();
      await expect(page.getByTestId('session-activity-coordination')).toContainText(localeCase.title);
      (observations.locales as Array<Record<string, unknown>>).push(localeCase);
    }
    await setLanguage(app, page, 'en');

    observations.coordinatorSessionKey = coordinatorSessionKey;
    observations.secondarySessionKey = secondarySessionKey;
    observations.taskNodeId = taskNodeId;
    observations.receipt = admitted.receipt;
    observations.batch = batch;
    observations.journeys = {
      sidebarExplicitOpen: true,
      switchFromSecondarySession: true,
      keyboardTaskLedgerOpen: true,
      workerTranscriptOpen: true,
      minimizeRestore: true,
      narrowOverlay: true,
      fourLocales: true,
    };
    observations.result = 'pass';
  } catch (error) {
    observations.result = 'fail';
    observations.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (app) await closeElectronApp(app).catch(() => undefined);
    const output = process.env.CLAWX_C4_EVIDENCE_PATH;
    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(observations, null, 2) + '\n', 'utf-8');
    }
    await testInfo.attach('long-session-coordination-observations', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json',
    });
  }
});
