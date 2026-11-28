// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHandoffOperation } from '@shared/types/session-handoff';
import type { RawMessage } from '@shared/chat/types';

const state = vi.hoisted(() => ({ root: '', store: '' }));
vi.mock('electron-store', () => ({ default: class {
  get(key: string) { return JSON.parse(readFileSync(state.store, 'utf8'))[key]; }
  set(key: string, value: unknown) { const data = JSON.parse(readFileSync(state.store, 'utf8')); writeFileSync(state.store, JSON.stringify({ ...data, [key]: value })); }
} }));
vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => state.root, expandPath: (path: string) => path, getResourcesDir: () => resolve('resources'),
  getUserDataDir: () => state.root, getDataDir: () => state.root,
}));
vi.mock('@electron/utils/store', () => ({ getSetting: async () => undefined, setSetting: vi.fn() }));
vi.mock('@electron/services/workspace-runtime-sync', () => ({ syncActiveWorkspacePermissionToRuntime: vi.fn(), syncActiveWorkspaceRootToRuntime: vi.fn() }));
vi.mock('@electron/utils/clawx-harness-template', () => ({ ensureVerseClawWorkspaceHarness: vi.fn(async () => ({})) }));
vi.mock('@electron/services/knowledge-api', () => ({ resolveHostOpenClawStateDir: () => state.root }));
vi.mock('@electron/services/mock-provider', () => ({ handleMockChatSend: () => null }));
vi.mock('@electron/utils/token-usage', () => ({ getSessionTokenUsageSummary: async () => ({ totalTokens: 0, estimatedCostUsd: 0 }) }));
vi.mock('@electron/services/resource-tracker', () => ({ getResourceTracker: () => ({
  markSessionActive: vi.fn(), scanListeningPorts: async () => [], watchNewListeningPorts: vi.fn(),
}) }));
vi.mock('@electron/services/long-session-resource-reclamation', () => ({ reclaimLongSessionOwnerResources: vi.fn() }));

import { createSessionsApi } from '@electron/services/sessions-api';
import { createChatApi } from '@electron/services/chat-api';
import { createTaskLedgerApi } from '@electron/services/task-ledger-api';
import { createWorkspacesApi, readWorkspaceCollaborationContinuity } from '@electron/services/workspaces-api';
import { GatewayRpcError } from '@electron/gateway/protocol';

