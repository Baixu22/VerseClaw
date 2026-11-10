import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ElectronApplication } from '@playwright/test';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import type { SessionCreateHandoffResult } from '../../shared/host-api/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { loseNextHandoffCreationResponse, failNextHandoffAcknowledgementWrite } from './fixtures/session-task-chain';
import type { SessionHandoffOperation } from '../../shared/types/session-handoff';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';
import type { TaskView } from '../../shared/task-system/types';

test('a real isolated schedule admits its first write without replacing the project coordinator', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const target = testInfo.outputPath('scheduled-workspace', 'scheduled.txt');
  let issued = false;
  let started = false;
  const llm = await startScriptedLlm((text) => {
    if (text.includes('A4-SCHEDULED-EFFECT') && !started) {
      started = true;
      return { toolCall: { id: 'scheduled-task-start', name: 'task_control', args: { action: 'start', requestId: 'scheduled-task-start',
        contract: { objective: 'Write the scheduled result', target: 'scheduled.txt', constraints: ['Keep the project coordinator'],
          acceptance: [{ id: 'scheduled-artifact', description: 'Exact scheduled output', verification: {
            kind: 'file-sha256', path: 'scheduled.txt', sha256: createHash('sha256').update('agent-driven scheduled effect\n').digest('hex'),
          } }] } } } };
    }
    if (text.includes('A4-SCHEDULED-EFFECT') && !issued) {
      issued = true;
      return { toolCall: { id: 'scheduled-write', name: 'write', args: { path: target, content: 'agent-driven scheduled effect\n' } } };
    }
    return { text: 'Scheduled effect finished.' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-scheduled-task-scope', provider: 'local-scripted', status: 'running' };
  const captureWorkspaceConfig = async (stage: string) => {
    const profiles = await hostInvoke(app, 'workspaces', 'list');
    const config = await app.evaluate(async ({ app }) => {
      const modules = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports?: { readOpenClawConfig?: () => Promise<Record<string, unknown>> } }>;
      const owner = modules.find(module => typeof module.exports?.readOpenClawConfig === 'function');
      const raw = await owner?.exports?.readOpenClawConfig?.();
      const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
      const path = process.mainModule!.require('node:path') as typeof import('node:path');
      const isolatedPath = path.join(app.getPath('userData'), 'openclaw-source-state', 'openclaw.json');
      const select = (value: Record<string, unknown> | undefined) => {
        const agents = value?.agents as { defaults?: { workspace?: string }; list?: Array<{ id?: string; workspace?: string; default?: boolean }> } | undefined;
        return { defaultWorkspace: agents?.defaults?.workspace, agents: agents?.list?.map(({ id, workspace, default: isDefault }) => ({ id, workspace, default: isDefault })) };
      };
      return { userData: app.getPath('userData'), mainOwnerAvailable: Boolean(owner), main: raw ? select(raw) : null, isolatedPath,
        isolated: fs.existsSync(isolatedPath) ? select(JSON.parse(fs.readFileSync(isolatedPath, 'utf8'))) : null };
    });
    ((evidence.workspaceConfig ??= []) as unknown[]).push({ stage, profiles, config });
    await writeFile(testInfo.outputPath('scheduled-task-scope.json'), JSON.stringify(evidence, null, 2));
  };
  try {
    await getStableWindow(app);
    await configureSessionChainProvider(app, llm.port);
    await captureWorkspaceConfig('after-provider');
    const project = await createSessionChainProject(app, testInfo.outputPath('scheduled-workspace'), 'Scheduled project');
    await captureWorkspaceConfig('after-project-start');
    const job = await hostInvoke<{ id: string }>(app, 'cron', 'create', { name: 'Agent schedule acceptance', agentId: 'main',
      schedule: '0 0 1 1 *', enabled: false, message: 'A4-SCHEDULED-EFFECT: write the assigned result.', delivery: { mode: 'none' } });
    const trigger = await hostInvoke(app, 'cron', 'trigger', { id: job.id });
    await expect.poll(() => readFile(target, 'utf8').catch(() => null), { timeout: 90_000 }).toBe('agent-driven scheduled effect\n');
    const ledger = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: project.workspaceId });
    const tasks = ledger.snapshot.nodes.filter((node) => node.kind === 'task');
    expect(tasks).toHaveLength(1);
    const workspaces = await hostInvoke<{ profiles: WorkspaceProfile[] }>(app, 'workspaces', 'list');
    const profile = workspaces.profiles.find((entry) => entry.id === project.workspaceId)!;
    const binding = Object.values(profile.coordinatorBindings ?? {}).find((entry) => entry.writerClaim?.taskNodeId === tasks[0].id);
    expect(binding).toBeDefined();
    expect(binding!.sessionKey).not.toBe(project.sessionKey);
    expect(profile.projectCoordinatorSessionKey).toBe(project.sessionKey);
    expect(profile.activeSessionKey).toBe(project.sessionKey);
    expect(llm.log.filter((entry) => entry.issued === 'scheduled-write')).toHaveLength(1);
    expect(llm.anomalies).toEqual([]);
    Object.assign(evidence, { status: 'passed', project, job, trigger, binding, snapshot: ledger.snapshot, providerLog: llm.log });
    await hostInvoke(app, 'cron', 'delete', { id: job.id });
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    evidence.providerLog = llm.log;
    await writeFile(testInfo.outputPath('scheduled-task-scope.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});

test('real Gateway keeps discussion empty, admits one write, and restores the same handoff child after restart', async ({ launchElectronApp, userDataDir }, testInfo) => {
  test.setTimeout(420_000);
  const rootPath = testInfo.outputPath('workspace');
  await mkdir(rootPath, { recursive: true });
  const target = `${rootPath}/admitted.txt`;
  let issuedWrite = false;
  let issuedContinueWrite = false;
  let startedTask = false;
  const llm = await startScriptedLlm((text) => {
    if (text.includes('A4-EXECUTE') && !startedTask) {
      startedTask = true;
      return { toolCall: { id: 'a4-task-start', name: 'task_control', args: { action: 'start', requestId: 'a4-task-start',
        contract: { objective: 'Write the approved execution artifact', target: 'admitted.txt', constraints: ['Preserve conversation history'],
          acceptance: [{ id: 'admitted-artifact', description: 'Exact approved bytes', verification: {
            kind: 'file-sha256', path: 'admitted.txt', sha256: createHash('sha256').update('agent-driven admitted write\n').digest('hex'),
          } }] } } } };
    }
    if (text.includes('A4-EXECUTE') && !issuedWrite) {
      issuedWrite = true;
      return { toolCall: { id: 'a4-write', name: 'write', args: { path: target, content: 'agent-driven admitted write\n' } } };
    }
    if (text.includes('A4-CONTINUE') && !issuedContinueWrite) {
      issuedContinueWrite = true;
      return { toolCall: { id: 'a4-continue-write', name: 'write', args: { path: target, content: 'agent-driven admitted write\n' } } };
    }
    const marker = [...text.matchAll(/A4-(?:DISCUSS-\d+|EXECUTE|CONTINUE|HANDOFF)/g)].at(-1)?.[0] ?? 'DONE';
    return { text: `FINISHED ${marker}` };
  });
  let app: ElectronApplication | undefined;
  const observations: Record<string, unknown> = { driven_by: 'agent', actor: 'codex-session-task-chain', provider: 'local-scripted', status: 'running' };
  const record = async (key: string, value: unknown) => {
    observations[key] = value;
    await writeFile(testInfo.outputPath('session-task-runtime.json'), JSON.stringify(observations, null, 2));
  };
  try {
    app = await launchElectronApp({ skipSetup: true });
    await getStableWindow(app);
    await hostInvoke(app, 'gateway', 'stop');
    const now = new Date().toISOString();
    await hostInvoke(app, 'providers', 'save', {
      config: { id: 'task-scope-fixture', name: 'Agent task fixture', type: 'custom', baseUrl: `http://127.0.0.1:${llm.port}/v1`,
        apiProtocol: 'openai-completions', model: 'mock-coder', enabled: true, createdAt: now, updatedAt: now },
      apiKey: 'local-agent-fixture-key',
    });
    await hostInvoke(app, 'providers', 'setDefault', { providerId: 'task-scope-fixture' });
    const workspace = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
      name: 'Session task acceptance', rootPath, permissionMode: 'fullAccess', agentId: 'main',
    });
    const workspaceId = workspace.activeWorkspace.id;
    await startGateway(app);
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 45_000 });
    const created = await rpc<{ key: string; sessionId: string }>('sessions.create', { agentId: 'main', label: 'Task scope source' });
    const sessionKey = created.key;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, agentId: 'main', sessionKey, activeSessionKey: sessionKey });
    const send = async (key: string, marker: string, extra: Record<string, unknown> = {}) => {
      const result = await hostInvoke<{ success: boolean; error?: string }>(app!, 'chat', 'sendWithMedia', {
        workspaceId, sessionKey: key, message: marker, idempotencyKey: `acceptance-${marker}`, ...extra,
      });
      expect(result.success, result.error).toBe(true);
      await expect.poll(async () => JSON.stringify((await rpc<{ messages?: unknown[] }>('chat.history', { sessionKey: key, limit: 100 })).messages ?? [])
        .includes(`FINISHED ${marker}`), { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => (await rpc<{ session?: { hasActiveRun?: boolean } }>('sessions.describe', { key })).session?.hasActiveRun ?? false,
        { timeout: 30_000 }).toBe(false);
    };
    for (let turn = 0; turn < 10; turn++) await send(sessionKey, `A4-DISCUSS-${turn}`);
    const discussion = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(discussion.snapshot.nodes.filter((node) => node.kind === 'task')).toHaveLength(0);
    await record('discussion', { turns: 10, businessTasks: 0, snapshot: discussion.snapshot });
    await expect(rpc('chat.send', { sessionKey, message: 'A4-STALE-MUST-NOT-SEND', idempotencyKey: 'stale-generation-denied',
      expectedSessionGeneration: 'stale-generation' })).rejects.toThrow('CHAT_SESSION_GENERATION_CHANGED');
    expect(JSON.stringify(await rpc('chat.history', { sessionKey, limit: 100 }))).not.toContain('A4-STALE-MUST-NOT-SEND');
    await send(sessionKey, 'A4-EXECUTE');
    expect(await readFile(target, 'utf8')).toBe('agent-driven admitted write\n');
    expect(llm.log.filter((entry) => entry.issued === 'a4-write')).toHaveLength(1);
    const execution = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(execution.snapshot.nodes.filter((node) => node.kind === 'task')).toHaveLength(1);
    const bound = await hostInvoke(app, 'workspaces', 'resolveCoordinator', { workspaceId, agentId: 'main', sessionKey });
    await record('execution', { snapshot: execution.snapshot, binding: bound, effect: await readFile(target, 'utf8') });
    await send(sessionKey, 'A4-CONTINUE');
    expect(llm.log.filter(entry => entry.issued === 'a4-continue-write')).toHaveLength(1);
    const continued = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(continued.snapshot.nodes.filter(node => node.kind === 'task').map(node => node.id)).toEqual(
      execution.snapshot.nodes.filter(node => node.kind === 'task').map(node => node.id));
    await record('continuedExecution', { snapshot: continued.snapshot, effect: await readFile(target, 'utf8') });
    const input = { workspaceId, agentId: 'main', sessionKey, operationId: 'agent-runtime-handoff-1', draftInput: 'A4-HANDOFF' };
    await loseNextHandoffCreationResponse(app, input.operationId);
    await expect(hostInvoke(app, 'sessions', 'createHandoff', input)).rejects.toThrow('agent injected creation response loss');
    const observed = await hostInvoke<{ operation: SessionHandoffOperation }>(app, 'sessions', 'handoffOperation', {
      workspaceId, sessionKey, operationId: input.operationId,
    });
    const handoff = observed.operation;
    const parent = await rpc<{ session: { parentSessionKey: string; sessionId: string } }>('sessions.describe', { key: handoff.sessionKey });
    expect(parent.session.parentSessionKey).toBe(sessionKey);
    expect(handoff.sessionGeneration).toBe(parent.session.sessionId);
    await record('handoffBeforeRestart', { creationResponse: 'lost', operation: handoff });
    await hostInvoke(app, 'gateway', 'stop'); await closeElectronApp(app); app = undefined;
    app = await launchElectronApp({ skipSetup: true, profileDir: userDataDir });
    await getStableWindow(app); await startGateway(app);
    const recovered = await hostInvoke<SessionCreateHandoffResult>(app, 'sessions', 'createHandoff', input);
    expect(recovered.sessionKey).toBe(handoff.sessionKey);
    expect(recovered.operation?.firstSendIdempotencyKey).toBe(handoff.firstSendIdempotencyKey);
    await failNextHandoffAcknowledgementWrite(app, input.operationId);
    const uncertain = await hostInvoke<{ success: boolean }>(app, 'chat', 'sendWithMedia', {
      workspaceId, sessionKey: recovered.sessionKey, message: 'A4-HANDOFF',
      idempotencyKey: recovered.operation!.firstSendIdempotencyKey, handoffOperationId: recovered.operation!.id,
    });
    expect(uncertain.success).toBe(false);
    const unknown = await hostInvoke<{ operation: SessionHandoffOperation }>(app, 'sessions', 'handoffOperation', {
      workspaceId, sessionKey: recovered.sessionKey, operationId: input.operationId,
    });
    expect(unknown.operation.phase).toBe('unknown');
    await expect.poll(async () => JSON.stringify(await rpc('chat.history', { sessionKey: recovered.sessionKey, limit: 100 })).includes('FINISHED A4-HANDOFF'), { timeout: 60_000 }).toBe(true);
    await record('unknownBeforeSecondRestart', unknown);
    await hostInvoke(app, 'gateway', 'stop'); await closeElectronApp(app); app = undefined;
    app = await launchElectronApp({ skipSetup: true, profileDir: userDataDir });
    await getStableWindow(app); await startGateway(app);
    const delivery = await hostInvoke<{ operation: SessionHandoffOperation }>(app, 'sessions', 'handoffOperation', {
      workspaceId, sessionKey: recovered.sessionKey, operationId: recovered.operation!.id, reconcile: true,
    });
    expect(delivery.operation.phase).toBe('sent');
    expect(delivery.operation.receipt?.source).toBe('transcript');
    expect(delivery.operation.sessionKey).toBe(handoff.sessionKey);
    await record('handoffAfterRestart', { recovered, delivery });
    await record('providerLog', llm.log);
    expect(llm.anomalies).toEqual([]);
    await record('status', 'passed');
  } catch (error) { await record('status', 'failed'); await record('error', String(error)); throw error; }
  finally {
    await record('providerLog', llm.log);
    if (app) { await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app); }
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});

