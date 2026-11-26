import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { TaskView } from '../../shared/task-system/types';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

async function openLedger(page: Page, workspaceId: string, sessionKey: string) {
  await page.evaluate(({ workspaceId, sessionKey }) => {
    location.hash = `/task-ledger?workspaceId=${encodeURIComponent(workspaceId)}&sessionKey=${encodeURIComponent(sessionKey)}`;
  }, { workspaceId, sessionKey });
  await expect(page.getByTestId('managed-tasks')).toBeVisible();
}

async function holdHostReply(app: ElectronApplication, module: string, action: string, workspaceId: string, sessionKey?: string) {
  await app.evaluate((_electron, target) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
    const state = globalThis as unknown as { reviewOriginal: (event: unknown, request: unknown) => Promise<unknown>;
      reviewHeld: boolean; reviewDelivered: boolean; reviewRelease: () => void; reviewCalls: Array<{ workspaceId?: string; module?: string; action?: string }>; reviewReplies: unknown[] };
    state.reviewOriginal = handlers.get('host:invoke')!;
    state.reviewHeld = false;
    state.reviewDelivered = false;
    state.reviewCalls = [];
    state.reviewReplies = [];
    const held = new Promise<void>(resolve => { state.reviewRelease = resolve; });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: { workspaceId?: string; sessionKey?: string; method?: string; params?: { sessionKey?: string }; command?: { action?: string } } }) => {
      state.reviewCalls.push({ module: request.module, action: request.action, workspaceId: request.payload?.workspaceId });
      const response = await state.reviewOriginal(event, request);
      if ((request.module === 'taskLedger' && request.action === 'command') || (request.module === 'sessions' && request.action === 'handoffOperation')) state.reviewReplies.push(response);
      if (!state.reviewHeld && request.module === target.module && request.action === target.action
          && (target.sessionKey ? request.payload?.method === 'chat.history' && request.payload?.params?.sessionKey === target.sessionKey
            : request.payload?.workspaceId === target.workspaceId && (target.action === 'handoffOperation'
              ? Boolean((request.payload as Record<string, unknown>).operationId) && (request.payload as Record<string, unknown>).reconcile === true
                && ['accepted', 'sent'].includes((response as { data?: { operation?: { phase?: string } } }).data?.operation?.phase ?? '')
              : request.payload.command?.action === 'claim'))) {
        state.reviewHeld = true;
        await held;
        state.reviewDelivered = true;
      }
      return response;
    });
  }, { module, action, workspaceId, sessionKey });
}

async function releaseHostReply(app: ElectronApplication) {
  await app.evaluate(() => (globalThis as unknown as { reviewRelease: () => void }).reviewRelease());
}

async function restoreHost(app: ElectronApplication) {
  await app.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const state = globalThis as unknown as { reviewOriginal?: (event: unknown, request: unknown) => Promise<unknown>; reviewRelease?: () => void };
    state.reviewRelease?.();
    if (state.reviewOriginal) { ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', state.reviewOriginal); }
  }).catch(() => undefined);
}

async function refreshWorkspaceProfiles(page: Page) {
  const assets = await readdir(resolve('dist/assets'));
  let workspaceAsset = '';
  for (const asset of assets.filter(value => value.endsWith('.js'))) {
    if (/fetchWorkspaces\s*:\s*async/.test(await readFile(resolve('dist/assets', asset), 'utf8'))) { workspaceAsset = asset; break; }
  }
  expect(workspaceAsset).toBeTruthy();
  await page.evaluate(async asset => {
    const module = await import(new URL(`assets/${asset}`, location.href).href);
    const store = Object.values(module).find(value => typeof value === 'function' && typeof (value as { getState?: unknown }).getState === 'function'
      && typeof (value as unknown as { getState: () => { fetchWorkspaces?: unknown } }).getState().fetchWorkspaces === 'function') as {
        getState: () => { fetchWorkspaces: () => Promise<void> };
      };
    if (!store) throw new Error('The built Workspace store export is unavailable');
    await store.getState().fetchWorkspaces();
  }, workspaceAsset);
}