type Session = { key: string; sessionId: string; parentSessionKey?: string; spawnedBy?: string; hasActiveRun?: boolean };
const source = 'agent:main:source';
const sessions = new Map<string, Session>();
const histories = new Map<string, RawMessage[]>();
let lostCreate = false;
let sendMode: 'ok' | 'lost-after-persist' | 'lost-before-persist' | 'rejected' = 'ok';
let changeDuringHistory = false;
let startSourceDuringCreate = false;
let sourceResourcesBusy = false;
const rpc = vi.fn(async (method: string, params: Record<string, unknown>) => {
  if (method === 'sessions.describe') return { session: sessions.get(String(params.key)) ?? null };
  if (method === 'sessions.create') {
    const key = String(params.key);
    sessions.set(key, { key, sessionId: `generation-${sessions.size}`, parentSessionKey: String(params.parentSessionKey) });
    if (startSourceDuringCreate) sessions.set(source, { ...sessions.get(source)!, hasActiveRun: true });
    if (lostCreate) { lostCreate = false; throw new Error('creation response lost'); }
    return { key, sessionId: sessions.get(key)!.sessionId };
  }
  if (method === 'chat.history') {
    const key = String(params.sessionKey);
    const messages = histories.get(key) ?? [];
    if (changeDuringHistory) { changeDuringHistory = false; sessions.set(key, { ...sessions.get(key)!, sessionId: 'reset-generation' }); }
    return { messages };
  }
  if (method === 'chat.send') {
    if (sendMode === 'rejected') throw new GatewayRpcError({ code: 'INVALID_REQUEST', message: 'rejected before effects' });
    if (sendMode === 'lost-before-persist') throw new Error('request outcome unknown');
    histories.set(String(params.sessionKey), [{ role: 'user', content: String(params.message),
      idempotencyKey: `${params.idempotencyKey}:user` } as RawMessage]);
    if (sendMode === 'lost-after-persist') throw new Error('send response lost');
    return { runId: String(params.idempotencyKey) };
  }
  if (method === 'sessions.send' || method === 'sessions.steer') return { runId: params.idempotencyKey };
  if (method === 'taskScope.runState') return { ...params, currentGeneration: 'source-generation',
    active: false, quiescent: !sourceResourcesBusy,
    delegation: { parentSessionKey: source, parentGeneration: 'source-generation', workspaceDir: state.root } };
  return {};
});
function services(beforeHandoffActivation?: () => Promise<void>) {
  const gatewayManager = { rpc } as never;
  const workspace = createWorkspacesApi({ gatewayManager, taskLedgerApi: createTaskLedgerApi(), gitApi: {
    status: async () => ({ success: true, status: { isRepository: false, workspaceRoot: state.root } }),
    worktrees: async () => ({ success: true, worktrees: [] }),
  } as never });
  return { sessions: createSessionsApi({ gatewayManager, coordinatorLifecycle: async (event) => {
    if (event.type === 'handoff') await beforeHandoffActivation?.();
    return workspace.coordinatorLifecycle(event);
  },
    gatewayRpcForDelegation: (payload) => rpc(payload.method, payload.params as Record<string, unknown>) }),
  chat: createChatApi({ gatewayManager, selectSessionTask: workspace.selectSessionTask }) };
}
const payload = (operationId = 'operation-unique-1') => ({ sessionKey: source, workspaceId: 'workspace-a', draftInput: 'Continue with the verified evidence.', operationId });
async function send(operation: SessionHandoffOperation) {
  return services().chat.sendWithMedia({ sessionKey: operation.sessionKey, workspaceId: operation.workspaceId,
    message: operation.draftInput, idempotencyKey: operation.firstSendIdempotencyKey, handoffOperationId: operation.id });
}
async function persisted(id: string) {
  return JSON.parse(await readFile(state.store, 'utf8')).profiles[0].handoffOperations[id] as SessionHandoffOperation;
}

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), 'handoff-recovery-'));
  state.store = join(state.root, 'workspaces.json');
  await writeFile(state.store, JSON.stringify({ activeWorkspaceId: 'workspace-a', profiles: [{ id: 'workspace-a', name: 'Project',
    rootPath: state.root, agentId: 'main', selectedAgentId: 'main', activeSessionKey: source, permissionMode: 'fullAccess',
    projectCoordinatorSessionKey: source,
    agentBindings: { main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: source } },
    state: {}, sessionStates: { [source]: { draftInput: 'Keep my source draft' } }, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 }] }));
  sessions.clear(); sessions.set(source, { key: source, sessionId: 'source-generation' });
  histories.clear(); rpc.mockClear(); lostCreate = false; sendMode = 'ok'; changeDuringHistory = false; startSourceDuringCreate = false; sourceResourcesBusy = false;
});
afterEach(async () => { await rm(state.root, { recursive: true, force: true }); });

