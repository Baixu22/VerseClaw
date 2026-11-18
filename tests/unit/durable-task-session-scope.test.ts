// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import type { TaskContractInput } from '../../shared/task-system/types';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '../../shared/types/workspace';
import { getProjectCoordinatorProfiles, getWorkspaceRootPathById } from '../../electron/services/workspaces-api';

vi.mock('../../electron/services/workspaces-api', () => ({ getPersistedCoordinatorBinding: vi.fn(), getWorkspaceRootPathById: vi.fn(), getProjectCoordinatorProfiles: vi.fn().mockResolvedValue([]) }));
import { handoffManagedSessionTask, readSessionTask, selectManagedSessionTask, startManagedSessionEffect } from '../../electron/services/task-system-service';

let root: string;
let store: TaskSystemStore | undefined;
const bytes = 'recorded result\n';
const sha = createHash('sha256').update(bytes).digest('hex');
const contract: TaskContractInput = { objective: 'Write the agreed result', target: 'result.txt', constraints: ['Keep prior work'],
  acceptance: [{ id: 'result', description: 'Exact result bytes', verification: { kind: 'file-sha256', path: 'result.txt', sha256: sha } }] };
const effect = (taskNodeId?: string, sessionKey = 'source', generation = 'generation-source', requestId = 'effect') =>
  startManagedSessionEffect({ workspaceRoot: root, taskNodeId, sessionKey, generation, requestId });
const owner = () => {
  store = new TaskSystemStore(resolveTaskDomain(root));
  const task = store.create(contract, 'create').task;
  return effect(task.contract.taskNodeId);
};
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'session-contract-')); vi.mocked(getProjectCoordinatorProfiles).mockResolvedValue([]); });
afterEach(() => { store?.close(); store = undefined; rmSync(root, { recursive: true, force: true }); });