test('explicit UI task selection executes the newly selected canonical contract', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const target = testInfo.outputPath('selection-workspace', 'beta.txt');
  let issued = false;
  const llm = await startScriptedLlm(text => {
    if (text.includes('SELECTED-TASK-EXECUTE') && !issued) {
      issued = true;
      return { toolCall: { id: 'selected-task-write', name: 'write', args: { path: target, content: 'selected task result\n' } } };
    }
    return { text: 'SELECTED-TASK-READY' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-canonical-task-selection', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('selection-workspace'), 'Canonical selection');
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      message: 'Discussion before selecting an execution task', idempotencyKey: 'selection-discussion' });
    await expect.poll(async () => JSON.stringify(await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.history',
      params: { sessionKey: project.sessionKey, limit: 20 }, timeoutMs: 30_000 })).includes('SELECTED-TASK-READY'),
    { timeout: 45_000 }).toBe(true);
    await expect.poll(async () => (await hostInvoke<{ session: { hasActiveRun: boolean } }>(app, 'gateway', 'rpc', {
      method: 'sessions.describe', params: { key: project.sessionKey }, timeoutMs: 30_000 })).session.hasActiveRun,
    { timeout: 45_000 }).toBe(false);
    const contract = { objective: 'Execute task Alpha', target: 'beta.txt', constraints: ['Preserve the other task'],
      acceptance: [{ id: 'artifact', description: 'Exact selected output', verification: { kind: 'file-sha256' as const,
        path: 'beta.txt', sha256: createHash('sha256').update('selected task result\n').digest('hex') } }] };
    const a = await createSessionChainTask(app, project.workspaceId, 'selection-a', contract);
    const b = await createSessionChainTask(app, project.workspaceId, 'selection-b', { ...contract, objective: 'Execute task Beta' });
    for (const task of [a, b]) await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId,
      sessionKey: project.sessionKey, sessionGeneration: project.generation, nodeId: task.contract.taskNodeId });
    await hostInvoke(app, 'workspaces', 'bindCoordinator', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [a.contract.taskNodeId],
      environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore' });
    await hostInvoke(app, 'taskLedger', 'command', { workspaceId: project.workspaceId,
      command: { action: 'claim', taskNodeId: a.contract.taskNodeId, sessionKey: project.sessionKey, requestId: 'selection-claim-a' } });
    const page = await getStableWindow(app); await page.reload();
    await page.getByTestId('session-tasks-toggle').click();
    await page.getByTestId(`session-task-select-${b.contract.taskNodeId}`).click();
    await expect(page.getByTestId(`session-task-select-${b.contract.taskNodeId}`)).toHaveText('Selected');
    const selected = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
    expect(selected.task.contract).toMatchObject({ taskNodeId: b.contract.taskNodeId, state: 'ready' });
    await hostInvoke(app, 'chat', 'sendWithMedia', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      message: 'SELECTED-TASK-EXECUTE', idempotencyKey: 'selection-execute-b' });
    await expect.poll(() => readFile(target, 'utf8').catch(() => null), { timeout: 60_000 }).toBe('selected task result\n');
    const after = await hostInvoke<{ task: TaskView }>(app, 'taskLedger', 'sessionTask', { workspaceId: project.workspaceId, sessionKey: project.sessionKey });
    expect(after.task.contract.taskNodeId).toBe(b.contract.taskNodeId);
    evidence.project = project; evidence.a = a; evidence.b = b; evidence.selected = selected; evidence.after = after; evidence.status = 'passed';
    await page.screenshot({ path: testInfo.outputPath('canonical-task-selection.png') });
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await writeFile(testInfo.outputPath('canonical-task-selection.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
