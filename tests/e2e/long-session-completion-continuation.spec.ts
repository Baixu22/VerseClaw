import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import type { TaskView } from '../../shared/task-system/types';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';
import { startScriptedLlm } from './fixtures/fp-p1-harness';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

let scriptedProvider: Awaited<ReturnType<typeof startScriptedLlm>> | undefined;
test.afterEach(async () => {
  const provider = scriptedProvider;
  scriptedProvider = undefined;
  if (!provider) return;
  provider.server.closeAllConnections();
  await new Promise<void>((resolve) => provider.server.close(() => resolve()));
});

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type LedgerSnapshot = { snapshot: { nodes: Array<{ id: string; title: string; status: string }> } };
type BindingResult = {
  success: boolean;
  binding?: {
    workspaceId: string;
    agentId: string;
    sessionKey: string;
    sessionGeneration: string | null;
    bindingRevision: number;
    state: string;
    environment: {
      kind: string;
      canonicalRoot: string;
      backend: string;
      branch: string | null;
      detachedHead: boolean;
      setupProfile: string | null;
    };
    taskLedgerReferences: Array<{ taskLedgerNodeId: string }>;
  } | null;
  recovery: { state: string; reason: string | null; bindingRevision: number | null };
};
type DelegationResult = {
  success: boolean;
  status: string;
  replayed?: boolean;
  error?: string;
  receipt?: {
    admissionId: string;
    idempotencyKey: string;
    status: string;
    orchestrationRunId: string | null;
    coordinator: { bindingRevision: number; sessionGeneration: string };
    taskRef: string;
    parentEnvironmentRevision: number;
    parentEnvironment: { canonicalRoot: string; backend: string; kind: string };
    budget: {
      status: string;
      maxWorkers: number;
      process: { maxChildrenPerAgent: number | null; maxSpawnDepth: number | null };
      backgroundTerminal: { lane: string; maxConcurrent: number | null; activeCount: number | null; queuedCount: number | null };
    };
    scheduler: { metrics: { concurrencyCap: number; scheduled: number } } | null;
    children: Array<{
      roleName: string;
      admissionStatus: string;
      runState: string;
      completionObserved: boolean;
      childSessionKey: string | null;
      childRunId: string | null;
      backend: string;
      toolAuthorization: { allowlist: string[] | null; denylist: string[]; parentRoleName: string | null };
      isolation: { mode: string; backend: string; canonicalRoot: string; branch: string | null; detachedHead: boolean | null; verifiedCheckout: boolean };
    }>;
    completionObserved: boolean;
    recoveryRequired: boolean;
  };
};
type CompletionBatch = {
  batchId: string;
  orchestrationRunId: string;
  status: string;
  outcome: string;
  generationState: string;
  consolidatedReceiptId: string | null;
  counts: Record<string, number>;
  delivery: Record<string, number | string | boolean>;
  members: Array<{ runId: string; status: string; deliveryStatus: string }>;
};
type ActivitySnapshot = {
  snapshot: {
    session: { sessionKey: string; sessionId?: string | null; status: string; runId?: string | null };
    subagents: Array<{ role?: string; status: string; childSessionKey?: string }>;
    completionBatches: CompletionBatch[];
    processes: Array<{ id: string; status: string }>;
  };
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
    return await handler(event, { id: `delegation-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'host invoke failed'}`);
  return response.data as T;
}

async function waitForBatch(
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
    const batch = activity.snapshot.completionBatches.find((candidate) => candidate.orchestrationRunId === orchestrationRunId);
    if (batch && batch.status !== 'collecting') return batch;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`completion batch ${orchestrationRunId} did not become terminal`);
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
  throw new Error('Gateway did not become ready for delegation admission E2E');
}