describe('session bridge consumes the persistent task owner', () => {
  it('reads project plans only through the current Workspace coordinator binding', async () => {
    owner();
    const plan = store!.saveProjectPlan({ workspaceId: 'workspace', sessionKey: 'source', generation: 'generation-source' }, {
      requestId: 'project-goal', goal: contract, nextAction: 'Record the result', children: [{ key: 'record', contract }],
    });
    const binding: WorkspaceCoordinatorBinding = { schemaVersion: 1, workspaceId: 'workspace', agentId: 'main',
      sessionKey: 'source', sessionGeneration: 'generation-source', state: 'active', taskLedgerReferences: [],
      environment: { kind: 'local', canonicalRoot: root, backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null },
      archiveRestorePolicy: 'none', bindingRevision: 1, invalidationReason: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    const profile: WorkspaceProfile = { id: 'workspace', name: 'Project', rootPath: root, agentId: 'main',
      activeSessionKey: 'source', permissionMode: 'fullAccess', createdAt: 0, updatedAt: 0, lastOpenedAt: 0, state: {},
      projectCoordinatorSessionKey: 'source', coordinatorBindings: { source: binding } };
    vi.mocked(getWorkspaceRootPathById).mockResolvedValue(root);
    vi.mocked(getProjectCoordinatorProfiles).mockResolvedValue([profile]);
    const gateway = { rpc: vi.fn().mockResolvedValue({ session: { sessionId: 'generation-source' } }) } as unknown as GatewayManager;
    expect((await readSessionTask('workspace', 'source', gateway)).projectPlan?.task.contract.taskNodeId).toBe(plan.taskNodeId);
    expect((await readSessionTask('foreign-project', 'source', gateway)).projectPlan).toBeUndefined();
    binding.sessionGeneration = 'old-generation';
    await expect(readSessionTask('workspace', 'source', gateway)).rejects.toThrow('TASK_GENERATION_STALE');
    binding.sessionGeneration = 'generation-source';
    binding.state = 'invalid';
    await expect(readSessionTask('workspace', 'source', gateway)).rejects.toThrow('TASK_PROJECT_COORDINATOR_REQUIRED');
  });
  it('reads actual verifier receipts without promoting a doing task to accepted', async () => {
    const task = owner();
    writeFileSync(join(root, 'result.txt'), bytes);
    const receipt = store!.verifyFile(task.claim!, 'result', 'result.txt', sha, sha);
    vi.mocked(getWorkspaceRootPathById).mockResolvedValue(root);
    const gateway = { rpc: vi.fn().mockResolvedValue({ session: { sessionId: 'generation-source' } }) } as unknown as GatewayManager;
    const snapshot = await readSessionTask('workspace', 'source', gateway, 'generation-source');
    expect(snapshot.verificationReceipts).toEqual([receipt]);
    expect(snapshot.verificationReceipts?.[0].candidate).toBe(sha);
    expect(snapshot.task?.contract.state).toBe('doing');
  });
  it('fences worker acceptance reads before and after a session generation changes', async () => {
    const task = owner();
    vi.mocked(getWorkspaceRootPathById).mockResolvedValue(root);
    const rpc = vi.fn().mockResolvedValue({ session: { sessionId: 'generation-source' } });
    const gateway = { rpc } as unknown as GatewayManager;
    expect((await readSessionTask('workspace', 'source', gateway, 'generation-source')).task?.contract.taskNodeId).toBe(task.contract.taskNodeId);
    rpc.mockResolvedValue({ session: { sessionId: 'replacement-generation' } });
    await expect(readSessionTask('workspace', 'source', gateway, 'generation-source')).rejects.toThrow('TASK_GENERATION_STALE');
    rpc.mockReset().mockResolvedValueOnce({ session: { sessionId: 'generation-source' } })
      .mockResolvedValueOnce({ session: { sessionId: 'replacement-generation' } });
    await expect(readSessionTask('workspace', 'source', gateway, 'generation-source')).rejects.toThrow('TASK_GENERATION_STALE');
    expect(store!.get(task.contract.taskNodeId).claim).toEqual(task.claim);
  });
  it.each([1, 2])('keeps the task owner readable when generation check %s takes twelve seconds', async (slowRead) => {
    const task = owner();
    vi.mocked(getWorkspaceRootPathById).mockResolvedValue(root);
    let reads = 0;
    vi.useFakeTimers();
    try {
      const rpc = vi.fn((_method: string, _params?: unknown, timeoutMs = 30_000) => new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('RPC timeout: sessions.describe')), timeoutMs);
        setTimeout(() => {
          clearTimeout(deadline);
          resolve({ session: { sessionId: 'generation-source' } });
        }, ++reads === slowRead ? 12_000 : 1);
      }));
      const reading = readSessionTask('workspace', 'source', { rpc } as unknown as GatewayManager, 'generation-source')
        .then(value => ({ value }), error => ({ error: String(error) }));
      await vi.advanceTimersByTimeAsync(12_010);
      expect(await reading).toMatchObject({ value: { task: { contract: { taskNodeId: task.contract.taskNodeId } } } });
      expect(reads).toBe(2);
      expect(store!.get(task.contract.taskNodeId).claim).toEqual(task.claim);
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
  it('rejects effects without a contract without creating a database', () => {
    expect(() => effect()).toThrow('TASK_CLAIM_REQUIRED');
    expect(existsSync(resolveTaskDomain(root).database)).toBe(false);
  });
  it('reuses the canonical TaskID and writer attempt across admission retries', () => {
    const task = owner();
    expect(effect().contract.taskNodeId).toBe(task.contract.taskNodeId);
    expect(effect().claim).toEqual(task.claim);
    expect(store!.page().tasks).toHaveLength(1);
  });
  it('rejects a legacy reference without inventing a contract or upgrading its state', () => {
    store = new TaskSystemStore(resolveTaskDomain(root));
    expect(() => effect('legacy-blocked-task')).toThrow('TASK_LEGACY_CONTRACT_REQUIRED');
    expect(store.page().tasks).toHaveLength(0);
  });
  it('rejects a second writer and a stale generation at the new entry point', () => {
    const task = owner();
    expect(() => effect(task.contract.taskNodeId, 'other', 'generation-other', 'other-effect')).toThrow('TASK_ALREADY_CLAIMED');
    expect(() => effect(task.contract.taskNodeId, 'source', 'new-generation', 'new-effect')).toThrow('TASK_GENERATION_STALE');
    expect(store!.get(task.contract.taskNodeId).claim).toEqual(task.claim);
  });
  it('keeps fork references read only until an explicit new owner is granted', () => {
    const task = owner();
    store!.inheritReference('source', 'generation-source', 'fork', 'generation-fork');
    expect(() => effect(task.contract.taskNodeId, 'fork', 'generation-fork', 'fork-effect')).toThrow('TASK_REFERENCE_READ_ONLY');
    expect(store!.get(task.contract.taskNodeId).claim).toEqual(task.claim);
  });
  it('uses the existing handoff epoch and fences the previous credential', () => {
    const task = owner();
    const next = handoffManagedSessionTask({ workspaceRoot: root, sourceSessionKey: 'source', sourceGeneration: 'generation-source',
      sessionKey: 'child', generation: 'generation-child' })!;
    expect(next.contract.taskNodeId).toBe(task.contract.taskNodeId);
    expect(next.claim!.epoch).toBe(task.claim!.epoch + 1);
    expect(() => store!.assertOwner(task.claim!)).toThrow('TASK_STALE_OWNER');
    expect(effect(undefined, 'child', 'generation-child', 'child-effect').claim).toEqual(next.claim);
    expect(handoffManagedSessionTask({ workspaceRoot: root, sourceSessionKey: 'source', sourceGeneration: 'generation-source',
      sessionKey: 'child', generation: 'generation-child' })).toBeNull();
  });
  it('retains the old owner while an effect is still unresolved', () => {
    const task = owner();
    store!.beginOperation(task.claim!, 'pending-write', 'write');
    expect(() => handoffManagedSessionTask({ workspaceRoot: root, sourceSessionKey: 'source', sourceGeneration: 'generation-source',
      sessionKey: 'child', generation: 'generation-child' })).toThrow('TASK_OPERATIONS_PENDING');
    const { expiresAt, ...identity } = task.claim!;
    expect(store!.get(task.contract.taskNodeId).claim).toMatchObject(identity);
    expect(store!.get(task.contract.taskNodeId).claim!.expiresAt).toBeGreaterThanOrEqual(expiresAt);
  });
  it('keeps an accepted task closed when selected for another effect', () => {
    const task = owner();
    writeFileSync(join(root, 'result.txt'), bytes);
    store!.submit(task.claim!, 'candidate');
    store!.verifyFile(task.claim!, 'result', join(root, 'result.txt'), sha, 'candidate');
    store!.accept(task.claim!, 'candidate');
    expect(() => effect(task.contract.taskNodeId, 'source', 'generation-source', 'after-accept')).toThrow('TASK_NOT_CLAIMABLE');
    expect(store!.get(task.contract.taskNodeId).contract.state).toBe('done');
  });
  it('retains task identity and writer exclusivity when runtime bootstrap initializes Git', () => {
    const task = owner();
    const originalDomain = resolveTaskDomain(root);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git('init');
    const after = resolveTaskDomain(root);
    expect(after.id).toBe(originalDomain.id);
    expect(after.database).toBe(originalDomain.database);
    expect(effect().claim).toEqual(task.claim);
    writeFileSync(join(root, 'fixture.txt'), 'agent fixture');
    git('add', '--', 'fixture.txt');
    git('-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'Create isolated worktree fixture');
    const worktree = join(root, 'child-worktree');
    git('worktree', 'add', '--detach', worktree, 'HEAD');
    expect(resolveTaskDomain(worktree).id).toBe(originalDomain.id);
    expect(resolveTaskDomain(worktree).database).toBe(originalDomain.database);
    expect(() => startManagedSessionEffect({ workspaceRoot: worktree, taskNodeId: task.contract.taskNodeId,
      sessionKey: 'other', generation: 'generation-other', requestId: 'other-worktree' })).toThrow('TASK_ALREADY_CLAIMED');
  });
  it('rejects conflicting stores after repository initialization', () => {
    owner();
    execFileSync('git', ['init'], { cwd: root, windowsHide: true, stdio: 'pipe' });
    const gitStore = join(root, '.git', 'verse-claw');
    mkdirSync(gitStore, { recursive: true });
    writeFileSync(join(gitStore, 'task-ledger.sqlite3'), 'conflicting store fixture');
    expect(() => resolveTaskDomain(root)).toThrow('TASK_DOMAIN_STORES_CONFLICT');
  });
  it('rejects a conflicting explicit task instead of reverting the selection', () => {
    const a = owner();
    const b = store!.create({ ...contract, objective: 'Independent selected task' }, 'create-b').task;
    expect(() => effect(b.contract.taskNodeId)).toThrow('TASK_SCOPE_TASK_SELECTION_CONFLICT');
    expect(store!.binding('source', 'generation-source')?.contract.taskNodeId).toBe(a.contract.taskNodeId);
  });
  it('selects another canonical task without changing its state and grants only its next execution', () => {
    const a = owner();
    const b = store!.create({ ...contract, objective: 'Independent selected task' }, 'create-b').task;
    selectManagedSessionTask({ workspaceRoot: root, taskNodeId: b.contract.taskNodeId, sessionKey: 'source',
      generation: 'generation-source', requestId: 'select-b' });
    expect(store!.get(b.contract.taskNodeId).contract.state).toBe('ready');
    expect(store!.get(a.contract.taskNodeId).claim?.state).toBe('released');
    expect(store!.binding('source', 'generation-source')?.referenceOnly).toBe(true);
    expect(effect(b.contract.taskNodeId, 'source', 'generation-source', 'execute-b').contract.taskNodeId).toBe(b.contract.taskNodeId);
    expect(store!.binding('source', 'generation-source')?.referenceOnly).toBeUndefined();
  });
  it('retains the current task when an execution or an unknown operation blocks selection', () => {
    const a = owner();
    const b = store!.create({ ...contract, objective: 'Blocked selection target' }, 'create-b').task;
    store!.beginRun(a.claim!, 'active-run');
    const select = () => selectManagedSessionTask({ workspaceRoot: root, taskNodeId: b.contract.taskNodeId,
      sessionKey: 'source', generation: 'generation-source', requestId: 'select-b' });
    expect(select).toThrow('TASK_RUN_ALREADY_ACTIVE');
    store!.endRun(a.claim!, 'active-run');
    store!.beginOperation(a.claim!, 'unknown-write', 'write');
    store!.finishOperation(a.claim!, 'unknown-write', 'unknown', 'Response lost');
    expect(select).toThrow('TASK_OPERATIONS_PENDING');
    expect(store!.binding('source', 'generation-source')?.contract.taskNodeId).toBe(a.contract.taskNodeId);
  });
});
