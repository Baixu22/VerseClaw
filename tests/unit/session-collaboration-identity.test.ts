// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import type { WorkspaceCoordinatorBinding } from '../../shared/types/workspace';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { TerminalSessionManager } from '../../electron/services/terminal-session-manager';
import { createSessionActivityReadSnapshot, parseSessionActivityReadQuery, type SessionActivityReadQuery, type SessionActivitySnapshot } from '../../shared/types/session-activity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { canonicalPath, resolveTaskDomain } from '../../shared/task-system/identity';

const mocks = vi.hoisted(() => ({ cfg: {} as OpenClawConfig, git: vi.fn(), ledger: vi.fn(), background: vi.fn(),
  workspace: vi.fn(), binding: vi.fn() }));
vi.mock('../../openclaw_runtime/src/config/io.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../openclaw_runtime/src/config/io.js')>(), getRuntimeConfig: () => mocks.cfg,
}));
vi.mock('../../electron/services/git-api', () => ({ createGitApi: () => ({ status: mocks.git }) }));
vi.mock('../../electron/services/task-ledger-api', () => ({ createTaskLedgerApi: () => ({ snapshot: mocks.ledger }) }));
vi.mock('../../electron/services/workspaces-api', () => ({ getWorkspaceRootPathById: mocks.workspace, getPersistedCoordinatorBinding: mocks.binding }));
vi.mock('../../electron/services/long-session-resource-reclamation', () => ({ collectLongSessionResourceInventory: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/mission-control/store.js', () => ({ getLatestMissionForSession: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/subagent-registry.js', () => ({ listSubagentRunsForRequester: vi.fn(), listOrchestrationCompletionBatchesForRequester: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/task-loop-controller.js', () => ({ listTaskLoopRunsForSession: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/clawgraph/runtime.js', () => ({ listClawGraphRunSnapshots: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/long-task-control/store.js', () => ({ countLongTaskQueuedMessages: vi.fn(), getLatestLongTaskCheckpoint: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-activity-projection.js', () => ({ collectSessionActivityReadProjection: mocks.background }));
vi.mock('../../openclaw_runtime/src/agents/runtime-effective-capability.js', () => ({ readRuntimeEffectiveCapabilityObservation: vi.fn(), resolveCurrentRuntimeGeneration: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-resource-inventory.js', () => ({ readRuntimeSessionResourceInventory: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-derivation-projection.js', () => ({ readSessionDerivation: vi.fn() }));

import { sessionActivityHandlers } from '../../openclaw_runtime/src/gateway/server-methods/session-activity';
import { createSessionActivityApi } from '../../electron/services/session-activity-api';
import { resolveStorePath } from '../../openclaw_runtime/src/config/sessions/paths';
import { closeSqliteSessionStoreDatabase, loadExistingSqliteSessionStoreReadOnly, replaceSqliteSessionStore } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { createExecutionTaskAccess } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { registerAgentRunContext, clearAgentRunContext } from '../../openclaw_runtime/src/infra/agent-events';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const A = 'agent:main:collaboration-a', B = 'agent:main:collaboration-b', C = 'agent:main:collaboration-child';
let root: string, workspaceA: string, workspaceB: string, sessionStore: string;
let taskA: TaskSystemStore, taskB: TaskSystemStore;
let bindings: Record<string, WorkspaceCoordinatorBinding>;
let runs: Map<string, { sessionKey: string; sessionId: string; workspaceId: string; controller: AbortController; startedAtMs: number }>;
const receipts: unknown[] = [];
const query = (sessionKey = A, workspaceId = 'workspace-a', generation = 'generation-a'): SessionActivityReadQuery =>
  parseSessionActivityReadQuery({ scope: { workspaceId, projectId: workspaceId, sessionKey, sessionGeneration: generation } });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function putSession(key: string, patch: Record<string, unknown>) {
  const entries = loadExistingSqliteSessionStoreReadOnly(sessionStore);
  entries[key] = { ...entries[key], ...patch } as typeof entries[string];
  replaceSqliteSessionStore(sessionStore, entries);
}
function bind(key: string, workspaceId: string, generation: string, path: string): WorkspaceCoordinatorBinding {
  return { schemaVersion: 1, workspaceId, agentId: 'main', sessionKey: key, sessionGeneration: generation,
    taskLedgerReferences: [], environment: { kind: 'local', canonicalRoot: path, backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null },
    state: 'active', bindingRevision: 3, invalidationReason: null, archiveRestorePolicy: 'none', createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' };
}
async function runtime(input: SessionActivityReadQuery) {
  let result!: { snapshot: SessionActivitySnapshot };
  await sessionActivityHandlers['session.activitySnapshot']({ params: input, context: { chatAbortControllers: runs, getRuntimeConfig: () => mocks.cfg },
    respond: (ok: boolean, value: unknown, error?: { message: string }) => { if (!ok) throw new Error(error?.message); result = value as typeof result; },
  } as never);
  return result;
}
function main(rpc = vi.fn(async (_method: string, input: SessionActivityReadQuery): Promise<{ snapshot: Partial<SessionActivitySnapshot> }> => runtime(input))) {
  const terminalList = vi.fn();
  return { api: createSessionActivityApi({ gatewayManager: { rpc } as unknown as GatewayManager,
    terminalManager: { list: terminalList } as unknown as TerminalSessionManager }), rpc, terminalList };
}
function state() {
  const taskState = (store: TaskSystemStore) => ['task_contracts', 'task_claims', 'task_bindings', 'task_references', 'task_events', 'task_requests', 'task_active_runs', 'task_operations']
    .map(table => ({ table, rows: store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }));
  const dbFiles: Record<string, string> = {};
  const visit = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.sqlite3?(?:-wal)?$/.test(entry.name)) dbFiles[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
  } };
  visit(root);
  return { sessions: loadExistingSqliteSessionStoreReadOnly(sessionStore), tasks: [taskState(taskA), taskState(taskB)], bindings,
    config: mocks.cfg, runs: [...runs.entries()].map(([id, run]) => ({ id, ...run, controller: run.controller.signal.aborted })), dbFiles };
}

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'session-collaboration-A1-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'owner-state'));
  vi.stubEnv('OPENCLAW_HOME', join(root, 'home'));
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  mocks.cfg = {};
  openOpenClawStateDatabase({ path: join(root, 'execution.sqlite') });
  workspaceA = join(root, 'workspace-a'); workspaceB = join(root, 'workspace-b');
  for (const path of [workspaceA, workspaceB]) { mkdirSync(path); execFileSync('git', ['init', '--quiet', path]); }
  sessionStore = resolveStorePath(undefined, { agentId: 'main' });
  replaceSqliteSessionStore(sessionStore, {
    [A]: { sessionId: 'generation-a', workspaceId: 'workspace-a', workspaceDir: workspaceA, updatedAt: 10 },
    [B]: { sessionId: 'generation-b', workspaceId: 'workspace-b', workspaceDir: workspaceB, updatedAt: 10 },
    [C]: { sessionId: 'generation-c', workspaceId: 'workspace-a', workspaceDir: workspaceA, spawnedBy: A, updatedAt: 10 },
  });
  taskA = new TaskSystemStore(resolveTaskDomain(workspaceA)); taskB = new TaskSystemStore(resolveTaskDomain(workspaceB));
  for (const [store, key, generation] of [[taskA, A, 'generation-a'], [taskB, B, 'generation-b']] as const) {
    const task = store.create({ objective: `Goal for ${key}`, target: 'artifact.txt', constraints: [], acceptance: [
      { id: 'read', description: 'Owner receipt', verification: { kind: 'owner-receipt', owner: 'test-owner' } },
    ] }, 'create').task;
    store.claim(task.contract.taskNodeId, key, generation, 'claim');
  }
  taskA.inheritReference(A, 'generation-a', C, 'generation-c');
  runs = new Map([['run-a', { sessionKey: A, sessionId: 'generation-a', workspaceId: 'workspace-a', controller: new AbortController(), startedAtMs: 10 }],
    ['run-b', { sessionKey: B, sessionId: 'generation-b', workspaceId: 'workspace-b', controller: new AbortController(), startedAtMs: 20 }]]);
  registerAgentRunContext('run-c', { sessionKey: C, sessionId: 'generation-c' });
  subagentRuns.set('run-c', { runId: 'run-c', childSessionKey: C, requesterSessionKey: A, requesterSessionId: 'generation-a',
    requesterDisplayKey: A, task: 'Read the parent task', cleanup: 'keep', createdAt: 30, startedAt: 30, workspaceDir: workspaceA } satisfies SubagentRunRecord);
  bindings = { [A]: bind(A, 'workspace-a', 'generation-a', workspaceA), [B]: bind(B, 'workspace-b', 'generation-b', workspaceB), [C]: bind(C, 'workspace-a', 'generation-c', workspaceA) };
  mocks.workspace.mockImplementation(async id => id === 'workspace-a' ? workspaceA : id === 'workspace-b' ? workspaceB : undefined);
  mocks.binding.mockImplementation(async (id, key) => bindings[key]?.workspaceId === id ? structuredClone(bindings[key]) : null);
});
afterEach(() => {
  vi.restoreAllMocks();
  taskA.close(); taskB.close(); closeSqliteSessionStoreDatabase(sessionStore); closeOpenClawStateDatabase();
  clearAgentRunContext('run-c'); subagentRuns.delete('run-c'); vi.unstubAllEnvs();
});
afterAll(() => {
  const directory = process.env.SESSION_COLLABORATION_EVIDENCE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'owner-readbacks.json'), JSON.stringify({
    schemaVersion: 1, driven_by: 'agent', actor: 'codex-tf0919', modelCalls: 0, receipts,
  }, null, 2)); }
});

describe('A1 owner-backed collaboration identity', () => {
  it('reads two independent sessions and an embedded child through the same Runtime and typed Main owner contract without mutation', async () => {
    const before = structuredClone(state());
    const { api, rpc, terminalList } = main();
    const inputs = [query(), query(B, 'workspace-b', 'generation-b'), query(C, 'workspace-a', 'generation-c')];
    const snapshots = [];
    for (const input of inputs) {
      const result = await api.read(input);
      expect(result.runtimeAvailable).toBe(true);
      expect(result.snapshot.readModel!.sources.session).toMatchObject({ state: 'ready', value: { scope: input.scope } });
      expect(result.snapshot.readModel!.sources.execution.state).toBe('ready');
      expect(result.snapshot.readModel!.sources.binding).toMatchObject({ state: 'ready', value: { bindingRevision: 3 } });
      snapshots.push(result.snapshot);
    }
    expect(snapshots.map(s => s.readModel!.sources.run.value)).toEqual(inputs.map((input, index) => ({
      runId: ['run-a', 'run-b', 'run-c'][index], scope: { workspaceId: input.scope.workspaceId, projectId: input.scope.projectId, sessionKey: input.scope.sessionKey },
    })));
    const references = snapshots.map(s => s.readModel!.sources.tasks.value!);
    expect(references[0][0].taskNodeId).not.toBe(references[1][0].taskNodeId);
    expect(references[2][0]).toMatchObject({ taskNodeId: references[0][0].taskNodeId, referenceOnly: true, claim: { sessionKey: A, generation: 'generation-a', epoch: 1 } });
    expect(snapshots[1].readModel!.sources.session.value?.spawnedBy).toBeNull();
    expect(snapshots[2].readModel!.sources.session.value?.spawnedBy).toBe(A);
    expect(terminalList).not.toHaveBeenCalled(); expect(mocks.git).not.toHaveBeenCalled(); expect(mocks.ledger).not.toHaveBeenCalled(); expect(mocks.background).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(([method]) => method === 'session.activitySnapshot')).toBe(true);
    const after = state(); expect(after).toEqual(before);
    receipts.push({ case: 'two-independent-and-child', root, inputs, snapshots, before, after, beforeSha256: digest(before), afterSha256: digest(after) });
  });
  it.each([
    ['workspace', () => query(A, 'workspace-b'), 'unavailable', 'scope-mismatch'],
    ['project', () => ({ ...query(), scope: { ...query().scope, projectId: query(B, 'workspace-b', 'generation-b').scope.projectId } }), 'unavailable', 'scope-mismatch'],
    ['generation', () => query(A, 'workspace-a', 'old-generation'), 'stale', 'generation-changed'],
    ['missing-owner', () => query('agent:main:missing'), 'unavailable', 'owner-missing'],
  ] as const)('rejects %s without returning a current-session fallback', async (_name, input, status, reason) => {
    const request = input(); const response = await runtime(request);
    expect(response.snapshot.readModel!.sources.session).toMatchObject({ state: status, reason, value: null });
    expect(response.snapshot.tasks).toEqual([]); expect(response.snapshot.session.runId).toBeNull();
    receipts.push({ case: _name, input: request, snapshot: response.snapshot });
  });
  it('distinguishes not read, owner-confirmed empty tasks, unknown workspace, and unavailable task owner', async () => {
    expect(createSessionActivityReadSnapshot(query().scope).readModel.sources.tasks.state).toBe('not_read');
    putSession('agent:main:discussion', { sessionId: 'generation-discussion', workspaceId: 'workspace-a', workspaceDir: workspaceA, updatedAt: 10 });
    const empty = await runtime(query('agent:main:discussion', 'workspace-a', 'generation-discussion'));
    expect(empty.snapshot.readModel!.sources.tasks).toMatchObject({ state: 'empty', value: [] });
    expect(empty.snapshot.readModel!.sources.run).toMatchObject({ state: 'empty', value: null });
    putSession(A, { workspaceId: undefined });
    expect((await runtime(query())).snapshot.readModel!.sources.session.state).toBe('unknown');
    putSession(A, { workspaceId: 'workspace-a', workspaceDir: workspaceB });
    const missing = await runtime(query());
    expect(missing.snapshot.readModel!.sources.tasks.state).toBe('empty');
    const noTaskRoot = join(root, 'no-task-owner'); mkdirSync(noTaskRoot); execFileSync('git', ['init', '--quiet', noTaskRoot]);
    putSession(A, { workspaceDir: noTaskRoot });
    const unavailable = await runtime(query());
    expect(unavailable.snapshot.readModel!.sources.tasks).toMatchObject({ state: 'unavailable', reason: 'owner-missing' });
    expect(existsSync(resolveTaskDomain(noTaskRoot).database)).toBe(false);
    receipts.push({ case: 'read-states', unread: createSessionActivityReadSnapshot(query().scope), empty: empty.snapshot, unavailable: unavailable.snapshot });
  });
  it('does not initialize an absent session or execution owner while querying', async () => {
    const path = resolveStorePath(undefined, { agentId: 'absent' });
    expect((await runtime(query('agent:absent:missing'))).snapshot.readModel!.sources.session.state).toBe('unavailable');
    expect(existsSync(join(root, 'owner-state', 'agents', 'absent'))).toBe(false);
    vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'absent-execution.sqlite'));
    expect((await runtime(query())).snapshot.readModel!.sources.execution.state).toBe('unavailable');
    expect(existsSync(join(root, 'absent-execution.sqlite'))).toBe(false);
    expect(loadExistingSqliteSessionStoreReadOnly(path)).toEqual({});
    receipts.push({ case: 'missing-session-and-execution-owner', root, absentSessionDirectoryCreated: false, absentExecutionDatabaseCreated: false });
  });
  it('keeps generation-less runs and missing child run owners unknown rather than confirming idle', async () => {
    runs.get('run-a')!.sessionId = '';
    const unpinned = await runtime(query());
    expect(unpinned.snapshot.readModel!.sources.session.state).toBe('ready');
    expect(unpinned.snapshot.readModel!.sources.run).toMatchObject({ state: 'unknown', reason: 'run-identity-missing', value: null });
    subagentRuns.delete('run-c'); clearAgentRunContext('run-c');
    const missing = await runtime(query(C, 'workspace-a', 'generation-c'));
    expect(missing.snapshot.readModel!.sources.run).toMatchObject({ state: 'unknown', reason: 'owner-missing', value: null });
    receipts.push({ case: 'unknown-run-owners', unpinned: unpinned.snapshot, missing: missing.snapshot });
  });
  it('fences old task generations and execution binding revisions', async () => {
    putSession(A, { sessionId: 'new-generation' });
    const staleTask = await runtime(query(A, 'workspace-a', 'new-generation'));
    expect(staleTask.snapshot.readModel!.sources.tasks.state).toBe('stale');
    expect(staleTask.snapshot.readModel!.sources.session.state).toBe('ready');
    putSession(A, { sessionId: 'generation-a' });
    const expectedExecution = createExecutionTaskAccess(workspaceA, undefined, true).basis;
    const staleExecution = await runtime({ ...query(), expectedExecution: { ...expectedExecution, registrationRevision: 7 } });
    expect(staleExecution.snapshot.readModel!.sources.execution).toMatchObject({ state: 'stale', reason: 'execution-changed' });
    expect(staleExecution.snapshot.tasks).toEqual([]);
    receipts.push({ case: 'old-task-generation-and-execution-revision', staleTask: staleTask.snapshot, staleExecution: staleExecution.snapshot, expectedExecution });
  });
  it('discards the whole join when reset happens while the Task owner is read', async () => {
    const original = TaskSystemStore.prototype.sessionSnapshot;
    vi.spyOn(TaskSystemStore.prototype, 'sessionSnapshot').mockImplementationOnce(function (this: TaskSystemStore, key, generation) {
      const value = original.call(this, key, generation); putSession(A, { sessionId: 'reset-during-read' }); return value;
    });
    const result = await runtime(query());
    expect(result.snapshot.readModel!.sources.session).toMatchObject({ state: 'stale', reason: 'generation-changed' });
    expect(result.snapshot.readModel!.sources.tasks.value).toBeNull(); expect(result.snapshot.tasks).toEqual([]);
    receipts.push({ case: 'reset-during-runtime-read', snapshot: result.snapshot, ownerAfter: loadExistingSqliteSessionStoreReadOnly(sessionStore)[A] });
  });
  it('discards a reset during Main await and rejects old workspace binding revisions before RPC', async () => {
    const rpc = vi.fn(async (_method: string, input: SessionActivityReadQuery) => runtime(input));
    rpc.mockImplementationOnce(async (_method, input) => { const response = await runtime(input); putSession(A, { sessionId: 'reset-at-host' }); return response; });
    const reset = await main(rpc).api.read(query());
    expect(reset.snapshot.readModel!.sources.session.state).toBe('stale');
    rpc.mockClear();
    const staleBinding = await main(rpc).api.read({ ...query(), expectedBindingRevision: 2 });
    expect(staleBinding.snapshot.readModel!.sources.binding).toMatchObject({ state: 'stale', reason: 'binding-changed' });
    expect(rpc).not.toHaveBeenCalled();
    receipts.push({ case: 'reset-during-host-read-and-old-binding-revision', reset: reset.snapshot, staleBinding: staleBinding.snapshot });
  });
  it('rejects a binding changed during the Host read, and preserves a missing binding as a source gap', async () => {
    const rpc = vi.fn(async (_method: string, input: SessionActivityReadQuery) => runtime(input));
    rpc.mockImplementationOnce(async (_method, input) => { const response = await runtime(input); bindings[A].bindingRevision++; return response; });
    expect((await main(rpc).api.read(query())).snapshot.readModel!.sources.binding.state).toBe('stale');
    delete bindings[A];
    const unbound = await main().api.read(query());
    expect(unbound.snapshot.readModel!.sources.session.state).toBe('ready');
    expect(unbound.snapshot.readModel!.sources.binding).toMatchObject({ state: 'unavailable', reason: 'owner-missing' });
    receipts.push({ case: 'missing-workspace-binding', input: query(), snapshot: unbound.snapshot });
  });
  it('checks bindings after the final Runtime await and validates ScopedRun identities', async () => {
    const rpc = vi.fn(async (_method: string, input: SessionActivityReadQuery) => runtime(input));
    rpc.mockImplementationOnce(async (_method, input) => runtime(input));
    rpc.mockImplementationOnce(async (_method, input) => { const response = await runtime(input); bindings[A].bindingRevision++; return response; });
    expect((await main(rpc).api.read(query())).snapshot.readModel!.sources.binding.state).toBe('stale');
    const foreign = main(vi.fn(async (_method, input: SessionActivityReadQuery) => {
      const response = await runtime(input);
      const source = response.snapshot.readModel!.sources.run;
      if (source.state === 'ready' && source.value) source.value.scope.workspaceId = query(B, 'workspace-b', 'generation-b').scope.workspaceId;
      return response;
    }));
    expect((await foreign.api.read(query())).snapshot.readModel!.sources.run.value).toBeNull();
  });
  it('refuses unverified legacy replies, another scope, and a missing workspace without reading current Git or ledger', async () => {
    const legacy = main(vi.fn(async () => ({ snapshot: {} })));
    expect((await legacy.api.read(query())).snapshot.readModel!.sources.session.state).toBe('unknown');
    const foreign = main(vi.fn(async () => runtime(query(B, 'workspace-b', 'generation-b'))));
    expect((await foreign.api.read(query())).snapshot.readModel!.sources.session.value).toBeNull();
    mocks.workspace.mockResolvedValue(undefined);
    const missing = main();
    expect((await missing.api.read(query())).runtimeAvailable).toBe(false); expect(missing.rpc).not.toHaveBeenCalled();
    expect(mocks.git).not.toHaveBeenCalled(); expect(mocks.ledger).not.toHaveBeenCalled();
  });
  it.each([{ scope: {} }, { ...query(), writeClaim: true }, { ...query(), expectedBindingRevision: 0 },
    { ...query(), expectedExecution: { authorityId: 'forged', writeClaim: true } },
    { ...query(), scope: { ...query().scope, authority: 'writer' } }])('rejects malformed and authority-bearing input: %j', async input => {
    const { api, rpc } = main(); await expect(api.read(input as SessionActivityReadQuery)).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled();
  });
  it('opens TaskSystem read-only without migration or write effects and keeps the checkout incarnation', () => {
    const access = createExecutionTaskAccess(workspaceA, undefined, true);
    expect(access.basis.executionWorktree).toBe(canonicalPath(workspaceA)); expect(access.basis.worktreeIncarnation).toBeTruthy();
    const reader = new TaskSystemStore(access.domain, undefined, access, true);
    try { expect(reader.binding(A, 'generation-a')).not.toBeNull(); expect(() => reader.create({ objective: 'Forbidden', constraints: [],
      acceptance: [{ id: 'owner', description: 'Original owner', verification: { kind: 'owner-receipt', owner: 'test-owner' } }], target: 'x' }, 'write')).toThrow(/readonly|read.only/i); }
    finally { reader.close(); }
    taskA.db.exec('PRAGMA user_version=6');
    expect(() => new TaskSystemStore(access.domain, undefined, access, true)).toThrow('TASK_READ_SCHEMA_MISMATCH');
    expect((taskA.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(6);
  });
});