test('cancels an active model, restores its task identity, reads a fork and resumes through the agent', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  let started = false, held = false;
  let release = () => {};
  const llm = await startScriptedLlm(async (text, results) => {
    if (text.includes('REVIEW-READ-HISTORY')) {
      if (!results.historyquery) return { toolCall: { id: 'historyquery', name: 'sessions_history', args: { sessionKey: readerSession, limit: 5 } } };
      return { text: 'HISTORY-READ-FINISHED' };
    }
    if (text.includes('REVIEW-RESUME-TASK')) {
      if (!results.resumetask) return { toolCall: { id: 'resumetask', name: 'task_control', args: { action: 'resume' } } };
      if (!results.resumewrite) return { toolCall: { id: 'resumewrite', name: 'write', args: { path: resumePath, content: 'resumed-through-agent\n' } } };
      return { text: 'RESUME-WRITE-FINISHED' };
    }
    if (text.includes('REVIEW-CANCEL-MODEL')) {
      if (!started) {
        started = true;
        return { toolCall: { id: 'start-cancel', name: 'task_control', args: { action: 'start', requestId: 'review-cancel', taskNodeId: cancellationTaskId } } };
      }
      held = true;
      await new Promise<void>(resolve => { release = resolve; });
      return { text: 'Cancelled model released by fixture' };
    }
    return { text: 'Local provider ready' };
  });
  let projectSession = '';
  let readerSession = '';
  let cancellationTaskId = '';
  const resumePath = info.outputPath('sdk-workspace', 'resumed.txt');
  const app = await launchElectronApp({ skipSetup: true });
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'session-task-fixes-electron', provider: 'local-scripted', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, info.outputPath('sdk-workspace'), 'Review runtime');
    projectSession = project.sessionKey;
    const cancellationTask = await createSessionChainTask(app, project.workspaceId, 'cancel-contract', {
      objective: 'Review model cancellation', target: 'cancel.txt', constraints: [],
      acceptance: [{ id: 'file', description: 'Expected file', verification: { kind: 'file-sha256', path: 'cancel.txt', sha256: '0'.repeat(64) } }] });
    cancellationTaskId = cancellationTask.contract.taskNodeId;
    await hostInvoke(app, 'workspaces', 'bindCoordinator', { workspaceId: project.workspaceId, sessionKey: projectSession,
      agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [cancellationTaskId], environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore' });
    const page = await getStableWindow(app);
    await page.reload();
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: projectSession,
      expectedSessionGeneration: project.generation, message: 'REVIEW-CANCEL-MODEL', idempotencyKey: 'review-cancel-turn' });
    await expect.poll(() => held, { timeout: 60_000 }).toBe(true);
    const active = await hostInvoke<{ tasks: TaskView[] }>(app, 'taskLedger', 'managedTasks', { workspaceId: project.workspaceId });
    evidence.activeBeforeCancel = active;
    const gitAfterBootstrap = await hostInvoke<{ success: boolean; status: { isRepository: boolean } }>(app, 'git', 'status', {});
    evidence.gitAfterBootstrap = gitAfterBootstrap;
    expect(gitAfterBootstrap.status.isRepository).toBe(false);
    expect(active.tasks.find(task => task.contract.taskNodeId === cancellationTaskId)).toMatchObject({ contract: { state: 'doing' }, claim: { state: 'active', generation: project.generation } });
    await holdHostReply(app, 'observe', 'observe', project.workspaceId);
    await openLedger(page, project.workspaceId, projectSession);
    const cancellingTask = page.getByTestId('managed-task').filter({ hasText: 'Review model cancellation' });
    await cancellingTask.getByTestId('managed-task-details').locator('summary').click();
    await cancellingTask.getByRole('button', { name: 'Cancel task', exact: true }).click();
    await expect(cancellingTask).toContainText('Cancelled');
    await expect.poll(async () => {
      const current = await hostInvoke<{ session: { hasActiveRun: boolean; sessionId: string } }>(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: projectSession } });
      return current.session.sessionId === project.generation && current.session.hasActiveRun === false;
    }, { timeout: 15_000 }).toBe(true);
    const stopped = await hostInvoke<{ session: { hasActiveRun: boolean; sessionId: string } }>(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: projectSession } });
    expect(stopped.session.hasActiveRun).toBe(false);
    expect(stopped.session.sessionId).toBe(project.generation);
    release();
    evidence.cancel = stopped;

    const bytes = 'resumed-through-agent\n';
    const task = await createSessionChainTask(app, project.workspaceId, 'restore-goal', { objective: 'Review restored agent execution', target: 'resumed.txt', constraints: [],
      acceptance: [{ id: 'file', description: 'Resumed artifact', verification: { kind: 'file-sha256', path: 'resumed.txt', sha256: createHash('sha256').update(bytes).digest('hex') } }] });
    const claimed = await hostInvoke<{ success: boolean; result: TaskView }>(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'claim', taskNodeId: task.contract.taskNodeId, sessionKey: projectSession, requestId: 'restore-claim' } });
    expect(claimed.success).toBe(true);
    const archived = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'archive', { id: projectSession, originalWorkspaceId: project.workspaceId });
    evidence.archiveReceipt = archived;
    expect(archived.success, archived.error).toBe(true);
    const restoreReceipt = await hostInvoke<{ success: boolean; error?: string }>(app, 'sessions', 'restore', { id: projectSession });
    evidence.restoreReceipt = restoreReceipt;
    expect(restoreReceipt.success, restoreReceipt.error).toBe(true);
    const described = await hostInvoke<{ session: { sessionId: string } }>(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: projectSession } });
    expect(described.session.sessionId).not.toBe(project.generation);
    const restored = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId,
      sessionKey: projectSession, expectedSessionGeneration: described.session.sessionId });
    expect(restored.task.contract.taskNodeId).toBe(task.contract.taskNodeId);
    expect(restored.task.claim?.generation).toBe(described.session.sessionId);
    const stale = await hostInvoke<{ success: boolean }>(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'renew', credential: claimed.result.claim } });
    expect(stale.success).toBe(false);
    await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId, command: { action: 'pause', credential: restored.task.claim } });

    const fork = await hostInvoke<{ sessionKey: string }>(app, 'sessions', 'fork', { workspaceId: project.workspaceId, sessionKey: projectSession });
    readerSession = fork.sessionKey;
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: fork.sessionKey,
      message: 'REVIEW-READ-HISTORY', idempotencyKey: 'review-reader-turn' });
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: fork.sessionKey, limit: 50 } })).includes('HISTORY-READ-FINISHED'), { timeout: 60_000 }).toBe(true);
    const historyResult = llm.log.find(entry => entry.toolResults.historyquery)?.toolResults.historyquery;
    expect(historyResult).toBeTruthy();
    const historyData = JSON.parse(historyResult ?? '{}') as { sessionKey: string; messages: unknown[] };
    expect(historyData.sessionKey).toBe(readerSession);
    expect(Array.isArray(historyData.messages)).toBe(true);
    evidence.historyResult = historyResult;
    const reader = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: fork.sessionKey });
    expect(reader.task.referenceOnly).toBe(true);
    expect(reader.task.claim?.sessionKey).toBe(projectSession);
    expect(reader.task.claim?.state).toBe('paused');
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: projectSession,
      expectedSessionGeneration: described.session.sessionId, message: 'REVIEW-RESUME-TASK', idempotencyKey: 'review-resume-turn' });
    await expect.poll(async () => readFile(resumePath, 'utf8').catch(() => ''), { timeout: 60_000 }).toBe(bytes);
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: projectSession, limit: 50 } })).includes('RESUME-WRITE-FINISHED'), { timeout: 60_000 }).toBe(true);
    evidence.restore = restored;
    evidence.reader = reader;
    evidence.status = 'passed';
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error);
    const page = await getStableWindow(app).catch(() => null);
    evidence.page = page ? await page.locator('body').innerText().catch(() => 'unavailable') : 'unavailable';
    throw error;
  }
  finally {
    release();
    evidence.providerLog = llm.log;
    evidence.responses = await app.evaluate(() => (globalThis as unknown as { reviewReplies?: unknown[] }).reviewReplies ?? []).catch(() => []);
    await writeFile(info.outputPath('runtime-session-task-fixes.json'), JSON.stringify(evidence, null, 2));
    await restoreHost(app);
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});

