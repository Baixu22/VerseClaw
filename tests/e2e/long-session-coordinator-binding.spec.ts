import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type CreatedSession = { key?: string; sessionKey?: string };
type LedgerSnapshot = { snapshot: { nodes: Array<{ id: string; title: string; status: string }> } };
type BindingResult = {
  success: boolean;
  binding?: { sessionKey: string; sessionGeneration: string | null; bindingRevision: number; state: string; taskLedgerReferences: Array<{ taskLedgerNodeId: string }> } | null;
  recovery: { state: string; reason: string | null; bindingRevision: number | null };
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
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = { sender, senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' } };
    return await handler(event, { id: `coordinator-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'host invoke failed'}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let started = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!started && status.state !== 'starting') {
      started = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready for coordinator binding E2E');
}

async function activeWorkspace(app: ElectronApplication): Promise<{ id: string; rootPath: string }> {
  const active = await hostInvoke<{ activeWorkspace?: { id?: string; rootPath?: string }; id?: string; rootPath?: string }>(
    app,
    'workspaces',
    'getActive',
  );
  const workspace = active.activeWorkspace ?? active;
  if (!workspace.id || !workspace.rootPath) throw new Error('Active workspace is incomplete');
  await mkdir(workspace.rootPath, { recursive: true });
  await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, permissionMode: 'fullAccess' });
  return { id: workspace.id, rootPath: workspace.rootPath };
}

type CoordinatorSeed = {
  workspaceId: string;
  rootPath: string;
  sessionKey: string;
  taskLedgerNodeId: string;
  firstGeneration: string;
};

test('coordinator binding survives restart and follows rename, handoff, archive, restore, and pause boundaries', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  let seed: CoordinatorSeed | undefined;
  const first = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(first);
    await ensureGatewayReady(first);
    const workspace = await activeWorkspace(first);
    const workspaceId = workspace.id;
    const rootPath = workspace.rootPath;
    const created = await hostInvoke<CreatedSession>(first, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label: `coordinator-${Date.now()}` },
      timeoutMs: 60_000,
    });
    const sessionKey = created.key ?? created.sessionKey ?? '';
    if (!sessionKey) throw new Error('sessions.create returned no key');
    await hostInvoke(first, 'workspaces', 'update', {
      id: workspaceId,
      agentId: 'main',
      activeSessionKey: sessionKey,
      sessionKey,
    });

    const led = await hostInvoke<LedgerSnapshot>(first, 'taskLedger', 'createNode', {
      workspaceId,
      node: { title: `Coordinator task ${Date.now()}`, kind: 'task', status: 'todo' },
      idempotencyKey: `coordinator-task-${Date.now()}`,
    });
    const node = led.snapshot.nodes.at(-1);
    if (!node) throw new Error('Task Ledger did not return the created node');
    const taskLedgerNodeId = node.id;
    await hostInvoke(first, 'taskLedger', 'linkSession', {
      workspaceId,
      nodeId: node.id,
      sessionKey,
      agentId: 'main',
      relation: 'related',
      idempotencyKey: `coordinator-link-${sessionKey}-${node.id}`,
    });

    const bound = await hostInvoke<BindingResult>(first, 'workspaces', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskLedgerNodeIds: [taskLedgerNodeId],
      environment: { kind: 'local', rootPath, setupProfile: 'default' },
      archiveRestorePolicy: 'restore',
    });
    expect(bound.recovery.state).toBe('ready');
    const firstGeneration = bound.binding?.sessionGeneration ?? '';
    expect(firstGeneration).toBeTruthy();
    expect(bound.binding?.taskLedgerReferences.map((reference) => reference.taskLedgerNodeId)).toEqual([taskLedgerNodeId]);
    seed = { workspaceId, rootPath, sessionKey, taskLedgerNodeId, firstGeneration };
  } finally {
    await closeElectronApp(first);
  }

  if (!seed) throw new Error('Coordinator seed did not complete');
  const { workspaceId, rootPath, sessionKey, taskLedgerNodeId, firstGeneration } = seed;
  const second = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(second);
    await ensureGatewayReady(second);
    const persisted = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey,
    });
    expect(persisted.recovery.state).toBe('ready');
    expect(persisted.binding?.sessionGeneration).toBe(firstGeneration);
    expect(persisted.binding?.bindingRevision).toBe(1);

    await hostInvoke(second, 'gateway', 'rpc', {
      method: 'sessions.patch',
      params: { key: sessionKey, label: 'Coordinator renamed' },
      timeoutMs: 30_000,
    });
    const renamed = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey,
    });
    expect(renamed.recovery.state).toBe('ready');

    const handoff = await hostInvoke<{ success: boolean; sessionKey?: string }>(second, 'sessions', 'createHandoff', {
      sessionKey,
      agentId: 'main',
      workspaceId,
      draftInput: 'Continue the coordinator task.',
    });
    expect(handoff.success).toBe(true);
    const childSessionKey = handoff.sessionKey ?? '';
    expect(childSessionKey).toBeTruthy();
    if (!childSessionKey) throw new Error('createHandoff returned no session key');
    const pending = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey: childSessionKey,
    });
    expect(pending.recovery.state).toBe('session-pending');
    await hostInvoke(second, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { key: childSessionKey, agentId: 'main', label: 'Coordinator handoff child' },
      timeoutMs: 60_000,
    });
    const handoffActive = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey: childSessionKey,
    });
    expect(handoffActive.recovery.state).toBe('ready');
    expect(handoffActive.binding?.sessionGeneration).toBeTruthy();

    const archived = await hostInvoke<{ success: boolean }>(second, 'sessions', 'archive', {
      id: childSessionKey,
      originalWorkspaceId: workspaceId,
      label: 'Coordinator handoff archived',
    });
    expect(archived.success).toBe(true);
    const paused = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey: childSessionKey,
    });
    expect(paused.recovery.state).toBe('paused');
    expect(paused.binding?.state).toBe('paused');
    expect(existsSync(rootPath)).toBe(true);

    const restored = await hostInvoke<{ success: boolean }>(second, 'sessions', 'restore', { id: childSessionKey });
    expect(restored.success).toBe(true);
    const active = await hostInvoke<BindingResult>(second, 'workspaces', 'resolveCoordinator', {
      workspaceId, agentId: 'main', sessionKey: childSessionKey,
    });
    expect(active.recovery.state).toBe('ready');
    const restoredGeneration = active.binding?.sessionGeneration ?? '';
    expect(restoredGeneration).toBeTruthy();
    expect(restoredGeneration).not.toBe(handoffActive.binding?.sessionGeneration ?? '');

    const manuallyPaused = await hostInvoke<BindingResult>(second, 'workspaces', 'pauseCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey: childSessionKey,
      expectedRevision: active.binding?.bindingRevision,
    });
    expect(manuallyPaused.recovery.state).toBe('paused');
    expect(manuallyPaused.binding?.state).toBe('paused');
    expect(existsSync(rootPath)).toBe(true);

    const ledger = await hostInvoke<LedgerSnapshot>(second, 'taskLedger', 'snapshot', { workspaceId });
    expect(ledger.snapshot.nodes.find((candidate) => candidate.id === taskLedgerNodeId)?.status).toBe('todo');

    const output = testInfo.outputPath('coordinator-binding-e2e.json');
    await writeFile(output, `${JSON.stringify({
      schema: 'clawx.long-session.coordinator-binding-e2e/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      workspaceId,
      sessionKey,
      childSessionKey,
      taskLedgerNodeId,
      firstGeneration,
      restoredGeneration,
      states: { persisted: persisted.recovery.state, renamed: renamed.recovery.state, handoffPending: pending.recovery.state, handoffActive: handoffActive.recovery.state, archived: paused.recovery.state, restored: active.recovery.state, manuallyPaused: manuallyPaused.recovery.state },
      environmentRetainedAfterArchiveAndPause: existsSync(rootPath),
      taskLedgerStatusAfterLifecycle: ledger.snapshot.nodes.find((candidate) => candidate.id === taskLedgerNodeId)?.status,
      transport: 'built Electron host:invoke workspaces.bindCoordinator -> actual Main/Gateway/Git/TaskLedger owners',
    }, null, 2)}\n`);
    await testInfo.attach('coordinator-binding-e2e', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(second);
  }
});
