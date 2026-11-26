import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { TaskSystemStore } from '../../../shared/task-system/store';
import { resolveTaskDomain } from '../../../shared/task-system/identity';
import { parseSessionCollaborationQuery } from '../../../shared/types/session-collaboration';
import type { TaskLedgerSnapshotResult } from '../../../shared/host-api/contract';
import { hostInvoke, startGateway } from './fp-p1-harness';
import { createSessionChainProject } from './session-task-chain';
import { resolveStorePath } from '../../../openclaw_runtime/src/config/sessions/paths';
import { resolve } from 'node:path';

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
  const setupRunId = await establishCollaborationScope(app, project);
  return { ...project, taskNodeId, setupRunId, scope: parseSessionCollaborationQuery({ requester: {
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
  if (!result.runId) throw new Error('Original fixture run ID missing');
  const terminal = await hostInvoke<{ status: string }>(app, 'gateway', 'rpc', {
    method: 'agent.wait', params: { runId: result.runId, timeoutMs: 60_000 }, timeoutMs: 65_000,
  });
  if (terminal.status !== 'ok') throw new Error(`Fixture setup run ended with ${terminal.status}`);
  return result.runId;
}

export async function collaborationFixtureStorePath(app: ElectronApplication) {
  const config = await hostInvoke<{ config: { session?: { store?: string } } }>(app, 'gateway', 'rpc', { method: 'config.get' });
  const env = await app.evaluate(() => ({ HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR, OPENCLAW_HOME: process.env.OPENCLAW_HOME }));
  const path = resolveStorePath(config.config.session?.store, { agentId: 'main', env });
  const home = env.HOME ?? env.USERPROFILE;
  if (!home || !resolve(path).toLowerCase().startsWith(`${resolve(home).toLowerCase()}${process.platform === 'win32' ? '\\' : '/'}`))
    throw new Error('Collaboration fixture store escaped its private home');
  return path;
}

export async function createCollaborationChild(app: ElectronApplication, parent: Awaited<ReturnType<typeof createCollaborationProject>>) {
  const child = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', { method: 'sessions.create',
    params: { agentId: 'main', parentSessionKey: parent.sessionKey, label: 'Original observer child' } });
  await hostInvoke(app, 'workspaces', 'saveState', { id: parent.workspaceId, sessionKey: child.key, state: {} });
  await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.patch', params: { key: child.key, workspaceDir: parent.rootPath, expectedSessionId: child.sessionId } });
  const store = new TaskSystemStore(resolveTaskDomain(parent.rootPath));
  try { store.inheritReference(parent.sessionKey, parent.generation, child.key, child.sessionId); } finally { store.close(); }
  const project = { workspaceId: parent.workspaceId, rootPath: parent.rootPath, sessionKey: child.key, generation: child.sessionId };
  await establishCollaborationScope(app, project);
  return { ...project, scope: parseSessionCollaborationQuery({ requester: { workspaceId: parent.workspaceId, projectId: parent.workspaceId,
    sessionKey: child.key, sessionGeneration: child.sessionId } }).requester };
}