describe('durable handoff owner', () => {
  it('projects the persisted handoff identity and draft retention after a lost creation response', async () => {
    lostCreate = true;
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('creation response lost');
    const scope = { workspaceId: 'workspace-a', projectId: 'workspace-a', sessionKey: source, sessionGeneration: 'source-generation' } as const;
    const pending = await readWorkspaceCollaborationContinuity(scope as never);
    expect(pending).toMatchObject([{ id: payload().operationId, kind: 'handoff', phase: 'creating', draftRetained: true }]);
    expect(JSON.stringify(pending)).not.toContain(payload().draftInput);
    const ready = await services().sessions.createHandoff(payload());
    const inherited = await readWorkspaceCollaborationContinuity({ ...scope, sessionKey: ready.sessionKey!, sessionGeneration: ready.operation!.sessionGeneration! } as never);
    expect(inherited).toMatchObject([{ id: pending[0].id, sessionKey: pending[0].sessionKey, phase: 'ready', firstSendIdempotencyKey: ready.operation!.firstSendIdempotencyKey }]);
    expect(await readWorkspaceCollaborationContinuity({ ...scope, sessionGeneration: 'wrong-generation' } as never)).toEqual([]);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('retains one pending child while source resources remain unresolved without a writer binding', async () => {
    sourceResourcesBusy = true;
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('HANDOFF_SOURCE_WRITER_BUSY');
    const pending = await persisted(payload().operationId);
    expect(pending.phase).toBe('creating');
    expect(rpc).toHaveBeenCalledWith('taskScope.runState', expect.objectContaining({
      sessionKey: source, sessionGeneration: 'source-generation', processScope: 'session',
    }), 10_000);
    sourceResourcesBusy = false;
    const resumed = await services().sessions.createHandoff(payload());
    expect(resumed.sessionKey).toBe(pending.sessionKey);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('binds the task selected in the existing composer before dispatching chat effects', async () => {
    const ledger = createTaskLedgerApi();
    const created = await ledger.createNode({ workspaceId: 'workspace-a', node: { title: 'Chosen existing task', kind: 'task', status: 'done' } });
    const task = created.snapshot.nodes[0];
    const sent = await services().chat.sendWithMedia({ workspaceId: 'workspace-a', sessionKey: source,
      message: 'Execute this task', activeTaskNodeId: task.id, idempotencyKey: 'selected-task-send' });
    expect(sent.success, sent.error).toBe(true);
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    expect(document.profiles[0].coordinatorBindings[source].activeTaskNodeId).toBe(task.id);
    expect((await ledger.snapshot({ workspaceId: 'workspace-a' })).snapshot.nodes.find((node) => node.id === task.id)?.status).toBe('done');
  });
  it('keeps the same pending child when the source starts a run during creation', async () => {
    startSourceDuringCreate = true;
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('HANDOFF_SOURCE_ACTIVE');
    const pending = await persisted(payload().operationId);
    expect(pending.phase).toBe('creating');
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    expect(document.profiles[0].sessionStates[pending.sessionKey]).toBeUndefined();
    startSourceDuringCreate = false;
    sessions.set(source, { ...sessions.get(source)!, hasActiveRun: false });
    const restored = await services().sessions.createHandoff(payload());
    expect(restored.sessionKey).toBe(pending.sessionKey);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('confirms runtime ancestry, saves the child draft and reuses one child across duplicate creation requests', async () => {
    const first = await services().sessions.createHandoff(payload());
    const second = await services().sessions.createHandoff(payload());
    expect(second.sessionKey).toBe(first.sessionKey);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
    expect(sessions.get(first.sessionKey!)?.parentSessionKey).toBe(source);
    const saved = await persisted(payload().operationId);
    expect(saved).toMatchObject({ phase: 'ready', sourceGeneration: 'source-generation', sessionGeneration: sessions.get(first.sessionKey!)?.sessionId });
    expect(JSON.parse(await readFile(state.store, 'utf8')).profiles[0].sessionStates[source].draftInput).toBe('Keep my source draft');
    expect(JSON.parse(await readFile(state.store, 'utf8')).profiles[0].projectCoordinatorSessionKey).toBe(first.sessionKey);
  });
  it('creates independent children for different intent IDs and replays each ID without creating again', async () => {
    const alpha = payload('u3-alpha-intent-001');
    const bravo = payload('u3-bravo-intent-002');
    expect({ ...alpha, operationId: undefined }).toEqual({ ...bravo, operationId: undefined });

    const first = await services().sessions.createHandoff(alpha);
    const replayFirst = await services().sessions.createHandoff(alpha);
    const second = await services().sessions.createHandoff(bravo);
    // Reconstruct the Main services between calls; persistence, not instance state, owns replay.
    const replaySecond = await services().sessions.createHandoff(bravo);
    expect([first.success, replayFirst.success, second.success, replaySecond.success]).toEqual([true, true, true, true]);
    expect(replayFirst.sessionKey).toBe(first.sessionKey);
    expect(replaySecond.sessionKey).toBe(second.sessionKey);
    expect(second.sessionKey).not.toBe(first.sessionKey);
    expect(sessions.get(first.sessionKey!)?.parentSessionKey).toBe(source);
    expect(sessions.get(second.sessionKey!)?.parentSessionKey).toBe(source);
    expect(sessions.get(source)?.sessionId).toBe('source-generation');

    const savedFirst = await persisted(alpha.operationId);
    const savedSecond = await persisted(bravo.operationId);
    expect(savedFirst).toMatchObject({ id: alpha.operationId, phase: 'ready', sessionKey: first.sessionKey,
      sourceSessionKey: source, sourceGeneration: 'source-generation', draftInput: alpha.draftInput });
    expect(savedSecond).toMatchObject({ id: bravo.operationId, phase: 'ready', sessionKey: second.sessionKey,
      sourceSessionKey: source, sourceGeneration: 'source-generation', draftInput: alpha.draftInput });
    expect(savedFirst.draftDigest).toBe(savedSecond.draftDigest);
    expect(savedFirst.firstSendIdempotencyKey).not.toBe(savedSecond.firstSendIdempotencyKey);
    const creates = rpc.mock.calls.filter(([method]) => method === 'sessions.create');
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map(([, input]) => input.key))).toEqual(new Set([first.sessionKey, second.sessionKey]));
    expect(rpc.mock.calls.filter(([method]) => method === 'chat.send')).toHaveLength(0);
    const document = JSON.parse(await readFile(state.store, 'utf8'));
    expect(document.profiles[0].sessionStates[source].draftInput).toBe('Keep my source draft');
    expect(Object.keys(document.profiles[0].handoffOperations).sort()).toEqual([alpha.operationId, bravo.operationId].sort());
  });

  it('recovers a lost creation reply from the same runtime child after reconstructing Main services', async () => {
    lostCreate = true;
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('creation response lost');
    const pending = await persisted(payload().operationId);
    expect(pending.phase).toBe('creating');
    const recovered = await services().sessions.createHandoff(payload());
    expect(recovered.sessionKey).toBe(pending.sessionKey);
    expect(recovered.operation?.phase).toBe('ready');
    expect((await persisted(payload().operationId)).sessionGeneration).toBe(sessions.get(pending.sessionKey)?.sessionId);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('keeps creation pending when the lifecycle owner is unavailable', async () => {
    await expect(createSessionsApi({ gatewayManager: { rpc } as never }).createHandoff(payload()))
      .rejects.toThrow('Lifecycle coordinator owner unavailable');
    expect(await persisted(payload().operationId)).toMatchObject({ phase: 'creating', sessionGeneration: expect.any(String) });
    expect(JSON.parse(await readFile(state.store, 'utf8')).profiles[0].projectCoordinatorSessionKey).toBe(source);
  });
  it('pins the child generation before activation and rejects a removed or reset child during recovery', async () => {
    await expect(services(async () => { throw new Error('activation interrupted'); })
      .sessions.createHandoff(payload())).rejects.toThrow('activation interrupted');
    const pending = await persisted(payload().operationId);
    const child = sessions.get(pending.sessionKey)!;
    expect(pending).toMatchObject({ phase: 'creating', sessionGeneration: child.sessionId });
    expect(JSON.parse(await readFile(state.store, 'utf8')).profiles[0].projectCoordinatorSessionKey).toBe(source);

    sessions.delete(pending.sessionKey);
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('HANDOFF_CHILD_GENERATION_CHANGED');
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
    sessions.set(pending.sessionKey, { ...child, sessionId: 'reset-child-generation' });
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('HANDOFF_CHILD_GENERATION_CHANGED');
    expect((await persisted(payload().operationId)).phase).toBe('creating');

    sessions.set(pending.sessionKey, child);
    const recovered = await services().sessions.createHandoff(payload());
    expect(recovered.operation).toMatchObject({ phase: 'ready', sessionKey: pending.sessionKey,
      sessionGeneration: child.sessionId });
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('rejects a changed source generation or draft without creating a second child', async () => {
    await services().sessions.createHandoff(payload());
    await expect(services().sessions.createHandoff({ ...payload(), draftInput: 'Different payload' })).rejects.toThrow('HANDOFF_SOURCE_OR_DRAFT_CHANGED');
    sessions.set(source, { key: source, sessionId: 'source-reset' });
    await expect(services().sessions.createHandoff(payload())).rejects.toThrow('HANDOFF_SOURCE_OR_DRAFT_CHANGED');
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('records acknowledgement separately and confirms the exact persisted first-turn identity', async () => {
    const created = await services().sessions.createHandoff(payload());
    expect((await send(created.operation!)).success).toBe(true);
    expect(rpc.mock.calls.find(([method]) => method === 'chat.send')?.[1].expectedSessionGeneration)
      .toBe(created.operation!.sessionGeneration);
    expect((await persisted(payload().operationId)).phase).toBe('accepted');
    const checked = await services().sessions.handoffOperation({ sessionKey: created.sessionKey!, workspaceId: 'workspace-a', reconcile: true });
    expect(checked.operation?.phase).toBe('sent');
    expect(checked.operation?.receipt?.source).toBe('transcript');
    await send(created.operation!);
    expect(rpc.mock.calls.filter(([method]) => method === 'chat.send')).toHaveLength(1);
  });
  it('reconciles a lost send reply from the exact runtime transcript after restart', async () => {
    const created = await services().sessions.createHandoff(payload());
    sendMode = 'lost-after-persist';
    expect((await send(created.operation!)).success).toBe(false);
    expect((await persisted(payload().operationId)).phase).toBe('unknown');
    const checked = await services().sessions.handoffOperation({ workspaceId: 'workspace-a', sessionKey: created.sessionKey!, reconcile: true });
    expect(checked.operation?.phase).toBe('sent');
    expect(checked.operation?.receipt?.run.runId).toBe(created.operation?.firstSendIdempotencyKey);
    expect(rpc.mock.calls.filter(([method]) => method === 'chat.send')).toHaveLength(1);
  });
  it('retains an unknown delivery and prevents silent resends even when the text matches', async () => {
    const created = await services().sessions.createHandoff(payload());
    sendMode = 'lost-before-persist';
    await send(created.operation!);
    histories.set(created.sessionKey!, [{ role: 'user', content: created.operation!.draftInput }]);
    const checked = await services().sessions.handoffOperation({ workspaceId: 'workspace-a', sessionKey: created.sessionKey!, reconcile: true });
    expect(checked.operation?.phase).toBe('unknown');
    expect((await send(created.operation!)).success).toBe(false);
    expect(rpc.mock.calls.filter(([method]) => method === 'chat.send')).toHaveLength(1);
  });
  it('allows an explicitly retried pre-effect rejection with the same child and send key', async () => {
    const created = await services().sessions.createHandoff(payload());
    sendMode = 'rejected'; await send(created.operation!);
    expect((await persisted(payload().operationId)).phase).toBe('failed');
    sendMode = 'ok'; await send(created.operation!);
    const sends = rpc.mock.calls.filter(([method]) => method === 'chat.send');
    expect(sends).toHaveLength(2);
    expect(sends[0][1].idempotencyKey).toBe(sends[1][1].idempotencyKey);
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.create')).toHaveLength(1);
  });
  it('does not reuse a first-send key with a different compiled payload', async () => {
    const created = await services().sessions.createHandoff(payload());
    sendMode = 'rejected'; await send(created.operation!);
    sendMode = 'ok';
    const result = await services().chat.sendWithMedia({ workspaceId: 'workspace-a', sessionKey: created.sessionKey!,
      message: created.operation!.draftInput, idempotencyKey: created.operation!.firstSendIdempotencyKey,
      handoffOperationId: created.operation!.id, modelRef: 'another-provider/another-model' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HANDOFF_SEND_PAYLOAD_CHANGED');
    expect(rpc.mock.calls.filter(([method]) => method === 'chat.send')).toHaveLength(1);
  });
  it('fences child transcript reads against wrong parents and reset races', async () => {
    const created = await services().sessions.createHandoff(payload());
    const api = services().sessions;
    expect((await api.history({ sessionKey: created.sessionKey!, expectedParentSessionKey: 'other' })).success).toBe(false);
    histories.set(created.sessionKey!, [{ role: 'assistant', content: 'Old generation' }]);
    changeDuringHistory = true;
    const history = await api.history({ sessionKey: created.sessionKey!, expectedParentSessionKey: source });
    expect(history.success).toBe(false);
    expect(history.messages).toBeUndefined();
  });
  it('sends to the selected worker through the existing permission route and rejects stale parent generations', async () => {
    const child = 'agent:main:worker'; sessions.set(child, { key: child, sessionId: 'worker-generation', spawnedBy: source });
    const input = { workspaceId: 'workspace-a', parentSessionKey: source, expectedParentGeneration: 'source-generation',
      childSessionKey: child, expectedChildGeneration: 'worker-generation', message: 'Inspect this result', idempotencyKey: 'worker-send-1', mode: 'send' as const };
    const result = await services().sessions.sendWorker(input);
    expect(result).toMatchObject({ success: true, phase: 'accepted', run: { runId: 'worker-send-1', scope: { workspaceId: 'workspace-a', sessionKey: child } } });
    const rejected = await services().sessions.sendWorker({ ...input, expectedParentGeneration: 'old' });
    expect(rejected.phase).toBe('rejected');
    expect(rpc.mock.calls.filter(([method]) => method === 'sessions.send')).toHaveLength(1);
  });
  it.each([{ queued: true }, { queued: true, steered: true }])('retains a successful worker intervention without requiring a new run: %j', async (receipt) => {
    const child = 'agent:main:worker'; sessions.set(child, { key: child, sessionId: 'worker-generation', spawnedBy: source });
    const api = createSessionsApi({ gatewayManager: { rpc } as never, gatewayRpcForDelegation: async () => receipt });
    const result = await api.sendWorker({ workspaceId: 'workspace-a', parentSessionKey: source, expectedParentGeneration: 'source-generation',
      childSessionKey: child, expectedChildGeneration: 'worker-generation', message: 'Guide the current run', idempotencyKey: 'intervention-key', mode: 'send' });
    expect(result).toMatchObject({ success: true, phase: 'steered' in receipt ? 'steered' : 'queued',
      receipt: { idempotencyKey: 'intervention-key', source: 'runtime-ack' } });
    expect(result.run).toBeUndefined();
  });
  it.each(['INVALID_REQUEST', '-32600', '-32602'])('reports a definite runtime worker rejection as rejected: %s', async (code) => {
    const child = 'agent:main:worker'; sessions.set(child, { key: child, sessionId: 'worker-generation', spawnedBy: source });
    const api = createSessionsApi({ gatewayManager: { rpc } as never, gatewayRpcForDelegation: async () => {
      throw new GatewayRpcError({ code, message: 'Worker session generation changed' });
    } });
    expect(await api.sendWorker({ workspaceId: 'workspace-a', parentSessionKey: source, expectedParentGeneration: 'source-generation',
      childSessionKey: child, expectedChildGeneration: 'worker-generation', message: 'Retain this input', idempotencyKey: 'rejected-worker-key', mode: 'send' }))
      .toMatchObject({ success: false, phase: 'rejected', error: 'Worker session generation changed' });
  });
  it('keeps a lost worker response unknown until delivery evidence is available', async () => {
    const child = 'agent:main:worker'; sessions.set(child, { key: child, sessionId: 'worker-generation', spawnedBy: source });
    const api = createSessionsApi({ gatewayManager: { rpc } as never, gatewayRpcForDelegation: async () => { throw new Error('Worker response lost'); } });
    expect(await api.sendWorker({ workspaceId: 'workspace-a', parentSessionKey: source, expectedParentGeneration: 'source-generation',
      childSessionKey: child, expectedChildGeneration: 'worker-generation', message: 'Retain this input', idempotencyKey: 'lost-worker-key', mode: 'send' }))
      .toMatchObject({ success: false, phase: 'unknown' });
  });
  it('recovers a lost worker acknowledgement from the exact persisted intervention key', async () => {
    const child = 'agent:main:worker'; sessions.set(child, { key: child, sessionId: 'worker-generation', spawnedBy: source });
    histories.set(child, []);
    const gateway = { rpc: async (method: string, params: Record<string, unknown>) => method === 'sessions.longTaskControlHistory'
      ? { events: [{ idempotencyKey: 'chat:worker-recovery:queue:event', status: 'queued', payload: { queueItemId: 'queue-1' } },
          { idempotencyKey: 'chat:other:guide:event', status: 'steered' }] }
      : rpc(method, params) };
    const api = createSessionsApi({ gatewayManager: gateway as never });
    const result = await api.history({ sessionKey: child, expectedParentSessionKey: source,
      expectedSessionGeneration: 'worker-generation', workerSendIdempotencyKey: 'worker-recovery' });
    expect(result.workerSendReceipt).toEqual({ phase: 'queued', idempotencyKey: 'worker-recovery', source: 'runtime-intervention', queueItemId: 'queue-1' });
    expect((await api.history({ sessionKey: child, expectedParentSessionKey: source,
      expectedSessionGeneration: 'worker-generation', workerSendIdempotencyKey: 'missing' })).workerSendReceipt).toBeUndefined();
  });
});
