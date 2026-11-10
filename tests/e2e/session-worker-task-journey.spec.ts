import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { TaskContractInput, TaskView } from '../../shared/task-system/types';
import type { SessionDelegationResult, WorkspaceCoordinatorBindingResult } from '../../shared/host-api/contract';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import type { SessionActivitySnapshot } from '../../shared/types/session-activity';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { hostActionTimeoutMs } from '../../shared/host-api/host-action-timeouts';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask, observeSessionUi } from './fixtures/session-task-chain';

for (const journey of ['navigation', 'controls', 'isolation'] as const) {
test(`a real delegated worker receives its own task, reports separately and accepts a scoped follow-up (${journey})`, async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const target = testInfo.outputPath('workspace', 'worker.txt');
  let wrote = false;
  let holdNext = false;
  let held = false;
  let releaseHold = () => {};
  const llm = await startScriptedLlm(async (text) => {
    if (holdNext && text.includes('WORKER-HOLD')) {
      holdNext = false; held = true;
      await new Promise<void>((resolve) => { releaseHold = resolve; });
      return { text: 'WORKER-HOLD-FINISHED' };
    }
    if (text.includes('WORKER-FOLLOWUP')) return { text: 'WORKER-FOLLOWUP-RECORDED' };
    if (text.includes('WORKER-EFFECT') && !wrote) {
      wrote = true;
      return { toolCall: { id: 'worker-effect', name: 'write', args: { path: target, content: 'agent-driven worker result\n' } } };
    }
    return { text: 'WORKER-RUN-FINISHED' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  await app.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get('host:invoke')!;
    const state = globalThis as unknown as { u4WorkerDispatches: Array<{ request: unknown; startedAt: number; endedAt?: number; result?: unknown; error?: string }> };
    state.u4WorkerDispatches = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: unknown }) => {
      if (request.module !== 'sessions' || request.action !== 'sendWorker') return original(event, request);
      const receipt: (typeof state.u4WorkerDispatches)[number] = { request: request.payload, startedAt: Date.now() };
      state.u4WorkerDispatches.push(receipt);
      try { receipt.result = await original(event, request); return receipt.result; }
      catch (error) { receipt.error = String(error); throw error; }
      finally { receipt.endedAt = Date.now(); }
    });
  });
  const mainOutput: string[] = [];
  const collect = (bytes: Buffer) => { mainOutput.push(bytes.toString()); if (mainOutput.length > 2000) mainOutput.splice(0, mainOutput.length - 2000); };
  app.process().stdout?.on('data', collect); app.process().stderr?.on('data', collect);
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-worker-task', provider: 'local-scripted', journey, status: 'running' };
  const dispatchTimeout = hostActionTimeoutMs('sessions', 'sendWorker');
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Worker project');
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 60_000 });
    const taskContract: TaskContractInput = { objective: 'Verify a delegated task', target: 'worker.txt', constraints: ['Preserve the project coordinator'],
      acceptance: [{ id: 'worker-artifact', description: 'Exact assigned output', verification: { kind: 'file-sha256',
        path: 'worker.txt', sha256: createHash('sha256').update('agent-driven worker result\n').digest('hex') } }] };
    const rootTask = await createSessionChainTask(app, project.workspaceId, 'worker-root-task', taskContract);
    const rootId = rootTask.contract.taskNodeId;
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      sessionGeneration: project.generation, nodeId: rootId, agentId: 'main' });
    const binding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', expectedRevision: 0,
      taskLedgerNodeIds: [rootId], environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore',
    });
    const rootClaim = await hostInvoke<{ result: TaskView }>(app, 'taskLedger', 'command', {
      workspaceId: project.workspaceId, command: { action: 'claim', taskNodeId: rootId, sessionKey: project.sessionKey, requestId: 'worker-root-claim' },
    });
    const plan = await hostInvoke<{ result: TaskView[] }>(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'decompose', credential: rootClaim.result.claim, requestId: 'worker-plan',
        children: [{ key: 'worker-output', contract: { ...taskContract, objective: 'Produce the assigned worker artifact' } }] } });
    const task = { id: plan.result[0].contract.taskNodeId, title: plan.result[0].contract.objective };
    const workerBinding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', expectedRevision: binding.binding!.bindingRevision,
      taskLedgerNodeIds: [task.id], environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore',
    });
    await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'claim', taskNodeId: task.id, sessionKey: project.sessionKey, requestId: 'worker-task-claim' } });
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      sessionGeneration: project.generation, nodeId: task.id, agentId: 'main' });
    const models = await hostInvoke<{ defaultModelRef: string }>(app, 'agents', 'list');
    expect(models.defaultModelRef).toBeTruthy();
    const request = { workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', taskRef: task.id,
      expectedBindingRevision: workerBinding.binding!.bindingRevision, expectedSessionGeneration: project.generation,
      task: 'Run the WORKER-EFFECT verification', idempotencyKey: 'worker-task-admission', backend: 'subagent',
      worker: { roleName: 'implementer', task: 'WORKER-EFFECT: write the assigned result and finish.', modelRef: models.defaultModelRef, isolation: 'shared', writeSet: ['worker.txt'] }, includeVerifier: false };
    const admitted = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'delegate', request);
    evidence.admission = admitted;
    expect(admitted.success, admitted.error).toBe(true);
    expect(admitted.receipt?.children[0].runState).toBe('accepted-not-completed');
    const childKey = admitted.receipt!.children[0].childSessionKey!;
    expect(childKey).toBeTruthy();
    await expect.poll(() => readFile(target, 'utf8').catch(() => null), { timeout: 90_000 }).toBe('agent-driven worker result\n');
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('WORKER-RUN-FINISHED'), { timeout: 60_000 }).toBe(true);
    const returnedOwner = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    });
    await expect.poll(async () => (await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    })).task.claim?.sessionKey, { timeout: 30_000 }).toBe(project.sessionKey);
    const currentOwner = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: project.sessionKey,
    });
    await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId, command: {
      action: 'checkpoint', credential: currentOwner.task.claim,
      checkpoint: { completed: ['Read back the assigned worker artifact'], nextAction: 'Verify the business task',
        unresolved: ['Business task acceptance'], artifacts: [{ path: target,
          sha256: createHash('sha256').update(await readFile(target)).digest('hex') }] },
    } });
    evidence.returnedOwner = { observed: returnedOwner, current: currentOwner };
    const after = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: project.workspaceId });
    const childTask = after.snapshot.nodes.find((node) => node.id === task.id && node.parentId === rootId && node.kind === 'task');
    expect(childTask).toBeTruthy();
    expect(after.snapshot.sessionLinks.some((link) => link.sessionKey === childKey && link.nodeId === childTask!.id)).toBe(true);
    expect(after.snapshot.nodes.find((node) => node.id === rootId)?.status).toBe('todo');
    expect(childTask?.status).toBe('doing');
    expect(childTask?.evidenceRefs?.some(ref => ref.ref === target)).toBe(true);
    const duplicate = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'delegate', request);
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.receipt?.children[0].childSessionKey).toBe(childKey);
    const described = await rpc<{ session: { sessionId: string; hasActiveRun: boolean; parentSessionKey?: string; spawnedBy?: string } }>('sessions.describe', { key: childKey });
    expect(described.session.spawnedBy).toBe(project.sessionKey);
    evidence.initialRunOwner = await rpc('agent.wait', { runId: admitted.receipt!.children[0].childRunId!, timeoutMs: 1000 });
    expect(evidence.initialRunOwner).toMatchObject({ status: 'ok' });
    await writeFile(testInfo.outputPath('worker-before-followup.json'), JSON.stringify({ owner: evidence.initialRunOwner, described }, null, 2));
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: childKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    evidence.initialIdleOwner = await rpc('sessions.describe', { key: childKey });
    let followup: unknown;
    if (journey === 'navigation') {
    followup = await hostInvoke(app, 'sessions', 'sendWorker', { workspaceId: project.workspaceId, parentSessionKey: project.sessionKey,
      expectedParentGeneration: project.generation, childSessionKey: childKey, expectedChildGeneration: described.session.sessionId,
      message: 'WORKER-FOLLOWUP', idempotencyKey: 'worker-followup-1', mode: 'send' });
    expect(followup).toMatchObject({ success: true, phase: 'accepted' });
    evidence.followup = { childKey, described, response: followup, requestedAt: new Date().toISOString(),
      parentOwner: { sessionKey: currentOwner.task.claim?.sessionKey, generation: currentOwner.task.claim?.generation, epoch: currentOwner.task.claim?.epoch } };
    await writeFile(testInfo.outputPath('worker-followup-start.json'), JSON.stringify(evidence.followup, null, 2));
    await expect.poll(async () => {
      const readback = await rpc('chat.history', { sessionKey: childKey, limit: 100 });
      evidence.followupLastHistory = readback;
      return JSON.stringify(readback).includes('WORKER-FOLLOWUP-RECORDED');
    }, { timeout: 60_000 }).toBe(true);
    evidence.followupObservedAt = new Date().toISOString();
    }
    const history = await hostInvoke(app, 'sessions', 'history', { sessionKey: childKey,
      expectedParentSessionKey: project.sessionKey, expectedSessionGeneration: described.session.sessionId });
    const activity = await hostInvoke<{ snapshot: SessionActivitySnapshot }>(app, 'sessionActivity', 'snapshot', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
    evidence.worker = { childKey, childTask, described, followup, history, activity };
    await rpc('chat.inject', { sessionKey: project.sessionKey, message: 'Worker lifecycle verification', label: 'agent fixture' });
    const page = await getStableWindow(app); await page.reload();
    const activityButton = page.getByTestId('chat-session-activity-toggle');
    await expect(activityButton).toBeVisible({ timeout: 30_000 });
    await activityButton.click();
    const workerActor = activity.snapshot.subagents.find(agent => agent.childSessionKey === childKey)!;
    const workerRow = page.getByTestId(`session-activity-subagent-${workerActor.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
    await expect(workerRow).toBeVisible(); await workerRow.click();
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-RUN-FINISHED');
    await expect(page.getByTestId('workspace-subagent-panel').locator('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'pending');
      await expect(page.getByTestId('workspace-subagent-panel').locator('[data-stage="verification"]')).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('workspace-subagent-model')).toContainText((history as { model: string }).model);
    if (journey === 'navigation') {
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: childKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    await page.getByTestId('workspace-subagent-dispatch-input').fill('WORKER-FOLLOWUP-UI');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Accepted|已接收/, { timeout: dispatchTimeout });
    await expect(page.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('WORKER-FOLLOWUP-UI'), { timeout: 60_000 }).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('worker-lifecycle.png') });

    if (journey === 'navigation') {
    await page.getByTestId('session-tasks-toggle').click();
    await page.getByTestId('session-task-list').getByRole('link', { name: task.title, exact: true }).click();
    await expect(page.getByTestId('task-ledger-tree')).toContainText(task.title);
    await page.getByTestId(`task-ledger-evidence-${task.id}`).getByRole('button', { name: 'worker.txt', exact: true }).click();
    await expect(page.getByText('agent-driven worker result', { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('worker-task-artifact.png') });
    await page.getByTestId('artifact-panel-tab-close-files').click();
    await page.getByTestId('session-tasks-toggle').click();
    await page.getByTestId('session-task-list').getByRole('link', { name: task.title, exact: true }).click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const workerLink = after.snapshot.sessionLinks.find(link => link.nodeId === task.id && link.sessionKey === childKey)!;
    await page.getByTestId(`task-ledger-open-session-${workerLink.id}`).click();
    await expect(page.getByTestId('task-ledger-page')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('WORKER-RUN-FINISHED');
    await page.screenshot({ path: testInfo.outputPath('worker-task-transcript.png') });
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Worker project');
    const projectScope = page.locator('[data-project-workspace]');
    await expect(projectScope).toHaveAttribute('data-project-workspace', project.workspaceId);
    expect(await page.getByTestId('session-family-children').selectOption(childKey)).toEqual([childKey]);
    await expect(projectScope).toHaveAttribute('data-project-workspace', project.workspaceId);
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-RUN-FINISHED');
    evidence.taskNavigation = { rootId, taskId: task.id, workerLink, artifact: target };
    }

    if (journey === 'controls') {
    const loop = await rpc<{ loop: { taskLedgerRootId: string; status: string } }>('task_loop.run', {
      task: 'Read the existing worker transcript and return a short summary.', sessionKey: childKey, agentId: 'main',
      workspaceId: project.workspaceId, maxWorkers: 1, includeVerifier: false });
    expect(loop.loop.taskLedgerRootId).toBeTruthy();
    evidence.loopBootstrap = loop;
    await page.getByTestId('workspace-subagent-refresh').click();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-RUN-FINISHED');
    holdNext = true;
    await page.getByTestId('workspace-subagent-dispatch-input').fill('interrupt WORKER-HOLD: open a model turn for receipt validation.');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Accepted|已接收/, { timeout: dispatchTimeout });
    await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
    await app.evaluate(() => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: { message?: string; idempotencyKey?: string } }) => {
        const result = await original(event, request);
        if (request.module === 'sessions' && request.action === 'sendWorker' && request.payload?.message === 'later WORKER-QUEUED') {
          (globalThis as unknown as { workerLostAck: unknown }).workerLostAck = { request, result };
          ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original);
          const envelope = result as Record<string, unknown>;
          return { ...envelope, data: { success: false, phase: 'unknown', error: 'Agent simulated worker acknowledgement loss' } };
        }
        return result;
      });
    });
    await page.getByTestId('workspace-subagent-dispatch-input').fill('later WORKER-QUEUED');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/unknown|未知/, { timeout: dispatchTimeout });
    await expect(page.getByTestId('workspace-subagent-dispatch')).toBeDisabled();
    const lostAck = await app.evaluate(() => (globalThis as unknown as { workerLostAck: {
      request: { payload: { idempotencyKey: string } }; result: { data: { phase: string } } } }).workerLostAck);
    expect(lostAck.result.data.phase).toBe('queued');
    const delivery = await hostInvoke<{ workerSendReceipt?: { phase: string; idempotencyKey: string; source: string } }>(app, 'sessions', 'history', {
      sessionKey: childKey, expectedParentSessionKey: project.sessionKey, expectedSessionGeneration: described.session.sessionId,
      workerSendIdempotencyKey: lostAck.request.payload.idempotencyKey });
    expect(delivery.workerSendReceipt).toMatchObject({ phase: 'queued', source: 'runtime-intervention', idempotencyKey: lostAck.request.payload.idempotencyKey });
    await page.getByTestId('workspace-subagent-refresh').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Queued|排队/, { timeout: dispatchTimeout });
    await expect(page.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
    await page.screenshot({ path: testInfo.outputPath('worker-queue-reconciled.png') });
    await page.getByTestId('workspace-subagent-dispatch-input').fill('btw WORKER-GUIDE use the already recorded evidence.');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Guidance accepted|Steered|引导/, { timeout: dispatchTimeout });
    const guide = await rpc<{ events: Array<{ status: string; payload?: { message?: string } }> }>('sessions.longTaskControlHistory', { key: childKey, limit: 200 });
    expect(guide.events.some((entry) => entry.status === 'steered' && entry.payload?.message === 'btw WORKER-GUIDE use the already recorded evidence.')).toBe(true);
    evidence.intervention = { driven_by: 'agent', actor: 'playwright-worker-task', fault: 'simulated-ack-loss-after-real-queue', lostAck, delivery, guide };
    releaseHold();
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('later WORKER-QUEUED'), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: childKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    }

    if (journey === 'isolation') {
    const assistants = await hostInvoke<{ agents: Array<{ id: string; name: string }> }>(app, 'agents', 'create', {
      name: 'Independent coordinator', inheritWorkspace: true,
    });
    const secondAgent = assistants.agents.find((agent) => agent.name === 'Independent coordinator')!;
    expect(secondAgent).toBeTruthy();
    const second = await rpc<{ key: string; sessionId: string }>('sessions.create', { agentId: secondAgent.id, label: 'Independent coordinator' });
    await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: second.key, state: {} });
    await hostInvoke(app, 'workspaces', 'update', { id: project.workspaceId, agentId: secondAgent.id, sessionKey: second.key, activeSessionKey: second.key });
    const secondContract = await createSessionChainTask(app, project.workspaceId, 'observer-task', {
      ...taskContract, objective: 'Independent coordinator task', target: 'Read the recorded transcript',
    });
    const secondTask = { id: secondContract.contract.taskNodeId, title: secondContract.contract.objective };
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: second.key,
      sessionGeneration: second.sessionId, nodeId: secondTask.id, agentId: secondAgent.id });
    const secondBinding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
      workspaceId: project.workspaceId, sessionKey: second.key, agentId: secondAgent.id, expectedRevision: 0,
      taskLedgerNodeIds: [secondTask.id], environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore',
    });
    await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'claim', taskNodeId: secondTask.id, sessionKey: second.key, requestId: 'observer-task-claim' } });
    const observerOwnerBefore = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: second.key });
    held = false;
    holdNext = true;
    const readOnly = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'delegate', {
      ...request, agentId: secondAgent.id, sessionKey: second.key, taskRef: secondTask.id, expectedSessionGeneration: second.sessionId,
      expectedBindingRevision: secondBinding.binding!.bindingRevision, idempotencyKey: 'read-only-worker-admission',
      task: 'Read the transcript and report without editing files',
      worker: { ...request.worker, roleName: 'reviewer', task: 'WORKER-HOLD: Read the transcript and report without editing files', writeSet: [] },
    });
    expect(readOnly.success, readOnly.error).toBe(true);
    const readOnlyKey = readOnly.receipt!.children[0].childSessionKey!;
    await expect.poll(() => held, { timeout: 30_000 }).toBe(true);
    const observerDuringRun = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: readOnlyKey });
    expect(observerDuringRun.task.referenceOnly).toBe(true);
    expect(observerDuringRun.task.claim?.sessionKey).toBe(second.key);
    expect(observerDuringRun.task.claim?.epoch).toBe(observerOwnerBefore.task.claim?.epoch);
    releaseHold();
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: readOnlyKey, limit: 100 })).includes('WORKER-HOLD-FINISHED'), { timeout: 60_000 }).toBe(true);
    const workspaces = await hostInvoke<{ profiles: WorkspaceProfile[] }>(app, 'workspaces', 'list');
    const currentProject = workspaces.profiles.find((profile) => profile.id === project.workspaceId)!;
    expect(currentProject.projectCoordinatorSessionKey).toBe(project.sessionKey);
    expect(currentProject.agentBindings?.main.sessionKey).toBe(project.sessionKey);
    expect(currentProject.agentBindings?.[secondAgent.id].sessionKey).toBe(second.key);
    expect(currentProject.coordinatorBindings?.[project.sessionKey].state).toBe('active');
    expect(currentProject.coordinatorBindings?.[second.key].state).toBe('active');
    expect(currentProject.coordinatorBindings?.[readOnlyKey]?.writerClaim).toBeUndefined();
    expect(currentProject.sessionStates?.[readOnlyKey]).toBeUndefined();
    const readOnlyDescription = await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: readOnlyKey });
    const firstOrigin = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: childKey });
    const secondOrigin = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
      workspaceId: project.workspaceId, sessionKey: readOnlyKey });
    expect(firstOrigin.task.contract.taskNodeId).toBe(task.id);
    expect(secondOrigin.task.contract.taskNodeId).toBe(secondTask.id);
    expect(secondOrigin.task.referenceOnly).toBe(true);
    expect(secondOrigin.task.claim?.sessionKey).toBe(second.key);
    const crossed = await hostInvoke(app, 'sessions', 'sendWorker', { workspaceId: project.workspaceId,
      parentSessionKey: second.key, expectedParentGeneration: second.sessionId, childSessionKey: childKey,
      expectedChildGeneration: described.session.sessionId, message: 'Wrong coordinator follow-up',
      idempotencyKey: 'crossed-worker-followup', mode: 'send' });
    expect(crossed).toMatchObject({ success: false, phase: 'rejected' });
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Worker project');
    await page.getByTestId(`sidebar-session-${second.key}`).click();
    await expect(page.getByTestId('session-family-children')).toBeVisible();
    await page.getByTestId('session-family-children').selectOption(readOnlyKey);
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-HOLD-FINISHED');
    const taskSummary = page.getByTestId('session-task-container');
    await expect(taskSummary).toHaveAttribute('data-state', 'ready');
    const taskSummaryToggle = taskSummary.getByTestId('session-tasks-toggle');
    if (await taskSummaryToggle.getAttribute('aria-expanded') !== 'true') await taskSummaryToggle.click();
    const ownerTaskLink = page.getByTestId('session-task-list').getByRole('link', {
      name: secondTask.title, exact: true,
    });
    await expect(ownerTaskLink).toBeVisible();
    await expect(ownerTaskLink).toHaveAttribute('href', expect.stringContaining(
      'nodeId=' + encodeURIComponent(secondTask.id),
    ));
    await page.screenshot({ path: testInfo.outputPath('read-only-worker-navigation.png') });
    evidence.multiCoordinator = { secondAgent, second, secondTask, readOnly, readOnlyDescription, observerOwnerBefore, observerDuringRun,
      firstOrigin, secondOrigin, crossed, currentProject };
    }
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error);
    evidence.mainLog = await hostInvoke(app, 'logs', 'memory', { count: 500 }).catch(String);
    const receipt = (evidence.admission as SessionDelegationResult | undefined)?.receipt;
    if (receipt?.children[0].childSessionKey) evidence.failureReadback = await hostInvoke(app, 'sessions', 'history', { sessionKey: receipt.children[0].childSessionKey }).catch(String);
    if (receipt?.children[0].childSessionKey) {
      evidence.failureControlHistory = await hostInvoke(app, 'sessions', 'longTaskControlHistory', { sessionKey: receipt.children[0].childSessionKey, limit: 200 }).catch(String);
      evidence.failureControlStatus = await hostInvoke(app, 'sessions', 'longTaskControlStatus', { sessionKey: receipt.children[0].childSessionKey }).catch(String);
    }
    throw error;
  }
  finally {
    releaseHold();
    evidence.workerDispatches = await app.evaluate(() => (globalThis as unknown as { u4WorkerDispatches: unknown[] }).u4WorkerDispatches).catch(String);
    await writeFile(testInfo.outputPath('worker-main.log'), mainOutput.join(''));
    evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('worker-task-journey.json'), JSON.stringify(evidence, null, 2));
    const window = await getStableWindow(app).catch(() => null);
    evidence.hostCalls = window ? await getAgentDevHostCalls(window).catch(String) : 'Window unavailable after failure';
    await writeFile(testInfo.outputPath('worker-task-journey.json'), JSON.stringify(evidence, null, 2));
    await captureUi((name) => testInfo.outputPath(name));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
}

// Each locale prepares a real canonical owner and uses one reload within the 300s case budget.
for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
  test(`the worker panel reads a real task acceptance after file verification and owner acceptance (${language})`, async ({ launchElectronApp }, testInfo) => {
    test.setTimeout(300_000);
    const content = 'owner-accepted worker result\n';
    const hash = createHash('sha256').update(content).digest('hex');
    const target = testInfo.outputPath('accepted-worker-workspace', 'accepted.txt');
    let wrote = false;
    const llm = await startScriptedLlm(async text => {
      if (text.includes('ACCEPTED-WORKER-WRITE') && !wrote) {
        wrote = true;
        return { toolCall: { id: 'accepted-worker-write', name: 'write', args: { path: target, content } } };
      }
      return { text: 'ACCEPTED-WORKER-FINISHED' };
    });
    const app = await launchElectronApp({ skipSetup: true });
    const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-worker-acceptance', provider: 'local-scripted', language, status: 'running' };
    try {
      await configureSessionChainProvider(app, llm.port);
      const project = await createSessionChainProject(app, testInfo.outputPath('accepted-worker-workspace'), 'Accepted worker');
      const task = await createSessionChainTask(app, project.workspaceId, 'accepted-worker-task', {
        objective: 'Produce and verify the worker artifact', target: 'accepted.txt', constraints: ['Preserve the coordinator'],
        acceptance: [{ id: 'file', description: 'Exact worker artifact', verification: { kind: 'file-sha256', path: 'accepted.txt', sha256: hash } },
          { id: 'owner', description: 'Existing verifier accepts the evidence', verification: { kind: 'owner-receipt', owner: 'evidence-verifier', requires: ['file'] } }],
      });
      const binding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', expectedRevision: 0,
        taskLedgerNodeIds: [task.contract.taskNodeId], environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore',
      });
      await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
        command: { action: 'claim', taskNodeId: task.contract.taskNodeId, sessionKey: project.sessionKey, requestId: 'accepted-worker-claim' } });
      const admitted = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'delegate', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', taskRef: task.contract.taskNodeId,
        expectedBindingRevision: binding.binding!.bindingRevision, expectedSessionGeneration: project.generation,
        task: 'Run ACCEPTED-WORKER-WRITE', idempotencyKey: 'accepted-worker-admission', backend: 'subagent',
        worker: { roleName: 'implementer', task: 'ACCEPTED-WORKER-WRITE', isolation: 'shared', writeSet: ['accepted.txt'] }, includeVerifier: false,
      });
      expect(admitted.success, admitted.error).toBe(true);
      const childKey = admitted.receipt!.children[0].childSessionKey!;
      evidence.project = project; evidence.task = task; evidence.admission = admitted; evidence.childKey = childKey;
      evidence.stage = 'worker-write';
      const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 45_000 });
      await expect.poll(() => readFile(target, 'utf8').catch(() => null), { timeout: 90_000 }).toBe(content);
      await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('ACCEPTED-WORKER-FINISHED'), { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => (await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      })).task.claim?.sessionKey, { timeout: 30_000 }).toBe(project.sessionKey);
      await rpc('chat.inject', { sessionKey: project.sessionKey, message: 'Read the worker acceptance', label: 'agent fixture' });
      evidence.uiSeed = { driven_by: 'agent', kind: 'injected-parent-message' };
      const page = await getStableWindow(app); await page.reload();
      await page.getByTestId('chat-session-activity-toggle').click();
      const activity = await hostInvoke<{ snapshot: SessionActivitySnapshot }>(app, 'sessionActivity', 'snapshot', {
        workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      });
      const worker = activity.snapshot.subagents.find(entry => entry.childSessionKey === childKey)!;
      await page.getByTestId(`session-activity-subagent-${worker.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`).click();
      const stage = page.getByTestId('workspace-subagent-panel').locator('[data-stage="acceptance"]');
      await expect(stage).toHaveAttribute('data-status', 'pending');
      await page.screenshot({ path: testInfo.outputPath('worker-awaiting-acceptance.png') });
      evidence.stage = 'owner-verification';
      const current = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
      const commands = [
        { action: 'verifyFile', credential: current.task.claim, criterionId: 'file', path: 'accepted.txt', expectedSha256: hash, candidate: hash },
        { action: 'submit', credential: current.task.claim, candidate: hash },
        { action: 'accept', credential: current.task.claim, candidate: hash },
      ];
      const receipts = [];
      for (const command of commands) {
        const result = await hostInvoke<{ success: boolean; result?: TaskView; error?: string }>(app, 'taskLedger', 'command', { workspaceId: project.workspaceId, command });
        expect(result.success, result.error).toBe(true); receipts.push({ command, result });
      }
      expect(receipts.at(-1)!.result.result!.contract.state).toBe('done');
      evidence.ownerVerification = { current, receipts, childOwner: await hostInvoke(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: childKey }) };
      await writeFile(testInfo.outputPath('worker-owner-receipts.json'), JSON.stringify(evidence.ownerVerification, null, 2));
      await page.getByTestId('workspace-subagent-refresh').click();
      evidence.ownerRefresh = { history: await hostInvoke(app, 'sessions', 'history', { sessionKey: childKey, expectedParentSessionKey: project.sessionKey }), task: await hostInvoke(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: childKey }) };
      await writeFile(testInfo.outputPath('worker-owner-refresh.json'), JSON.stringify(evidence.ownerRefresh, null, 2));
      await expect(stage).toHaveAttribute('data-status', 'accepted');
      await expect(page.getByTestId('workspace-subagent-panel').locator('[data-stage="verification"]')).toHaveAttribute('data-status', 'recorded');
      await expect(page.getByTestId('workspace-subagent-panel').locator('[data-stage="verification"]')).toHaveAttribute('data-recorded-criteria', '2');
      await expect(stage).toHaveText(/Accepted|已验收/);
      const readback = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: project.workspaceId });
      expect(readback.snapshot.nodes.find(node => node.id === task.contract.taskNodeId)?.status).toBe('done');
      const history = await hostInvoke(app, 'sessions', 'history', { sessionKey: childKey, expectedParentSessionKey: project.sessionKey });
      evidence.project = project; evidence.task = task; evidence.admission = admitted; evidence.childKey = childKey;
      evidence.artifact = { path: target, sha256: createHash('sha256').update(await readFile(target)).digest('hex') };
      evidence.acceptance = { current, receipts, readback, history, locales: [] };
      await page.screenshot({ path: testInfo.outputPath('worker-owner-accepted.png') });
      await app.evaluate((_electron, key) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<{ data?: Record<string, unknown> }>> })._invokeHandlers;
        const original = handlers.get('host:invoke')!;
        (globalThis as unknown as { workerCostOriginal: typeof original }).workerCostOriginal = original;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: { sessionKey?: string } }) => {
          const response = await original(event, request);
          return request.module === 'sessions' && request.action === 'history' && request.payload?.sessionKey === key && response.data
            ? { ...response, data: { ...response.data, costUsd: null } } : response;
        });
      }, childKey);
      evidence.costFault = { driven_by: 'agent', kind: 'null-cost-after-real-host-read' };
      evidence.stage = 'cost-unknown';
      await page.getByTestId('workspace-subagent-refresh').click();
      await expect(page.getByTestId('workspace-subagent-cost')).toHaveText(/Unknown|未知/);
      await expect(page.getByTestId('workspace-subagent-cost')).not.toHaveText(/\$0/);
      await expect(page.getByTestId('workspace-subagent-refresh')).toBeEnabled();
      await expect(stage).toHaveAttribute('data-status', 'accepted');
      await page.screenshot({ path: testInfo.outputPath('worker-cost-unknown.png') });
      const locales: Array<{ language: string; status: string; label: string }> = [];
      evidence.acceptance = { current, receipts, readback, history, locales };
      evidence.stage = 'locale-navigation-' + language;
      {
        const locale = JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`, 'utf8'));
        await page.getByTestId('sidebar-nav-settings').click();
        await page.getByTestId('settings-nav-general').click();
        await page.getByTestId('settings-language-select').click();
        const languageLabel = { en: 'English', zh: '中文', ja: '日本語', ru: 'Русский' }[language];
        await page.getByRole('option', { name: languageLabel, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect.poll(async () => (await hostInvoke<{ language: string }>(app, 'settings', 'getAll')).language).toBe(language);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await page.getByTestId('settings-back-button').click();
        await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
        await expect(page.getByTestId('project-coordinator-entry')).toBeVisible();
        const projectScope = page.locator('[data-project-workspace]');
        await expect(projectScope).toHaveAttribute('data-project-workspace', project.workspaceId);
        const draft = 'Keep the owner scope draft ' + language;
        await page.getByTestId('chat-composer-input').fill(draft);
        const children = page.getByTestId('session-family-children');
        await expect(children).toBeVisible();
        expect(await children.selectOption(childKey)).toEqual([childKey]);
        await expect(projectScope).toHaveAttribute('data-project-workspace', project.workspaceId);
        await expect(page.getByTestId('chat-composer-input')).toHaveValue(draft);
        const acceptedStage = page.getByTestId('workspace-subagent-panel').locator('[data-stage="acceptance"]');
        try { await expect(acceptedStage).toHaveAttribute('data-status', 'accepted'); }
        catch (error) {
          const readFailure = page.getByTestId('workspace-subagent-transcript-failed');
          if (!await readFailure.isVisible()) throw error;
          const history = await hostInvoke<{ success: boolean; sessionGeneration?: string; error?: string }>(app, 'sessions', 'history', {
            sessionKey: childKey, expectedParentSessionKey: project.sessionKey,
          });
          expect(history.success, history.error).toBe(true);
          expect(history.sessionGeneration).toBeTruthy();
          const owner = await hostInvoke<{ success: boolean; task: TaskView }>(app, 'taskLedger', 'sessionTask', {
            workspaceId: project.workspaceId, sessionKey: childKey, expectedSessionGeneration: history.sessionGeneration,
          });
          expect(owner.success).toBe(true);
          expect(owner.task.contract).toMatchObject({ taskNodeId: task.contract.taskNodeId, state: 'done' });
          evidence.navigationReadRecovery = { initialFailure: await readFailure.innerText(), history, owner,
            mainLog: await hostInvoke(app, 'logs', 'memory', { count: 100 }), driven_by: 'agent', actor: 'playwright-worker-acceptance' };
          await page.screenshot({ path: testInfo.outputPath(`worker-navigation-read-failed-${language}.png`) });
          await page.getByTestId('workspace-subagent-transcript-retry').click();
          await expect(acceptedStage).toHaveAttribute('data-status', 'accepted');
        }
        await expect(acceptedStage).toHaveText(locale.delegationStages.taskAcceptance.accepted);
        const verification = page.getByTestId('workspace-subagent-panel').locator('[data-stage="verification"]');
        await expect(verification).toHaveAttribute('data-recorded-criteria', '2');
        await expect(verification).toHaveAttribute('data-candidate', hash);
        await expect(verification).toHaveText(locale.delegationStages.verification.recorded.replace('{{count}}', '2').replace('{{total}}', '2'));
        await expect(page.getByTestId('workspace-subagent-cost')).toHaveText(locale.delegationStages.cost.replace('{{cost}}', locale.delegationStages.costUnknown));
        await page.screenshot({ path: testInfo.outputPath(`worker-owner-accepted-${language}.png`) });
        locales.push({ language, status: 'passed', label: locale.delegationStages.taskAcceptance.accepted });
      }
      evidence.project = project; evidence.task = task; evidence.admission = admitted; evidence.childKey = childKey;
      evidence.artifact = { path: target, sha256: createHash('sha256').update(await readFile(target)).digest('hex') };
      evidence.acceptance = { current, receipts, readback, history, locales }; evidence.status = 'passed';
    } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
    finally {
      evidence.providerLog = llm.log; await writeFile(testInfo.outputPath('worker-owner-acceptance.json'), JSON.stringify(evidence, null, 2));
      await app.evaluate(() => {
        const original = (globalThis as unknown as { workerCostOriginal?: (event: unknown, request: unknown) => unknown }).workerCostOriginal;
        if (original) {
          const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
          ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original);
        }
      }).catch(() => undefined);
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
      llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
    }
  });
}

