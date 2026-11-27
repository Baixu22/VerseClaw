// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, type SessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { emptyMaterialPage, type SessionCollaborationMaterialQuery } from '../../shared/types/session-collaboration-material';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), read: vi.fn(), generation: 'current-generation' }));
vi.mock('../../electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: mocks.profile }));
import { createSessionsApi } from '../../electron/services/sessions-api';

const scope = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace',
  sessionKey: 'agent:main:reader', sessionGeneration: 'current-generation' } }).requester;
const target = { ...scope, sessionKey: 'agent:main:source' as typeof scope.sessionKey };
const input = { requester: scope, target, limit: 1 };

function senderPage(query: SessionCollaborationQuery) {
  const notRead = (owner: string) => ({ owner, state: 'not_read', value: null, readAt: null, reason: 'source-not-read' });
  return { ...emptySessionCollaborationPage(query, 'ready'), scanned: 1,
    items: [{ sessionKey: query.requester.sessionKey, label: 'Current reader', status: 'unknown',
      detail: { scope: query.requester }, sources: {
        session: { owner: 'sessions', state: 'ready', value: { scope: query.requester, agentId: 'main' }, readAt: Date.now() },
        goal: notRead('TaskSystem'), tasks: notRead('TaskSystem'), run: notRead('runtime'),
        actions: notRead('session-task-effects/bash-processes'), origin: notRead('sessions'), execution: notRead('execution-domain'),
      } }] };
}

function api() {
  const rpc = vi.fn(async (method: string, payload: {
    query?: SessionCollaborationQuery; taskContext?: SessionCollaborationQuery; materials?: SessionCollaborationMaterialQuery;
  }) => {
    if (method === 'sessions.describe') return { session: { sessionId: mocks.generation } };
    if (payload.query) return { page: senderPage(payload.query) };
    return mocks.read(payload);
  });
  return createSessionsApi({ gatewayManager: { rpc } as unknown as GatewayManager });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = scope.sessionGeneration;
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
