import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, test } from './fixtures/electron';
import { configureSessionChainProvider, createSessionChainTask } from './fixtures/session-task-chain';
import { startScriptedLlm } from './fixtures/fp-p1-harness';
import type { TaskView } from '../../shared/task-system/types';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type CreatedSession = { key?: string; sessionKey?: string; entry?: { sessionId?: string } };
type DescribedSession = { session?: { sessionId?: string } };
type BindingResult = {
  success: boolean;
  binding?: {
    state: string;
    bindingRevision: number;
    sessionGeneration: string | null;
    environment: { backend: string; kind: string; canonicalRoot: string };
  } | null;
  recovery: { state: string; reason: string | null };
};
type DelegationResult = {
  success: boolean;
  status: string;
  error?: string;
  receipt?: {
    orchestrationRunId: string | null;
    children: Array<{ childSessionKey: string | null; childRunId: string | null }>;
  };
};
type CompletionBatch = {
  batchId: string;
  orchestrationRunId: string;
  status: string;
  outcome: string;
  delivery: { state: string };
  members: Array<{
    runId: string;
    childSessionKey: string;
    roleName: string;
    status: string;
    deliveryStatus: string;
  }>;
};
type ActivitySnapshot = {
  snapshot: {
    completionBatches: CompletionBatch[];
    terminals: Array<{ id: string; status: string }>;
    backgroundRead: { state: string };
  };
};
type ResourceEnvelopeState = {
  measured: boolean;
  snapshot: {
    totals: {
      activeSlots: number;
      queuedCount: number;
      processCount: number;
      treeRssBytes: number;
      treeCpuPercent: number;
    };
    warnings: string[];
    exceeded: Array<{ entryId: string; dimension: string }>;
  } | null;
};
type Locale = 'en' | 'zh' | 'ja' | 'ru';

const COORDINATOR_COPY: Record<Locale, { title: string; active: string; paused: string }> = {
  en: { title: 'Long-session coordinator', active: 'active', paused: 'paused' },
  zh: { title: '长期会话协调', active: '已启用', paused: '已暂停' },
  ja: { title: '長期セッション調整', active: '有効', paused: '一時停止' },
  ru: { title: 'Координатор долгой сессии', active: 'активен', paused: 'на паузе' },
};

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
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!handler || !win) throw new Error('host:invoke unavailable');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: `coordination-${Date.now()}-${Math.random()}`, ...request },
    );
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

