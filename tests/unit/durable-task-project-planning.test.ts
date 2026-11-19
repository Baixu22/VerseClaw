// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { readProjectCoordinator } from '../../shared/task-system/project-coordinator';
import { TaskSystemStore } from '../../shared/task-system/store';
import { createPersistentTaskTool } from '../../openclaw_runtime/src/agents/tools/persistent-task-tool';
import type { ProjectPlanInput, TaskContractInput, TaskPlanItem } from '../../shared/task-system/types';

const sha256 = createHash('sha256').update('proof').digest('hex');
const scope = { workspaceId: 'project-a', sessionKey: 'agent:main:project-a', generation: 'generation-1' };
const runtime = vi.hoisted(() => ({ generation: 'generation-1' }));
vi.mock('../../openclaw_runtime/src/config/sessions/store', () => ({ getSessionEntry: () => ({ sessionId: runtime.generation }) }));
const contract = (objective: string): TaskContractInput => ({
  objective, target: 'proof.txt', constraints: [], acceptance: [{
    id: 'proof', description: 'Verify the exact fixture bytes', verification: { kind: 'file-sha256', path: 'proof.txt', sha256 },
  }],
});
const initial: ProjectPlanInput = {
  requestId: 'goal-1', goal: { ...contract('Prepare a release checklist'), constraints: ['Keep the original evidence'] },
  nextAction: 'Record the checklist', assumptions: ['Existing checklist format remains compatible'],
  decisions: ['Confirm deployment scope'], children: [
    { key: 'record', contract: contract('Record the checklist') },
    { key: 'verify', contract: contract('Check the checklist'), dependsOn: ['record'] },
  ],
};

