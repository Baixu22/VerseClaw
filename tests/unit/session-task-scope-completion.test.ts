// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { SessionTaskEffectRequest, SessionTaskRequesterReference } from '@shared/session-task-scope';
import type { TaskContractInput, TaskView } from '@shared/task-system/types';

const state = vi.hoisted(() => ({ root: '', store: '', invoke: vi.fn() }));
vi.mock('electron-store', () => ({ default: class {
  get(key: string) { return JSON.parse(readFileSync(state.store, 'utf8'))[key]; }
  set(key: string, value: unknown) {
    const document = JSON.parse(readFileSync(state.store, 'utf8'));
    writeFileSync(state.store, JSON.stringify({ ...document, [key]: value }));
  }
} }));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => state.root, expandPath: (value: string) => value,
  getResourcesDir: () => resolve('resources'),
}));
vi.mock('@electron/services/workspace-runtime-sync', () => ({ syncActiveWorkspacePermissionToRuntime: vi.fn(), syncActiveWorkspaceRootToRuntime: vi.fn() }));
vi.mock('@electron/utils/clawx-harness-template', () => ({ ensureVerseClawWorkspaceHarness: vi.fn(async () => ({})) }));
vi.mock('../../openclaw_runtime/src/gateway/call', () => ({ callGateway: (...args: unknown[]) => state.invoke(...args) }));

import { createTaskLedgerApi } from '@electron/services/task-ledger-api';
import { createWorkspacesApi } from '@electron/services/workspaces-api';
import { readTaskLedgerEvents } from '@electron/services/task-ledger-service';
import { handoffManagedSessionTask, startManagedSessionEffect } from '@electron/services/task-system-service';
import { normalizeTaskContract, TaskSystemStore } from '@shared/task-system/store';
import { resolveTaskDomain } from '@shared/task-system/identity';
import { createTaskRuntimeGuard, executeTaskGuarded, finishPersistentTaskRun } from '@shared/task-system/runtime';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';
import { withSessionTaskScope, clearSessionTaskScopeRun, sessionTaskOperationsInFlight } from '../../openclaw_runtime/src/agents/session-task-scope';
import { executeManagedTaskTool, finishExecutionCheckoutRun } from '../../openclaw_runtime/src/agents/execution-checkout-tools';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';

const parent = 'agent:main:parent';
const child = 'agent:main:child';
const ledger = createTaskLedgerApi();
const proof = JSON.stringify({ driven_by: 'agent', actor: 'Hooke', subject: 'Canonical execution contract fixture' }) + '\n';
const proofSha256 = createHash('sha256').update(proof).digest('hex');
const runs = new Map<string, { active: boolean; quiescent: boolean; generation: string; workspaceId?: string;
  scheduled?: { jobId: string; workspaceDir: string; coordinator?: { workspaceId: string; sessionKey: string; generation: string; taskNodeId?: string } };
  delegation?: { parentSessionKey: string; parentGeneration: string; workspaceDir: string | null; taskReference?: SessionTaskRequesterReference } }>();
const generations = new Map<string, string>();
let tasks: TaskSystemStore;
let contractSequence = 0;

function profile(): WorkspaceProfile {
  return { id: 'workspace-a', name: 'Explicit project', rootPath: state.root, agentId: 'main',
    activeSessionKey: parent, permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 1,
    state: {}, sessionStates: { [parent]: {}, [child]: {} },
    agentBindings: { main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: parent } } };
}
function contract(objective = 'Execute the explicitly selected task'): TaskContractInput {
  return { objective, target: 'owner-proof.json', constraints: ['Retain session scope and the single writer'],
    businessKey: 'hooke-contract-' + ++contractSequence,
    acceptance: [{ id: 'proof', description: 'Read back the exact agent fixture bytes',
      verification: { kind: 'file-sha256', path: 'owner-proof.json', sha256: proofSha256 } }] };
}
function startTask(sessionKey = parent, generation = 'generation-parent', objective?: string): TaskView {
  generations.set(sessionKey, generation);
  return tasks.start({ contract: contract(objective) }, sessionKey, generation, 'start-' + contractSequence);
}
function request(sessionKey = parent, runId = 'run-parent', generation = 'generation-parent'): SessionTaskEffectRequest {
  return { requestId: runId + ':request', sessionKey, sessionGeneration: generation, runId, workspaceDir: state.root, toolName: 'write' };
}
function api(onRunRead?: (runId: string, readCount: number) => void | Promise<void>) {
  let readCount = 0;
  return createWorkspacesApi({ taskLedgerApi: ledger, gatewayManager: { rpc: vi.fn(async (method: string, payload: Record<string, string>) => {
    if (method === 'sessions.describe') return { session: { key: payload.key,
      sessionId: generations.get(payload.key) ?? 'generation-parent',
      hasActiveRun: payload.key === parent ? runs.get('run-parent')?.active === true : runs.get('run-child')?.active === true } };
    if (method !== 'taskScope.runState') throw new Error('Unexpected ' + method);
    await onRunRead?.(payload.runId, ++readCount);
    const run = runs.get(payload.runId) ?? (payload.processScope === 'session'
      ? runs.get(payload.sessionKey === parent ? 'run-parent' : 'run-child') : undefined);
    return { ...payload, currentGeneration: run?.generation ?? null, workspaceId: run?.workspaceId ?? 'workspace-a',
      active: run?.active ?? false, quiescent: run?.quiescent ?? false, inFlightEffects: run?.quiescent ? 0 : 1,
      inFlightProcesses: 0, inFlightOperationIds: sessionTaskOperationsInFlight(payload.runId),
      delegation: run?.delegation ?? null, scheduled: run?.scheduled };
  }) } as never, gitApi: {
    status: async () => ({ success: true, status: { isRepository: false, workspaceRoot: state.root } }),
    worktrees: async () => ({ success: true, worktrees: [] }),
  } as never });
}
async function binding(sessionKey = parent) {
  const document = JSON.parse(await readFile(state.store, 'utf8'));
  return (document.profiles[0] as WorkspaceProfile).coordinatorBindings?.[sessionKey];
}
async function existingTask(sessionKeys = [parent], status: 'done' | 'todo' = 'done') {
  const created = tasks.create(contract('Existing business task'), 'existing-' + contractSequence).task;
  if (status === 'done') {
    const claimed = tasks.start({ taskNodeId: created.contract.taskNodeId }, sessionKeys[0], generations.get(sessionKeys[0])!, 'complete-' + contractSequence);
    tasks.submit(claimed.claim!, 'hooke-candidate');
    tasks.verifyFile(claimed.claim!, 'proof', 'owner-proof.json', proofSha256, 'hooke-candidate');
    tasks.accept(claimed.claim!, 'hooke-candidate');
  }
  for (const sessionKey of sessionKeys) await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey,
    sessionGeneration: generations.get(sessionKey), nodeId: created.contract.taskNodeId });
  return (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes.find(node => node.id === created.contract.taskNodeId)!;
}

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'hooke-task-scope-completion-'));
  state.store = join(state.root, 'workspaces.json');
  vi.stubEnv('OPENCLAW_STATE_DIR', join(state.root, 'runtime-state'));
  await writeFile(state.store, JSON.stringify({ activeWorkspaceId: 'workspace-a', profiles: [profile()] }));
  await writeFile(join(state.root, 'owner-proof.json'), proof);
  tasks = new TaskSystemStore(resolveTaskDomain(state.root));
  contractSequence = 0;
  runs.clear(); generations.clear();
  generations.set(parent, 'generation-parent'); generations.set(child, 'generation-child');
  runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-parent' });
  runs.set('run-child', { active: true, quiescent: false, generation: 'generation-child' });
  vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1');
  state.invoke.mockImplementation(async ({ method, params }) => {
    if (method !== 'taskScope.admit') throw new Error(method);
    return api().admitTaskEffect(params);
  });
});
afterEach(async () => {
  finishExecutionCheckoutRun('run-parent'); finishExecutionCheckoutRun('run-child');
  clearSessionTaskScopeRun('run-parent'); clearSessionTaskScopeRun('run-child');
  finishPersistentTaskRun(state.root, parent, 'run-parent');
  finishPersistentTaskRun(state.root, child, 'run-child');
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  closeOpenClawAgentDatabasesForTest();
  tasks?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs(); state.invoke.mockReset();
  await rm(state.root, { recursive: true, force: true });
});

