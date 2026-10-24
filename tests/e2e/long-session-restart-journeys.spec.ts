import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type Workspace = { id: string; rootPath: string; activeSessionKey?: string };
type CoordinatorBinding = {
  workspaceId: string;
  sessionKey: string;
  sessionId: string;
  state: 'active' | 'invalidated';
  revision: number;
  invalidationReason?: string | null;
  taskRefs?: Array<{ kind: 'task-ledger'; nodeId: string }>;
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
      { id: 'f1-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? ('host invoke failed: ' + module + '.' + action));
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
  if (typeof key !== 'string') throw new Error('sessions.create returned no key: ' + JSON.stringify(created));
  return key;
}

async function readBinding(app: ElectronApplication, workspaceId: string): Promise<CoordinatorRead> {
  return hostInvoke<CoordinatorRead>(app, 'sessions', 'coordinatorBinding', { workspaceId });
}

async function createWorkspace(app: ElectronApplication, rootPath: string, name: string): Promise<string> {
  await hostInvoke(app, 'workspaces', 'create', { name, rootPath, agentId: 'main', permissionMode: 'fullAccess' });
  const snapshot = await hostInvoke<{ profiles?: Workspace[]; workspaces?: Workspace[] }>(app, 'workspaces', 'list');
  const all = snapshot.profiles ?? snapshot.workspaces ?? [];
  const found = all.find((workspace) => workspace.rootPath === rootPath);
  if (!found) throw new Error('workspace creation was not visible: ' + JSON.stringify(snapshot));
  return found.id;
}

async function bindCoordinator(
  app: ElectronApplication,
  workspaceId: string,
  sessionKey: string,
  nodeId: string,
  expectedRevision: number,
): Promise<CoordinatorBinding> {
  const bound = await hostInvoke<{ success: boolean; binding?: CoordinatorBinding; validation?: string }>(
    app,
    'sessions',
    'bindCoordinator',
    { workspaceId, agentId: 'main', sessionKey, expectedRevision, taskRefs: [{ kind: 'task-ledger', nodeId }] },
  );
  expect(bound.success).toBe(true);
  expect(bound.validation).toBe('current');
  if (!bound.binding) throw new Error('bindCoordinator returned no binding');
  return bound.binding;
}

test('F1 six real long-session restart journeys across two workspaces', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(900_000);
  const runRoot = testInfo.outputPath('f1-run-root');
  await mkdir(runRoot, { recursive: true });
  const workspaceRootA = join(runRoot, 'workspace-a');
  const workspaceRootB = join(runRoot, 'workspace-b');
  await mkdir(workspaceRootA, { recursive: true });
  await mkdir(workspaceRootB, { recursive: true });

  const journeys: Array<Record<string, unknown>> = [];
  const negatives: string[] = [];
  const record = (entry: Record<string, unknown>) => journeys.push(entry);

  let app = await launchElectronApp({ skipSetup: true });
  let workspaceA = '';
  let coordinatorA!: string;
  let taskA = '';
  let firstGeneration!: string;
  try {
    await ensureGatewayReady(app);
    workspaceA = await createWorkspace(app, workspaceRootA, 'F1 workspace A');
    coordinatorA = await createSession(app, 'F1 coordinator A');
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceA,
      agentId: 'main',
      activeSessionKey: coordinatorA,
      sessionKey: coordinatorA,
      permissionMode: 'fullAccess',
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string }> } }>(app, 'taskLedger', 'createNode', {
      workspaceId: workspaceA,
      node: {
        title: 'F1 journey-1 durable task',
        kind: 'task',
        status: 'doing',
        owner: 'agent',
        metadata: { nextAction: 'Continue after restart.' },
      },
    });
    taskA = ledger.snapshot.nodes.find((node) => node.title === 'F1 journey-1 durable task')?.id ?? '';
    expect(taskA).toBeTruthy();
    const binding = await bindCoordinator(app, workspaceA, coordinatorA, taskA, 0);
    firstGeneration = binding.sessionId;
    expect(firstGeneration).toBeTruthy();
    record({
      id: 'journey-1-bind',
      status: 'pass',
      workspaceId: workspaceA,
      sessionKey: coordinatorA,
      taskNodeId: taskA,
      physicalSessionId: firstGeneration,
      validation: 'current',
    });
  } finally {
    await closeElectronApp(app);
  }

  app = await launchElectronApp({ skipSetup: true });
  try {
    await ensureGatewayReady(app);
    const recovered = await readBinding(app, workspaceA);
    expect(recovered).toMatchObject({
      success: true,
      validation: 'current',
      binding: { workspaceId: workspaceA, sessionKey: coordinatorA, sessionId: firstGeneration, revision: 1 },
    });
    const history = await hostInvoke<{ messages?: Array<Record<string, unknown>> }>(app, 'sessions', 'history', {
      sessionKey: coordinatorA,
      limit: 20,
    });
    expect(Array.isArray(history.messages)).toBe(true);
    // The durable work record must survive the restart too.
    const ledgerAfter = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string; status: string }> } }>(
      app,
      'taskLedger',
      'snapshot',
      { workspaceId: workspaceA },
    );
    const durable = ledgerAfter.snapshot.nodes.find((node) => node.id === taskA);
    expect(durable?.status).toBe('doing');
    record({
      id: 'journey-2-app-restart-recovery',
      status: 'pass',
      validation: recovered.validation,
      physicalSessionId: recovered.binding?.sessionId ?? null,
      transcriptMessages: history.messages?.length ?? 0,
      transcriptNote: 'no provider turn ran in this environment, so an empty runtime transcript is the authoritative readback',
      taskLedgerNodeId: durable?.id ?? null,
      taskLedgerStatus: durable?.status ?? null,
    });
  } finally {
    await closeElectronApp(app);
  }

  app = await launchElectronApp({ skipSetup: true });
  let workspaceB = '';
  let coordinatorB!: string;
  let taskB!: string;
  try {
    await ensureGatewayReady(app);
    workspaceB = await createWorkspace(app, workspaceRootB, 'F1 workspace B');
    // Creating a workspace activates it; re-activate A before reading A's binding
    // is not needed because the binding is persisted per workspace. Read both.
    coordinatorB = await createSession(app, 'F1 coordinator B');
    await hostInvoke(app, 'workspaces', 'update', {
      id: workspaceB,
      agentId: 'main',
      activeSessionKey: coordinatorB,
      sessionKey: coordinatorB,
      permissionMode: 'fullAccess',
    });
    const ledger = await hostInvoke<{ snapshot: { nodes: Array<{ id: string; title: string }> } }>(app, 'taskLedger', 'createNode', {
      workspaceId: workspaceB,
      node: { title: 'F1 journey-3 isolated task', kind: 'task', status: 'doing', owner: 'agent' },
    });
    taskB = ledger.snapshot.nodes.find((node) => node.title === 'F1 journey-3 isolated task')?.id ?? '';
    expect(taskB).toBeTruthy();
    await bindCoordinator(app, workspaceB, coordinatorB, taskB, 0);
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceA });
    const readA = await readBinding(app, workspaceA);
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceB });
    const readB = await readBinding(app, workspaceB);
    expect(readA.binding?.workspaceId).toBe(workspaceA);
    expect(readB.binding?.workspaceId).toBe(workspaceB);
    expect(readA.binding?.sessionKey).not.toBe(readB.binding?.sessionKey);
    negatives.push('cross-workspace binding readback stayed isolated (workspace A vs B)');
    record({
      id: 'journey-3-second-workspace-isolation',
      status: 'pass',
      workspaceA: readA.binding?.workspaceId,
      workspaceB: readB.binding?.workspaceId,
      distinctSessionKeys: readA.binding?.sessionKey !== readB.binding?.sessionKey,
    });
  } finally {
    await closeElectronApp(app);
  }

  app = await launchElectronApp({ skipSetup: true });
  try {
    await ensureGatewayReady(app);
    const prepared = await hostInvoke<{ success?: boolean; draft?: string }>(app, 'sessions', 'prepareHandoff', {
      sessionKey: coordinatorB,
      workspaceId: workspaceB,
    });
    const handoff = await hostInvoke<Record<string, unknown>>(app, 'sessions', 'createHandoff', {
      sessionKey: coordinatorB,
      workspaceId: workspaceB,
      draftInput: typeof prepared.draft === 'string' && prepared.draft.trim()
        ? prepared.draft
        : 'F1 handoff: continue the same task after restart.',
    });
    expect(handoff).toBeTruthy();
    const forked = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
      method: 'sessions.fork',
      params: { key: coordinatorB, label: 'F1 fork from B' },
      timeoutMs: 30_000,
    });
    expect(forked).toBeTruthy();
    const compact = await hostInvoke<Record<string, unknown>>(app, 'sessions', 'compact', { sessionKey: coordinatorB });
    expect(compact).toBeTruthy();
    const bindingB = await readBinding(app, workspaceB);
    expect(bindingB.binding?.workspaceId).toBe(workspaceB);
    // The binding read is scoped to the ACTIVE workspace by design, so read A
    // only after switching back to it.
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceA });
    const bindingA = await readBinding(app, workspaceA);
    expect(bindingA.binding?.workspaceId).toBe(workspaceA);
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceB });
    record({
      id: 'journey-4-handoff-fork-compact',
      status: 'pass',
      handoffSession: (handoff as { sessionKey?: string }).sessionKey ?? null,
      forkedSession: (forked as { key?: string }).key ?? null,
      compactionSuccess: (compact as { success?: boolean }).success !== false,
      workspaceBStillBound: bindingB.binding?.workspaceId === workspaceB,
      workspaceAUntouched: bindingA.binding?.workspaceId === workspaceA,
    });
  } finally {
    await closeElectronApp(app);
  }

  app = await launchElectronApp({ skipSetup: true });
  try {
    await ensureGatewayReady(app);
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceA });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceA, permissionMode: 'fullAccess' });
    const terminal = await hostInvoke<{ success?: boolean; sessionId?: string | null }>(app, 'terminal', 'open', {
      workspaceId: workspaceA,
      sessionKey: coordinatorA,
    });
    expect(terminal.sessionId).toBeTruthy();
    const listedBefore = await hostInvoke<{ sessions?: Array<Record<string, unknown>> }>(app, 'terminal', 'list', {
      workspaceId: workspaceA,
      sessionKey: coordinatorA,
    });
    expect((listedBefore.sessions ?? []).length).toBeGreaterThan(0);

    await hostInvoke(app, 'workspaces', 'update', { id: workspaceA, permissionMode: 'readOnly' });
    const afterRevoke = await hostInvoke<CoordinatorRead>(app, 'sessions', 'coordinatorBinding', { workspaceId: workspaceA });
    expect(afterRevoke.binding?.workspaceId).toBe(workspaceA);
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceA, permissionMode: 'fullAccess' });

    const archived = await hostInvoke<{ success?: boolean }>(app, 'sessions', 'archive', {
      id: coordinatorA,
      originalWorkspaceId: workspaceA,
      label: 'F1 archived A',
    });
    expect(archived.success).not.toBe(false);
    const afterArchive = await readBinding(app, workspaceA);
    expect(afterArchive.validation).toBe('invalidated');
    expect(afterArchive.binding?.invalidationReason).toBe('archived');
    negatives.push('archive invalidated the coordinator binding instead of leaving a live pointer');

    const remaining = await hostInvoke<{ sessions?: Array<Record<string, unknown>> }>(app, 'terminal', 'list', {
      workspaceId: workspaceA,
      sessionKey: coordinatorA,
    });
    expect((remaining.sessions ?? []).length).toBe(0);
    record({
      id: 'journey-5-revoke-archive-resource',
      status: 'pass',
      terminalOpened: Boolean(terminal.sessionId),
      validationAfterArchive: afterArchive.validation,
      invalidationReason: afterArchive.binding?.invalidationReason,
      terminalsAfterArchive: (remaining.sessions ?? []).length,
    });
  } finally {
    await closeElectronApp(app);
  }

  app = await launchElectronApp({ skipSetup: true });
  try {
    await ensureGatewayReady(app);
    await hostInvoke(app, 'workspaces', 'switch', { id: workspaceB });
    const deleted = await hostInvoke<{ success?: boolean; error?: string }>(app, 'sessions', 'delete', { id: coordinatorB });
    if (!deleted.success) throw new Error('session delete failed: ' + JSON.stringify(deleted));
    expect(deleted.success).toBe(true);
    const afterDelete = await readBinding(app, workspaceB);
    expect(afterDelete.validation).toBe('invalidated');
    const lateRead = await readBinding(app, workspaceB);
    expect(lateRead.validation).toBe('invalidated');
    expect(lateRead.binding?.sessionId).toBe(afterDelete.binding?.sessionId);
    negatives.push('late coordinator read after delete could not resurrect the deleted generation');

    const workspaceList = await hostInvoke<{ profiles?: Workspace[]; workspaces?: Workspace[] }>(app, 'workspaces', 'list');
    const retained = workspaceList.profiles ?? workspaceList.workspaces ?? [];
    expect(retained.some((workspace) => workspace.id === workspaceA)).toBe(true);
    expect(retained.some((workspace) => workspace.id === workspaceB)).toBe(true);
    record({
      id: 'journey-6-delete-late-events',
      status: 'pass',
      validationAfterDelete: afterDelete.validation,
      lateReadValidation: lateRead.validation,
      workspaceARetained: true,
      workspaceBRetained: true,
    });
  } finally {
    await closeElectronApp(app);
  }

  const observation = {
    schema: 'clawx.long-session.f1-restart-journeys/v1',
    driven_by: 'agent',
    actor: 'codex-long-session-f1',
    runRoot,
    workspaceA,
    workspaceB,
    coordinatorA,
    coordinatorB,
    taskA,
    taskB,
    journeys,
    negatives,
    status: journeys.length >= 6 ? 'passed' : 'failed',
  };
  const observationPath = testInfo.outputPath('f1-journey-observation.json');
  await writeFile(observationPath, JSON.stringify(observation, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(observation));
  expect(journeys).toHaveLength(6);
});
