// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { parseSessionActivityReadQuery, type SessionActivityReadReason } from '../../shared/types/session-activity';
import { parseSessionCollaborationQuery, validateSessionCollaborationPage, type SessionCollaborationQuery, type SessionCollaborationPage } from '../../shared/types/session-collaboration';
import { parseSessionCollaborationWatch, type SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { TerminalSessionManager } from '../../electron/services/terminal-session-manager';
import type { ProcessSession } from '../../openclaw_runtime/src/agents/bash-process-registry';

const mocks = vi.hoisted(() => ({ cfg: {} as OpenClawConfig, workspace: vi.fn(), git: vi.fn(), ledger: vi.fn(), history: vi.fn(),
  statusText: vi.fn(), patched: vi.fn(), checkoutCleanup: vi.fn(), taskAdmission: vi.fn(), taskOpens: [] as string[], fileReads: [] as string[] }));
// Fixtures seed run identities without checkout writers; terminal teardown stays outside this read contract.
vi.mock('../../openclaw_runtime/src/agents/execution-checkout-tools.js', () => ({ finishExecutionCheckoutRun: mocks.checkoutCleanup }));
vi.mock('../../shared/task-system/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../../shared/task-system/store')>();
  return { ...actual, TaskSystemStore: class extends actual.TaskSystemStore {
    constructor(...args: ConstructorParameters<typeof actual.TaskSystemStore>) {
      if (args[3] === true) mocks.taskOpens.push(args[0].database); super(...args);
    }
  } };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => { mocks.fileReads.push(String(args[0])); return actual.readFile(...args); } };
});
vi.mock('../../openclaw_runtime/src/config/io.js', async importOriginal => ({ ...await importOriginal<typeof import('../../openclaw_runtime/src/config/io.js')>(), getRuntimeConfig: () => mocks.cfg }));
vi.mock('../../electron/services/git-api', () => ({ createGitApi: () => ({ status: mocks.git }) }));
vi.mock('../../electron/services/task-ledger-api', () => ({ createTaskLedgerApi: () => ({ snapshot: mocks.ledger }) }));
vi.mock('../../electron/services/workspaces-api', () => ({ getWorkspaceRootPathById: mocks.workspace, getPersistedCoordinatorBinding: vi.fn() }));
vi.mock('../../electron/services/long-session-resource-reclamation', () => ({ collectLongSessionResourceInventory: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/mission-control/store.js', () => ({ getLatestMissionForSession: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/subagent-registry.js', () => ({ listSubagentRunsForRequester: vi.fn(), listOrchestrationCompletionBatchesForRequester: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/task-loop-controller.js', () => ({ listTaskLoopRunsForSession: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/clawgraph/runtime.js', () => ({ listClawGraphRunSnapshots: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/long-task-control/store.js', () => ({ countLongTaskQueuedMessages: vi.fn(), getLatestLongTaskCheckpoint: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/runtime-effective-capability.js', () => ({ readRuntimeEffectiveCapabilityObservation: vi.fn(), resolveCurrentRuntimeGeneration: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/session-resource-inventory.js', () => ({ readRuntimeSessionResourceInventory: vi.fn() }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-derivation-projection.js', () => ({ readSessionDerivation: vi.fn() }));
vi.mock('../../openclaw_runtime/src/agents/tools/session-status.runtime.js', () => ({ buildStatusText: mocks.statusText }));
vi.mock('../../openclaw_runtime/src/gateway/session-patch-hooks.js', () => ({ triggerSessionPatchHook: mocks.patched }));
vi.mock('../../openclaw_runtime/src/gateway/call.js', () => ({ callGateway: mocks.taskAdmission }));

import { sessionActivityHandlers } from '../../openclaw_runtime/src/gateway/server-methods/session-activity';
import { cancelSessionCollaborationWatch, watchSessionCollaboration } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-watch';
import { createSessionActivityApi } from '../../electron/services/session-activity-api';
import { readSessionCollaborationPage } from '../../src/lib/session-read-model';
import { createSessionsListTool } from '../../openclaw_runtime/src/agents/tools/sessions-list-tool';
import { querySessionCollaborationMaterialBatchTool } from '../../openclaw_runtime/src/agents/tools/session-collaboration-query';
import { materialReference } from '../../shared/types/session-collaboration-material';
import { createSessionStatusTool } from '../../openclaw_runtime/src/agents/tools/session-status-tool';
import { resolveStorePath } from '../../openclaw_runtime/src/config/sessions/paths';
import { closeSqliteSessionStoreDatabase, loadExistingSqliteSessionStoreReadOnly, replaceSqliteSessionStore } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import * as metadata from '../../openclaw_runtime/src/config/sessions/combined-store-gateway';
import * as archive from '../../openclaw_runtime/src/gateway/session-archive-index';
import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { registerAgentRunContext, clearAgentRunContext } from '../../openclaw_runtime/src/infra/agent-events';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import { addSession, deleteSession } from '../../openclaw_runtime/src/agents/bash-process-registry';
import { isMutatingToolCall, requiresSessionTaskScope } from '../../openclaw_runtime/src/agents/tool-mutation';
import { clearSessionTaskScopeRun, getSessionTaskEffectRequest, readSessionTaskEffectRequests, sessionTaskOperationsInFlight,
  withSessionTaskScope } from '../../openclaw_runtime/src/agents/session-task-scope';

const A = 'agent:main:a2-a', B = 'agent:main:a2-b', C = 'agent:main:a2-child';
let root: string, workspaceA: string, workspaceB: string, sessionStore: string;
let tasksA: TaskSystemStore, tasksB: TaskSystemStore;
let runs: Map<string, { sessionKey: string; sessionId: string; workspaceId: string; controller: AbortController; startedAtMs: number }>;
const receipts: unknown[] = [];
const scope = (key = A, workspaceId = 'workspace-a', generation = 'generation-a') =>
  parseSessionActivityReadQuery({ scope: { workspaceId, projectId: workspaceId, sessionKey: key, sessionGeneration: generation } }).scope;
const query = (patch: Partial<SessionCollaborationQuery> = {}) => parseSessionCollaborationQuery({ requester: scope(), ...patch });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function put(key: string, patch: Record<string, unknown>) {
  const entries = loadExistingSqliteSessionStoreReadOnly(sessionStore);
  entries[key] = { ...entries[key], ...patch } as typeof entries[string]; replaceSqliteSessionStore(sessionStore, entries);
}
async function runtime(input: SessionCollaborationQuery) {
  let result!: { page: SessionCollaborationPage };
  await sessionActivityHandlers['session.activitySnapshot']({ params: { query: input }, context: { chatAbortControllers: runs, getRuntimeConfig: () => mocks.cfg },
    respond: (ok: boolean, data: unknown, error?: { message: string }) => { if (!ok) throw new Error(error?.message); result = data as typeof result; },
  } as never);
  return result;
}
function main() {
  const rpc = vi.fn(async (_method: string, payload: { query: SessionCollaborationQuery }): Promise<unknown> => runtime(payload.query));
  return { rpc, api: createSessionActivityApi({ gatewayManager: { rpc } as unknown as GatewayManager, terminalManager: { list: vi.fn() } as unknown as TerminalSessionManager }) };
}
function ownerState() {
  const files: Record<string, string> = {};
  const visit = (path: string) => { for (const child of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, child.name); if (child.isDirectory()) visit(item);
    else if (/\.sqlite3?(?:-wal)?$/.test(item)) files[item] = createHash('sha256').update(readFileSync(item)).digest('hex');
  } }; visit(root);
  return { sessions: loadExistingSqliteSessionStoreReadOnly(sessionStore), files, config: mocks.cfg,
    tasks: [tasksA, tasksB].map(store => store.db.prepare('SELECT * FROM task_events ORDER BY seq').all()) };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  root = mkdtempSync(join(tmpdir(), 'session-collaboration-A2-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'state')); vi.stubEnv('OPENCLAW_HOME', join(root, 'home')); vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
  mocks.cfg = { tools: { sessions: { visibility: 'all' } } };
  openOpenClawStateDatabase({ path: join(root, 'execution.sqlite') });
  workspaceA = join(root, 'a'); workspaceB = join(root, 'b');
  for (const path of [workspaceA, workspaceB]) { mkdirSync(path); execFileSync('git', ['init', '--quiet', path]); }
  sessionStore = resolveStorePath(undefined, { agentId: 'main' });
  replaceSqliteSessionStore(sessionStore, {
    [A]: { sessionId: 'generation-a', workspaceId: 'workspace-a', workspaceDir: workspaceA, label: 'Independent A', updatedAt: 10 },
    [B]: { sessionId: 'generation-b', workspaceId: 'workspace-b', workspaceDir: workspaceB, label: 'Independent B', updatedAt: 10 },
    [C]: { sessionId: 'generation-c', workspaceId: 'workspace-a', workspaceDir: workspaceA, spawnedBy: A, label: 'Worker C', updatedAt: 10 },
  });
  tasksA = new TaskSystemStore(resolveTaskDomain(workspaceA)); tasksB = new TaskSystemStore(resolveTaskDomain(workspaceB));
  for (const [store, key, generation, objective] of [[tasksA, A, 'generation-a', 'Build the alpha feature'], [tasksB, B, 'generation-b', 'Review the quantum needle']] as const) {
    const task = store.create({ objective, target: 'artifact.txt', constraints: [], acceptance: [{ id: 'owner', description: 'Receipt', verification: { kind: 'owner-receipt', owner: 'fixture-owner' } }] }, 'create').task;
    store.claim(task.contract.taskNodeId, key, generation, 'claim');
  }
  tasksA.inheritReference(A, 'generation-a', C, 'generation-c');
  runs = new Map([['run-a', { sessionKey: A, sessionId: 'generation-a', workspaceId: 'workspace-a', controller: new AbortController(), startedAtMs: 1 }],
    ['run-b', { sessionKey: B, sessionId: 'generation-b', workspaceId: 'workspace-b', controller: new AbortController(), startedAtMs: 2 }]]);
  registerAgentRunContext('run-c', { sessionKey: C, sessionId: 'generation-c' });
  subagentRuns.set('run-c', { runId: 'run-c', childSessionKey: C, requesterSessionKey: A, requesterSessionId: 'generation-a', requesterDisplayKey: A,
    task: 'Read the parent task', cleanup: 'keep', createdAt: 3, workspaceDir: workspaceA });
  addSession({ id: 'a2-process-b', command: 'fixture safe command', sessionKey: B, lifecycleCanonicalSessionKey: B, lifecycleExpectedSessionId: 'generation-b',
    startedAt: 3, exited: false, maxOutputChars: 10, totalOutputChars: 0, pendingStdout: [], pendingStderr: [], pendingStdoutChars: 0, pendingStderrChars: 0,
    aggregated: '', tail: '', truncated: false, backgrounded: true, cursorKeyMode: 'unknown' } satisfies ProcessSession);
  mocks.workspace.mockImplementation(async id => id === 'workspace-a' ? workspaceA : id === 'workspace-b' ? workspaceB : undefined);
  mocks.taskOpens.length = 0; mocks.fileReads.length = 0;
});
afterEach(() => {
  tasksA.close(); tasksB.close(); closeSqliteSessionStoreDatabase(sessionStore); closeOpenClawStateDatabase();
  clearAgentRunContext('run-c'); subagentRuns.delete('run-c'); deleteSession('a2-process-b'); vi.restoreAllMocks(); vi.unstubAllEnvs();
});
afterAll(() => {
  const directory = process.env.SESSION_COLLABORATION_EVIDENCE_DIR;
  if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'a2-query-readbacks.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-tf0920', receipts }, null, 2)); }
});

it('uses the same Main-owned Gateway for watch and cancellation', async () => {
  const request = parseSessionCollaborationWatch({ id: 'main-wait', query: query({ target: scope(), limit: 1 }), condition: 'changed', timeoutMs: 0 });
  const result: SessionCollaborationWatchResult = {
    schemaVersion: 'SessionCollaborationWatch/v1', id: request.id, state: 'timeout', cursor: null,
    page: (await runtime(request.query)).page, event: null,
  };
  const { rpc, api } = main();
  const cancel = { id: request.id, query: request.query };
  rpc.mockResolvedValueOnce({ watch: result }).mockResolvedValueOnce({ cancelled: true });
  await expect(api.watch(request)).resolves.toEqual({ success: true, watch: result });
  await expect(api.cancelWatch(cancel)).resolves.toEqual({ success: true, cancelled: true });
  expect(rpc).toHaveBeenNthCalledWith(1, 'session.activitySnapshot', { watch: request }, 5_000);
  expect(rpc).toHaveBeenNthCalledWith(2, 'session.activitySnapshot', { cancelWatch: cancel }, 5_000);
  rpc.mockImplementationOnce(async () => {
    mocks.workspace.mockResolvedValueOnce(workspaceB);
    return { watch: result };
  });
  await expect(api.watch(request)).resolves.toMatchObject({ watch: { state: 'stale', page: { reason: 'scope-mismatch', items: [] } } });
});

it('reads a bounded final material batch through the Gateway and rejects a reset during its reply', async () => {
  const claim = tasksA.binding(A, 'generation-a')!.claim!;
  const material = tasksA.publishSharedMaterial(claim, { id: 'batch-route', kind: 'claim', summary: 'Original owner result',
    sensitivity: 'internal', evidenceRefs: [] }, 'run-a', () => scope());
  const call = vi.fn(async (request: { params: Record<string, unknown> }) => {
    let result: unknown;
    await sessionActivityHandlers['session.activitySnapshot']({ params: request.params,
      context: { chatAbortControllers: runs, getRuntimeConfig: () => mocks.cfg },
      respond: (ok: boolean, data: unknown, error?: { message: string }) => { if (!ok) throw new Error(error?.message); result = data; },
    } as never);
    return result;
  });
  const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: call as never };
  const selections = [{ ref: materialReference(material), source: scope() }];
  const pages = await querySessionCollaborationMaterialBatchTool(opts, selections);
  expect(pages).toMatchObject([{ state: 'ready', detail: { material: JSON.parse(JSON.stringify(material)), state: 'claim' } }]);
  expect(call.mock.calls[0][0].params).toMatchObject({ materialsBatch: [{ requester: scope(), target: scope(), ref: materialReference(material) }] });
  call.mockImplementationOnce(async () => { put(A, { sessionId: 'reset' }); return { materials: pages }; });
  expect(await querySessionCollaborationMaterialBatchTool(opts, selections)).toMatchObject([{ state: 'unavailable', detail: null }]);
});

it('releases cancelled and expired Gateway waits while their initial owner reads are pending', async () => {
  vi.useFakeTimers();
  const resume: (() => void)[] = [];
  const pause: typeof archive.filterArchivedSessionStore = (_config, store) =>
    new Promise(resolve => { resume.push(() => resolve(store)); });
  vi.spyOn(archive, 'filterArchivedSessionStore').mockImplementationOnce(pause).mockImplementationOnce(pause);
  const request = parseSessionCollaborationWatch({ id: 'cancel-initial-read', query: query({ target: scope(), limit: 1 }), condition: 'changed' });
  const expiring = { ...request, id: 'expire-initial-read', timeoutMs: 5 };
  const context = { chatAbortControllers: runs, getRuntimeConfig: () => mocks.cfg } as never;
  const cancel = (id: string) => cancelSessionCollaborationWatch({ id, query: request.query }, context, 'fixture-window');
  try {
    const pending = watchSessionCollaboration(request, context, 'fixture-window');
    const timed = watchSessionCollaboration(expiring, context, 'fixture-window');
    expect(resume).toHaveLength(2);
    expect(cancel(request.id)).toEqual({ cancelled: true });
    await expect(pending).resolves.toMatchObject({ state: 'cancelled', event: null });
    await vi.advanceTimersByTimeAsync(5);
    await expect(timed).resolves.toMatchObject({ state: 'timeout', event: null });
    expect(cancel(request.id)).toEqual({ cancelled: false });
    expect(cancel(expiring.id)).toEqual({ cancelled: false });
  } finally {
    for (const release of resume) release();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  }
});

describe('A2 shared session discovery and detail', () => {
  it('returns the same owner-backed scopes, goals, actions and task references through UI and both existing session tools without mutation', async () => {
    const before = structuredClone(ownerState()); const input = query();
    const { api, rpc } = main();
    const ui = await readSessionCollaborationPage(input, api.query);
    const call = vi.fn(async (request: { params?: unknown }) => runtime((request.params as { query: SessionCollaborationQuery }).query));
    const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: call as never };
    const tool = await createSessionsListTool(opts).execute('list', { collaboration: true });
    expect(tool.details).toEqual(ui); expect(ui.items.map(row => row.sessionKey)).toEqual([A, B, C]);
    expect(ui.items.map(row => row.sources.run.value?.runId)).toEqual(['run-a', 'run-b', 'run-c']);
    expect(ui.items[1].sources.goal.value?.text).toBe('Review the quantum needle');
    expect(ui.items[1].sources.actions).toMatchObject({ state: 'ready', value: [{ id: 'a2-process-b', kind: 'process', state: 'running', run: null }] });
    expect(ui.items[2].sources.tasks.value![0]).toMatchObject({ referenceOnly: true, claim: { sessionKey: A, generation: 'generation-a', epoch: 1 } });
    const target = scope(B, 'workspace-b', 'generation-b');
    const status = await createSessionStatusTool(opts).execute('status', { readOnly: true, scope: target });
    const detail = await readSessionCollaborationPage(query({ target, limit: 1 }), api.query);
    expect(status.details).toEqual(detail); expect(detail.items[0].detail?.scope).toEqual(target);
    expect(mocks.git).not.toHaveBeenCalled(); expect(mocks.ledger).not.toHaveBeenCalled(); expect(mocks.statusText).not.toHaveBeenCalled(); expect(mocks.patched).not.toHaveBeenCalled();
    expect(mocks.checkoutCleanup).not.toHaveBeenCalled();
    expect(rpc.mock.calls.every(([method]) => method === 'session.activitySnapshot')).toBe(true);
    const after = ownerState(); expect(after).toEqual(before);
    receipts.push({ case: 'shared-ui-agent-owners', input, ui, detail, before, after, beforeSha256: hash(before), afterSha256: hash(after) });
  });
  it('keeps owned runs running without observed actions and rejects empty ready actions across consumers', async () => {
    const before = structuredClone(ownerState()), input = query({ target: scope(), limit: 1 });
    const { api, rpc } = main();
    const call = vi.fn(async (request: { params?: unknown }) => runtime((request.params as { query: SessionCollaborationQuery }).query));
    const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: call as never };
    const ui = await readSessionCollaborationPage(input, api.query);
    expect(ui).toMatchObject({ state: 'ready', items: [{ status: 'running', sources: { run: { state: 'ready' }, actions: { state: 'unknown', value: null } } }] });
    const list = await createSessionsListTool(opts).execute('owned-run-list', { collaboration: true });
    const status = await createSessionStatusTool(opts).execute('owned-run-status', { readOnly: true, scope: scope() });
    expect((list.details as SessionCollaborationPage).items[0]).toEqual(ui.items[0]); expect(status.details).toEqual(ui);
    const malformed = structuredClone(ui);
    malformed.items[0].sources.actions = { owner: 'session-task-effects/bash-processes', state: 'ready', value: [], readAt: Date.now() };
    expect(validateSessionCollaborationPage(input, malformed)).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
    rpc.mockResolvedValue({ page: malformed }); opts.callGateway = vi.fn(async () => ({ page: malformed })) as never;
    const rejectedUi = await readSessionCollaborationPage(input, api.query);
    const rejectedList = await createSessionsListTool(opts).execute('empty-ready-list', { collaboration: true });
    const rejectedStatus = await createSessionStatusTool(opts).execute('empty-ready-status', { readOnly: true, scope: scope() });
    expect(rejectedUi).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
    expect(rejectedList.details).toEqual(rejectedUi); expect(rejectedStatus.details).toEqual(rejectedUi);
    const after = ownerState(); expect(after).toEqual(before);
    receipts.push({ case: 'owned-run-without-actions-and-empty-ready-rejection', input, ui, list: list.details, status: status.details,
      malformed, rejectedUi, rejectedList: rejectedList.details, rejectedStatus: rejectedStatus.details, beforeSha256: hash(before), afterSha256: hash(after) });
  });
  it('distinguishes failed owner reads from missing reply envelopes across Main, UI and both tools', async () => {
    const before = structuredClone(ownerState()), input = query(), good = (await runtime(input)).page;
    const { api, rpc } = main();
    const fail = async () => { throw new Error('Fixture Gateway unavailable'); };
    rpc.mockImplementation(fail);
    const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: vi.fn(fail) as never };
    const invalidInput = { ...input, limit: 51 }, unread = vi.fn(fail);
    await expect(readSessionCollaborationPage(invalidInput, unread)).rejects.toThrow('Collaboration limit');
    await expect(api.query(invalidInput)).rejects.toThrow('Collaboration limit');
    await expect(createSessionsListTool(opts).execute('invalid-owner-query', { collaboration: true, limit: 51 })).rejects.toThrow('Collaboration limit');
    expect(unread).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled(); expect(opts.callGateway).not.toHaveBeenCalled();
    const unavailable = await readSessionCollaborationPage(input, api.query);
    expect(unavailable).toMatchObject({ state: 'unavailable', reason: 'owner-unavailable', items: [], nextCursor: null, scanned: 0 });
    expect(await readSessionCollaborationPage(input, fail)).toEqual(unavailable);
    const failedList = await createSessionsListTool(opts).execute('failed-owner-list', { collaboration: true });
    const failedStatus = await createSessionStatusTool(opts).execute('failed-owner-status', { readOnly: true, scope: scope() });
    expect(failedList.details).toEqual(unavailable); expect(failedStatus.details).toEqual(unavailable);
    const callsBeforeWorkspaceFailure = rpc.mock.calls.length;
    mocks.workspace.mockRejectedValueOnce(new Error('Fixture Workspace owner unavailable'));
    expect(await readSessionCollaborationPage(input, api.query)).toEqual(unavailable);
    expect(rpc).toHaveBeenCalledTimes(callsBeforeWorkspaceFailure);
    const malformedResults: Array<{ envelope: unknown; result: SessionCollaborationPage }> = [];
    for (const envelope of [null, undefined, { snapshot: good }]) {
      rpc.mockResolvedValue(envelope as never); opts.callGateway = vi.fn(async () => envelope) as never;
      const ui = await readSessionCollaborationPage(input, api.query);
      const list = await createSessionsListTool(opts).execute('missing-query-list', { collaboration: true });
      const status = await createSessionStatusTool(opts).execute('missing-query-status', { readOnly: true, scope: scope() });
      expect(ui).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
      expect(await readSessionCollaborationPage(input, () => envelope as never)).toEqual(ui);
      expect(list.details).toEqual(ui); expect(status.details).toEqual(ui);
      malformedResults.push({ envelope, result: ui });
    }
    expect(await readSessionCollaborationPage(input, () => ({ success: false, page: good }) as never)).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
    const after = ownerState(); expect(after).toEqual(before);
    receipts.push({ case: 'owner-failure-and-query-envelope', input, unavailable, malformedResults, beforeSha256: hash(before), afterSha256: hash(after) });
  });
  it('filters by real TaskSystem goals and workspace without switching the active workspace', async () => {
    const goal = (await runtime(query({ search: 'quantum needle' }))).page;
    expect(goal.items.map(row => row.sessionKey)).toEqual([B]);
    const filtered = (await runtime(query({ workspace: { workspaceId: scope().workspaceId, projectId: scope().projectId } }))).page;
    expect(filtered.items.map(row => row.sessionKey)).toEqual([A, C]);
    receipts.push({ case: 'goal-and-workspace-filter', goal, filtered });
  });
  it('keeps an unverifiable goal unknown while filtering metadata rows that have no session identity', async () => {
    put(B, { workspaceId: undefined });
    const noMatch = (await runtime(query({ search: 'missing search needle' }))).page;
    expect(noMatch).toMatchObject({ state: 'unknown', unknownMatches: 1, items: [] });
    const metadataMatch = (await runtime(query({ search: 'Independent B' }))).page;
    expect(metadataMatch.items.map(row => row.sessionKey)).toEqual([B]);
    expect(metadataMatch.items[0]).toMatchObject({ status: 'unknown', detail: null, sources: { session: { state: 'unknown' }, tasks: { state: 'not_read' } } });
    receipts.push({ case: 'unverified-search-owner', noMatch, metadataMatch });
  });
  it('reuses one read-only TaskSystem connection per execution root and reads no transcript bytes', async () => {
    const transcript = join(root, 'large.jsonl'); writeFileSync(transcript, 'fixture transcript content\n'.repeat(100_000));
    put(B, { sessionFile: transcript });
    const page = (await runtime(query())).page;
    expect(page.items).toHaveLength(3);
    expect(mocks.taskOpens).toHaveLength(2); expect(new Set(mocks.taskOpens).size).toBe(2);
    expect(mocks.fileReads.filter(path => path.endsWith('.jsonl'))).toEqual([]);
    receipts.push({ case: 'connection-and-transcript-budget', taskConnections: mocks.taskOpens.slice(), fileReads: mocks.fileReads.slice(), transcriptReads: 0, page });
  });
  it('attempts an incompatible TaskSystem schema only once per execution root and preserves its bytes', async () => {
    tasksA.db.exec('PRAGMA user_version=999');
    const before = structuredClone(ownerState());
    const page = (await runtime(query())).page;
    expect(page.items.filter(row => row.sessionKey !== B).every(row => row.sources.tasks.state === 'unavailable')).toBe(true);
    expect(mocks.taskOpens.filter(path => path === tasksA.domain.database)).toHaveLength(1);
    expect(ownerState()).toEqual(before);
    receipts.push({ case: 'incompatible-root-single-attempt', page, taskConnections: mocks.taskOpens.slice(), beforeSha256: hash(before), afterSha256: hash(ownerState()) });
  });
  it('returns bounded Unicode goals and preserves the full TaskSystem objective at the A1 detail entry', async () => {
    const key = 'agent:main:long-goal', objective = '🧭'.repeat(800);
    put(key, { sessionId: 'long-generation', workspaceId: 'workspace-a', workspaceDir: workspaceA, label: '🧭'.repeat(200), updatedAt: 10 });
    const task = tasksA.create({ objective, target: 'long.txt', constraints: [], acceptance: [{ id: 'long', description: 'Receipt', verification: { kind: 'owner-receipt', owner: 'fixture-owner' } }] }, 'long-create').task;
    tasksA.claim(task.contract.taskNodeId, key, 'long-generation', 'long-claim');
    const page = (await runtime(query({ target: scope(key, 'workspace-a', 'long-generation') }))).page;
    const row = page.items[0];
    expect(row.sources.goal.value).toEqual({ text: '🧭'.repeat(512), truncated: true }); expect(Array.from(row.label)).toHaveLength(160);
    let detail!: { snapshot: { readModel: { sources: { tasks: { value: Array<{ objective: string; digest: string }> } } } } };
    await sessionActivityHandlers['session.activitySnapshot']({ params: row.detail, context: { chatAbortControllers: runs, getRuntimeConfig: () => mocks.cfg },
      respond: (ok: boolean, data: unknown) => { expect(ok).toBe(true); detail = data as typeof detail; } } as never);
    expect(detail.snapshot.readModel.sources.tasks.value[0]).toMatchObject({ objective, digest: row.sources.tasks.value![0].digest });
    receipts.push({ case: 'bounded-unicode-goal-and-full-detail', page, detail });
  });
  it('reads an original in-flight tool request with its own run identity and removes it when the owner settles', async () => {
    vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1');
    const admission = { status: 'granted', bindingRevision: 1,
      claim: { id: 'fixture-admission', taskNodeId: tasksA.sessionSnapshot(A, 'generation-a').task!.contract.taskNodeId,
        sessionGeneration: 'generation-a', run: { runId: 'effect-run-a', scope: { workspaceId: 'workspace-a', projectId: 'workspace-a', sessionKey: A } } } };
    let requested!: () => void, grant!: (value: typeof admission) => void, started!: () => void, finish!: () => void;
    const requestSeen = new Promise<void>(resolve => { requested = resolve; });
    const approval = new Promise<typeof admission>(resolve => { grant = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const completion = new Promise<void>(resolve => { finish = resolve; });
    mocks.taskAdmission.mockImplementation(async () => { requested(); return approval; });
    const pending = withSessionTaskScope({ config: mocks.cfg, sessionKey: A, sessionId: 'generation-a', runId: 'effect-run-a', workspaceDir: workspaceA },
      'write', { path: 'fixture.txt' }, undefined, async () => { started(); await completion; },
      { operationId: 'a2-tool-effect', checkoutAccess: 'write' });
    try {
      await requestSeen;
      const waitingBefore = structuredClone(ownerState()), waitingOwner = readSessionTaskEffectRequests(A, 'generation-a');
      const originalRequest = getSessionTaskEffectRequest(waitingOwner[0].requestId);
      expect(originalRequest).toMatchObject({ sessionKey: A, sessionGeneration: 'generation-a', workspaceDir: workspaceA, runId: 'effect-run-a' });
      expect(Object.isFrozen(originalRequest)).toBe(true);
      const waiting = (await runtime(query({ target: scope() }))).page;
      expect(waitingOwner[0].run).toBeNull();
      expect(waiting.items[0].sources.actions).toMatchObject({ state: 'unknown', reason: 'run-identity-missing', value: null });
      expect(ownerState()).toEqual(waitingBefore); expect(readSessionTaskEffectRequests(A, 'generation-a')).toEqual(waitingOwner);
      expect(getSessionTaskEffectRequest(waitingOwner[0].requestId)).toBe(originalRequest);
      expect(sessionTaskOperationsInFlight('effect-run-a')).toEqual(['a2-tool-effect']);
      grant(admission);
      await entered;
      const before = structuredClone(ownerState());
      const original = readSessionTaskEffectRequests(A, 'generation-a');
      expect(original[0].run).toEqual(admission.claim.run);
      original[0].run!.scope.workspaceId = scope(B, 'workspace-b', 'generation-b').workspaceId;
      const active = (await runtime(query({ target: scope() }))).page;
      expect(active.items[0].sources.actions).toMatchObject({ state: 'ready', value: [{ id: 'a2-tool-effect', kind: 'tool', state: 'inflight', run: admission.claim.run }] });
      expect(readSessionTaskEffectRequests(A, 'generation-a')[0].run).toEqual(admission.claim.run);
      expect(getSessionTaskEffectRequest(waitingOwner[0].requestId)).toBe(originalRequest);
      expect(ownerState()).toEqual(before);
      finish(); await pending;
      expect(getSessionTaskEffectRequest(waitingOwner[0].requestId)).toBeUndefined();
      expect(sessionTaskOperationsInFlight('effect-run-a')).toEqual([]);
      const settled = (await runtime(query({ target: scope() }))).page;
      expect(settled.items[0].sources.actions).toMatchObject({ state: 'unknown', value: null });
      receipts.push({ case: 'inflight-tool-owner-and-settlement', admissionAdapter: 'fixture', waiting, active, settled, beforeSha256: hash(before), afterSha256: hash(ownerState()) });
    } finally { grant(admission); finish(); await pending; clearSessionTaskScopeRun('effect-run-a'); }
  });
  it('preserves a foreign admission scope for the same key and generation and rejects its actions across consumers', async () => {
    vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1'); runs.delete('run-a');
    const foreignRun = { runId: 'effect-run-foreign', scope: { workspaceId: 'workspace-b', projectId: 'workspace-b', sessionKey: A } };
    mocks.taskAdmission.mockResolvedValue({ status: 'granted', bindingRevision: 1,
      claim: { id: 'fixture-foreign-admission', taskNodeId: tasksA.sessionSnapshot(A, 'generation-a').task!.contract.taskNodeId,
        sessionGeneration: 'generation-a', run: foreignRun } });
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), completion = new Promise<void>(resolve => { finish = resolve; });
    const pending = withSessionTaskScope({ config: mocks.cfg, sessionKey: A, sessionId: 'generation-a', runId: foreignRun.runId, workspaceDir: workspaceB },
      'write', { path: 'foreign.txt' }, undefined, async () => { started(); await completion; }, { operationId: 'a2-foreign-effect', checkoutAccess: 'write' });
    try {
      await entered;
      const before = structuredClone(ownerState()), original = readSessionTaskEffectRequests(A, 'generation-a'), input = query({ target: scope(), limit: 1 });
      expect(original[0].run).toEqual(foreignRun);
      const ui = await readSessionCollaborationPage(input, main().api.query);
      const call = vi.fn(async (request: { params?: unknown }) => runtime((request.params as { query: SessionCollaborationQuery }).query));
      const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: call as never };
      const listed = await createSessionsListTool(opts).execute('foreign-action-list', { collaboration: true });
      const status = await createSessionStatusTool(opts).execute('foreign-action-status', { readOnly: true, scope: scope() });
      expect((listed.details as SessionCollaborationPage).items.find(row => row.sessionKey === A)).toEqual(ui.items[0]);
      expect(status.details).toEqual(ui);
      expect(ui.items[0].sources.actions).toMatchObject({ state: 'unavailable', reason: 'scope-mismatch', value: null });
      expect(ui.items[0].sources.run.state).toBe('empty'); expect(ui.items[0].status).toBe('unknown');
      const after = ownerState(); expect(after).toEqual(before); expect(readSessionTaskEffectRequests(A, 'generation-a')).toEqual(original);
      put(A, { sessionId: 'generation-new' });
      const current = scope(A, 'workspace-a', 'generation-new'), resetBefore = structuredClone(ownerState());
      const reset = (await runtime(query({ requester: current, target: current }))).page;
      expect(reset.items[0].sources.actions).toMatchObject({ state: 'empty', value: [] }); expect(reset.items[0].status).toBe('idle');
      expect(readSessionTaskEffectRequests(A, 'generation-new')).toEqual([]); expect(ownerState()).toEqual(resetBefore);
      receipts.push({ case: 'same-key-generation-foreign-action-scope', admissionAdapter: 'fixture', original, ui, reset, beforeSha256: hash(before), afterSha256: hash(after) });
    } finally { finish(); await pending; clearSessionTaskScopeRun(foreignRun.runId); }
  });
  it('pages using a scoped metadata cursor and rejects old generations and cursor identities', async () => {
    const input = query({ limit: 1 });
    const first = (await runtime(input)).page;
    const second = (await runtime({ ...input, cursor: first.nextCursor! })).page;
    expect(first.items[0].sessionKey).toBe(A); expect(second.items[0].sessionKey).toBe(B);
    put(B, { sessionId: 'generation-reset' });
    const stale = (await runtime({ ...input, cursor: first.nextCursor! })).page;
    expect(stale).toMatchObject({ state: 'stale', items: [] });
    expect((await runtime(query({ target: scope(B, 'workspace-b', 'generation-b') }))).page.state).toBe('stale');
    receipts.push({ case: 'pagination-and-old-generation', first, second, stale });
  });
  it('invalidates a cursor after metadata label or effective visibility changes', async () => {
    const input = query({ limit: 1 }), first = (await runtime(input)).page;
    put(B, { label: 'Renamed without clock change' });
    const renamed = (await runtime({ ...input, cursor: first.nextCursor! })).page;
    expect(renamed).toMatchObject({ state: 'stale', items: [] });
    const current = (await runtime(input)).page;
    mocks.cfg = { tools: { sessions: { visibility: 'self' } } };
    const restricted = (await runtime({ ...input, cursor: current.nextCursor! })).page;
    expect(restricted).toMatchObject({ state: 'stale', items: [] });
    receipts.push({ case: 'cursor-metadata-and-visibility-fence', renamed, restricted });
  });
  it('keeps unselected fields not_read and bounds discovery to a single 100-candidate scan', async () => {
    const source = loadExistingSqliteSessionStoreReadOnly(sessionStore);
    for (let index = 0; index < 150; index++) source[`agent:main:bulk-${index.toString().padStart(3, '0')}`] = { sessionId: `gen-${index}`, workspaceId: 'workspace-a', workspaceDir: workspaceA, updatedAt: 10 };
    replaceSqliteSessionStore(sessionStore, source);
    const probe = vi.spyOn(metadata, 'loadCombinedSessionStoreForGateway');
    const snapshot = vi.spyOn(TaskSystemStore.prototype, 'sessionSnapshot');
    const fields = (await runtime(query({ fields: [], limit: 50 }))).page;
    expect(fields.items).toHaveLength(50); expect(fields.items[0].sources.goal.state).toBe('not_read'); expect(fields.items[0].sources.run.state).toBe('not_read');
    expect(snapshot).not.toHaveBeenCalled(); expect(probe).toHaveBeenCalledTimes(2);
    const scanned = (await runtime(query({ search: 'not-present', limit: 50 }))).page;
    expect(scanned.scanned).toBe(100); expect(scanned.nextCursor).not.toBeNull(); expect(scanned.items).toEqual([]);
    receipts.push({ case: 'bounded-page-and-fields', fields, scanned });
  });
  it('distinguishes verified empty tasks, idle runs, unavailable owners and unknown activity', async () => {
    put('agent:main:discussion', { sessionId: 'generation-discussion', workspaceId: 'workspace-a', workspaceDir: workspaceA, updatedAt: 10 });
    const idle = (await runtime(query({ target: scope('agent:main:discussion', 'workspace-a', 'generation-discussion') }))).page.items[0];
    expect(idle.status).toBe('idle'); expect(idle.sources.tasks).toMatchObject({ state: 'empty', value: [] });
    expect((await runtime(query({ target: scope() }))).page.items[0].sources.actions.state).toBe('unknown');
    const absent = join(root, 'no-task'); mkdirSync(absent); execFileSync('git', ['init', '--quiet', absent]); put(B, { workspaceDir: absent });
    const unavailable = (await runtime(query({ target: scope(B, 'workspace-b', 'generation-b') }))).page.items[0];
    expect(unavailable.sources.tasks.state).toBe('unavailable'); expect(existsSync(resolveTaskDomain(absent).database)).toBe(false);
    receipts.push({ case: 'source-states', idle, unavailable });
  });
  it('fences reset during the owner join and never reuses a current-session result for another workspace', async () => {
    const original = metadata.loadCombinedSessionStoreForGateway;
    vi.spyOn(metadata, 'loadCombinedSessionStoreForGateway').mockImplementationOnce(original).mockImplementationOnce((cfg, options) => {
      put(B, { sessionId: 'reset-during-read' }); return original(cfg, options);
    });
    const reset = (await runtime(query())).page; expect(reset).toMatchObject({ state: 'stale', items: [] });
    const foreign = (await runtime(query({ target: scope(A, 'workspace-b', 'generation-a') }))).page;
    expect(foreign).toMatchObject({ state: 'stale', reason: 'scope-mismatch', items: [] });
    const requesterMismatch = (await runtime(query({ requester: scope(A, 'workspace-b', 'generation-a') }))).page;
    expect(requesterMismatch).toMatchObject({ state: 'stale', reason: 'scope-mismatch', items: [] });
    receipts.push({ case: 'reset-and-cross-workspace', reset, foreign, requesterMismatch });
  });
  it.each(['self', 'tree', 'agent'] as const)('applies original %s visibility before hydrating task details', async visibility => {
    mocks.cfg = { tools: { sessions: { visibility } } };
    const read = vi.spyOn(TaskSystemStore.prototype, 'sessionSnapshot');
    const page = (await runtime(query())).page;
    expect(page.items.map(row => row.sessionKey)).toEqual(visibility === 'self' ? [A] : visibility === 'tree' ? [A, C] : [A, B, C]);
    if (visibility !== 'agent') expect(read.mock.calls.some(([key]) => key === B)).toBe(false);
  });
  it('uses existing A2A allow rules and sandbox clamps without accepting policy overrides from parameters', async () => {
    put('agent:peer:other', { sessionId: 'peer-gen', workspaceId: 'workspace-b', workspaceDir: workspaceB, updatedAt: 10 });
    expect((await runtime(query())).page.items.some(row => row.sessionKey === 'agent:peer:other')).toBe(false);
    mocks.cfg = { tools: { sessions: { visibility: 'all' }, agentToAgent: { enabled: true, allow: ['main', 'peer'] } } };
    expect((await runtime(query())).page.items.some(row => row.sessionKey === 'agent:peer:other')).toBe(true);
    mocks.cfg = { ...mocks.cfg, agents: { defaults: { sandbox: { mode: 'all', sessionToolsVisibility: 'spawned' } } } };
    expect((await runtime(query())).page.items.map(row => row.sessionKey)).toEqual([A, C]);
    await expect(runtime({ ...query(), visibility: 'all' } as SessionCollaborationQuery)).rejects.toThrow();
  });
  it('rejects model edits, spoofed requesters and stale sender generations on readOnly tool requests', async () => {
    const call = vi.fn(); const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: call as never };
    await expect(createSessionStatusTool(opts).execute('edit', { readOnly: true, model: 'unsafe/model' })).rejects.toThrow();
    expect(requiresSessionTaskScope('session_status', { readOnly: true, model: 'unsafe/model' })).toBe(false);
    expect(isMutatingToolCall('session_status', { readOnly: true, model: 'unsafe/model' })).toBe(false);
    expect(requiresSessionTaskScope('sessions_watch', {})).toBe(false);
    expect(isMutatingToolCall('sessions_watch', {})).toBe(false);
    expect(requiresSessionTaskScope('session_status', { model: 'existing/model' })).toBe(true);
    expect(isMutatingToolCall('session_status', { model: 'existing/model' })).toBe(true);
    await expect(createSessionsListTool(opts).execute('spoof', { collaboration: true, requester: scope(B, 'workspace-b', 'generation-b') })).rejects.toThrow();
    const stale = await createSessionsListTool({ ...opts, agentSessionId: 'old-generation' }).execute('old', { collaboration: true });
    expect(stale.details).toMatchObject({ state: 'stale', items: [] }); expect(call).not.toHaveBeenCalled(); expect(mocks.patched).not.toHaveBeenCalled();
    await expect(createSessionsListTool(opts).execute('filter', { collaboration: true, agentId: 'peer' })).rejects.toThrow('Unexpected collaboration tool parameter');
  });
  it('rejects malformed, unselected and cross-scope replies consistently at Main, UI and tool consumers', async () => {
    const input = query(), good = (await runtime(input)).page;
    const scopedInput = query({ target: scope(), limit: 1 }), scopedGood = (await runtime(scopedInput)).page;
    expect(await readSessionCollaborationPage(input, () => ({ success: true, page: good }))).toEqual(good);
    const corruptions: Array<[string, (page: SessionCollaborationPage) => void, 'unknown' | 'stale', SessionActivityReadReason?]> = [
      ['missing-source', page => { delete (page.items[0].sources as Partial<typeof page.items[0]['sources']>).tasks; }, 'unknown'],
      ['missing-source-reason', page => { Reflect.deleteProperty(page.items[0].sources.actions, 'reason'); }, 'unknown'],
      ['missing-ready-value', page => { page.items[0].sources.session.value = null as never; }, 'unknown'],
      ['wrong-row-key', page => { page.items[0].sessionKey = 'agent:main:wrong' as typeof page.items[0]['sessionKey']; }, 'stale'],
      ['wrong-run-scope', page => { page.items[0].sources.run.value!.scope.workspaceId = scope(B, 'workspace-b', 'generation-b').workspaceId; }, 'stale'],
      ['negative-read-budget', page => { page.scanned = -1; }, 'unknown'],
      ['excess-actions', page => { page.items[page.items.length > 1 ? 1 : 0].sources.actions = { owner: 'session-task-effects/bash-processes', state: 'ready', readAt: Date.now(), value: Array.from({ length: 9 }, () => good.items[1].sources.actions.value![0]) }; }, 'unknown'],
      ['invalid-task-revision', page => { page.items[0].sources.tasks.value![0].revision = 0; }, 'unknown'],
      ['unverified-session-with-facts', page => { page.items[0].sources.session = { owner: 'sessions', state: 'unknown', value: null, readAt: null, reason: 'owner-missing' }; }, 'unknown'],
      ['invented-idle', page => { page.items[0].status = 'idle'; }, 'unknown'],
      ['missing-requester', page => { Reflect.deleteProperty(page, 'requester'); }, 'unknown'],
      ['duplicate-session', page => { page.items[1] = structuredClone(page.items[0]); page.scanned = Math.max(page.scanned, page.items.length); }, 'unknown'],
      ['observed-unread-source', page => { page.items[0].sources.tasks = { owner: 'TaskSystem', state: 'not_read', value: null, readAt: Date.now(), reason: 'source-not-read' }; }, 'unknown'],
      ['unread-owner-missing', page => { page.items[0].sources.tasks = { owner: 'TaskSystem', state: 'not_read', value: null, readAt: null, reason: 'owner-missing' }; }, 'unknown'],
      ['unknown-source-reason', page => { Reflect.set(page.items[0].sources.actions, 'reason', 'invented-reason'); }, 'unknown'],
      ['unknown-page-reason', page => { Reflect.set(page, 'reason', 'invented-reason'); }, 'unknown'],
      ['failed-page-cursor', page => { page.items = []; page.state = 'stale'; page.reason = 'generation-changed'; page.scanned = 0; page.unknownMatches = 0; page.nextCursor = 'old-page'; }, 'unknown'],
      ['old-requester-generation', page => { page.requester.sessionGeneration = 'old-generation'; }, 'stale', 'generation-changed'],
      ['old-detail-generation', page => { page.items[0].detail!.scope = { ...page.items[0].detail!.scope, sessionGeneration: 'old-generation' }; }, 'stale', 'generation-changed'],
      ['old-self-generation', page => { page.items[0].sources.session.value!.scope.sessionGeneration = 'old-generation'; page.items[0].detail!.scope.sessionGeneration = 'old-generation'; }, 'stale', 'generation-changed'],
    ];
    const { api, rpc } = main();
    const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: vi.fn() as never };
    for (const [name, corrupt, state, reason] of corruptions) {
      const expectedReason = reason ?? (state === 'stale' ? 'scope-mismatch' : 'protocol-unverified');
      const page = structuredClone(good); corrupt(page);
      expect(validateSessionCollaborationPage(input, page), name).toMatchObject({ state, reason: expectedReason, items: [] });
      rpc.mockResolvedValue({ page });
      opts.callGateway = vi.fn(async () => ({ page })) as never;
      const ui = await readSessionCollaborationPage(input, api.query);
      const tool = await createSessionsListTool(opts).execute(name, { collaboration: true });
      expect(ui, name).toMatchObject({ state, reason: expectedReason, items: [] }); expect(tool.details, name).toEqual(ui);
      const scopedPage = structuredClone(scopedGood); corrupt(scopedPage);
      rpc.mockResolvedValue({ page: scopedPage }); opts.callGateway = vi.fn(async () => ({ page: scopedPage })) as never;
      const scopedUi = await readSessionCollaborationPage(scopedInput, api.query);
      const status = await createSessionStatusTool(opts).execute(name, { readOnly: true, scope: scope() });
      expect(scopedUi, name).toMatchObject({ state, reason: expectedReason, items: [] }); expect(status.details, name).toEqual(scopedUi);
    }
    const selected = query({ fields: [] });
    const unchecked = (await runtime(selected)).page;
    unchecked.items[0].sources.tasks = good.items[0].sources.tasks;
    expect(validateSessionCollaborationPage(selected, unchecked)).toMatchObject({ state: 'unknown', items: [] });
    receipts.push({ case: 'shared-reply-boundary', rejectedCases: corruptions.map(([name, , state, reason]) => ({ name, state, reason: reason ?? (state === 'stale' ? 'scope-mismatch' : 'protocol-unverified') })), unselectedFieldRejected: true });
  });
  it('preserves unknown search matches and rejects a fabricated empty page across consumers', async () => {
    put(B, { workspaceId: undefined });
    const input = query({ search: 'missing search needle' }), good = (await runtime(input)).page;
    expect(validateSessionCollaborationPage(input, good)).toEqual(good);
    expect(good).toMatchObject({ state: 'unknown', unknownMatches: 1, items: [] });
    const malformed = { ...good, state: 'empty' as const };
    expect(validateSessionCollaborationPage(input, malformed)).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
    const { api, rpc } = main(); rpc.mockResolvedValue({ page: malformed });
    const opts = { agentSessionKey: A, agentSessionId: 'generation-a', config: mocks.cfg, callGateway: vi.fn(async () => ({ page: malformed })) as never };
    const ui = await readSessionCollaborationPage(input, api.query);
    const list = await createSessionsListTool(opts).execute('unknown-search-list', { collaboration: true, search: input.search });
    const status = await createSessionStatusTool(opts).execute('unknown-search-status', { readOnly: true, scope: scope() });
    expect(ui).toMatchObject({ state: 'unknown', reason: 'protocol-unverified', items: [] });
    expect(list.details).toEqual(ui); expect(status.details).toEqual(ui);
    receipts.push({ case: 'unknown-search-cannot-be-empty', input, good, malformed, ui, list: list.details, status: status.details });
  });
  it.each([{ limit: 51 }, { limit: 0 }, { fields: ['unknown'] }, { cursor: 'x'.repeat(257) }, { requester: { ...scope(), writeClaim: true } }])(
    'rejects an unbounded or authority-bearing query before owner hydration: %j', async patch => {
      const read = vi.spyOn(metadata, 'loadCombinedSessionStoreForGateway');
      await expect(runtime({ ...query(), ...patch } as SessionCollaborationQuery)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
    });
});
