import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { TaskSystemStore } from '../../../shared/task-system/store';
import { resolveTaskDomain } from '../../../shared/task-system/identity';
import { parseSessionCollaborationQuery } from '../../../shared/types/session-collaboration';
import type { TaskLedgerSnapshotResult } from '../../../shared/host-api/contract';
import { hostInvoke, startGateway } from './fp-p1-harness';
import { createSessionChainProject } from './session-task-chain';

/** Fixture setup uses the original Workspace/Session/Task owners and one scripted turn. */
export async function createCollaborationProject(app: ElectronApplication, root: string, name: string) {
  await mkdir(root, { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', root], { windowsHide: true });
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'Agent collaboration fixture'], { windowsHide: true });
  const project = await createSessionChainProject(app, root, name);
  const ledger = await hostInvoke<TaskLedgerSnapshotResult>(app, 'taskLedger', 'createNode', { workspaceId: project.workspaceId,
    node: { title: `${name} collaboration goal`, kind: 'task', status: 'todo' }, idempotencyKey: `${name}-binding` });
  await hostInvoke(app, 'workspaces', 'bindCoordinator', { ...project, agentId: 'main', expectedRevision: 0,
    taskLedgerNodeIds: [ledger.snapshot.nodes.find(node => node.title === `${name} collaboration goal`)!.id],
    environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore' });
  const store = new TaskSystemStore(resolveTaskDomain(root));
  let taskNodeId: string;
  try {
    const task = store.sessionSnapshot(project.sessionKey, project.generation).task;
    if (!task) throw new Error('Original coordinator task owner missing');
    taskNodeId = task.contract.taskNodeId;
    store.claim(taskNodeId, project.sessionKey, project.generation, `${name}-claim`);
  } finally { store.close(); }
  await establishCollaborationScope(app, project);
  return { ...project, taskNodeId, scope: parseSessionCollaborationQuery({ requester: {
    workspaceId: project.workspaceId, projectId: project.workspaceId, sessionKey: project.sessionKey, sessionGeneration: project.generation,
  } }).requester };
}

export async function enableCollaborationFixtureVisibility(app: ElectronApplication) {
  const current = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get' });
  await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: current.hash,
    raw: JSON.stringify({ tools: { sessions: { visibility: 'all' } } }) } });
  await hostInvoke(app, 'gateway', 'stop'); await startGateway(app);
}

export async function establishCollaborationScope(app: ElectronApplication, project: { workspaceId: string; rootPath: string; sessionKey: string; generation: string }) {
  const result = await hostInvoke<{ runId: string }>(app, 'gateway', 'rpc', { method: 'sessions.send', params: {
    key: project.sessionKey, expectedSessionId: project.generation, workspaceId: project.workspaceId, workspaceDir: project.rootPath,
    message: 'Fixture setup: acknowledge the existing session without tools.', idempotencyKey: `collaboration-setup:${project.sessionKey}:${project.generation}`,
  } });
  if (result.runId) await hostInvoke(app, 'gateway', 'rpc', { method: 'agent.wait', params: { runId: result.runId, timeoutMs: 60_000 }, timeoutMs: 65_000 });
}