describe('first effect consumes the canonical execution contract', () => {
  it('reads task admission by identity without a full Ledger snapshot', async () => {
    startTask();
    const snapshot = vi.spyOn(ledger, 'snapshot').mockRejectedValue(new Error('The admission attempted a full scan'));
    try {
      await expect(api().admitTaskEffect(request())).resolves.toMatchObject({ status: 'granted' });
      expect(snapshot).not.toHaveBeenCalled();
    } finally { snapshot.mockRestore(); }
  });
  it.each([1000, 10000])('keeps admission scoped with %s persisted task contracts', async (size) => {
    const task = startTask();
    const normalized = normalizeTaskContract({ objective: 'Historical scope fixture', target: 'owner-proof.json', constraints: [],
      acceptance: [{ id: 'proof', description: 'Recorded fixture bytes', verification: { kind: 'file-sha256', path: 'owner-proof.json', sha256: proofSha256 } }] });
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const insert = tasks.db.prepare('INSERT INTO task_contracts VALUES(?,?,?,?,?,?)');
    tasks.db.exec('BEGIN IMMEDIATE');
    for (let index = 1; index < size; index++) {
      const taskNodeId = randomUUID();
      const fixture = { ...normalized, taskNodeId, domain: tasks.domain.id, revision: 1, digest: fingerprint, state: 'ready',
        origin: { source: 'agent-scale-fixture', requestId: `fixture-${index}` }, createdAt: 1, updatedAt: 1 };
      insert.run(taskNodeId, fingerprint, null, 'ready', 1, JSON.stringify(fixture));
    }
    tasks.db.exec('COMMIT');
    const snapshot = vi.spyOn(ledger, 'snapshot').mockRejectedValue(new Error('Admission loaded the entire task list'));
    const admissionMs = [] as number[];
    try {
      const owner = api();
      for (let sample = 0; sample < 5; sample++) {
        const started = performance.now();
        const admitted = await owner.admitTaskEffect({ ...request(), requestId: `scale-${size}-${sample}` });
        admissionMs.push(performance.now() - started);
        expect(admitted.claim.taskNodeId).toBe(task.contract.taskNodeId);
      }
      expect(snapshot).not.toHaveBeenCalled();
    } finally { snapshot.mockRestore(); }
    const snapshotMs = [] as number[];
    for (let sample = 0; sample < 3; sample++) {
      const started = performance.now();
      const result = await ledger.snapshot({ workspaceId: 'workspace-a' });
      snapshotMs.push(performance.now() - started);
      expect(result.snapshot.nodes).toHaveLength(size);
    }
    const directory = process.env.CLAWX_SESSION_TASK_REVIEW_METRICS_DIR;
    if (directory) await writeFile(join(directory, `scale-${size}.json`), JSON.stringify({ driven_by: 'agent', actor: 'session-task-fixes',
      size, admissionMs, snapshotMs, fullSnapshotCallsDuringAdmission: 0 }, null, 2));
  }, 30000);
  it('restores the Workspace and Task owner generations before admitting the next run', async () => {
    const task = startTask();
    const live = api();
    await live.admitTaskEffect(request());
    const before = await binding();
    await live.coordinatorLifecycle({ type: 'archive', workspaceId: 'workspace-a', sessionKey: parent });
    generations.set(parent, 'generation-restored');
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-restored' });
    await live.coordinatorLifecycle({ type: 'restore', workspaceId: 'workspace-a', sessionKey: parent,
      previousSessionGeneration: 'generation-parent', sessionGeneration: 'generation-restored' });
    const restored = await binding();
    expect(restored).toMatchObject({ state: 'active', sessionGeneration: 'generation-restored', activeTaskNodeId: task.contract.taskNodeId });
    expect(restored?.writerClaim).toBeUndefined();
    expect(restored!.bindingRevision).toBeGreaterThan(before!.bindingRevision);
    expect(tasks.binding(parent, 'generation-restored')?.claim?.epoch).toBe(task.claim!.epoch + 1);
    expect(() => tasks.binding(parent, 'generation-parent')).toThrow('TASK_GENERATION_STALE');
    runs.set('restored-run', { active: true, quiescent: false, generation: 'generation-restored' });
    await expect(live.admitTaskEffect(request(parent, 'restored-run', 'generation-restored'))).resolves.toMatchObject({ status: 'granted' });
  });
  it('rechecks a restrictive project permission before the next effect', async () => {
    startTask(); await api().admitTaskEffect(request());
    const document = JSON.parse(readFileSync(state.store, 'utf8'));
    document.profiles[0].permissionMode = 'readOnly';
    writeFileSync(state.store, JSON.stringify(document));
    await expect(api().admitTaskEffect({ ...request(), requestId: 'permission-revoked' })).rejects.toThrow('TASK_SCOPE_PERMISSION_REVOKED');
  });
  it('serializes permission downgrade behind an already admitted effect boundary', async () => {
    startTask();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const reached = new Promise<void>(done => { entered = done; });
    const live = api(async (_runId, readCount) => { if (readCount === 1) { entered(); await gate; } });
    const admission = live.admitTaskEffect(request());
    await reached;
    let permissionCommitted = false;
    const update = Promise.resolve(live.update({ id: 'workspace-a', permissionMode: 'readOnly' })).then(result => { permissionCommitted = true; return result; });
    await new Promise(done => setTimeout(done, 20));
    expect(permissionCommitted).toBe(false);
    release();
    await expect(admission).resolves.toMatchObject({ status: 'granted' });
    await update;
    await expect(live.admitTaskEffect({ ...request(), requestId: 'after-revocation' })).rejects.toThrow('TASK_SCOPE_PERMISSION_REVOKED');
  });
  it.each([['task_loop', 'status'], ['mission_loop', 'status'], ['transcripts', 'stop']])('keeps paused %s %s on its owning control path', async (toolName, action) => {
    const { executeManagedTaskTool } = await import('../../openclaw_runtime/src/agents/execution-checkout-tools');
    vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', state.store);
    await api().setSystemControl({ expectedRevision: 0, requestId: 'pause-control', paused: true });
    const execute = vi.fn(async () => ({ ownerChecked: true }));
    expect(await executeManagedTaskTool(undefined, null, 'control', toolName, { action }, undefined, execute)).toEqual({ ownerChecked: true });
    expect(execute).toHaveBeenCalledOnce();
    await expect(executeManagedTaskTool(undefined, null, 'write', 'write', { path: 'x' }, undefined, execute)).rejects.toThrow('SYSTEM_EXECUTION_PAUSED');
  });
  it('global pause rejects the next managed effect even when its project binding remains active', async () => {
    startTask();
    const owner = api();
    await owner.admitTaskEffect(request());
    const paused = await owner.setSystemControl({ expectedRevision: 0, requestId: 'global-pause', paused: true });
    expect((await binding())?.state).toBe('active');
    await expect(owner.admitTaskEffect({ ...request(), requestId: 'next-effect' })).rejects.toThrow('SYSTEM_EXECUTION_PAUSED');
    expect(await api().systemControl()).toEqual(paused);
    await owner.setSystemControl({ expectedRevision: paused.revision, requestId: 'global-resume', paused: false });
    await expect(owner.admitTaskEffect({ ...request(), requestId: 'resumed-effect' })).resolves.toMatchObject({ status: 'granted' });
  });
  it('binds an in-process worker through its persisted worktree owner', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-q', state.root], { windowsHide: true });
    const { createWorktreeService } = await import('../../openclaw_runtime/src/agents/worktree-service');
    const worker = createWorktreeService(state.root, { backend: 'inprocess' }).create('scope-worker', {
      seedFiles: ['owner-proof.json'], writeSet: ['owner-proof.json'],
      owner: { sessionKey: parent, expectedSessionId: 'generation-parent', agentId: 'main' },
    });
    const task = startTask();
    tasks.prepareWriterDelegation(task.claim!, { delegationId: 'run-child', childSessionKey: child,
      childGeneration: 'generation-child', childWorktree: worker.root, childRunId: 'run-child', mode: 'writer' });
    runs.get('run-child')!.delegation = { parentSessionKey: parent, parentGeneration: 'generation-parent', workspaceDir: worker.root,
      taskReference: { taskRef: task.contract.taskNodeId, coordinator: { workspaceId: 'workspace-a', sessionKey: parent,
        sessionGeneration: 'generation-parent', bindingRevision: 0 } } };
    const admitted = await api().admitTaskEffect({ ...request(child, 'run-child', 'generation-child'), workspaceDir: worker.root });
    expect(admitted.claim.credential?.sessionKey).toBe(child);
    expect((await binding(child))?.environment).toMatchObject({ kind: 'managed-worktree', backend: 'local-workspace',
      managedWorktreeGeneration: worker.generation });
    const repeated = await api().admitTaskEffect({ ...request(child, 'run-child', 'generation-child'), workspaceDir: worker.root });
    expect(repeated.claim.credential?.epoch).toBe(admitted.claim.credential?.epoch);
  });
  it('retains the same Main writer through idle renewal and a lost admission ACK', async () => {
    const initial = startTask();
    const context = { sessionKey: parent, sessionId: 'generation-parent', runId: 'run-parent', workspaceDir: state.root };
    const guard = createTaskRuntimeGuard(state.root, parent, context.sessionId, context.runId)!;
    await executeManagedTaskTool(context, guard, 'first-write', 'write', {}, undefined, async () => ({}));
    const siblingGuard = { ...guard, credential: { ...guard.credential! } };
    const first = (await binding())!.writerClaim!;
    vi.spyOn(Date, 'now').mockReturnValue(tasks.get(initial.contract.taskNodeId).claim!.expiresAt + 1);
    const admit = state.invoke.getMockImplementation()!;
    state.invoke.mockImplementationOnce(async payload => { await admit(payload); throw new Error('admission ACK lost'); });
    const effect = vi.fn(async () => { await writeFile(join(state.root, 'second-effect.txt'), 'once'); return {}; });
    const run = () => executeManagedTaskTool(context, guard, 'second-write', 'write', {}, undefined, effect);
    await expect(run()).rejects.toThrow('admission ACK lost');
    expect(effect).not.toHaveBeenCalled();
    await run();
    expect(effect).toHaveBeenCalledTimes(1);
    const renewed = (await binding())!.writerClaim!;
    expect(renewed.id).toBe(first.id);
    expect(renewed.executionRevision).toBe(first.executionRevision);
    expect(renewed.credential?.epoch).toBe(first.credential!.epoch + 1);
    expect(guard.credential?.epoch).toBe(renewed.credential?.epoch);
    expect(await readFile(join(state.root, 'second-effect.txt'), 'utf8')).toBe('once');
    await executeManagedTaskTool(context, siblingGuard, 'sibling-write', 'write', {}, undefined, async () => ({}));
    expect(siblingGuard.credential.epoch).toBe(renewed.credential?.epoch);
  });
  it('uses the canonical parent reference after transfer even before its navigation link was persisted', async () => {
    const task = startTask();
    tasks.prepareWriterDelegation(task.claim!, { delegationId: 'run-child', childSessionKey: child,
      childGeneration: 'generation-child', childWorktree: state.root, childRunId: 'run-child', mode: 'writer' });
    expect(tasks.binding(parent, 'generation-parent')?.referenceOnly).toBe(true);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.sessionLinks.some(link =>
      link.sessionKey === parent && link.nodeId === task.contract.taskNodeId)).toBe(false);
    runs.get('run-child')!.delegation = { parentSessionKey: parent, parentGeneration: 'generation-parent', workspaceDir: state.root,
      taskReference: { taskRef: task.contract.taskNodeId, coordinator: { workspaceId: 'workspace-a', sessionKey: parent,
        sessionGeneration: 'generation-parent', bindingRevision: 0 } } };
    const admitted = await api().admitTaskEffect(request(child, 'run-child', 'generation-child'));
    expect(admitted.claim.credential?.sessionKey).toBe(child);
    expect(() => tasks.assertOwner(task.claim!)).toThrow('TASK_STALE_OWNER');
    const other = tasks.create(contract('Unrelated task'), 'unrelated-parent-task').task;
    runs.get('run-child')!.delegation!.taskReference!.taskRef = other.contract.taskNodeId;
    await expect(api().admitTaskEffect(request(child, 'run-child', 'generation-child'))).rejects.toThrow('TASK_SCOPE_PARENT_TASK_LINK_STALE');
    runs.get('run-child')!.delegation!.taskReference!.taskRef = task.contract.taskNodeId;
    runs.get('run-child')!.delegation!.parentGeneration = 'stale-parent';
    runs.get('run-child')!.delegation!.taskReference!.coordinator.sessionGeneration = 'stale-parent';
    await expect(api().admitTaskEffect(request(child, 'run-child', 'generation-child'))).rejects.toThrow('TASK_GENERATION_STALE');
    expect(tasks.get(task.contract.taskNodeId).claim?.epoch).toBe(admitted.claim.credential!.epoch);
  });
  it('admits an owned child while the fenced parent run remains active', async () => {
    const task = startTask();
    const parentClaim = await api().admitTaskEffect(request());
    tasks.prepareWriterDelegation(task.claim!, { delegationId: 'run-child', childSessionKey: child,
      childGeneration: 'generation-child', childWorktree: state.root, childRunId: 'run-child', mode: 'writer' });
    runs.get('run-child')!.delegation = { parentSessionKey: parent, parentGeneration: 'generation-parent', workspaceDir: state.root,
      taskReference: { taskRef: task.contract.taskNodeId, coordinator: { workspaceId: 'workspace-a', sessionKey: parent,
        sessionGeneration: 'generation-parent', bindingRevision: parentClaim.bindingRevision } } };
    const admitted = await api().admitTaskEffect(request(child, 'run-child', 'generation-child'));
    expect(admitted.claim.credential?.sessionKey).toBe(child);
    expect(() => tasks.assertOwner(parentClaim.claim.credential!)).toThrow('TASK_STALE_OWNER');
    expect((await binding())?.writerClaim).toBeUndefined();
    expect(runs.get('run-parent')!.active).toBe(true);
  });
  it('rejects missing and incomplete contracts without creating a Legacy business task', async () => {
    const effect = vi.fn(async () => 'written');
    const context = { sessionKey: parent, sessionId: 'generation-parent', runId: 'run-parent', workspaceDir: state.root };
    await expect(withSessionTaskScope(context, 'write', {}, undefined, effect)).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(() => tasks.start({ contract: { ...contract(), acceptance: [] } }, parent, 'generation-parent', 'invalid')).toThrow('TASK_ACCEPTANCE_REQUIRED');
    expect(effect).not.toHaveBeenCalled();
    expect(tasks.list()).toHaveLength(0);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes).toHaveLength(0);
  });
  it('starts a complete canonical contract through task_control without requiring a session bridge', async () => {
    const input = contract('Start the explicit execution contract');
    const tool = createPersistentTaskTool({ workspace: state.root, sessionKey: parent, generation: 'generation-parent' });
    const result = await withSessionTaskScope(undefined, 'task_control', { action: 'start', contract: input }, undefined,
      () => tool.execute('task-start', { action: 'start', contract: input, requestId: 'task-start' }));
    const view = result.details as TaskView;
    expect(state.invoke).not.toHaveBeenCalled();
    expect(view.contract).toMatchObject(input);
    expect(tasks.binding(parent, 'generation-parent')?.claim).toEqual(view.claim);
    expect(tasks.list()).toHaveLength(1);
    const admitted = await api().admitTaskEffect(request());
    expect(admitted.claim.id).toBe(view.claim!.attemptId);
    expect(admitted.claim.credential).toMatchObject({ taskNodeId: view.contract.taskNodeId, epoch: view.claim!.epoch });
  });
  it('associates a live isolated scheduled run with its canonical contract without replacing the project coordinator', async () => {
    const scheduledKey = 'agent:main:cron:job:run:scheduled-generation';
    const task = startTask(scheduledKey, 'scheduled-generation', 'Isolated scheduled occurrence');
    runs.set('scheduled-run', { active: true, quiescent: false, generation: 'scheduled-generation', workspaceId: '',
      scheduled: { jobId: 'job', workspaceDir: state.root } });
    const claim = await api().admitTaskEffect(request(scheduledKey, 'scheduled-run', 'scheduled-generation'));
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    expect(claim.claim.run.scope.sessionKey).toBe(scheduledKey);
    expect(claim.claim.id).toBe(task.claim!.attemptId);
    expect(document.profiles[0].projectCoordinatorSessionKey).not.toBe(scheduledKey);
    expect(document.profiles[0].activeSessionKey).toBe(parent);
    expect(document.profiles[0].coordinatorBindings[scheduledKey].writerClaim.credential).toEqual(claim.claim.credential);
  });
  it('uses a decomposed scheduled child contract under the recorded parent TaskRef', async () => {
    const parentTask = startTask();
    const parentClaim = await api().admitTaskEffect(request());
    const planned = tasks.decompose(parentTask.claim!, [{ key: 'schedule', contract: contract('Scheduled child contract') }], 'schedule-plan')[0];
    const scheduledKey = 'agent:main:cron:job:run:scheduled-generation';
    generations.set(scheduledKey, 'scheduled-generation');
    tasks.start({ taskNodeId: planned.contract.taskNodeId }, scheduledKey, 'scheduled-generation', 'scheduled-start');
    runs.set('scheduled-run', { active: true, quiescent: false, generation: 'scheduled-generation',
      scheduled: { jobId: 'job', workspaceDir: state.root, coordinator: { workspaceId: 'workspace-a', sessionKey: parent,
        generation: 'generation-parent', taskNodeId: parentClaim.claim.taskNodeId } } });
    const admitted = await api().admitTaskEffect(request(scheduledKey, 'scheduled-run', 'scheduled-generation'));
    const snapshot = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot;
    expect(snapshot.nodes.find(node => node.id === admitted.claim.taskNodeId)?.parentId).toBe(parentTask.contract.taskNodeId);
    expect(admitted.claim.id).not.toBe(parentClaim.claim.id);
    expect(tasks.binding(parent, 'generation-parent')?.referenceOnly).toBe(true);
    expect(tasks.get(parentTask.contract.taskNodeId).claim?.state).toBe('released');
    expect((await binding())?.activeTaskNodeId).toBe(parentTask.contract.taskNodeId);
    expect(JSON.parse(await readFile(state.store, 'utf8')).profiles[0].projectCoordinatorSessionKey).toBe(parent);
  });
  it.each(['missing', 'stale', 'paused'])('rejects a %s scheduled coordinator before claiming another task', async (reason) => {
    startTask();
    const parentClaim = await api().admitTaskEffect(request());
    const scheduledKey = 'agent:main:cron:job:run:scheduled-generation';
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    if (reason === 'missing') delete document.profiles[0].coordinatorBindings[parent];
    if (reason === 'paused') document.profiles[0].coordinatorBindings[parent].state = 'paused';
    await writeFile(state.store, JSON.stringify(document));
    runs.set('scheduled-run', { active: true, quiescent: false, generation: 'scheduled-generation',
      scheduled: { jobId: 'job', workspaceDir: state.root, coordinator: { workspaceId: 'workspace-a', sessionKey: parent,
        generation: reason === 'stale' ? 'old-generation' : 'generation-parent', taskNodeId: parentClaim.claim.taskNodeId } } });
    await expect(api().admitTaskEffect(request(scheduledKey, 'scheduled-run', 'scheduled-generation'))).rejects.toThrow('TASK_SCOPE_SCHEDULE_STALE');
    expect(tasks.list()).toHaveLength(1);
    expect(tasks.binding(scheduledKey)).toBeNull();
  });
  it('rejects an isolated schedule from another workspace or agent before creating a task', async () => {
    const scheduledKey = 'agent:other:cron:job:run:scheduled-generation';
    runs.set('scheduled-run', { active: true, quiescent: false, generation: 'scheduled-generation', workspaceId: '',
      scheduled: { jobId: 'job', workspaceDir: state.root } });
    await expect(api().admitTaskEffect(request(scheduledKey, 'scheduled-run', 'scheduled-generation'))).rejects.toThrow('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
    runs.get('scheduled-run')!.scheduled!.workspaceDir = resolve(state.root, '..');
    await expect(api().admitTaskEffect(request('agent:main:cron:job:run:scheduled-generation', 'scheduled-run', 'scheduled-generation'))).rejects.toThrow('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
    expect(tasks.list()).toHaveLength(0);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes).toHaveLength(0);
  });
  it('consumes a canonical business contract after a failed turn left a diagnostic deviation link', async () => {
    const diagnostic = await ledger.createNode({ workspaceId: 'workspace-a', node: { kind: 'deviation', title: 'Earlier turn failed' } });
    await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey: parent, nodeId: diagnostic.snapshot.nodes[0].id });
    const task = startTask();
    const claim = await api().admitTaskEffect(request());
    const snapshot = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot;
    expect(claim.claim.taskNodeId).toBe(task.contract.taskNodeId);
    expect(snapshot.nodes.filter(node => node.kind === 'task')).toHaveLength(1);
    expect(snapshot.nodes.filter(node => node.kind === 'deviation')).toHaveLength(1);
    expect(tasks.list()).toHaveLength(1);
  });
  it('selects an existing completed task and preserves its status and historical links', async () => {
    const task = await existingTask();
    const owner = api();
    await expect(owner.selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: task.id,
      expectedSessionGeneration: 'generation-parent' })).rejects.toThrow('TASK_SCOPE_TASK_SWITCH_BLOCKED');
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    const selected = await owner.selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: task.id,
      expectedSessionGeneration: 'generation-parent', expectedRevision: 0 });
    const firstLinks = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.sessionLinks;
    expect(selected.binding).toMatchObject({ activeTaskNodeId: task.id, sessionGeneration: 'generation-parent' });
    await owner.selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: task.id,
      expectedSessionGeneration: 'generation-parent', expectedRevision: selected.binding!.bindingRevision });
    const snapshot = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot;
    expect(snapshot.nodes.find(node => node.id === task.id)).toEqual(task);
    expect(snapshot.sessionLinks).toEqual(firstLinks);
    expect(snapshot.sessionLinks.filter(link => link.id.startsWith('task-selection:'))).toHaveLength(1);
    expect(tasks.get(task.id).contract.state).toBe('done');
  });
  it('uses the captured worker parent TaskRef with a real child contract despite a later parent selection', async () => {
    const owner = api();
    const parentTask = startTask();
    const parentClaim = await owner.admitTaskEffect(request());
    const planned = tasks.decompose(parentTask.claim!, [{ key: 'worker', contract: contract('Worker execution contract') }], 'worker-plan')[0];
    tasks.start({ taskNodeId: planned.contract.taskNodeId }, child, 'generation-child', 'worker-start');
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    delete document.profiles[0].sessionStates[child];
    await writeFile(state.store, JSON.stringify(document));
    runs.set('run-child', { active: true, quiescent: false, generation: 'generation-child',
      delegation: { parentSessionKey: parent, parentGeneration: 'old', workspaceDir: state.root } });
    await expect(owner.admitTaskEffect(request(child, 'run-child', 'generation-child'))).rejects.toThrow('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
    runs.get('run-child')!.delegation!.parentGeneration = 'generation-parent';
    runs.get('run-child')!.delegation!.taskReference = { taskRef: parentClaim.claim.taskNodeId,
      coordinator: { workspaceId: 'workspace-a', sessionKey: parent, sessionGeneration: 'generation-parent', bindingRevision: parentClaim.bindingRevision } };
    const nextTask = startTask(parent, 'generation-parent', 'Later parent execution');
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    await owner.selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: nextTask.contract.taskNodeId,
      expectedSessionGeneration: 'generation-parent', expectedRevision: parentClaim.bindingRevision });
    const childClaim = await owner.admitTaskEffect(request(child, 'run-child', 'generation-child'));
    expect(childClaim.claim.id).not.toBe(parentClaim.claim.id);
    expect(childClaim.claim.taskNodeId).toBe(planned.contract.taskNodeId);
    expect(tasks.get(childClaim.claim.taskNodeId).parentTaskNodeId).toBe(parentTask.contract.taskNodeId);
    expect(tasks.assertOwner(childClaim.claim.credential!).claim?.sessionKey).toBe(child);
    expect((await binding())?.activeTaskNodeId).toBe(nextTask.contract.taskNodeId);
    expect(tasks.list()).toHaveLength(3);
  });
  it('pauses new dispatch while retaining the already admitted writer and workgroup ownership', async () => {
    startTask();
    const owner = api();
    const admitted = await owner.admitTaskEffect(request());
    await owner.pauseCoordinator({ workspaceId: 'workspace-a', sessionKey: parent, agentId: 'main', expectedRevision: admitted.bindingRevision });
    expect((await owner.admitTaskEffect({ ...request(), expectedClaimId: admitted.claim.id })).claim.id).toBe(admitted.claim.id);
    runs.set('new-run', { active: true, quiescent: false, generation: 'generation-parent' });
    await expect(owner.admitTaskEffect(request(parent, 'new-run'))).rejects.toThrow('TASK_SCOPE_BINDING_NOT_READY');
    const created = await owner.createFolder({ workspaceId: 'workspace-a', name: 'Independent workgroup', parentId: null });
    await owner.moveSessionToFolder({ workspaceId: 'workspace-a', sessionKey: parent, folderId: created.profiles[0].sessionFolders![0].id });
    expect((await binding())?.writerClaim?.taskNodeId).toBe(admitted.claim.taskNodeId);
    expect(tasks.assertOwner(admitted.claim.credential!).claim?.attemptId).toBe(admitted.claim.id);
  });
  it('keeps ten discussion/read turns empty, then reuses one canonical contract at the guarded effect boundary', async () => {
    const context = { sessionKey: parent, sessionId: 'generation-parent', runId: 'run-parent', workspaceDir: state.root };
    const read = vi.fn(async () => readFile(join(state.root, 'owner-proof.json'), 'utf8'));
    for (let turn = 0; turn < 10; turn++) await withSessionTaskScope(context, 'read', { path: 'owner-proof.json' }, undefined, read);
    expect(tasks.list()).toHaveLength(0);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes).toHaveLength(0);
    expect(state.invoke).not.toHaveBeenCalled();
    const guard = createTaskRuntimeGuard(state.root, parent, 'generation-parent', 'run-parent');
    const task = startTask();
    for (let retry = 0; retry < 3; retry++) await withSessionTaskScope(context, 'write', {}, undefined,
      () => executeTaskGuarded(guard, 'run-parent:effect-' + retry, 'write',
        () => writeFile(join(state.root, 'effect-result.txt'), proof), { path: 'effect-result.txt', content: proof }));
    const snapshot = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot;
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.sessionLinks).toHaveLength(1);
    expect(snapshot.nodes[0]).toMatchObject({ id: task.contract.taskNodeId, kind: 'task', status: 'doing',
      metadata: { readonlyProjection: true, source: 'task-ledger.execution-contract' } });
    const events = (await readTaskLedgerEvents('workspace-a')).events;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_linked');
    expect((await binding())?.writerClaim?.id).toBe(task.claim!.attemptId);
    expect(await readFile(join(state.root, 'effect-result.txt'), 'utf8')).toBe(proof);
    expect(tasks.list()).toHaveLength(1);
  });
  it('captures checkout execution revision while allowing the admitted run through coordinator pause', async () => {
    startTask();
    const owner = api();
    const first = await owner.admitTaskEffect({ ...request(), operationId: 'run-parent:write-1', checkoutAccess: 'write' });
    expect(first.checkout?.credential.owner).toMatchObject({ kind: 'run', bindingRevision: first.claim.executionRevision,
      task: { taskNodeId: first.claim.taskNodeId, epoch: first.claim.credential!.epoch } });
    await owner.pauseCoordinator({ workspaceId: 'workspace-a', agentId: 'main', sessionKey: parent,
      expectedRevision: first.bindingRevision });
    const next = await owner.admitTaskEffect({ ...request(), operationId: 'run-parent:write-2', checkoutAccess: 'write',
      expectedClaimId: first.claim.id, expectedExecutionRevision: first.claim.executionRevision });
    expect(next.bindingRevision).toBeGreaterThan(first.bindingRevision);
    expect(next.checkout?.credential).toEqual(first.checkout?.credential);
    await expect(owner.admitTaskEffect({ ...request(), operationId: 'run-parent:stale', checkoutAccess: 'write',
      expectedClaimId: first.claim.id, expectedExecutionRevision: first.claim.executionRevision! + 1 })).rejects.toThrow('TASK_SCOPE_BINDING_FENCED');
  });
  it('rejects effects on a completed canonical task, including after owner reconstruction', async () => {
    const original = await existingTask();
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    await api().selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: original.id,
      expectedSessionGeneration: 'generation-parent', expectedRevision: 0 });
    runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-parent' });
    await expect(api().admitTaskEffect(request())).rejects.toThrow('TASK_NOT_CLAIMABLE');
    tasks.close(); tasks = new TaskSystemStore(resolveTaskDomain(state.root));
    await expect(api().admitTaskEffect(request())).rejects.toThrow('TASK_NOT_CLAIMABLE');
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes[0]).toEqual(original);
    expect(tasks.list()).toHaveLength(1);
  });
  it('rejects a Legacy done node without creating a canonical replacement or changing it to doing', async () => {
    const created = await ledger.createNode({ workspaceId: 'workspace-a', node: { title: 'Legacy completed task', kind: 'task', status: 'done' } });
    const legacy = created.snapshot.nodes[0];
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    await api().selectSessionTask({ workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: legacy.id,
      expectedSessionGeneration: 'generation-parent', expectedRevision: 0 });
    runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-parent' });
    await expect(api().admitTaskEffect(request())).rejects.toThrow('TASK_LEGACY_CONTRACT_REQUIRED');
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes[0]).toEqual(legacy);
    expect(tasks.list()).toHaveLength(0);
  });
  it('keeps a Fork reference read-only until an explicit fresh canonical claim, then fences the old token', async () => {
    const task = startTask();
    const first = await api().admitTaskEffect(request());
    expect(tasks.inheritReference(parent, 'generation-parent', child, 'generation-child')?.referenceOnly).toBe(true);
    const fork = request(child, 'run-child', 'generation-child');
    await expect(api().admitTaskEffect(fork)).rejects.toThrow('TASK_REFERENCE_READ_ONLY');
    expect(() => tasks.start({ taskNodeId: task.contract.taskNodeId }, child, 'generation-child', 'fork-busy')).toThrow('TASK_ALREADY_CLAIMED');
    expect(await binding(child)).toBeUndefined();
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    await expect(api().admitTaskEffect(fork)).rejects.toThrow('TASK_REFERENCE_READ_ONLY');
    tasks.control(first.claim.credential!, 'release');
    const fresh = tasks.start({ taskNodeId: task.contract.taskNodeId }, child, 'generation-child', 'fork-fresh');
    const second = await api().admitTaskEffect(fork);
    expect(second.claim.id).toBe(fresh.claim!.attemptId);
    expect(second.claim.id).not.toBe(first.claim.id);
    expect(second.claim.credential!.epoch).toBeGreaterThan(first.claim.credential!.epoch);
    expect((await binding())?.writerClaim).toBeUndefined();
    expect(() => tasks.assertOwner(first.claim.credential!)).toThrow('TASK_STALE_OWNER');
    runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-parent' });
    await expect(api().admitTaskEffect({ ...request(), expectedClaimId: first.claim.id })).rejects.toThrow('TASK_SCOPE_WRITER_FENCED');
  });
  it('does not release a live canonical claim because a new API instance or response settled', async () => {
    const task = startTask();
    const first = await api().admitTaskEffect(request());
    const credential = { taskNodeId: task.contract.taskNodeId, sessionKey: parent,
      generation: 'generation-parent', epoch: task.claim!.epoch };
    expect(first.claim.credential).toEqual(credential);
    tasks.close(); tasks = new TaskSystemStore(resolveTaskDomain(state.root));
    const rebuilt = api();
    await rebuilt.saveState({ id: 'workspace-a', sessionKey: parent, state: { draftInput: 'Owner rebuilt draft' } });
    expect((await binding())?.writerClaim?.credential).toEqual(credential);
    const reread = await rebuilt.admitTaskEffect({ ...request(), expectedClaimId: first.claim.id });
    expect(reread.claim.credential).toEqual(credential);
    runs.set('run-child', { active: false, quiescent: true, generation: 'generation-child' });
    await api().selectSessionTask({ workspaceId: 'workspace-a', sessionKey: child, taskNodeId: task.contract.taskNodeId,
      expectedSessionGeneration: 'generation-child', expectedRevision: 0 });
    runs.set('run-child', { active: true, quiescent: false, generation: 'generation-child' });
    const second = request(child, 'run-child', 'generation-child');
    await expect(api().admitTaskEffect(second)).rejects.toThrow('TASK_SCOPE_WRITER_BUSY');
    await expect(api().admitTaskEffect(second)).rejects.toThrow('TASK_SCOPE_WRITER_BUSY');
    expect(tasks.get(task.contract.taskNodeId).claim?.attemptId).toBe(first.claim.id);
    expect((await binding())?.writerClaim?.credential).toEqual(credential);
    expect(tasks.binding(child)).toMatchObject({ referenceOnly: true, claim: { sessionKey: parent } });
  });
  it('rejects an old claim after canonical epoch rotation even when the Workspace cache still has it', async () => {
    const task = startTask();
    const first = await api().admitTaskEffect(request());
    const credential = { taskNodeId: task.contract.taskNodeId, sessionKey: parent,
      generation: 'generation-parent', epoch: task.claim!.epoch };
    expect(first.claim.credential).toEqual(credential);
    tasks.control(first.claim.credential!, 'release');
    const fresh = tasks.start({ taskNodeId: task.contract.taskNodeId }, parent, 'generation-parent', 'new-owner-epoch');
    const rebuilt = api();
    await rebuilt.saveState({ id: 'workspace-a', sessionKey: parent, state: { draftInput: 'Keep the stale claim fenced' } });
    expect((await binding())?.writerClaim?.id).toBe(first.claim.id);
    expect((await binding())?.writerClaim?.credential).toEqual(credential);
    await expect(rebuilt.admitTaskEffect({ ...request(), expectedClaimId: first.claim.id })).rejects.toThrow('TASK_STALE_OWNER');
    expect(tasks.get(task.contract.taskNodeId).claim?.attemptId).toBe(fresh.claim!.attemptId);
    expect(() => tasks.assertOwner(first.claim.credential!)).toThrow('TASK_STALE_OWNER');
  });
  it('preserves writer fields across UI saves and transfers Handoff through the canonical epoch interface', async () => {
    const task = startTask();
    const owner = api();
    const first = await owner.admitTaskEffect(request());
    const credential = { taskNodeId: task.contract.taskNodeId, sessionKey: parent,
      generation: 'generation-parent', epoch: task.claim!.epoch };
    expect(first.claim.credential).toEqual(credential);
    await owner.saveState({ id: 'workspace-a', sessionKey: parent, state: { draftInput: 'my draft' } });
    expect((await binding())?.writerClaim?.id).toBe(first.claim.id);
    expect((await binding())?.writerClaim?.credential).toEqual(credential);
    const rebuilt = api();
    const reread = await rebuilt.admitTaskEffect({ ...request(), expectedClaimId: first.claim.id });
    expect(reread.claim.credential).toEqual(credential);
    await rebuilt.saveState({ id: 'workspace-a', sessionKey: parent, state: { draftInput: 'my restored draft' } });
    expect((await binding())?.writerClaim?.credential).toEqual(credential);
    tasks.beginOperation(first.claim.credential!, 'handoff-pending', 'write');
    expect(() => handoffManagedSessionTask({ workspaceRoot: state.root, sourceSessionKey: parent,
      sourceGeneration: 'generation-parent', sessionKey: child, generation: 'generation-child' })).toThrow('TASK_OPERATIONS_PENDING');
    tasks.finishOperation(first.claim.credential!, 'handoff-pending', 'completed', 'owner finished');
    const transferred = handoffManagedSessionTask({ workspaceRoot: state.root, sourceSessionKey: parent,
      sourceGeneration: 'generation-parent', sessionKey: child, generation: 'generation-child' })!;
    expect(transferred.contract.taskNodeId).toBe(task.contract.taskNodeId);
    expect(transferred.claim!.epoch).toBeGreaterThan(first.claim.credential!.epoch);
    expect(() => tasks.assertOwner(first.claim.credential!)).toThrow('TASK_STALE_OWNER');
    await owner.coordinatorLifecycle({ type: 'handoff', workspaceId: 'workspace-a', sourceSessionKey: parent, sessionKey: child, agentId: 'main' });
    expect((await binding(child))?.writerClaim).toBeUndefined();
    await expect(owner.admitTaskEffect(request())).rejects.toThrow('TASK_SCOPE_BINDING_NOT_READY');
    const activeParentHandoff = await owner.admitTaskEffect(request(child, 'run-child', 'generation-child'));
    expect(activeParentHandoff.claim.id).toBe(transferred.claim!.attemptId);
    runs.set('run-parent', { active: false, quiescent: true, generation: 'generation-parent' });
    const handed = await owner.admitTaskEffect(request(child, 'run-child', 'generation-child'));
    expect(handed.claim.id).toBe(transferred.claim!.attemptId);
    const transferredCredential = { taskNodeId: task.contract.taskNodeId, sessionKey: child,
      generation: 'generation-child', epoch: transferred.claim!.epoch };
    expect(handed.claim.credential).toEqual(transferredCredential);
    expect((await binding(child))?.writerClaim?.credential).toEqual(transferredCredential);
    const links = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.sessionLinks;
    expect(links.some(link => link.nodeId === task.contract.taskNodeId && link.sessionKey === parent && link.sessionGeneration === 'generation-parent')).toBe(true);
    expect(links.some(link => link.nodeId === task.contract.taskNodeId && link.sessionKey === child && link.sessionGeneration === 'generation-child')).toBe(true);
  });
  it.each([
    ['unknown session', { sessionKey: 'agent:main:unknown' }, 'TASK_SCOPE_WORKSPACE_UNAVAILABLE'],
    ['wrong root', { workspaceDir: resolve(state.root || '.', '..') }, 'TASK_SCOPE_WORKSPACE_MISMATCH'],
    ['stale generation', { sessionGeneration: 'old' }, 'TASK_SCOPE_RUN_STALE'],
    ['forged claim', { expectedClaimId: 'someone-elses-claim' }, 'TASK_SCOPE_WRITER_FENCED'],
  ])('rejects %s before writing a task', async (_label, patch, error) => {
    await expect(api().admitTaskEffect({ ...request(), ...patch })).rejects.toThrow(error);
    expect(tasks.list()).toHaveLength(0);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes).toHaveLength(0);
  });
  it('rejects foreign workspace identity and a changed session generation without manufacturing a replacement', async () => {
    const task = startTask();
    await api().admitTaskEffect(request());
    runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-parent', workspaceId: 'workspace-b' });
    await expect(api().admitTaskEffect(request())).rejects.toThrow('TASK_SCOPE_WORKSPACE_UNAVAILABLE');
    runs.set('run-parent', { active: true, quiescent: false, generation: 'generation-new' });
    await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey: parent,
      sessionGeneration: 'generation-old', nodeId: task.contract.taskNodeId });
    expect((await readTaskLedgerEvents('workspace-a')).events.some(event =>
      event.type === 'session_linked' && event.payload.sessionLink?.sessionGeneration === 'generation-old')).toBe(true);
    await expect(api().admitTaskEffect(request(parent, 'run-parent', 'generation-new'))).rejects.toThrow('TASK_SCOPE_GENERATION_STALE');
    expect(tasks.list().map(view => view.contract.taskNodeId)).toEqual([task.contract.taskNodeId]);
    expect(tasks.get(task.contract.taskNodeId).claim?.generation).toBe('generation-parent');
  });
  it('fences a generation change while admission is awaiting its final live owner read', async () => {
    const task = startTask();
    const owner = api((_runId, readCount) => {
      if (readCount === 2) runs.get('run-parent')!.generation = 'generation-new';
    });
    await expect(owner.admitTaskEffect(request())).rejects.toThrow('TASK_SCOPE_RUN_STALE');
    expect(await binding()).toBeUndefined();
    expect(tasks.get(task.contract.taskNodeId).claim?.generation).toBe('generation-parent');
    expect(tasks.list()).toHaveLength(1);
  });
  it('leaves a selected task unclaimed when the final run check fails', async () => {
    const task = tasks.create(contract('Selected but not yet executing'), 'selected-only').task;
    tasks.selectReference(task.contract.taskNodeId, parent, 'generation-parent', 'select-only');
    await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey: parent,
      sessionGeneration: 'generation-parent', nodeId: task.contract.taskNodeId });
    const owner = api((_runId, readCount) => {
      if (readCount === 2) runs.get('run-parent')!.generation = 'generation-new';
    });
    await expect(owner.admitTaskEffect(request())).rejects.toThrow('TASK_SCOPE_RUN_STALE');
    expect(tasks.get(task.contract.taskNodeId).claim).toBeNull();
    expect(tasks.get(task.contract.taskNodeId).contract.state).toBe('ready');
    expect(tasks.binding(parent, 'generation-parent')?.referenceOnly).toBe(true);
    expect(await binding()).toBeUndefined();
  });
  it('rejects a contract revision changed after resolution without claiming the revised task', async () => {
    const task = tasks.create(contract('Initially selected objective'), 'revision-race').task;
    tasks.selectReference(task.contract.taskNodeId, parent, 'generation-parent', 'select-before-revise');
    await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey: parent,
      sessionGeneration: 'generation-parent', nodeId: task.contract.taskNodeId });
    const owner = api((_runId, readCount) => {
      if (readCount === 2) tasks.revise(task.contract.taskNodeId, task.contract.revision, contract('Changed objective'));
    });
    await expect(owner.admitTaskEffect(request())).rejects.toThrow('TASK_CONTRACT_STALE');
    expect(tasks.get(task.contract.taskNodeId).claim).toBeNull();
    expect(tasks.get(task.contract.taskNodeId).contract.revision).toBe(task.contract.revision + 1);
    expect(await binding()).toBeUndefined();
    const snapshot = (await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot;
    expect(snapshot.sessionLinks.some(link => link.id.startsWith('execution-link:'))).toBe(false);
  });
  it('blocks task selection and rebinding on session resources even without a Workspace writer', async () => {
    const task = await existingTask([parent], 'todo');
    runs.set('run-parent', { active: false, quiescent: false, generation: 'generation-parent' });
    const owner = api();
    const selection = { workspaceId: 'workspace-a', sessionKey: parent, taskNodeId: task.id,
      expectedSessionGeneration: 'generation-parent', expectedRevision: 0 };
    await expect(owner.selectSessionTask(selection)).rejects.toThrow('TASK_SCOPE_WRITER_BUSY');
    expect(tasks.get(task.id).claim).toBeNull();
    expect(await binding()).toBeUndefined();
    runs.get('run-parent')!.quiescent = true;
    const selected = await owner.selectSessionTask(selection);
    expect(selected.binding?.writerClaim).toBeUndefined();
    const nextTask = tasks.create(contract('Another task'), 'another-task').task;
    runs.get('run-parent')!.quiescent = false;
    await expect(owner.bindCoordinator({ workspaceId: 'workspace-a', agentId: 'main', sessionKey: parent,
      expectedRevision: selected.binding!.bindingRevision, taskLedgerNodeIds: [nextTask.contract.taskNodeId],
      environment: { kind: 'local', rootPath: state.root }, archiveRestorePolicy: 'restore',
    })).rejects.toThrow('TASK_SCOPE_TASK_SWITCH_BLOCKED');
    expect((await binding())?.activeTaskNodeId).toBe(task.id);
  });
  it('requires explicit canonical selection for multiple links and rejects an external reference as a task', async () => {
    const first = await existingTask([parent], 'todo');
    const second = await existingTask([parent], 'todo');
    await expect(api().admitTaskEffect(request())).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(tasks.list()).toHaveLength(2);
    tasks.start({ taskNodeId: first.id }, parent, 'generation-parent', 'explicit-linked-selection');
    expect((await api().admitTaskEffect(request())).claim.taskNodeId).toBe(first.id);
    expect(tasks.get(second.id).claim).toBeNull();
    await ledger.linkSession({ workspaceId: 'workspace-a', sessionKey: child, nodeId: 'external:forest:TF-1' });
    runs.set('run-child', { active: false, quiescent: true, generation: 'generation-child' });
    await expect(api().selectSessionTask({ workspaceId: 'workspace-a', sessionKey: child, taskNodeId: 'external:forest:TF-1',
      expectedSessionGeneration: 'generation-child', expectedRevision: 0 })).rejects.toThrow('TASK_SCOPE_TASK_NOT_FOUND');
    runs.set('run-child', { active: true, quiescent: false, generation: 'generation-child' });
    await expect(api().admitTaskEffect(request(child, 'run-child', 'generation-child'))).rejects.toThrow('TASK_CLAIM_REQUIRED');
    expect(tasks.binding(child)).toBeNull();
    expect(tasks.list()).toHaveLength(2);
  });
  it('does not silently switch a running canonical task through coordinator rebinding', async () => {
    const initial = startTask();
    const owner = api();
    const admitted = await owner.admitTaskEffect(request());
    const other = tasks.create(contract('Other task'), 'other-contract').task;
    await expect(owner.bindCoordinator({ workspaceId: 'workspace-a', agentId: 'main', sessionKey: parent,
      expectedRevision: admitted.bindingRevision, taskLedgerNodeIds: [other.contract.taskNodeId],
      environment: { kind: 'local', rootPath: state.root }, archiveRestorePolicy: 'restore',
    })).rejects.toThrow('COORDINATOR_BINDING_SWITCH_BLOCKED');
    expect((await binding())?.activeTaskNodeId).toBe(initial.contract.taskNodeId);
    expect(tasks.binding(parent, 'generation-parent')?.claim?.attemptId).toBe(initial.claim!.attemptId);
  });
  it('requires admission for unknown MCP effects and checks cancellation before execution', async () => {
    const effect = vi.fn(async () => undefined);
    const context = { sessionKey: parent, sessionId: 'generation-parent', runId: 'run-parent', workspaceDir: state.root };
    state.invoke.mockRejectedValueOnce(new Error('TASK_SCOPE_WRITER_BUSY'));
    await expect(withSessionTaskScope(context, 'mcp_unknown', { action: 'get' }, undefined, effect)).rejects.toThrow('TASK_SCOPE_WRITER_BUSY');
    const controller = new AbortController(); controller.abort();
    await expect(withSessionTaskScope(context, 'write', {}, controller.signal, effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(tasks.list()).toHaveLength(0);
  });
  it('cancels an effect after Main admission without releasing or upgrading its canonical claim', async () => {
    const task = startTask();
    const controller = new AbortController();
    state.invoke.mockImplementationOnce(async ({ params }) => {
      const result = await api().admitTaskEffect(params);
      controller.abort();
      return result;
    });
    const effect = vi.fn(async () => undefined);
    const context = { sessionKey: parent, sessionId: 'generation-parent', runId: 'run-parent', workspaceDir: state.root };
    await expect(withSessionTaskScope(context, 'write', {}, controller.signal, effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(tasks.get(task.contract.taskNodeId).claim?.attemptId).toBe(task.claim!.attemptId);
    expect(tasks.list()).toHaveLength(1);
    expect(startManagedSessionEffect({ workspaceRoot: state.root, sessionKey: parent, generation: 'generation-parent',
      requestId: 'owner-readback' }).claim?.attemptId).toBe(task.claim!.attemptId);
  });
});
