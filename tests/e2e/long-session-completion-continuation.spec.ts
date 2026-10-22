import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string };
type AdmissionReceipt = {
  receiptId: string;
  idempotencyKey: string;
  state: 'submitting' | 'accepted' | 'rejected' | 'unknown';
  childSessionKey: string | null;
  childRunId: string | null;
  orchestrationRunId?: string | null;
};
type CompletionBatch = {
  id: string;
  idempotencyKey: string;
  orchestrationRunId: string;
  requesterSessionKey: string;
  requesterSessionId: string | null;
  generationState: 'consistent' | 'mismatch' | 'unknown';
  status: 'collecting' | 'delivery-pending' | 'delivered' | 'partial';
  terminal: boolean;
  expectedWorkerCount: number;
  completedWorkerCount: number;
  failedWorkerCount: number;
  cancelledWorkerCount: number;
  pendingWorkerCount: number;
  bounded: boolean;
  completionAuthority: 'none';
  delivery: { state: string; pendingCount: number; deliveredCount: number };
};
type SessionActivity = {
  completionBatches: CompletionBatch[];
  subagents: Array<{ id: string; status: string }>;
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
      { id: 'c3-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? 'host invoke failed: ' + module + '.' + action);
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
  throw new Error('Gateway did not become ready: ' + (lastError ?? 'timeout'));
}

async function createSession(app: ElectronApplication): Promise<string> {
  const created = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: { agentId: 'main', label: 'completion-' + Date.now() },
    timeoutMs: 60_000,
  });
  const key = typeof created.key === 'string' ? created.key : created.sessionKey;
  if (typeof key !== 'string') throw new Error('sessions.create returned no key: ' + JSON.stringify(created));
  return key;
}

async function readActivity(
  app: ElectronApplication,
  workspaceId: string,
  sessionKey: string,
): Promise<SessionActivity> {
  const result = await hostInvoke<{ snapshot: SessionActivity }>(app, 'sessionActivity', 'snapshot', {
    workspaceId,
    sessionKey,
  });
  return result.snapshot;
}