async function selectSession(page: Page, sessionKey: string): Promise<void> {
  const row = page.getByTestId(`sidebar-session-${sessionKey}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  const selectedRow = row.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sidebar-row ")][1]',
  );
  await expect(selectedRow).toHaveAttribute('data-hook-selected', 'true', { timeout: 30_000 });
}

async function openCoordinator(page: Page) {
  const popover = page.getByTestId('resource-popover');
  if (!await popover.isVisible().catch(() => false)) {
    const chip = page.getByTestId('resource-chip');
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
  }
  const coordinator = page.getByTestId('long-session-coordinator');
  await expect(coordinator).toBeVisible({ timeout: 30_000 });
  return coordinator;
}

async function reloadChat(app: ElectronApplication, page: Page, sessionKey: string): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await getStableWindow(app);
  await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 60_000 });
  await selectSession(page, sessionKey);
}

async function waitForTerminalBatch(
  app: ElectronApplication,
  sessionKey: string,
  workspaceId: string,
  orchestrationRunId: string,
): Promise<CompletionBatch> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const activity = await hostInvoke<ActivitySnapshot>(app, 'gateway', 'rpc', {
      method: 'session.activitySnapshot',
      params: { sessionKey, workspaceId },
      timeoutMs: 30_000,
    });
    const batch = activity.snapshot.completionBatches.find(
      (candidate) => candidate.orchestrationRunId === orchestrationRunId,
    );
    if (batch && batch.status !== 'collecting') return batch;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`completion batch ${orchestrationRunId} did not become terminal`);
}

async function minimizeAndRestore(app: ElectronApplication): Promise<{ minimized: boolean; restored: boolean; visible: boolean }> {
  return await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    win.minimize();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const minimized = win.isMinimized();
    win.restore();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { minimized, restored: !win.isMinimized(), visible: win.isVisible() };
  });
}

async function pngEvidence(path: string): Promise<{ sha256: string; pixels: { width: number; height: number }; bytes: number }> {
  const data = await readFile(path);
  if (data.length < 24 || data.readUInt32BE(12) !== 0x49484452) throw new Error(`Not a PNG: ${path}`);
  return {
    sha256: createHash('sha256').update(data).digest('hex'),
    pixels: { width: data.readUInt32BE(16), height: data.readUInt32BE(20) },
    bytes: data.byteLength,
  };
}

test('opens the long-session coordinator from Chat and verifies receipts, navigation, keyboard, window lifecycle, locales, and screenshots', async ({
  launchElectronApp,
}, testInfo) => {
  test.setTimeout(600_000);
  const provider = await startScriptedLlm(() => ({ text: 'Coordinator worker result is ready for review.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await configureSessionChainProvider(app, provider.port);
    await ensureGatewayReady(app);
    const active = await hostInvoke<{
      activeWorkspace?: { id?: string; rootPath?: string };
      id?: string;
      rootPath?: string;
    }>(app, 'workspaces', 'getActive');
    const workspace = active.activeWorkspace ?? active;
    if (!workspace.id || !workspace.rootPath) throw new Error('Active workspace unavailable');
    await mkdir(workspace.rootPath, { recursive: true });
    // This owned test directory is nested below the source checkout. Give it
    // an explicit repository before binding so Runtime bootstrap cannot move
    // the environment from the parent checkout to a newly initialized child.
    execFileSync('git', ['init', '-b', 'coordination-fixture'], { cwd: workspace.rootPath, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid',
      'commit', '--allow-empty', '-m', 'Initialize coordinator fixture'], { cwd: workspace.rootPath, windowsHide: true });
    await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, permissionMode: 'fullAccess', agentId: 'main' });

    const label = `Coordination ${Date.now()}`;
    const created = await hostInvoke<CreatedSession>(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label },
      timeoutMs: 60_000,
    });
    const sessionKey = created.key ?? created.sessionKey ?? '';
    if (!sessionKey) throw new Error('Session creation returned no key');
    let sessionGeneration = created.entry?.sessionId ?? '';
    if (!sessionGeneration) {
      const described = await hostInvoke<DescribedSession>(app, 'gateway', 'rpc', {
        method: 'sessions.describe',
        params: { key: sessionKey },
        timeoutMs: 30_000,
      });
      sessionGeneration = described.session?.sessionId ?? '';
    }
    if (!sessionGeneration) throw new Error('Coordinator session has no generation');
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspace.id,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });

    const managedTask = await createSessionChainTask(app, workspace.id, `coordination-task-${Date.now()}`, {
      objective: 'Exercise the long-session coordinator UI with an actual worker receipt',
      target: 'docs/coordination-note.md',
      constraints: ['Worker completion remains separate from task acceptance'],
      acceptance: [{ id: 'owner-review', description: 'Review the coordinator worker result',
        verification: { kind: 'owner-receipt', owner: 'coordination-review', files: ['docs/coordination-note.md'] } }],
    });
    const task = { id: managedTask.contract.taskNodeId };
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
    expect(bound.success).toBe(true);
    expect(bound.recovery.state).toBe('ready');
    expect(bound.binding?.sessionGeneration).toBe(sessionGeneration);
    const bindingRevision = bound.binding?.bindingRevision;
    if (typeof bindingRevision !== 'number') throw new Error('Coordinator binding revision is missing');
    const claimed = await hostInvoke<{ result: TaskView }>(app, 'taskLedger', 'command', {
      workspaceId: workspace.id,
      command: { action: 'claim', taskNodeId: task.id, sessionKey, requestId: `coordination-claim-${task.id}` },
    });
    expect(claimed.result.claim).toMatchObject({ sessionKey, generation: sessionGeneration });
    expect(claimed.result.contract.state).toBe('doing');

    const idempotencyKey = `coordination-ui-${Date.now()}`;
    const delegated = await hostInvoke<DelegationResult>(app, 'sessions', 'delegate', {
      sessionKey,
      workspaceId: workspace.id,
      agentId: 'main',
      taskRef: task.id,
      task: 'Exercise the long-session coordinator UI with an actual worker receipt',
      expectedBindingRevision: bindingRevision,
      expectedSessionGeneration: sessionGeneration,
      idempotencyKey,
      backend: 'subagent',
      worker: {
        roleName: 'architect',
        task: 'Return through the existing coordinator completion receipt path',
        isolation: 'shared',
        writeSet: [],
      },
      includeVerifier: false,
    });
    expect(delegated.success, JSON.stringify(delegated)).toBe(true);
    expect(delegated.status).toBe('accepted');
    const orchestrationRunId = delegated.receipt?.orchestrationRunId;
    if (!orchestrationRunId) throw new Error('Delegation returned no orchestration run id');
    const batch = await waitForTerminalBatch(app, sessionKey, workspace.id, orchestrationRunId);
    expect(batch.status).toBe('terminal');
    const worker = batch.members[0];
    if (!worker?.childSessionKey) throw new Error('Terminal batch did not expose a child session key');
    const mainActivity = await hostInvoke<{ success: boolean; snapshot: ActivitySnapshot['snapshot'] }>(
      app,
      'sessionActivity',
      'snapshot',
      { workspaceId: workspace.id, sessionKey },
    );
    expect(mainActivity.success).toBe(true);
    expect(mainActivity.snapshot.completionBatches.some((candidate) => candidate.batchId === batch.batchId)).toBe(true);
    const activeBackgroundTerminalCount = mainActivity.snapshot.terminals.filter(
      (terminal) => ['starting', 'running', 'idle', 'blocked'].includes(terminal.status),
    ).length;
    const resourceEnvelope = await hostInvoke<ResourceEnvelopeState>(app, 'resourceEnvelope', 'getState');
    expect(resourceEnvelope.measured).toBe(true);
    if (!resourceEnvelope.snapshot) throw new Error('Measured resource envelope has no snapshot');

    await reloadChat(app, page, sessionKey);
    let coordinator = await openCoordinator(page);
    await expect(coordinator).toContainText(task.id);
    expect(bound.binding?.environment.backend).toBe('git');
    await expect(coordinator).toContainText('git / local');
    await expect(coordinator.getByTestId('coordinator-recovery')).toContainText('ready');
    await expect(coordinator).toContainText('CPU');
    await expect(coordinator).toContainText(`${activeBackgroundTerminalCount} background terminals`);
    await expect(coordinator).toContainText(`${resourceEnvelope.snapshot.totals.queuedCount} queued`);
    await expect(coordinator).toContainText(worker.roleName);
    await expect(coordinator).toContainText(`${batch.outcome} / ${batch.delivery.state}`);

    const pause = coordinator.getByTestId('coordinator-pause');
    await pause.focus();
    await expect(pause).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(coordinator.getByTestId('coordinator-resume')).toBeVisible({ timeout: 30_000 });
    await expect(coordinator).toContainText(COORDINATOR_COPY.en.paused);
    const pauseControlAbsentWhilePaused = await coordinator.getByTestId('coordinator-pause').count() === 0;
    const pausedReadback = await hostInvoke<{
      binding?: { state: string; bindingRevision: number } | null;
      recovery: { state: string };
    }>(app, 'workspaces', 'resolveCoordinator', {
      workspaceId: workspace.id,
      agentId: 'main',
      sessionKey,
    });
    expect(pausedReadback.binding?.state).toBe('paused');

    const resume = coordinator.getByTestId('coordinator-resume');
    await resume.focus();
    await expect(resume).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(coordinator.getByTestId('coordinator-pause')).toBeVisible({ timeout: 30_000 });
    await expect(coordinator).toContainText(COORDINATOR_COPY.en.active);
    const activeReadback = await hostInvoke<{
      binding?: { state: string; bindingRevision: number } | null;
      recovery: { state: string };
    }>(app, 'workspaces', 'resolveCoordinator', {
      workspaceId: workspace.id,
      agentId: 'main',
      sessionKey,
    });
    expect(activeReadback.binding?.state).toBe('active');

    const windowLifecycle = await minimizeAndRestore(app);
    expect(windowLifecycle).toEqual({ minimized: true, restored: true, visible: true });
    await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
    await expect(coordinator).toBeVisible();

    const taskLedgerLink = coordinator.getByTestId(`coordinator-task-ledger-${task.id}`);
    await taskLedgerLink.click();
    await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 })
      .toBe(`#/task-ledger?nodeId=${encodeURIComponent(task.id)}`);
    const taskLedgerHash = new URL(page.url()).hash;
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 60_000 });
    coordinator = await openCoordinator(page);

    const workerButton = coordinator.getByTestId(`coordinator-worker-${batch.batchId}`);
    await expect(workerButton).toContainText(worker.roleName);
    await workerButton.click();
    const childRow = page.getByTestId(`sidebar-session-${worker.childSessionKey}`);
    await expect(childRow).toBeVisible({ timeout: 60_000 });
    await expect(childRow.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sidebar-row ")][1]',
    )).toHaveAttribute('data-hook-selected', 'true', { timeout: 30_000 });
    const workerSelection = await hostInvoke<{ activeWorkspace: { id: string; activeSessionKey: string; projectCoordinatorSessionKey: string } }>(app, 'workspaces', 'getActive');
    expect(workerSelection.activeWorkspace.id).toBe(workspace.id);
    expect(workerSelection.activeWorkspace.activeSessionKey).toBe(worker.childSessionKey);
    expect(workerSelection.activeWorkspace.projectCoordinatorSessionKey).toBe(sessionKey);
    if (await page.getByTestId('resource-popover-close').isVisible().catch(() => false)) {
      await page.getByTestId('resource-popover-close').click();
    }
    await selectSession(page, sessionKey);
    coordinator = await openCoordinator(page);
    await expect(coordinator).toContainText(task.id);

    await app.evaluate((_electron, target) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const observed = ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        coordinatorActivityReads: number;
      };
      const handler = observed._invokeHandlers.get('host:invoke');
      if (!handler) throw new Error('host:invoke unavailable');
      observed.coordinatorActivityReads = 0;
      observed._invokeHandlers.set('host:invoke', async (event, request) => {
        const result = await handler(event, request);
        const input = request as { module?: string; action?: string; payload?: { workspaceId?: string; sessionKey?: string } };
        const response = result as HostResponse<ActivitySnapshot>;
        if (input.module === 'sessionActivity' && input.action === 'snapshot'
          && input.payload?.workspaceId === target.workspaceId && input.payload?.sessionKey === target.sessionKey
          && response.ok && response.data?.snapshot.completionBatches.some((item) => item.batchId === target.batchId)) {
          observed.coordinatorActivityReads++;
        }
        return result;
      });
    }, { workspaceId: workspace.id, sessionKey, batchId: batch.batchId });
    const activityReadCount = () => app.evaluate(() => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      return (ipcMain as unknown as { coordinatorActivityReads: number }).coordinatorActivityReads;
    });
    const locales: Array<{ locale: Locale; title: string; active: string; activityReadsOnOpen: number }> = [];
    for (const locale of ['en', 'zh', 'ja', 'ru'] as const) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
      await reloadChat(app, page, sessionKey);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const readsBeforeOpen = await activityReadCount();
      coordinator = await openCoordinator(page);
      const copy = COORDINATOR_COPY[locale];
      const title = coordinator.getByText(copy.title, { exact: true });
      await expect(title).toBeVisible({ timeout: 30_000 });
      await expect(coordinator).toContainText(copy.active);
      await expect(coordinator.getByTestId(`coordinator-worker-${batch.batchId}`)).toContainText(worker.roleName);
      await expect.poll(activityReadCount).toBeGreaterThan(readsBeforeOpen);
      locales.push({ locale, title: await title.innerText(), active: copy.active, activityReadsOnOpen: await activityReadCount() - readsBeforeOpen });
      await page.getByTestId('resource-popover-close').click();
    }

    await reloadChat(app, page, sessionKey);
    coordinator = await openCoordinator(page);
    const workerRows = coordinator.locator('[data-testid^="coordinator-worker-"]');
    await expect(coordinator.getByTestId(`coordinator-worker-${batch.batchId}`)).toContainText(worker.roleName);
    const quietBefore = await workerRows.count();
    const bellUnreadBefore = await page.getByTestId('chat-completion-unread-dot').count();
    await page.waitForTimeout(2_500);
    const quietAfter = await workerRows.count();
    const bellUnreadAfter = await page.getByTestId('chat-completion-unread-dot').count();
    expect(quietAfter).toBe(quietBefore);
    const observedWorkerManagedStopControls = await coordinator.locator('[data-testid^="resource-row-stop-"]').count();
    expect(observedWorkerManagedStopControls).toBe(0);

    const requestedWide = { width: 1280, height: 800 };
    const wide = await pinWindowContentSize(app, requestedWide);
    const widePath = testInfo.outputPath('coordination-wide.png');
    await page.screenshot({ path: widePath, fullPage: true });
    const wideEvidence = await pngEvidence(widePath);
    const wideViewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }));

    const requestedNarrow = { width: 680, height: 760 };
    const narrow = await pinWindowContentSize(app, requestedNarrow);
    const narrowPath = testInfo.outputPath('coordination-narrow.png');
    await page.screenshot({ path: narrowPath, fullPage: true });
    const narrowEvidence = await pngEvidence(narrowPath);
    const narrowViewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }));
    expect(wide.width).toBeGreaterThan(0);
    expect(wide.height).toBeGreaterThan(0);
    expect(Math.abs(wideViewport.innerWidth - wide.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(wideViewport.innerHeight - wide.height)).toBeLessThanOrEqual(2);
    expect(narrow.width).toBeGreaterThan(0);
    expect(narrow.height).toBeGreaterThan(0);
    expect(Math.abs(narrowViewport.innerWidth - narrow.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(narrowViewport.innerHeight - narrow.height)).toBeLessThanOrEqual(2);
    expect(narrowViewport.innerWidth).toBeLessThan(wideViewport.innerWidth);
    expect(narrowEvidence.pixels.width).toBeLessThan(wideEvidence.pixels.width);
    await pinWindowContentSize(app, requestedWide);

    const screenshots = [
      {
        id: 'wide',
        path: 'coordination-wide.png',
        requestedViewport: requestedWide,
        contentSize: wide,
        browserViewport: wideViewport,
        pixels: wideEvidence.pixels,
        bytes: wideEvidence.bytes,
        sha256: wideEvidence.sha256,
      },
      {
        id: 'narrow',
        path: 'coordination-narrow.png',
        requestedViewport: requestedNarrow,
        contentSize: narrow,
        browserViewport: narrowViewport,
        pixels: narrowEvidence.pixels,
        bytes: narrowEvidence.bytes,
        sha256: narrowEvidence.sha256,
      },
    ];

    const journeyOutput = testInfo.outputPath('coordination-ui-journey.json');
    await writeFile(journeyOutput, `${JSON.stringify({
      schema: 'clawx.long-session.coordination-ui-journey/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'codex-long-session-r2',
      workspaceId: workspace.id,
      rootPath: workspace.rootPath,
      sessionKey,
      sessionGeneration,
      taskRef: task.id,
      bindingRevision,
      idempotencyKey,
      actualWorker: {
        delegationStatus: delegated.status,
        orchestrationRunId,
        batchId: batch.batchId,
        status: batch.status,
        outcome: batch.outcome,
        delivery: batch.delivery,
        member: worker,
      },
      observed: {
        bindingStates: ['ready', 'active', 'paused', 'active'],
        keyboard: { pause: 'focus + Enter', resume: 'focus + Enter', verifiedByHostReadback: true },
        pausedState: { pauseControlAbsent: pauseControlAbsentWhilePaused, hostState: pausedReadback.binding?.state },
        resumedState: { hostState: activeReadback.binding?.state },
        ownerReads: {
          activityBackgroundRead: mainActivity.snapshot.backgroundRead.state,
          activityCompletionBatchIds: mainActivity.snapshot.completionBatches.map((candidate) => candidate.batchId),
          recoveryState: activeReadback.recovery.state,
          resourceEnvelope: resourceEnvelope.snapshot,
          activeBackgroundTerminalCount,
        },
        windowLifecycle,
        taskLedgerNavigation: { hash: taskLedgerHash, includesNodeId: taskLedgerHash.includes(`nodeId=${encodeURIComponent(task.id)}`) },
        workerNavigation: { childSessionKey: worker.childSessionKey, workspaceReadback: workerSelection.activeWorkspace, sidebarSelected: true, returnedToCoordinator: true },
        locales,
        quietWindow: {
          durationMs: 2_500,
          completionBatchRowsBefore: quietBefore,
          completionBatchRowsAfter: quietAfter,
          completionBellUnreadBefore: bellUnreadBefore,
          completionBellUnreadAfter: bellUnreadAfter,
        },
        observedWorkerManagedStopControls,
      },
      screenshots,
      transport: 'built Electron Chat ResourceChip -> typed workspaces/taskLedger/settings host-api -> actual Main owner; sessions.delegate -> Gateway orchestrator -> persisted session activity completion batch',
      negativeCases: [
        'While paused, the UI exposes resume only and the Workspace owner readback reports paused.',
        'The observed completion worker is listed as a navigation target and does not receive a managed-resource stop control.',
        'No new completion batch is synthesized during the quiet window.',
      ],
      limitations: [
        'No live-provider model-quality turn was issued; the actual worker receipt can settle through the runtime failure path without provider text.',
        'Narrow content requests are clamped by the existing Electron minimum width; both requested and actual pixels are recorded.',
        'Managed-worktree deletion and backend-unavailable UI recovery remain owner-boundary evidence from C1-C3 rather than an injected destructive C4 journey.',
      ],
    }, null, 2)}\n`);

    const screenshotOutput = testInfo.outputPath('coordination-ui-screenshots.json');
    await writeFile(screenshotOutput, `${JSON.stringify({
      schema: 'clawx.long-session.coordination-ui-screenshots/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'codex-long-session-r2',
      capturedAt: new Date().toISOString(),
      locale: 'ru',
      screenshots,
      notes: [
        'contentSize is Electron getContentSize after pinning.',
        'pixels is read from each PNG IHDR.',
        'sha256 is computed from the complete PNG file.',
      ],
    }, null, 2)}\n`);
    await testInfo.attach('coordination-ui-journey', { path: journeyOutput, contentType: 'application/json' });
    await testInfo.attach('coordination-ui-screenshots', { path: screenshotOutput, contentType: 'application/json' });
    await testInfo.attach('coordination-wide', { path: widePath, contentType: 'image/png' });
    await testInfo.attach('coordination-narrow', { path: narrowPath, contentType: 'image/png' });
  } finally {
    await closeElectronApp(app);
    provider.server.closeAllConnections();
    await new Promise<void>((resolve) => provider.server.close(() => resolve()));
  }
});