for (const { editTarget, remount, stayTarget, name } of [
  { editTarget: false, remount: false, stayTarget: false, name: 'without restoring its sent target draft' },
  { editTarget: true, remount: true, stayTarget: false, name: 'while retaining a new same-text target draft' },
  { editTarget: false, remount: true, stayTarget: true, name: 'while synchronizing an unedited remounted target' },
]) {
  test(`acknowledges a background handoff ${name}`, async ({ launchElectronApp }, info) => {
    test.setTimeout(300_000);
    const llm = await startScriptedLlm(text => ({ text: text.includes('REVIEW-HANDOFF-SCOPE')
      ? 'HANDOFF-TARGET-ANSWER-FINISHED' : 'HANDOFF-SCOPE-ANSWER-FINISHED' }));
    const app = await launchElectronApp({ skipSetup: true });
    const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'session-task-fixes-electron', provider: 'local-scripted', editTarget, remount, stayTarget, status: 'running' };
    try {
      await configureSessionChainProvider(app, llm.port);
      const project = await createSessionChainProject(app, info.outputPath('handoff-workspace'), 'Review handoff scope');
      await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
        expectedSessionGeneration: project.generation, message: 'Source session for handoff scope', idempotencyKey: 'review-handoff-source' });
      await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: project.sessionKey, limit: 50 } })).includes('HANDOFF-SCOPE-ANSWER-FINISHED'), { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => (await hostInvoke<{ session: { hasActiveRun: boolean } }>(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: project.sessionKey } })).session.hasActiveRun).toBe(false);
      const selected = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'Handoff scope C' } });
      await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: selected.key, state: { draftInput: 'C original draft' } });
      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-session-handoff')).toBeEnabled();
      await page.getByTestId('chat-session-handoff').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      const sentDraft = 'REVIEW-HANDOFF-SCOPE: continue the recorded source';
      await page.getByTestId('chat-handoff-draft').fill(sentDraft);
      await holdHostReply(app, 'sessions', 'handoffOperation', project.workspaceId);
      await page.getByTestId('chat-handoff-create').click();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld), { timeout: 60_000 }).toBe(true);
      const snapshot = await hostInvoke<{ activeWorkspace: { activeSessionKey: string } }>(app, 'workspaces', 'list');
      const targetSessionKey = snapshot.activeWorkspace.activeSessionKey;
      expect(targetSessionKey).not.toBe(project.sessionKey);
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(sentDraft);
      if (remount) {
        await page.evaluate(() => { location.hash = '/settings'; });
        await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);
        await page.goBack();
        await expect(page.getByTestId('chat-composer-input')).toHaveValue(sentDraft);
      }
      if (editTarget) {
        await page.getByTestId('chat-composer-input').fill('');
        await page.getByTestId('chat-composer-input').fill(sentDraft);
      }
      if (!stayTarget) {
        await page.getByTestId(`sidebar-session-drag-${selected.key}`).click();
        await expect(page.getByTestId('chat-composer-input')).toHaveValue('C original draft');
        await page.getByTestId('chat-composer-input').fill('C edited while handoff settles');
      }
      await releaseHostReply(app);
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewDelivered: boolean }).reviewDelivered)).toBe(true);
      const expectedDraft = editTarget ? sentDraft : '';
      await expect.poll(async () => (await hostInvoke<{ activeWorkspace: { sessionStates: Record<string, { draftInput?: string }> } }>(app, 'workspaces', 'list')).activeWorkspace.sessionStates[targetSessionKey]?.draftInput).toBe(expectedDraft);
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(stayTarget ? expectedDraft : 'C edited while handoff settles');
      if (!stayTarget) await page.getByTestId(`sidebar-session-drag-${targetSessionKey}`).click();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(expectedDraft);
      if (stayTarget) {
        await page.evaluate(() => { location.hash = '/settings'; });
        await expect(page.getByTestId('chat-composer-input')).toHaveCount(0);
        await page.goBack();
        await expect(page.getByTestId('chat-composer-input')).toHaveValue(expectedDraft);
      }
      await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: targetSessionKey, limit: 50 } })).includes('HANDOFF-TARGET-ANSWER-FINISHED'), { timeout: 60_000 }).toBe(true);
      const history = await hostInvoke<{ messages: Array<{ role: string; content: unknown }> }>(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: targetSessionKey, limit: 50 } });
      expect(history.messages.filter(message => message.role === 'user' && JSON.stringify(message.content).includes(sentDraft))).toHaveLength(1);
      if (stayTarget) {
        await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: targetSessionKey, state: { draftInput: 'Draft restored by the profile owner' } });
        await refreshWorkspaceProfiles(page);
        await page.getByTestId(`sidebar-session-drag-${selected.key}`).click();
        await page.getByTestId(`sidebar-session-drag-${targetSessionKey}`).click();
        await expect(page.getByTestId('chat-composer-input')).toHaveValue('Draft restored by the profile owner');
        evidence.restoredOwnerDraft = await page.getByTestId('chat-composer-input').inputValue();
      }
      if (editTarget) {
        await page.getByTestId('chat-composer-input').fill('');
        await expect.poll(async () => (await hostInvoke<{ activeWorkspace: { sessionStates: Record<string, { draftInput?: string }> } }>(app, 'workspaces', 'list')).activeWorkspace.sessionStates[targetSessionKey]?.draftInput).toBe('');
        await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: targetSessionKey, state: { draftInput: 'Owner draft after manual clearing' } });
        await refreshWorkspaceProfiles(page);
        await expect(page.getByTestId('chat-composer-input')).toHaveValue('Owner draft after manual clearing');
        evidence.ownerDraftAfterManualClear = await page.getByTestId('chat-composer-input').inputValue();
      }
      evidence.targetSessionKey = targetSessionKey;
      evidence.selectedSessionKey = selected.key;
      evidence.targetDraft = await page.getByTestId('chat-composer-input').inputValue();
      evidence.history = history;
      evidence.status = 'passed';
    } catch (error) {
      evidence.status = 'failed'; evidence.error = String(error);
      throw error;
    } finally {
      evidence.providerLog = llm.log;
      evidence.responses = await app.evaluate(() => (globalThis as unknown as { reviewReplies?: unknown[] }).reviewReplies ?? []).catch(() => []);
      await writeFile(info.outputPath('handoff-draft-scope.json'), JSON.stringify(evidence, null, 2));
      await restoreHost(app);
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
      await closeElectronApp(app);
      llm.server.closeAllConnections();
      await new Promise<void>(resolve => llm.server.close(() => resolve()));
    }
  });
}