test('real Host/Gateway batch receipt survives stop and restart without duplicate continuation', async ({ launchElectronApp }) => {
  test.setTimeout(300_000);
  let firstApp: ElectronApplication | undefined;
  let secondApp: ElectronApplication | undefined;
  const evidence: Record<string, unknown> = {
    schema: 'clawx.long-session.c3-restart-replay/v1',
    driven_by: 'agent',
    actor: 'codex-long-session-c3',
    hostRoute: 'sessionActivity.snapshot',
    gatewayMethod: 'session.activitySnapshot',
    checkedAt: new Date().toISOString(),
  };
  try {
    firstApp = await launchElectronApp({ skipSetup: true });
    await getStableWindow(firstApp);
    await ensureGatewayReady(firstApp);
    const active = await hostInvoke<{ activeWorkspace?: Workspace }>(firstApp, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace?.id;
    if (!workspaceId) throw new Error('No active workspace');
    await hostInvoke(firstApp, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const sessionKey = await createSession(firstApp);
    await hostInvoke(firstApp, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string }> } }>(
      firstApp,
      'taskLedger',
      'createNode',
      {
        workspaceId,
        node: { title: 'C3 completion continuation', kind: 'task', status: 'doing', owner: 'agent' },
      },
    );
    const taskNodeId = ledger.snapshot.nodes[0]?.id;
    if (!taskNodeId) throw new Error('Task Ledger node missing');
    await hostInvoke(firstApp, 'sessions', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskRefs: [{ kind: 'task-ledger', nodeId: taskNodeId }],
    });
    const request = {
      workspaceId,
      idempotencyKey: 'c3-delegation-' + Date.now(),
      roleName: 'implementer',
      task: 'Produce C3 completion evidence and stop safely',
      taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
      writeSet: ['src/c3-completion-fixture.ts'],
      isolation: 'shared',
      backend: 'openclaw-embedded',
    };
    const admitted = await hostInvoke<{ success: boolean; receipt: AdmissionReceipt }>(
      firstApp,
      'sessions',
      'delegateCoordinator',
      request,
    );
    expect(admitted.success).toBe(true);
    expect(admitted.receipt).toMatchObject({ state: 'accepted', childSessionKey: expect.any(String), childRunId: expect.any(String) });
    if (!admitted.receipt.childSessionKey || !admitted.receipt.childRunId) {
      throw new Error('Accepted delegation has no child identity');
    }

    await hostInvoke(firstApp, 'gateway', 'rpc', {
      method: 'sessions.stop',
      params: { key: admitted.receipt.childSessionKey },
      timeoutMs: 60_000,
    });

    let beforeRestart: SessionActivity | undefined;
    let batchBeforeRestart: CompletionBatch | undefined;
    await expect.poll(async () => {
      beforeRestart = await readActivity(firstApp!, workspaceId, sessionKey);
      batchBeforeRestart = beforeRestart.completionBatches.find(
        (batch) => batch.orchestrationRunId === admitted.receipt.orchestrationRunId,
      ) ?? beforeRestart.completionBatches[0];
      return Boolean(batchBeforeRestart?.terminal);
    }, { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(true);
    expect(batchBeforeRestart).toMatchObject({
      requesterSessionKey: sessionKey,
      generationState: 'consistent',
      terminal: true,
      completionAuthority: 'none',
      bounded: true,
    });
    expect(
      batchBeforeRestart!.completedWorkerCount +
      batchBeforeRestart!.failedWorkerCount +
      batchBeforeRestart!.cancelledWorkerCount +
      batchBeforeRestart!.pendingWorkerCount,
    ).toBe(batchBeforeRestart!.expectedWorkerCount);
    const firstIdempotencyKey = batchBeforeRestart!.idempotencyKey;
    const firstReceiptId = admitted.receipt.receiptId;

    await closeElectronApp(firstApp);
    firstApp = undefined;
    secondApp = await launchElectronApp({ skipSetup: true });
    await getStableWindow(secondApp);
    await ensureGatewayReady(secondApp);
    let afterRestart: SessionActivity | undefined;
    await expect.poll(async () => {
      afterRestart = await readActivity(secondApp!, workspaceId, sessionKey);
      return afterRestart.completionBatches.length;
    }, { timeout: 60_000, intervals: [1_000, 2_000, 3_000] }).toBeGreaterThan(0);
    const matching = afterRestart!.completionBatches.filter(
      (batch) => batch.idempotencyKey === firstIdempotencyKey,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      terminal: true,
      completionAuthority: 'none',
      requesterSessionKey: sessionKey,
      requesterSessionId: batchBeforeRestart!.requesterSessionId,
      generationState: 'consistent',
    });
    const duplicate = await hostInvoke<{ duplicate?: boolean; receipt: AdmissionReceipt }>(
      secondApp,
      'sessions',
      'delegateCoordinator',
      request,
    );
    expect(duplicate).toMatchObject({
      duplicate: true,
      receipt: { receiptId: firstReceiptId, state: 'accepted' },
    });

    evidence.sessionKey = sessionKey;
    evidence.workspaceId = workspaceId;
    evidence.admissionReceiptId = firstReceiptId;
    evidence.childRunId = admitted.receipt.childRunId;
    evidence.batchBeforeRestart = batchBeforeRestart;
    evidence.batchAfterRestart = matching[0];
    evidence.duplicateAdmission = {
      duplicate: duplicate.duplicate === true,
      sameReceiptId: duplicate.receipt.receiptId === firstReceiptId,
    };
    evidence.result = 'pass';
  } catch (error) {
    evidence.result = 'fail';
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (firstApp) await closeElectronApp(firstApp).catch(() => undefined);
    if (secondApp) await closeElectronApp(secondApp).catch(() => undefined);
    const output = process.env.CLAWX_C3_EVIDENCE_PATH;
    if (output) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', 'utf-8');
    }
  }
});