test('consolidates deferred worker completion into one generation-fenced batch after restart', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Delegation review recorded for task verification.' }));
  scriptedProvider = provider;
  const first = await launchElectronApp({ skipSetup: true });
  let workspaceId: string;
  let rootPath: string;
  let it: string;
  let sessionKey: string;
  let sessionGeneration: string;
  let taskRef: string;
  let request: Record<string, unknown> | undefined;
  let firstReceipt: NonNullable<DelegationResult['receipt']>;
  let taskLedgerStatusAfter: string;
  let duplicate: DelegationResult | undefined;
  let unsupported: DelegationResult | undefined;
  let terminalBatch: CompletionBatch | undefined;
  let replayBatch: CompletionBatch | undefined;
  let fencedBatch: CompletionBatch | undefined;
  try {
    await getStableWindow(first);
    await configureSessionChainProvider(first, provider.port);
    const project = await createSessionChainProject(first, testInfo.outputPath('workspace'), 'Completion continuation');
    workspaceId = project.workspaceId;
    rootPath = project.rootPath;
    sessionKey = project.sessionKey;
    sessionGeneration = project.generation;
    expect(sessionGeneration).toBeTruthy();
    const managedTask = await createSessionChainTask(first, workspaceId, `delegation-task-${Date.now()}`, {
      objective: 'Exercise long-session delegation admission',
      target: 'docs/delegation-note.md',
      constraints: ['Worker completion does not accept the business task'],
      acceptance: [{ id: 'owner-review', description: 'Review the recorded delegation result',
        verification: { kind: 'owner-receipt', owner: 'delegation-review', files: ['docs/delegation-note.md'] } }],
    });
    const node = { id: managedTask.contract.taskNodeId };
    taskRef = node.id;
    await hostInvoke(first, 'taskLedger', 'linkSession', {
      workspaceId,
      nodeId: node.id,
      sessionKey,
      agentId: 'main',
      relation: 'related',
      idempotencyKey: `delegation-link-${sessionKey}-${node.id}`,
    });
    const bound = await hostInvoke<BindingResult>(first, 'workspaces', 'bindCoordinator', {
      workspaceId,
      agentId: 'main',
      sessionKey,
      expectedRevision: 0,
      taskLedgerNodeIds: [taskRef],
      environment: { kind: 'local', rootPath, setupProfile: 'default' },
      archiveRestorePolicy: 'restore',
    });
    expect(bound.recovery.state).toBe('ready');
    expect(bound.binding?.sessionGeneration).toBe(sessionGeneration);
    const claimed = await hostInvoke<{ result: TaskView }>(first, 'taskLedger', 'command', {
      workspaceId,
      command: { action: 'claim', taskNodeId: taskRef, sessionKey, requestId: `delegation-claim-${taskRef}` },
    });
    expect(claimed.result?.claim, JSON.stringify(claimed)).toMatchObject({ sessionKey, generation: sessionGeneration });
    expect(claimed.result.contract.state).toBe('doing');

    const models = await hostInvoke<{ defaultModelRef: string }>(first, 'agents', 'list');
    expect(models.defaultModelRef).toBeTruthy();
    it = `delegation-admission-${Date.now()}`;
    request = {
      sessionKey,
      workspaceId,
      agentId: 'main',
      taskRef,
      task: 'Exercise long-session delegation admission',
      expectedBindingRevision: bound.binding?.bindingRevision,
      expectedSessionGeneration: sessionGeneration,
      idempotencyKey: it,
      backend: 'subagent',
      worker: {
        roleName: 'architect',
        modelRef: models.defaultModelRef,
        task: 'Review the admission boundary and report findings',
        isolation: 'shared',
        writeSet: ['docs/delegation-note.md'],
      },
      includeVerifier: false,
    };

    const firstResult = await hostInvoke<DelegationResult>(first, 'sessions', 'delegate', request);
    expect(firstResult.success, firstResult.error).toBe(true);
    expect(firstResult.status).toBe('accepted');
    expect(firstResult.replayed).not.toBe(true);
    if (!firstResult.receipt) throw new Error('Accepted delegation returned no receipt');
    firstReceipt = firstResult.receipt;
    expect(firstReceipt).toMatchObject({
      status: 'accepted',
      taskRef,
      parentEnvironmentRevision: bound.binding?.bindingRevision,
      parentEnvironment: {
        canonicalRoot: rootPath,
      },
      budget: { status: 'observed', maxWorkers: expect.any(Number) },
      completionObserved: false,
      children: [{
        roleName: 'architect',
        admissionStatus: 'accepted',
        runState: 'accepted-not-completed',
        completionObserved: false,
        backend: 'subagent',
        isolation: { mode: 'shared', backend: 'shared-inprocess', canonicalRoot: rootPath },
      }],
    });
    expect(firstReceipt?.coordinator).toMatchObject({
      bindingRevision: bound.binding?.bindingRevision,
      sessionGeneration,
    });
    expect(firstReceipt?.children[0]?.childSessionKey).toBeTruthy();
    expect(firstReceipt?.children[0]?.childRunId).toBeTruthy();
    const ledgerAfter = await hostInvoke<LedgerSnapshot>(first, 'taskLedger', 'snapshot', { workspaceId });
    taskLedgerStatusAfter = ledgerAfter.snapshot.nodes.find((candidate) => candidate.id === taskRef)?.status ?? '';
    expect(taskLedgerStatusAfter).toBe('doing');

    const describedChild = await hostInvoke<{ session?: { sessionId?: string; key?: string } }>(first, 'gateway', 'rpc', {
      method: 'sessions.describe',
      params: { key: firstReceipt?.children[0]?.childSessionKey },
      timeoutMs: 30_000,
    });
    expect(describedChild.session).toBeTruthy();
    const activity = await hostInvoke<ActivitySnapshot>(first, 'gateway', 'rpc', {
      method: 'session.activitySnapshot',
      params: { sessionKey, workspaceId },
      timeoutMs: 30_000,
    });
    expect(activity.snapshot.subagents.some((entry) => (
      entry.role === 'architect'
      && ['started', 'error', 'aborted', 'completed'].includes(entry.status)
    ))).toBe(true);
    if (!firstReceipt.orchestrationRunId) throw new Error('Accepted delegation has no orchestration run id');
    terminalBatch = await waitForBatch(first, sessionKey, workspaceId, firstReceipt.orchestrationRunId);
    expect(terminalBatch).toMatchObject({
      orchestrationRunId: firstReceipt.orchestrationRunId,
      status: 'terminal',
      generationState: 'matching',
      consolidatedReceiptId: expect.any(String),
      counts: { expected: 1, settled: 1 },
    });
    expect(terminalBatch.members).toHaveLength(1);

    duplicate = await hostInvoke<DelegationResult>(first, 'sessions', 'delegate', request);
    expect(duplicate).toMatchObject({ success: true, status: 'accepted', replayed: true });
    expect(duplicate.receipt?.orchestrationRunId).toBe(firstReceipt?.orchestrationRunId);

    unsupported = await hostInvoke<DelegationResult>(first, 'sessions', 'delegate', {
      ...request,
      idempotencyKey: `${it}-unsupported`,
      backend: 'native-shell',
    });
    expect(unsupported).toMatchObject({ success: false, status: 'rejected' });
    expect(unsupported.receipt).toBeUndefined();

    await expect(hostInvoke(first, 'gateway', 'rpc', {
      method: 'orchestrator.run',
      params: {
        task: 'unknown worker must not spawn',
        sessionKey,
        agentId: 'main',
        backend: 'subagent',
        workers: [{ roleName: 'ghost-worker', task: 'do not run' }],
      },
      timeoutMs: 30_000,
    })).rejects.toThrow(/unknown role/);
  } finally {
    await closeElectronApp(first);
  }

  const modelCallsBeforeRestart = provider.log.length;
  const second = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(second);
    await ensureGatewayReady(second);
    await hostInvoke(second, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    if (!request || !firstReceipt) throw new Error('First launch did not produce a delegation request');
    const restarted = await hostInvoke<DelegationResult>(second, 'sessions', 'delegate', request);
    expect(restarted).toMatchObject({ success: true, status: 'accepted', replayed: true });
    expect(restarted.receipt?.orchestrationRunId).toBe(firstReceipt.orchestrationRunId);
    expect(restarted.receipt?.admissionId).toBe(firstReceipt.admissionId);
    const modelCallsAfterReplay = provider.log.length;
    expect(modelCallsAfterReplay).toBe(modelCallsBeforeRestart);
    if (!firstReceipt.orchestrationRunId) throw new Error('Missing orchestration run id');
    replayBatch = await waitForBatch(second, sessionKey, workspaceId, firstReceipt.orchestrationRunId);
    expect(replayBatch.consolidatedReceiptId).toBe(terminalBatch?.consolidatedReceiptId);
    expect(replayBatch.members).toEqual(terminalBatch?.members);

    const reset = await hostInvoke<{ ok: boolean; key: string; entry: { sessionId: string } }>(second, 'gateway', 'rpc', {
      method: 'sessions.reset',
      params: { key: sessionKey, agentId: 'main', reason: 'reset' },
      timeoutMs: 30_000,
    });
    expect(reset.ok).toBe(true);
    expect(reset.entry.sessionId).toBeTruthy();
    expect(reset.entry.sessionId).not.toBe(sessionGeneration);
    const activityAfterReset = await hostInvoke<ActivitySnapshot>(second, 'gateway', 'rpc', {
      method: 'session.activitySnapshot',
      params: { sessionKey, workspaceId },
      timeoutMs: 30_000,
    });
    expect(activityAfterReset.snapshot.session.sessionId).toBe(reset.entry.sessionId);
    expect(activityAfterReset.snapshot.completionBatches.find((candidate) => candidate.orchestrationRunId === firstReceipt.orchestrationRunId))
      .toMatchObject({ generationState: 'mismatch' });
    const stale = await hostInvoke<DelegationResult>(second, 'sessions', 'delegate', {
      ...request,
      idempotencyKey: `${it}-stale-generation`,
    });
    expect(stale).toMatchObject({ success: false, status: 'rejected' });
    expect(stale.receipt).toBeUndefined();
    expect(stale.error).toMatch(/generation|ready|binding/i);
    if (!firstReceipt.orchestrationRunId) throw new Error('Missing orchestration run id');
    fencedBatch = await waitForBatch(second, sessionKey, workspaceId, firstReceipt.orchestrationRunId);
    expect(fencedBatch).toMatchObject({
      status: 'fenced',
      outcome: 'fenced',
      generationState: 'mismatch',
      consolidatedReceiptId: null,
    });

    const output = testInfo.outputPath('completion-continuation-e2e.json');
    await writeFile(output, `${JSON.stringify({
      schema: 'clawx.long-session.completion-continuation-e2e/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      provider: 'local-scripted',
      modelCallsBeforeRestart,
      modelCallsAfterReplay,
      workspaceId,
      rootPath,
      sessionKey,
      sessionGeneration,
      taskRef,
      taskLedgerStatusAfter,
      idempotencyKey: it,
      first: {
        status: firstReceipt.status,
        admissionId: firstReceipt.admissionId,
        orchestrationRunId: firstReceipt.orchestrationRunId,
        bindingRevision: firstReceipt.coordinator.bindingRevision,
        parentEnvironmentRevision: firstReceipt.parentEnvironmentRevision,
        budget: firstReceipt.budget,
        children: firstReceipt.children,
        completionObserved: firstReceipt.completionObserved,
      },
      duplicate: { status: duplicate?.status, replayed: duplicate?.replayed, orchestrationRunId: duplicate?.receipt?.orchestrationRunId },
      restartRetry: { status: restarted.status, replayed: restarted.replayed, orchestrationRunId: restarted.receipt?.orchestrationRunId },
      staleGeneration: { status: stale.status, error: stale.error },
      unsupportedBackend: { status: unsupported?.status, error: unsupported?.error },
      unknownWorker: { status: 'rejected', phantomChildCreated: false },
      terminalBatch: terminalBatch ? {
        batchId: terminalBatch.batchId,
        status: terminalBatch.status,
        outcome: terminalBatch.outcome,
        generationState: terminalBatch.generationState,
        consolidatedReceiptId: terminalBatch.consolidatedReceiptId,
        counts: terminalBatch.counts,
        delivery: terminalBatch.delivery,
        members: terminalBatch.members,
      } : null,
      restartReplay: replayBatch ? {
        batchId: replayBatch.batchId,
        status: replayBatch.status,
        consolidatedReceiptId: replayBatch.consolidatedReceiptId,
        members: replayBatch.members,
      } : null,
      resetFence: fencedBatch ? {
        batchId: fencedBatch.batchId,
        status: fencedBatch.status,
        outcome: fencedBatch.outcome,
        generationState: fencedBatch.generationState,
        consolidatedReceiptId: fencedBatch.consolidatedReceiptId,
      } : null,
      transport: 'built Electron session.activitySnapshot -> persisted subagent registry batches -> existing generation-pinned delivery owner',
    }, null, 2)}\n`);
    await testInfo.attach('completion-continuation-e2e', { path: output, contentType: 'application/json' });
  } finally {
    await closeElectronApp(second);
  }
});