test('keeps the new workspace list after an old real claim response arrives', async ({ launchElectronApp }, info) => {
  test.setTimeout(240_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const first = await createSessionChainProject(app, info.outputPath('workspace-a'), 'Review Alpha');
    const second = await createSessionChainProject(app, info.outputPath('workspace-b'), 'Review Beta');
    const make = (objective: string) => ({ objective, target: '.', constraints: [],
      acceptance: [{ id: 'owner', description: 'Owner evidence', verification: { kind: 'owner-receipt' as const, owner: 'agent-fixture' } }] });
    const taskA = await createSessionChainTask(app, first.workspaceId, 'alpha-task', make('Alpha delayed task'));
    await createSessionChainTask(app, second.workspaceId, 'beta-task', make('Beta current task'));
    await hostInvoke(app, 'workspaces', 'switch', { id: first.workspaceId });
    await hostInvoke(app, 'workspaces', 'bindCoordinator', { workspaceId: first.workspaceId, sessionKey: first.sessionKey,
      agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [taskA.contract.taskNodeId],
      environment: { kind: 'local', rootPath: first.rootPath }, archiveRestorePolicy: 'restore' });
    const page = await getStableWindow(app);
    await holdHostReply(app, 'taskLedger', 'command', first.workspaceId);
    await openLedger(page, first.workspaceId, first.sessionKey);
    const alpha = page.getByTestId('managed-task').filter({ hasText: 'Alpha delayed task' });
    await alpha.getByTestId('managed-task-details').locator('summary').click();
    await alpha.getByRole('button', { name: 'Claim for this session' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
    await openLedger(page, second.workspaceId, second.sessionKey);
    await expect(page.getByTestId('managed-task')).toContainText('Beta current task');
    await releaseHostReply(app);
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewDelivered: boolean }).reviewDelivered)).toBe(true);
    await page.waitForTimeout(200);
    await expect(page.getByTestId('managed-task')).toContainText('Beta current task');
    await expect(page.getByTestId('managed-task').filter({ hasText: 'Alpha delayed task' })).toHaveCount(0);
    const calls = await app.evaluate(() => (globalThis as unknown as { reviewCalls: unknown[] }).reviewCalls);
    await writeFile(info.outputPath('workspace-response-fencing.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-task-fixes-electron', first, second, calls, status: 'passed' }, null, 2));
  } finally { await restoreHost(app); await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app); }
});

