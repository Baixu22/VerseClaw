import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import type {
  SessionCreateHandoffResult,
  SessionDelegationResult,
  SessionForkResult,
  WorkspaceCoordinatorBindingResult,
} from '../../shared/host-api/contract';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway } from './fixtures/fp-p1-harness';

type LedgerResult = { snapshot: TaskLedgerSnapshot };

test('Main preserves task references across fork and handoff without inheriting coordinator authority', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const evidence: Record<string, unknown> = {
    schema: 'clawx.session-task-scope-derivation-e2e/v1',
    driven_by: 'agent', actor: 'codex-session-task-scope-derivation-e2e',
    candidate: { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')) },
    startedAt: new Date().toISOString(), status: 'running',
  };
  const evidencePath = testInfo.outputPath('task-scope-derivation.json');
  const record = async (stage: string, value: unknown) => {
    evidence[stage] = value;
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  };
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.minimize();
    });
    await startGateway(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string; rootPath: string } }>(app, 'workspaces', 'getActive');
    const { id: workspaceId, rootPath } = active.activeWorkspace;
    await mkdir(rootPath, { recursive: true });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const created = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', {
      method: 'sessions.create', params: { agentId: 'main', label: 'Agent task-scope source' }, timeoutMs: 60_000,
    });
    const sourceSessionKey = created.key;
    expect(created.sessionId).toBeTruthy();
    await hostInvoke(app, 'gateway', 'rpc', {
      method: 'chat.inject',
      params: { sessionKey: sourceSessionKey, agentId: 'main', message: 'Agent-driven task-reference derivation fixture.', label: 'agent fixture' },
      timeoutMs: 30_000,
    });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, agentId: 'main', activeSessionKey: sourceSessionKey, sessionKey: sourceSessionKey });
    const createdTask = await hostInvoke<LedgerResult>(app, 'taskLedger', 'createNode', {
      workspaceId, node: { title: 'Preserve this explicit task', kind: 'task', status: 'done' }, idempotencyKey: 'derivation-business-task',
    });
    const task = createdTask.snapshot.nodes.at(-1)!;
    expect(task.kind).toBe('task');
    await hostInvoke(app, 'taskLedger', 'linkSession', {
      workspaceId, nodeId: task.id, sessionKey: sourceSessionKey, sessionGeneration: created.sessionId,
      agentId: 'main', relation: 'related', idempotencyKey: 'derivation-source-link',
    });
    const bound = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'bindCoordinator', {
      workspaceId, agentId: 'main', sessionKey: sourceSessionKey, expectedRevision: 0,
      taskLedgerNodeIds: [task.id], environment: { kind: 'local', rootPath, setupProfile: 'default' }, archiveRestorePolicy: 'restore',
    });
    expect(bound.recovery.state).toBe('ready');
    await record('source', { workspaceId, sessionKey: sourceSessionKey, generation: created.sessionId, task, binding: bound });

    const fork = await hostInvoke<SessionForkResult>(app, 'sessions', 'fork', { workspaceId, agentId: 'main', sessionKey: sourceSessionKey });
    expect(fork.success).toBe(true);
    expect(fork.sessionKey).toBeTruthy();
    const forkSessionKey = fork.sessionKey!;
    const forkDescription = await hostInvoke<{ session: { sessionId: string } }>(app, 'gateway', 'rpc', {
      method: 'sessions.describe', params: { key: forkSessionKey }, timeoutMs: 30_000,
    });
    const forkGeneration = forkDescription.session.sessionId;
    expect(forkGeneration).not.toBe(created.sessionId);
    const afterFork = await hostInvoke<LedgerResult>(app, 'taskLedger', 'snapshot', { workspaceId });
    const forkLinks = afterFork.snapshot.sessionLinks.filter((link) => link.sessionKey === forkSessionKey);
    expect(forkLinks.filter((link) => link.nodeId).map((link) => link.nodeId)).toEqual([task.id]);
    expect(forkLinks.every((link) => link.relation === 'forked_from' && link.sourceSessionKey === sourceSessionKey && link.sessionGeneration === forkGeneration)).toBe(true);
    expect(afterFork.snapshot.nodes.find((node) => node.id === task.id)).toEqual(task);
    const forkBinding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'resolveCoordinator', { workspaceId, agentId: 'main', sessionKey: forkSessionKey });
    expect(forkBinding.recovery.state).not.toBe('ready');
    const rejectedFork = await hostInvoke<SessionDelegationResult>(app, 'sessions', 'delegate', {
      workspaceId, sessionKey: forkSessionKey, agentId: 'main', taskRef: task.id, task: 'No inherited writer',
      expectedBindingRevision: bound.binding!.bindingRevision, expectedSessionGeneration: forkGeneration,
      idempotencyKey: 'derivation-fork-denied', backend: 'subagent', worker: { roleName: 'implementer', task: 'Must not launch' },
    });
    expect(rejectedFork.status).toBe('rejected');
    await record('fork', { result: fork, generation: forkGeneration, links: forkLinks, binding: forkBinding, admission: rejectedFork });

    const handoff = await hostInvoke<SessionCreateHandoffResult>(app, 'sessions', 'createHandoff', {
      workspaceId, agentId: 'main', sessionKey: sourceSessionKey, draftInput: 'Continue the explicitly linked task.',
    });
    expect(handoff.success).toBe(true);
    const handoffSessionKey = handoff.sessionKey!;
    const afterHandoff = await hostInvoke<LedgerResult>(app, 'taskLedger', 'snapshot', { workspaceId });
    const handoffLinks = afterHandoff.snapshot.sessionLinks.filter((link) => link.sessionKey === handoffSessionKey);
    expect(handoffLinks.filter((link) => link.nodeId).map((link) => link.nodeId)).toEqual([task.id]);
    expect(handoffLinks.every((link) => link.relation === 'handoff_from' && link.sourceSessionKey === sourceSessionKey && link.sessionGeneration === null)).toBe(true);
    const sourceAfterHandoff = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'resolveCoordinator', { workspaceId, agentId: 'main', sessionKey: sourceSessionKey });
    expect(sourceAfterHandoff.binding?.state).toBe('paused');
    const handoffPending = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'resolveCoordinator', { workspaceId, agentId: 'main', sessionKey: handoffSessionKey });
    expect(handoffPending.recovery.state).toBe('session-pending');
    await hostInvoke(app, 'gateway', 'rpc', {
      method: 'sessions.create', params: { key: handoffSessionKey, agentId: 'main', label: 'Agent task-scope handoff' }, timeoutMs: 60_000,
    });
    const handoffBinding = await hostInvoke<WorkspaceCoordinatorBindingResult>(app, 'workspaces', 'resolveCoordinator', { workspaceId, agentId: 'main', sessionKey: handoffSessionKey });
    expect(handoffBinding.recovery.state).toBe('ready');
    expect(handoffBinding.binding?.sessionGeneration).toBeTruthy();
    expect(handoffBinding.binding?.sessionGeneration).not.toBe(created.sessionId);
    expect(handoffBinding.binding?.taskLedgerReferences.map((reference) => reference.taskLedgerNodeId)).toEqual([task.id]);
    expect(afterHandoff.snapshot.nodes.find((node) => node.id === task.id)).toEqual(task);
    await record('handoff', { result: handoff, links: handoffLinks, sourceBinding: sourceAfterHandoff, pending: handoffPending, active: handoffBinding });
    await page.screenshot({ path: testInfo.outputPath('task-scope-derived-session.png') });
    evidence.status = 'passed';
    await record('finishedAt', new Date().toISOString());
  } catch (error) {
    evidence.status = 'failed';
    await record('error', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    try {
      await hostInvoke(app, 'gateway', 'stop');
    } finally {
      await closeElectronApp(app);
    }
  }
});
