// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, type SessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { emptyMaterialPage, type SessionCollaborationMaterialQuery } from '../../shared/types/session-collaboration-material';
import { emptyCollaborationHints, parseCollaborationHintsQuery } from '../../shared/types/session-collaboration-hints';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), read: vi.fn(), query: vi.fn(), generation: 'current-generation',
  navigation: undefined as (() => void) | undefined }));
vi.mock('../../electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: mocks.profile,
  observeWorkspaceNavigation: (listener: () => void) => { mocks.navigation = listener; return () => { mocks.navigation = undefined; }; },
}));
import { createSessionsApi } from '../../electron/services/sessions-api';

const scope = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace',
  sessionKey: 'agent:main:reader', sessionGeneration: 'current-generation' } }).requester;
const target = { ...scope, sessionKey: 'agent:main:source' as typeof scope.sessionKey };
const input = { requester: scope, target, limit: 1 };

function senderPage(query: SessionCollaborationQuery) {
  const scope = query.target ?? query.requester;
  const notRead = (owner: string) => ({ owner, state: 'not_read', value: null, readAt: null, reason: 'source-not-read' });
  return { ...emptySessionCollaborationPage(query, 'ready'), scanned: 1,
    items: [{ sessionKey: scope.sessionKey, label: 'Current reader', status: 'unknown',
      detail: { scope }, sources: {
        session: { owner: 'sessions', state: 'ready', value: { scope, agentId: 'main' }, readAt: Date.now() },
        goal: notRead('TaskSystem'), tasks: notRead('TaskSystem'), run: notRead('runtime'),
        actions: notRead('session-task-effects/bash-processes'), origin: notRead('sessions'), execution: notRead('execution-domain'),
      } }] };
}

function api() {
  const rpc = vi.fn(async (method: string, payload: {
    query?: SessionCollaborationQuery; taskContext?: SessionCollaborationQuery; materials?: SessionCollaborationMaterialQuery;
  }) => {
    if (method === 'sessions.describe') return { session: { sessionId: mocks.generation } };
    if (payload.query) return { page: await mocks.query(payload.query) };
    return mocks.read(payload);
  });
  return createSessionsApi({ gatewayManager: { rpc } as unknown as GatewayManager });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = scope.sessionGeneration;
  mocks.navigation = undefined;
  mocks.query.mockImplementation(senderPage);
  mocks.profile.mockResolvedValue({ id: scope.workspaceId, activeSessionKey: scope.sessionKey, name: 'Reader', rootPath: 'D:/fixture' });
  mocks.read.mockImplementation(async ({ taskContext, materials }) => taskContext ? { taskContext: {
    schemaVersion: 'SessionCollaborationTaskContext/v1', scope: taskContext.target, state: 'empty', task: null, context: null,
    evidence: [], legacy: { state: 'unavailable', reason: 'association-not-verified' }, capturedAt: Date.now(),
  } } : { materials: emptyMaterialPage(materials, 'empty') });
});

it('reads task context for the active requester and rejects a forged requester before the owner read', async () => {
  const host = api();
  await expect(host.collaborationContext(input)).resolves.toMatchObject({ taskContext: { state: 'empty' } });
  expect(mocks.read).toHaveBeenCalledOnce();
  mocks.read.mockClear();
  await expect(host.collaborationContext({ ...input, requester: target })).resolves.toMatchObject({
    taskContext: { state: 'stale', reason: 'scope-mismatch', context: null, evidence: [] },
  });
  expect(mocks.read).not.toHaveBeenCalled();
});

it.each(['generation', 'workspace'] as const)('drops task context when the requester %s changes during reading', async change => {
  const original = mocks.read.getMockImplementation()!;
  mocks.read.mockImplementationOnce(async payload => {
    const response = await original(payload);
    if (change === 'generation') mocks.generation = 'new-generation';
    else mocks.profile.mockResolvedValue({ id: 'other-workspace', activeSessionKey: 'agent:main:other', name: 'Other' });
    return response;
  });
  await expect(api().collaborationContext(input)).resolves.toMatchObject({ taskContext: {
    state: 'stale', task: null, context: null, evidence: [], reason: change === 'generation' ? 'generation-changed' : 'scope-mismatch',
  } });
});

it('drops material results when the active requester resets during reading', async () => {
  const original = mocks.read.getMockImplementation()!;
  mocks.read.mockImplementationOnce(async payload => {
    const response = await original(payload);
    mocks.generation = 'new-generation';
    return response;
  });
  await expect(api().collaborationMaterials({ requester: scope })).resolves.toMatchObject({ materials: {
    state: 'stale', reason: 'generation-changed', items: [], detail: null,
  } });
});

it('binds coordination hints to the actual active reader before and after the Gateway response', async () => {
  mocks.read.mockImplementation(async () => ({ hints: emptyCollaborationHints(parseCollaborationHintsQuery(input), 'empty') }));
  const host = api();
  expect(await host.collaborationHints(input)).toMatchObject({ hints: { state: 'empty' } });
  mocks.read.mockClear();
  expect(await host.collaborationHints({ ...input, requester: target })).toMatchObject({ hints: { state: 'stale', task: null } });
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.read.mockImplementationOnce(async () => { mocks.generation = 'reset'; return { hints: emptyCollaborationHints(parseCollaborationHintsQuery(input), 'empty') }; });
  expect(await host.collaborationHints(input)).toMatchObject({ hints: { state: 'stale', task: null } });
});

it.each(['unavailable', 'stale'] as const)('clears hints when the target becomes %s during the asynchronous reader recheck', async state => {
  let hintsRead = false, changed = false;
  mocks.read.mockImplementation(async () => {
    hintsRead = true;
    return { hints: { ...emptyCollaborationHints(parseCollaborationHintsQuery(input), 'ready'),
      admission: { owner: 'SessionAdmissionRegistry', active: 2, waiters: 1, fenced: true } } };
  });
  mocks.query.mockImplementation((query: SessionCollaborationQuery) => {
    if (hintsRead && query.target?.sessionKey === scope.sessionKey) changed = true;
    if (changed && query.target?.sessionKey === target.sessionKey)
      return emptySessionCollaborationPage(query, state, state === 'stale' ? 'generation-changed' : 'not-visible');
    return senderPage(query);
  });
  expect(await api().collaborationHints(input)).toMatchObject({ hints: { state, task: null, admission: null } });
  expect(changed).toBe(true);
});

it.each([false, true])('invalidates the complete hint read when navigation occurs during the last target RPC (roundtrip: %s)', async roundtrip => {
  mocks.read.mockImplementation(async () => ({ hints: { ...emptyCollaborationHints(parseCollaborationHintsQuery(input), 'ready'),
    admission: { owner: 'SessionAdmissionRegistry', active: 2, waiters: 1, fenced: true } } }));
  mocks.query.mockImplementation((query: SessionCollaborationQuery) => {
    if (query.target?.sessionKey === target.sessionKey) {
      mocks.profile.mockResolvedValue({ id: 'other', activeSessionKey: 'agent:main:other', name: 'Other' });
      mocks.navigation?.();
      if (roundtrip) {
        mocks.profile.mockResolvedValue({ id: scope.workspaceId, activeSessionKey: scope.sessionKey, name: 'Reader' });
        mocks.navigation?.();
      }
    }
    return senderPage(query);
  });
  expect(await api().collaborationHints(input)).toMatchObject({ hints: { state: 'stale', task: null, admission: null } });
  expect(mocks.navigation).toBeUndefined();
});