test('keeps C and its draft while a send to B is waiting for real history', async ({ launchElectronApp }, info) => {
  test.setTimeout(240_000);
  const llm = await startScriptedLlm(() => ({ text: 'NAV-B-ANSWER-FINISHED' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, info.outputPath('navigation-workspace'), 'Review navigation');
    const sessions = [] as Array<{ key: string; sessionId: string }>;
    for (const label of ['Nav B', 'Nav C']) {
      const created = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label } });
      await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: created.key, state: { draftInput: '' } });
      sessions.push(created);
    }
    const [target, selected] = sessions;
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    const assets = await readdir(resolve('dist/assets'));
    let chatAsset = '';
    for (const asset of assets.filter(value => value.endsWith('.js'))) {
      if (/sendMessage\s*:\s*async/.test(await readFile(resolve('dist/assets', asset), 'utf8'))) { chatAsset = asset; break; }
    }
    expect(chatAsset).toBeTruthy();
    await holdHostReply(app, 'gateway', 'rpc', project.workspaceId, target.key);
    await page.evaluate(async ({ chatAsset, project, target }) => {
      const module = await import(new URL(`assets/${chatAsset}`, location.href).href);
      const store = Object.values(module).find(value => typeof value === 'function' && typeof (value as { getState?: unknown }).getState === 'function'
        && typeof (value as unknown as { getState: () => { sendMessage?: unknown } }).getState().sendMessage === 'function') as {
          getState: () => { sendMessage: (text: string, options: unknown) => Promise<void>; currentSessionKey: string; messages: Array<{ content?: unknown }>; sending: boolean };
        };
      if (!store) throw new Error('The built Chat store export is unavailable');
      const state = window as unknown as { reviewChatStore: typeof store; reviewSend: Promise<void> };
      state.reviewChatStore = store;
      state.reviewSend = store.getState().sendMessage('REVIEW-NAV-B', { workspaceId: project.workspaceId, targetSessionKey: target.key, expectedSessionGeneration: target.sessionId });
    }, { chatAsset, project, target });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { reviewHeld: boolean }).reviewHeld)).toBe(true);
    await page.getByTestId(`sidebar-session-drag-${selected.key}`).click();
    await expect.poll(() => page.evaluate(key => {
      const state = (window as unknown as { reviewChatStore: { getState: () => { currentSessionKey: string; loading: boolean } } }).reviewChatStore.getState();
      return state.currentSessionKey === key && !state.loading;
    }, selected.key)).toBe(true);
    await expect.poll(async () => {
      const snapshot = await hostInvoke<{ activeWorkspace: { activeSessionKey: string } }>(app, 'workspaces', 'list');
      return snapshot.activeWorkspace.activeSessionKey;
    }).toBe(selected.key);
    await page.getByTestId('chat-composer-input').fill('C draft remains');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('C draft remains');
    await releaseHostReply(app);
    const result = await page.evaluate(async () => {
      const state = window as unknown as { reviewSend: Promise<void>; reviewChatStore: { getState: () => { currentSessionKey: string; messages: Array<{ content?: unknown }>; sending: boolean } } };
      await state.reviewSend;
      const snapshot = state.reviewChatStore.getState();
      return { key: snapshot.currentSessionKey, messages: snapshot.messages.map(message => message.content), sending: snapshot.sending };
    });
    expect(result.key).toBe(selected.key);
    expect(result.messages).not.toContain('REVIEW-NAV-B');
    expect(result.sending).toBe(false);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('C draft remains');
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: target.key, limit: 50 } })).includes('NAV-B-ANSWER-FINISHED'), { timeout: 60_000 }).toBe(true);
    await page.getByTestId('chat-composer-permission-mode').click();
    await page.getByTestId('chat-composer-new-session').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as {
      reviewChatStore: { getState: () => { currentSessionKey: string } };
    }).reviewChatStore.getState().currentSessionKey)).not.toBe(selected.key);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
    await page.getByTestId(`sidebar-session-drag-${selected.key}`).click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('C draft remains');
    await writeFile(info.outputPath('history-send-fencing.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-task-fixes-electron', result, project, target, selected, sourceDraftAfterNewSession: 'C draft remains', status: 'passed' }, null, 2));
  } finally {
    await restoreHost(app);
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