describe('project coordinator planning', () => {
  let root: string;
  let store: TaskSystemStore;
  beforeEach(() => {
    runtime.generation = scope.generation;
    root = mkdtempSync(join(tmpdir(), 'project-planning-'));
    store = new TaskSystemStore(resolveTaskDomain(root));
    writeFileSync(join(root, 'proof.txt'), 'proof');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('takes planning scope from the Workspace owner and fences stale Runtime calls', async () => {
    const ownerPath = join(root, 'workspaces.json');
    const profile = { id: scope.workspaceId, rootPath: root, projectCoordinatorSessionKey: scope.sessionKey };
    writeFileSync(ownerPath, JSON.stringify({ profiles: [profile] }));
    vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', ownerPath);
    const tool = createPersistentTaskTool({ workspace: root, sessionKey: scope.sessionKey, generation: scope.generation });
    const result = await tool.execute('plansave', { action: 'savePlan', ...initial, contract: initial.goal, workspaceId: 'foreign-project' });
    expect(result.details).toMatchObject({ workspaceId: scope.workspaceId, generation: scope.generation });
    expect(store.projectPlan(scope.workspaceId)?.children).toHaveLength(2);
    runtime.generation = 'replacement-generation';
    await expect(tool.execute('stale', { action: 'planStatus' })).rejects.toThrow('TASK_GENERATION_STALE');
    runtime.generation = scope.generation;
    writeFileSync(ownerPath, JSON.stringify({ profiles: [{ ...profile, projectCoordinatorSessionKey: 'another-session' }] }));
    await expect(tool.execute('foreign', { action: 'savePlan', ...initial, contract: initial.goal, requestId: 'foreign-write' })).rejects.toThrow('TASK_PROJECT_COORDINATOR_REQUIRED');
    expect(store.list()).toHaveLength(3);
  });

  it('releases a settled failed writer without accepting its task or unlocking its dependents', () => {
    const plan = store.saveProjectPlan(scope, { ...initial, children: [
      ...initial.children, { key: 'independent', contract: contract('Update the index') },
    ] });
    const first = store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'first').claim!;
    const d = store.prepareWriterDelegation(first, {
      delegationId: 'worker-run', childRunId: 'worker-run', childSessionKey: 'worker',
      childGeneration: 'worker-generation', childWorktree: root, mode: 'writer',
    });
    const checkpoint = { nextAction: 'Keep the failed checkpoint', completed: [], unresolved: [], artifacts: [] };
    store.checkpoint(d.child, checkpoint);
    store.beginRun(d.child, d.childRunId);
    store.beginOperation(d.child, 'pending-effect', 'write');
    const receipt = { runId: d.childRunId, endedAt: Date.now(), outcome: 'error', parentGeneration: scope.generation };
    expect(store.returnDelegatedWriter(d.child.sessionKey, receipt)?.phase).toBe('recovery_required');
    expect(() => store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'independent')).toThrow('TASK_PROJECT_WRITER_BUSY');
    store.endRun(d.child, d.childRunId);
    expect(store.returnDelegatedWriter(d.child.sessionKey, receipt)?.phase).toBe('recovery_required');
    store.finishOperation(d.child, 'pending-effect', 'completed', 'Recorded by the effect owner');
    expect(store.returnDelegatedWriter(d.child.sessionKey, { ...receipt, parentGeneration: 'stale' })?.phase).toBe('recovery_required');
    for (let i = 0; i < 2; i++) expect(store.returnDelegatedWriter(d.child.sessionKey, receipt)?.phase).toBe('returned');
    expect(store.get(first.taskNodeId)).toMatchObject({ contract: { state: 'paused' }, checkpoint, claim: { state: 'released' } });
    expect(store.getTaskEvidence(first.taskNodeId)).toEqual([]);
    expect(store.history(first.taskNodeId).filter(event => event.kind === 'project_child_paused')).toHaveLength(1);
    expect(store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'independent').claim?.taskNodeId).toBe(plan.childIds[2]);
    expect(store.get(plan.childIds[1]).claim).toBeNull();
  });

  it('holds a cancelling project writer until its worker and effects both settle', () => {
    const plan = store.saveProjectPlan(scope, initial);
    const first = store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'first').claim!;
    const d = store.prepareWriterDelegation(first, {
      delegationId: 'worker-run', childRunId: 'worker-run', childSessionKey: 'worker',
      childGeneration: 'worker-generation', childWorktree: root, mode: 'writer',
    });
    store.recordDelegationDispatch(d.child.sessionKey, d.childRunId, 'dispatched');
    store.beginOperation(d.child, 'write', 'write');
    expect(() => store.control(first, 'cancel')).toThrow('TASK_STALE_OWNER');
    expect(store.control(d.child, 'cancel').contract.state).toBe('cancelling');
    expect(() => store.beginRun(d.child, 'restarted-worker')).toThrow('TASK_EXECUTION_NOT_RUNNING');
    store.finishOperation(d.child, 'write', 'completed', 'Effect owner settled');
    expect(store.get(first.taskNodeId).contract.state).toBe('cancelling');
    expect(store.returnDelegatedWriter(d.child.sessionKey, {
      runId: d.childRunId, endedAt: Date.now(), outcome: 'ok', parentGeneration: scope.generation,
    })).toMatchObject({ phase: 'returned', terminalReceipt: { outcome: 'cancelled' } });
    expect(store.get(first.taskNodeId)).toMatchObject({ contract: { state: 'cancelled' }, claim: { state: 'released' } });
    expect(store.binding(d.child.sessionKey, d.child.generation)?.referenceOnly).toBe(true);
    expect(() => store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, 'blocked')).toThrow('TASK_PROJECT_NO_READY_CHILD');
  });

  it('checks the active Workspace and live generation before claiming, including on replay', async () => {
    const path = join(root, 'workspaces.json');
    const profiles = [{ id: scope.workspaceId, rootPath: root, projectCoordinatorSessionKey: scope.sessionKey }];
    const activate = (activeWorkspaceId: string) => writeFileSync(path, JSON.stringify({ activeWorkspaceId, profiles }));
    vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', path);
    const plan = store.saveProjectPlan(scope, initial);
    const tool = createPersistentTaskTool({ workspace: root, sessionKey: scope.sessionKey, generation: scope.generation });
    const next = () => tool.execute('next', { action: 'startNextPlanTask', taskNodeId: plan.taskNodeId, expectedRevision: 1, requestId: 'next', workspaceId: scope.workspaceId });
    activate('other-project');
    await expect(next()).rejects.toThrow('TASK_PROJECT_INACTIVE');
    expect(store.get(plan.childIds[0]).claim).toBeNull();
    activate(scope.workspaceId);
    runtime.generation = 'replaced';
    await expect(next()).rejects.toThrow('TASK_GENERATION_STALE');
    runtime.generation = scope.generation;
    expect((await next()).details).toMatchObject({ contract: { taskNodeId: plan.childIds[0] } });
    activate('other-project');
    await expect(next()).rejects.toThrow('TASK_PROJECT_INACTIVE');
  });

  it('persists the plan, provisional facts and dependencies across reopen and idempotent retries', () => {
    const revision = store.saveProjectPlan(scope, initial);
    store.close();
    store = new TaskSystemStore(resolveTaskDomain(root));
    expect(store.saveProjectPlan(scope, initial)).toEqual(revision);
    expect(() => store.saveProjectPlan(scope, { ...initial, nextAction: 'Different intent' })).toThrow('TASK_IDEMPOTENCY_CONFLICT');
    const plan = store.projectPlan(scope.workspaceId)!;
    expect(plan.revisions).toEqual([revision]);
    expect(revision).toMatchObject({ revision: 1, assumptions: initial.assumptions, pendingDecisions: initial.decisions });
    expect(plan.task.claim).toBeNull();
    expect(plan.children[0].contract.constraints).toEqual(initial.goal.constraints);
    expect(plan.children[1].contract.dependencies).toEqual([revision.childIds[0]]);
    expect(() => store.claim(revision.childIds[1], 'worker', 'g', 'too-early')).toThrow('TASK_DEPENDENCY_UNSATISFIED');
    const separate = store.saveProjectPlan(scope, { ...initial, requestId: 'explicit-new-goal' });
    expect(separate.taskNodeId).not.toBe(revision.taskNodeId);
    expect(store.projectPlan('project-b')).toBeUndefined();
  });

  it('selects a dependency-ready child in plan order and fences replays after handoff or completion', () => {
    const plan = store.saveProjectPlan(scope, { ...initial, children: [...initial.children].reverse() });
    const start = (key: string) => store.startNextPlanTask(scope, plan.taskNodeId, plan.revision, key);
    expect(() => store.startNextPlanTask(scope, plan.taskNodeId, 2, 'bad-revision')).toThrow('TASK_PROJECT_PLAN_STALE');
    expect(() => store.startNextPlanTask({ ...scope, workspaceId: 'other' }, plan.taskNodeId, 1, 'bad-project')).toThrow('TASK_PROJECT_PLAN_STALE');
    const first = start('next-1').claim!;
    expect(first.taskNodeId).toBe(plan.childIds[1]);
    store.close();
    store = new TaskSystemStore(resolveTaskDomain(root));
    expect(start('next-1').claim).toEqual(first);
    expect(() => start('next-2')).toThrow('TASK_PROJECT_WRITER_BUSY');
    store.verifyFile(first, 'proof', 'proof.txt', sha256, 'candidate');
    store.submit(first, 'candidate');
    expect(() => start('next-2')).toThrow('TASK_PROJECT_WRITER_BUSY');
    store.accept(first, 'candidate');
    expect(() => start('next-1')).toThrow();
    expect(start('next-2').claim?.taskNodeId).toBe(plan.childIds[0]);
  });

  it('does not admit work in a new plan while a previous plan child has a writer', () => {
    const old = store.saveProjectPlan(scope, initial);
    store.claim(old.childIds[0], 'worker', 'generation-worker', 'working');
    const fresh = store.saveProjectPlan(scope, { ...initial, requestId: 'new-goal' });
    expect(() => store.startNextPlanTask(scope, old.taskNodeId, 1, 'outdated')).toThrow('TASK_PROJECT_PLAN_STALE');
    expect(() => store.startNextPlanTask(scope, fresh.taskNodeId, 1, 'next')).toThrow('TASK_PROJECT_WRITER_BUSY');
    expect(store.get(fresh.childIds[0]).claim).toBeNull();
  });

  it('keeps settled tasks and evidence when replacing a revision without recycling child identities', () => {
    const first = store.saveProjectPlan(scope, initial);
    const next = { ...initial, requestId: 'revise', revise: { taskNodeId: first.taskNodeId, expectedRevision: 1, reason: 'Change rollout requirements' } };
    expect(() => store.saveProjectPlan(scope, next)).toThrow('TASK_PLAN_CHILDREN_ACTIVE');
    expect(() => store.saveProjectPlan({ ...scope, workspaceId: 'foreign' }, next)).toThrow('TASK_PROJECT_PLAN_NOT_FOUND');
    expect(() => store.revise(first.taskNodeId, 1, initial.goal)).toThrow('TASK_PROJECT_PLAN_REVISION_REQUIRED');
    for (const [i, id] of first.childIds.entries()) {
      const owner = store.claim(id, `worker-${i}`, 'g', `claim-${i}`).claim!;
      expect(() => store.decompose(owner, initial.children, 'recursive')).toThrow('TASK_PLAN_NOT_EDITABLE');
      store.verifyFile(owner, 'proof', 'proof.txt', sha256, 'old-candidate');
      store.submit(owner, 'old-candidate');
      store.accept(owner, 'old-candidate');
    }
    const oldEvidence = store.getTaskEvidence(first.childIds[0]);
    expect(oldEvidence).toHaveLength(1);
    expect(() => store.saveProjectPlan(scope, { ...next, revise: { ...next.revise, expectedRevision: 2 } })).toThrow('TASK_REVISION_CONFLICT');
    const second = store.saveProjectPlan(scope, next);
    expect(second).toMatchObject({ revision: 2, reason: next.revise.reason, previousChildIds: first.childIds });
    expect(second.childIds.every((id) => !first.childIds.includes(id))).toBe(true);
    expect(store.projectPlan(scope.workspaceId)?.revisions).toEqual([second, first]);
    expect(store.get(first.childIds[0]).contract.state).toBe('done');
    expect(store.getTaskEvidence(first.childIds[0])).toEqual(oldEvidence);
    expect(store.getTaskEvidence(second.childIds[0])).toEqual([]);
    expect(store.history(first.taskNodeId).map((event) => event.kind)).toContain('plan_retired');
  });

  it('rolls back cyclic, missing and foreign dependencies without leaving any tasks', () => {
    expect(() => store.saveProjectPlan({ ...scope, sessionKey: '' }, initial)).toThrow('TASK_INVALID_SESSION');
    expect(() => store.saveProjectPlan({ ...scope, generation: '' }, initial)).toThrow('TASK_INVALID_GENERATION');
    expect(() => store.saveProjectPlan(scope, { ...initial, assumptions: [{ text: 'Unknown scope', status: 'confirmed' }] as unknown as string[] })).toThrow('TASK_INVALID_ASSUMPTION');
    expect(() => store.saveProjectPlan(scope, { ...initial, children: Array.from({ length: 31 }, (_, index) => ({ ...initial.children[0], key: `step-${index}` })) })).toThrow('TASK_PLAN_SIZE_INVALID');
    const invalidPlans: Array<[TaskPlanItem[], string]> = [
      [[{ ...initial.children[0], dependsOn: ['verify'] }, initial.children[1]], 'TASK_DEPENDENCY_CYCLE'],
      [[{ ...initial.children[0], dependsOn: ['missing'] }], 'TASK_PLAN_DEPENDENCY_MISSING'],
      [[{ ...initial.children[0], contract: { ...contract('Foreign'), dependencies: ['other-project-task'] } }], 'TASK_PROJECT_PLAN_USE_LOCAL_DEPENDENCIES'],
    ];
    for (const [children, error] of invalidPlans) {
      expect(() => store.saveProjectPlan(scope, { ...initial, children: [...children] })).toThrow(error);
      expect(store.list()).toEqual([]);
    }
    expect(store.changes('audit').events).toEqual([]);
  });

  it('uses the Workspace owner binding and rejects another checkout, generation or duplicate coordinator', () => {
    const ownerPath = join(root, 'workspaces.json');
    const profile = {
      id: scope.workspaceId, rootPath: root, projectCoordinatorSessionKey: scope.sessionKey,
      coordinatorBindings: { [scope.sessionKey]: { ...scope, sessionGeneration: scope.generation, state: 'active', environment: { canonicalRoot: root } } },
    };
    writeFileSync(ownerPath, JSON.stringify({ profiles: [profile] }));
    expect(readProjectCoordinator(ownerPath, scope.sessionKey, scope.generation, root)).toEqual(scope);
    expect(() => readProjectCoordinator(ownerPath, scope.sessionKey, 'stale', root)).toThrow('TASK_GENERATION_STALE');
    const other = join(root, 'other');
    mkdirSync(other);
    expect(() => readProjectCoordinator(ownerPath, scope.sessionKey, scope.generation, other)).toThrow('TASK_SESSION_DOMAIN_MISMATCH');
    writeFileSync(ownerPath, JSON.stringify({ profiles: [{ ...profile, coordinatorBindings: {
      [scope.sessionKey]: { ...profile.coordinatorBindings[scope.sessionKey], state: 'retired' },
    } }] }));
    expect(() => readProjectCoordinator(ownerPath, scope.sessionKey, scope.generation, root)).toThrow('TASK_PROJECT_COORDINATOR_REQUIRED');
    writeFileSync(ownerPath, JSON.stringify({ profiles: [profile, { ...profile, id: 'duplicated' }] }));
    expect(() => readProjectCoordinator(ownerPath, scope.sessionKey, scope.generation, root)).toThrow('TASK_PROJECT_COORDINATOR_REQUIRED');
  });
});
