import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string; activeSessionKey?: string; permissionMode?: string };
type CoordinatorBinding = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  taskRefs: Array<{ kind: 'task-ledger'; nodeId: string }>;
  state: 'active' | 'invalidated';
  revision: number;
  invalidationReason: string | null;
};
type CoordinatorRead = {
  success: boolean;
  binding: CoordinatorBinding | null;
  validation: 'current' | 'unverified' | 'invalidated' | 'missing';
  reason?: string | null;
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
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: `c1-${Date.now()}-${Math.random()}`, ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  let startRequested = false;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (!startRequested && lastStatus.state !== 'starting') {
        startRequested = true;
        await hostInvoke(app, 'gateway', 'start');
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Gateway did not become ready: ${JSON.stringify({ lastStatus, lastError })}`);
}

async function activeWorkspace(app: ElectronApplication): Promise<Workspace> {
  const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
  if (!active.activeWorkspace?.id) throw new Error('No active workspace');
  return active.activeWorkspace;
}

async function createCoordinatorSession(app: ElectronApplication): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label: `coordinator-${Date.now()}` },
    timeoutMs: 60_000,
  });
  const key = typeof created.key === 'string' ? created.key : created.sessionKey;
  if (typeof key !== 'string') throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
  return key;
}

test('real Host/Gateway coordinator binding survives app restart and invalidates reset generations', async ({ launchElectronApp }) => {
  test.setTimeout(240_000);
  let workspaceId: string;
  let sessionKey: string;
  let ledgerNodeId: string;
  let physicalSessionId: string;

  const first = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(first);
    await ensureGatewayReady(first);
    const workspace = await activeWorkspace(first);
    workspaceId = workspace.id;
    await hostInvoke(first, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    sessionKey = await createCoordinatorSession(first);
    await hostInvoke(first, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string }> } }>(first, 'taskLedger', 'createNode', {
      workspaceId,
      node: { title: 'C1 durable coordinator task', kind: 'task', status: 'doing', owner: 'agent' },
    });
    ledgerNodeId = ledger.snapshot.nodes.find((node) => node.id)?.id ?? '';
    expect(ledgerNodeId).toBeTruthy();

    const bound = await hostInvoke<{ success: boolean; binding?: CoordinatorBinding; validation?: string }>(first, 'sessions', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskRefs: [{ kind: 'task-ledger', nodeId: ledgerNodeId }],
    });
    expect(bound.success).toBe(true);
    expect(bound.validation).toBe('current');
    expect(bound.binding).toMatchObject({ workspaceId, sessionKey, state: 'active', revision: 1 });
    physicalSessionId = bound.binding?.sessionId ?? '';
    expect(physicalSessionId).toBeTruthy();

    await expect(hostInvoke<CoordinatorRead>(first, 'sessions', 'coordinatorBinding', { workspaceId }))
      .resolves.toMatchObject({ validation: 'current', binding: { sessionId: physicalSessionId, revision: 1 } });

    /* A handoff/new active session does not silently repoint the stable master.
       The explicit binding remains on the source generation until the user
       deliberately rebinds with the current revision. */
    const derivedSessionKey = await createCoordinatorSession(first);
    await hostInvoke(first, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: derivedSessionKey,
      sessionKey: derivedSessionKey,
    });
    await expect(hostInvoke<CoordinatorRead>(first, 'sessions', 'coordinatorBinding', { workspaceId }))
      .resolves.toMatchObject({
        validation: 'current',
        binding: { sessionKey, sessionId: physicalSessionId, revision: 1 },
      });
    await hostInvoke(first, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });
    await page.getByTestId('chat-page').waitFor({ state: 'visible' });
  } finally {
    await closeElectronApp(first);
  }

  const restarted = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(restarted);
    await ensureGatewayReady(restarted);
    const recovered = await hostInvoke<CoordinatorRead>(restarted, 'sessions', 'coordinatorBinding', { workspaceId });
    expect(recovered).toMatchObject({
      success: true,
      validation: 'current',
      binding: {
        workspaceId,
        agentId: 'main',
        sessionKey,
        sessionId: physicalSessionId,
        taskRefs: [{ kind: 'task-ledger', nodeId: ledgerNodeId }],
        state: 'active',
        revision: 1,
      },
    });

    const reset = await hostInvoke<Record<string, unknown>>(restarted, 'gateway', 'rpc', {
      method: 'sessions.reset',
      params: { key: sessionKey },
      timeoutMs: 30_000,
    });
    expect(reset.ok).not.toBe(false);
    await expect.poll(async () => (
      await hostInvoke<CoordinatorRead>(restarted, 'sessions', 'coordinatorBinding', { workspaceId })
    ), { timeout: 30_000 }).toMatchObject({
      validation: 'invalidated',
      reason: 'reset',
      binding: { state: 'invalidated', invalidationReason: 'reset', revision: 2 },
    });

    /* Archive through the real Host/Gateway mutation path. The durable binding
       must be invalidated rather than pointing at the archived generation. */
    const archiveKey = await createCoordinatorSession(restarted);
    await hostInvoke(restarted, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: archiveKey,
      sessionKey: archiveKey,
    });
    const rebound = await hostInvoke<{ success: boolean; binding?: CoordinatorBinding }>(restarted, 'sessions', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey: archiveKey,
      expectedRevision: 2,
      taskRefs: [{ kind: 'task-ledger', nodeId: ledgerNodeId }],
    });
    expect(rebound).toMatchObject({ success: true, binding: { state: 'active', revision: 3 } });
    await expect(hostInvoke(restarted, 'sessions', 'archive', {
      id: archiveKey,
      originalWorkspaceId: workspaceId,
      label: 'Archived coordinator generation',
    })).resolves.toMatchObject({ success: true });
    const archived = await hostInvoke<CoordinatorRead>(restarted, 'sessions', 'coordinatorBinding', { workspaceId });
    expect(archived).toMatchObject({
      validation: 'invalidated',
      reason: 'archived',
      binding: { sessionKey: archiveKey, state: 'invalidated', invalidationReason: 'archived', revision: 4 },
    });
  } finally {
    await closeElectronApp(restarted);
  }
});
