import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string };
type AdmissionReceipt = {
  receiptId: string;
  idempotencyKey: string;
  state: 'submitting' | 'accepted' | 'rejected' | 'unknown';
  acceptedIsNotCompletion: true;
  coordinator: { workspaceId: string; agentId: string; sessionKey: string; sessionId: string; bindingRevision: number };
  taskRef: { kind: 'task-ledger'; nodeId: string };
  childSessionKey: string | null;
  childRunId: string | null;
  backend: { kind: string; provider: string | null; model: string | null; evidence: string };
  toolAuthorization: { allowlist: string[]; denylist: string[]; permissionDecisionCount: number; source: string };
  isolation: { mode: string; backend: string; writeSet: string[]; parallelWritesAllowed: boolean; writeSetBasis: string };
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
      { id: `c2-${Date.now()}-${Math.random()}`, ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError: string | undefined;
  let startRequested = false;
  while (Date.now() < deadline) {
    try {
      const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (status.gatewayReady === true || status.state === 'running') return;
      if (!startRequested && status.state !== 'starting') {
        startRequested = true;
        await hostInvoke(app, 'gateway', 'start');
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Gateway did not become ready: ${lastError ?? 'timeout'}`);
}

async function createSession(app: ElectronApplication): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label: `delegation-${Date.now()}` },
    timeoutMs: 60_000,
  });
  const key = typeof created.key === 'string' ? created.key : created.sessionKey;
  if (typeof key !== 'string') throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
  return key;
}

test('real Host/Gateway delegation admission returns an idempotent accepted receipt, not completion', async ({ launchElectronApp }) => {
  test.setTimeout(240_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await ensureGatewayReady(app);
    const active = await hostInvoke<{ activeWorkspace?: Workspace }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace?.id;
    if (!workspaceId) throw new Error('No active workspace');
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const sessionKey = await createSession(app);
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string }> } }>(app, 'taskLedger', 'createNode', {
      workspaceId,
      node: { title: 'C2 delegated implementation', kind: 'task', status: 'doing', owner: 'agent' },
    });
    const taskNodeId = ledger.snapshot.nodes[0]?.id;
    if (!taskNodeId) throw new Error('Task Ledger node missing');
    await expect(hostInvoke(app, 'sessions', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskRefs: [{ kind: 'task-ledger', nodeId: taskNodeId }],
    })).resolves.toMatchObject({ success: true, binding: { state: 'active', revision: 1 } });

    const request = {
      workspaceId,
      idempotencyKey: `delegation-${Date.now()}`,
      roleName: 'implementer',
      task: 'Implement the isolated C2 fixture slice',
      taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
      writeSet: ['src/c2-admission-fixture.ts'],
      isolation: 'shared',
      backend: 'openclaw-embedded',
    };
    const admitted = await hostInvoke<{ success: boolean; receipt: AdmissionReceipt; duplicate?: boolean }>(app, 'sessions', 'delegateCoordinator', request);
    expect(admitted.success).toBe(true);
    expect(admitted.receipt).toMatchObject({
      state: 'accepted',
      acceptedIsNotCompletion: true,
      coordinator: { workspaceId, agentId: 'main', sessionKey, bindingRevision: 1 },
      taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
      backend: { kind: 'openclaw-embedded', evidence: 'role-spawn:spawnSubagentDirect' },
      isolation: { mode: 'inprocess-shared', backend: 'inprocess', writeSet: ['src/c2-admission-fixture.ts'] },
    });
    expect(admitted.receipt.childRunId).toBeTruthy();
    expect(admitted.receipt.childSessionKey).toBeTruthy();
    expect(admitted.receipt.toolAuthorization.source).toBe('role-clamped-inherited');

    const duplicate = await hostInvoke<{ success: boolean; receipt: AdmissionReceipt; duplicate?: boolean }>(app, 'sessions', 'delegateCoordinator', request);
    expect(duplicate).toMatchObject({ success: true, duplicate: true, receipt: { receiptId: admitted.receipt.receiptId, state: 'accepted' } });
    const listed = await hostInvoke<{ success: boolean; receipts: AdmissionReceipt[] }>(app, 'sessions', 'delegationAdmissions', { workspaceId });
    expect(listed.success).toBe(true);
    expect(listed.receipts.filter((receipt) => receipt.idempotencyKey === request.idempotencyKey)).toHaveLength(1);
  } finally {
    await closeElectronApp(app);
  }
});
