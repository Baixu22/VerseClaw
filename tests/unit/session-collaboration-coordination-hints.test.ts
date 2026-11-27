// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { emptyCollaborationHints, parseCollaborationHintsQuery, validateCollaborationHints } from '../../shared/types/session-collaboration-hints';
import { readSessionCollaborationHints } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-hints';
import { querySessionCollaborationHintsTool } from '../../openclaw_runtime/src/agents/tools/session-collaboration-query';
import { sessionAdmissionRegistry } from '../../openclaw_runtime/src/sessions/session-admission-registry';
import { openExecutionStateDatabase } from '../../openclaw_runtime/src/state/execution-state-db';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

const mocks = vi.hoisted(() => ({ entries: {} as Record<string, { sessionId: string; workspaceId: string; workspaceDir: string }>, visible: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({ loadSessionEntry: (key: string) => ({ canonicalKey: key, entry: mocks.entries[key] }) }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query.js', () => ({ readSessionCollaborationQuery: mocks.visible }));
const reader = { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader', sessionGeneration: 'reader' };
const target = { ...reader, sessionKey: 'agent:main:writer', sessionGeneration: 'writer' };
const query = parseCollaborationHintsQuery({ requester: reader, target, limit: 1 });
let root: string, store: TaskSystemStore, visibility: 'all' | 'self', storeOpen: boolean;
const context = { getRuntimeConfig: () => ({ tools: { sessions: { visibility } } }) } as never;
const create = (name: string, dependencies: string[] = []) => store.create({ objective: name, target: 'result.txt', constraints: [], dependencies,
  acceptance: [{ id: 'receipt', description: 'Original receipt', verification: { kind: 'owner-receipt', owner: 'fixture' } }] }, name).task;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coordination-hints-'));
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  openExecutionStateDatabase();
  store = new TaskSystemStore(resolveTaskDomain(root));
  storeOpen = true;
  visibility = 'all';
  mocks.entries = Object.fromEntries([reader, target].map(scope => [scope.sessionKey, { sessionId: scope.sessionGeneration,
    workspaceId: scope.workspaceId, workspaceDir: root }]));
  mocks.visible.mockResolvedValue({ state: 'ready' });
});
afterEach(() => { if (storeOpen) store.close(); closeOpenClawStateDatabase(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

it('reads exact task identity, observer role and dependency states without writes or a new claim', async () => {
  const dependency = create('Prerequisite');
  const task = create('Selected task', [dependency.contract.taskNodeId]);
  store.selectReference(task.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'select-target');
  store.selectReference(task.contract.taskNodeId, reader.sessionKey, reader.sessionGeneration, 'select-reader');
  const before = store.db.prepare('SELECT * FROM task_events ORDER BY seq').all();
  const result = await readSessionCollaborationHints(query, context);
  expect(validateCollaborationHints(query, result)).toEqual(result);
  expect(result).toMatchObject({ state: 'ready', task: { task: { taskNodeId: task.contract.taskNodeId, revision: 1, digest: task.contract.digest },
    referenceOnly: true, claim: null, relation: 'same-task', dependencies: [{ taskNodeId: dependency.contract.taskNodeId, state: 'ready' }] } });
  expect(store.db.prepare('SELECT * FROM task_events ORDER BY seq').all()).toEqual(before);
  expect(store.get(task.contract.taskNodeId).claim).toBeNull();
});

it('distinguishes shared checkpoint paths from task identity and preserves the original writer epoch', async () => {
  const a = create('Reader task'), b = create('Writer task');
  const readerClaim = store.claim(a.contract.taskNodeId, reader.sessionKey, reader.sessionGeneration, 'reader').claim!;
  const targetClaim = store.claim(b.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'target').claim!;
  writeFileSync(join(root, 'shared.txt'), 'shared');
  const checkpoint = { nextAction: 'Read source', completed: [], unresolved: [], artifacts: [
    { path: 'shared.txt', sha256: createHash('sha256').update('shared').digest('hex') }] };
  store.checkpoint(readerClaim, checkpoint); store.checkpoint(targetClaim, checkpoint);
  const result = await readSessionCollaborationHints(query, context);
  expect(result.task).toMatchObject({ relation: 'shared-artifact', referenceOnly: false,
    claim: { sessionKey: target.sessionKey, generation: target.sessionGeneration, epoch: targetClaim.epoch } });
  expect(result.task?.sharedArtifacts).toHaveLength(1);
  expect(result.task?.sharedArtifacts).toEqual(['shared.txt']);
  unlinkSync(join(root, 'shared.txt'));
  expect(await readSessionCollaborationHints(query, context)).toMatchObject({ state: 'ready', task: {
    relation: 'shared-artifact', sharedArtifacts: result.task?.sharedArtifacts } });
  store.handoff(targetClaim, 'agent:main:successor', 'successor', root);
  expect(() => store.control(targetClaim, 'pause')).toThrow('TASK_STALE_OWNER');
});

it('compares the same TaskSystem authority across two real Git worktrees', async () => {
  store.close(); storeOpen = false;
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'fixture']);
  const linked = join(root, 'linked-worktree');
  execFileSync('git', ['-C', root, 'worktree', 'add', '--quiet', '--detach', linked, 'HEAD']);
  store = new TaskSystemStore(resolveTaskDomain(root)); storeOpen = true;
  const task = create('Shared authority task');
  const readerClaim = store.claim(task.contract.taskNodeId, reader.sessionKey, reader.sessionGeneration, 'writer').claim!;
  store.inheritReference(reader.sessionKey, reader.sessionGeneration, target.sessionKey, target.sessionGeneration);
  mocks.entries[target.sessionKey].workspaceDir = linked;
  expect(await readSessionCollaborationHints(query, context)).toMatchObject({ state: 'ready', task: {
    referenceOnly: true, relation: 'same-task', task: { taskNodeId: task.contract.taskNodeId } } });
  const other = create('Linked task');
  const linkedStore = new TaskSystemStore(resolveTaskDomain(linked));
  try {
    const claim = linkedStore.claim(other.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'linked-writer').claim!;
    const path = join(root, 'shared.txt'); writeFileSync(path, 'shared');
    const checkpoint = { nextAction: 'Read original source', completed: [], unresolved: [],
      artifacts: [{ path, sha256: createHash('sha256').update('shared').digest('hex') }] };
    store.checkpoint(readerClaim, checkpoint); linkedStore.checkpoint(claim, checkpoint);
    const result = await readSessionCollaborationHints(query, context);
    expect(result.task?.relation).toBe('shared-artifact');
    expect(result.task?.sharedArtifacts).toEqual([expect.stringMatching(/^artifact:[a-f0-9]{16}$/)]);
    expect(JSON.stringify(result)).not.toContain(root.replace(/\\/g, '/').toLowerCase());
  } finally { linkedStore.close(); }
});

it.each([0, 1])('keeps a missing task owner distinct from an empty task with %i active permits', async active => {
  const database = store.domain.database;
  store.close(); storeOpen = false; unlinkSync(database);
  const release = active ? sessionAdmissionRegistry.acquirePermit({ canonicalSessionKey: target.sessionKey, expectedSessionId: target.sessionGeneration }, 'embedded-agent') : () => {};
  try {
    const result = await readSessionCollaborationHints(query, context);
    expect(validateCollaborationHints(query, result)).toMatchObject({ state: 'ready', task: null,
      taskReadState: 'unavailable', admission: { active } });
  } finally { release(); }
});

it.each(['generation', 'visibility'] as const)('clears hints after a %s change while reading the owner', async change => {
  const task = create('Protected task'); store.claim(task.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'claim');
  const original = TaskSystemStore.prototype.sessionCoordinationSnapshot;
  vi.spyOn(TaskSystemStore.prototype, 'sessionCoordinationSnapshot').mockImplementationOnce(function (this: TaskSystemStore, ...args) {
    const result = original.apply(this, args);
    if (change === 'generation') mocks.entries[target.sessionKey].sessionId = 'reset'; else visibility = 'self';
    return result;
  });
  expect(await readSessionCollaborationHints(query, context)).toMatchObject({ state: change === 'generation' ? 'stale' : 'unavailable', task: null, admission: null });
});

it('uses the original admission fence and drain count without changing permits', async () => {
  const identity = { agentId: 'main', canonicalSessionKey: target.sessionKey, expectedSessionId: target.sessionGeneration };
  const release = sessionAdmissionRegistry.acquirePermit(identity, 'embedded-agent');
  const fence = sessionAdmissionRegistry.fence(identity, { timeoutMs: 10_000 });
  try {
    const before = sessionAdmissionRegistry.snapshot(identity);
    expect(await readSessionCollaborationHints(query, context)).toMatchObject({ admission: { owner: 'SessionAdmissionRegistry', active: 1, waiters: 1, fenced: true } });
    expect(sessionAdmissionRegistry.snapshot(identity)).toEqual(before);
  } finally { release(); (await fence).release(); }
});

it('shares the scoped result with the model tool and rejects a requester reset on the reply', async () => {
  const task = create('Model task'); store.claim(task.contract.taskNodeId, target.sessionKey, target.sessionGeneration, 'claim');
  const call = vi.fn(async (request: { params: { coordinationHints: unknown } }) => ({ hints: await readSessionCollaborationHints(request.params.coordinationHints, context) }));
  const opts = { agentSessionKey: reader.sessionKey, agentSessionId: reader.sessionGeneration, callGateway: call as never };
  const result = await querySessionCollaborationHintsTool(opts, { target });
  expect(result.task?.task.taskNodeId).toBe(task.contract.taskNodeId);
  await expect(querySessionCollaborationHintsTool(opts, { target, requester: target })).rejects.toThrow();
  call.mockImplementationOnce(async () => { mocks.entries[reader.sessionKey].sessionId = 'reset'; return { hints: result }; });
  expect(await querySessionCollaborationHintsTool(opts, { target })).toMatchObject({ state: 'unavailable', task: null });
});

it('rejects wrong-scope or malformed hints and never accepts task data in an unavailable reply', () => {
  const empty = emptyCollaborationHints(query, 'empty');
  expect(validateCollaborationHints(query, { ...empty, target: reader })).toMatchObject({ state: 'unknown', task: null });
  expect(validateCollaborationHints(query, { ...empty, admission: { owner: 'SessionAdmissionRegistry', active: -1, waiters: 0, fenced: false } }))
    .toMatchObject({ state: 'unknown', task: null });
  expect(validateCollaborationHints(query, { ...empty, state: 'unavailable', task: { secret: 'not returned' } }))
    .toMatchObject({ state: 'unavailable', task: null });
});
