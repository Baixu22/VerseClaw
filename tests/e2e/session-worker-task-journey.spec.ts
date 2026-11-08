import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { TaskContractInput, TaskView } from '../../shared/task-system/types';
import type { SessionDelegationResult, WorkspaceCoordinatorBindingResult } from '../../shared/host-api/contract';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import type { SessionActivitySnapshot } from '../../shared/types/session-activity';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask, observeSessionUi } from './fixtures/session-task-chain';

test('a real delegated worker receives its own task, reports separately and accepts a scoped follow-up', async ({ launchElectronApp }, testInfo) => {
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
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-worker-task', provider: 'local-scripted', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const assistants = await hostInvoke<{ agents: Array<{ id: string; name: string }> }>(app, 'agents', 'create', {
      name: 'Independent coordinator', inheritWorkspace: true,
    });
    const secondAgent = assistants.agents.find((agent) => agent.name === 'Independent coordinator')!;
    expect(secondAgent).toBeTruthy();
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
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: childKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);
    const followup = await hostInvoke(app, 'sessions', 'sendWorker', { workspaceId: project.workspaceId, parentSessionKey: project.sessionKey,
      expectedParentGeneration: project.generation, childSessionKey: childKey, expectedChildGeneration: described.session.sessionId,
      message: 'WORKER-FOLLOWUP', idempotencyKey: 'worker-followup-1', mode: 'send' });
    expect(followup).toMatchObject({ success: true, phase: 'accepted' });
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('WORKER-FOLLOWUP-RECORDED'), { timeout: 60_000 }).toBe(true);
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
    await expect(page.getByTestId('workspace-subagent-panel').locator('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
    await expect(page.getByTestId('workspace-subagent-model')).toContainText((history as { model: string }).model);
    await page.getByTestId('workspace-subagent-dispatch-input').fill('WORKER-FOLLOWUP-UI');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Accepted|已接收/);
    await expect(page.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('WORKER-FOLLOWUP-UI'), { timeout: 60_000 }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('worker-lifecycle.png') });

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
    await page.getByTestId(`sidebar-session-${project.sessionKey}`).click();
    if (!(await page.getByTestId('workspace-subagent-panel').isVisible())) {
      await activityButton.click();
    }
    await page.getByTestId('session-family-children').selectOption(childKey);
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-RUN-FINISHED');
    evidence.taskNavigation = { rootId, taskId: task.id, workerLink, artifact: target };

    const loop = await rpc<{ loop: { taskLedgerRootId: string; status: string } }>('task_loop.run', {
      task: 'Read the existing worker transcript and return a short summary.', sessionKey: childKey, agentId: 'main',
      workspaceId: project.workspaceId, maxWorkers: 1, includeVerifier: false });
    expect(loop.loop.taskLedgerRootId).toBeTruthy();
    evidence.loopBootstrap = loop;
    await page.getByTestId('workspace-subagent-refresh').click();
    await expect(page.getByTestId('workspace-subagent-panel')).toContainText('WORKER-RUN-FINISHED');
    holdNext = true;
    await page.getByTestId('workspace-subagent-dispatch-input').fill('WORKER-HOLD: keep this model turn open for receipt validation.');
    await page.getByTestId('workspace-subagent-dispatch').click();
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
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/unknown|未知/);
    await expect(page.getByTestId('workspace-subagent-dispatch')).toBeDisabled();
    const lostAck = await app.evaluate(() => (globalThis as unknown as { workerLostAck: {
      request: { payload: { idempotencyKey: string } }; result: { data: { phase: string } } } }).workerLostAck);
    expect(lostAck.result.data.phase).toBe('queued');
    const delivery = await hostInvoke<{ workerSendReceipt?: { phase: string; idempotencyKey: string; source: string } }>(app, 'sessions', 'history', {
      sessionKey: childKey, expectedParentSessionKey: project.sessionKey, expectedSessionGeneration: described.session.sessionId,
      workerSendIdempotencyKey: lostAck.request.payload.idempotencyKey });
    expect(delivery.workerSendReceipt).toMatchObject({ phase: 'queued', source: 'runtime-intervention', idempotencyKey: lostAck.request.payload.idempotencyKey });
    await page.getByTestId('workspace-subagent-refresh').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Queued|排队/);
    await expect(page.getByTestId('workspace-subagent-dispatch-input')).toHaveValue('');
    await page.screenshot({ path: testInfo.outputPath('worker-queue-reconciled.png') });
    await page.getByTestId('workspace-subagent-dispatch-input').fill('btw WORKER-GUIDE use the already recorded evidence.');
    await page.getByTestId('workspace-subagent-dispatch').click();
    await expect(page.getByTestId('worker-send-phase')).toHaveText(/Guidance accepted|Steered|引导/);
    const guide = await rpc<{ events: Array<{ status: string; payload?: { message?: string } }> }>('sessions.longTaskControlHistory', { key: childKey, limit: 200 });
    expect(guide.events.some((entry) => entry.status === 'steered' && entry.payload?.message === 'btw WORKER-GUIDE use the already recorded evidence.')).toBe(true);
    evidence.intervention = { driven_by: 'agent', actor: 'playwright-worker-task', fault: 'simulated-ack-loss-after-real-queue', lostAck, delivery, guide };
    releaseHold();
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: childKey, limit: 100 })).includes('later WORKER-QUEUED'), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: childKey })).session.hasActiveRun, { timeout: 30_000 }).toBe(false);

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
    evidence.multiCoordinator = { secondAgent, second, secondTask, readOnly, observerOwnerBefore, observerDuringRun,
      firstOrigin, secondOrigin, crossed, currentProject };
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error);
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
    evidence.providerLog = llm.log;
    evidence.hostCalls = await getAgentDevHostCalls(await getStableWindow(app)).catch(String);
    await writeFile(testInfo.outputPath('worker-task-journey.json'), JSON.stringify(evidence, null, 2));
    await captureUi((name) => testInfo.outputPath(name));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});

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