test('a child writes under the canonical transfer while its parent turn remains active', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const target = testInfo.outputPath('active-parent-workspace', 'child.txt');
  let started = false, spawned = false, wrote = false, parentHeld = false, childHeld = false;
  let releaseParent = () => {}, releaseChild = () => {};
  const llm = await startScriptedLlm(async text => {
    if (text.includes('ACTIVE-PARENT-DELEGATE')) {
      if (!started) {
        started = true;
        return { toolCall: { id: 'active-parent-task', name: 'task_control', args: { action: 'start', requestId: 'active-parent-task',
          contract: { objective: 'Produce the delegated child artifact', target: 'child.txt', constraints: ['Preserve the parent turn'],
            acceptance: [{ id: 'child-artifact', description: 'Exact child output', verification: { kind: 'file-sha256',
              path: 'child.txt', sha256: createHash('sha256').update('active-parent child result\n').digest('hex') } }] } } } };
      }
      if (!spawned) {
        spawned = true;
        return { toolCall: { id: 'active-parent-spawn', name: 'sessions_spawn', args: {
          task: 'ACTIVE-CHILD-WRITE: write the assigned artifact.', mode: 'run', cleanup: 'keep',
        } } };
      }
      parentHeld = true;
      await new Promise<void>(resolve => { releaseParent = resolve; });
      return { text: 'ACTIVE-PARENT-FINISHED' };
    }
    if (text.includes('ACTIVE-CHILD-WRITE')) {
      if (!wrote) {
        wrote = true;
        return { toolCall: { id: 'active-child-write', name: 'write', args: { path: target, content: 'active-parent child result\n' } } };
      }
      childHeld = true;
      await new Promise<void>(resolve => { releaseChild = resolve; });
      return { text: 'ACTIVE-CHILD-FINISHED' };
    }
    return { text: 'Ready' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-active-parent-transfer', provider: 'local-scripted', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('active-parent-workspace'), 'Active parent');
    const receipt = await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      message: 'ACTIVE-PARENT-DELEGATE', idempotencyKey: 'active-parent-turn' });
    await expect.poll(() => parentHeld && childHeld, { timeout: 90_000 }).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('active-parent child result\n');
    const parent = await hostInvoke<{ session: { hasActiveRun: boolean } }>(app, 'gateway', 'rpc', {
      method: 'sessions.describe', params: { key: project.sessionKey }, timeoutMs: 30_000 });
    expect(parent.session.hasActiveRun).toBe(true);
    const sessions = await hostInvoke<{ sessions: Array<{ key: string; spawnedBy?: string }> }>(app, 'gateway', 'rpc', { method: 'sessions.list', params: {}, timeoutMs: 30_000 });
    const childKey = sessions.sessions.find(session => session.spawnedBy === project.sessionKey)!.key;
    const childOwner = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: childKey });
    expect(childOwner.task.claim?.sessionKey).toBe(childKey);
    evidence.project = project; evidence.receipt = receipt; evidence.parent = parent; evidence.child = { childKey, childOwner };
    releaseChild(); releaseParent();
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history',
      params: { sessionKey: project.sessionKey, limit: 100 }, timeoutMs: 30_000 })).includes('ACTIVE-PARENT-FINISHED'), { timeout: 45_000 }).toBe(true);
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    releaseChild(); releaseParent(); evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('active-parent-transfer.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
