// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { createSessionCollaborationMessage, validateSessionCollaborationReceipt } from '../../shared/session-collaboration-message';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, type SessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { emptyMaterialPage } from '../../shared/types/session-collaboration-material';
import type { SessionCollaborationMessageQuery } from '../../shared/types/session-collaboration-message';
import { normalizeRunScope } from '../../shared/types/identity-scope';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), read: vi.fn(), query: vi.fn(), generation: 'reader-generation',
  listeners: new Set<() => void>() }));
vi.mock('../../electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: mocks.profile,
  readWorkspaceCollaborationContinuity: async () => [],
  observeWorkspaceNavigation: (listener: () => void) => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; },
}));
import { createSessionsApi } from '../../electron/services/sessions-api';

const reader = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace',
  sessionKey: 'agent:main:reader', sessionGeneration: 'reader-generation' } }).requester;
const target = { ...reader, sessionKey: 'agent:main:target' as typeof reader.sessionKey, sessionGeneration: 'target-generation' };
const message = createSessionCollaborationMessage({ id: 'original-message', target, purpose: 'request', message: 'Original scoped message' },
  { scope: reader, run: null, actor: 'operator' }, 1);
const receipt = { schemaVersion: 'SessionCollaborationReceipt/v1' as const, message, phase: 'accepted' as const, run: null, replyRef: null, updatedAt: 2 };
const input = { requester: reader, target, id: message.id };
const profile = () => ({ id: reader.workspaceId, activeSessionKey: reader.sessionKey, name: 'Reader', rootPath: 'D:/fixture' });
function page(query: SessionCollaborationQuery) {
  const scope = query.target ?? query.requester;
  const unread = (owner: string) => ({ owner, state: 'not_read', readAt: null, value: null, reason: 'source-not-read' });
  return { ...emptySessionCollaborationPage(query, 'ready'), scanned: 1, items: [{ sessionKey: scope.sessionKey, label: 'Reader', status: 'unknown', detail: { scope }, sources: {
    session: { owner: 'sessions', state: 'ready', readAt: 1, value: { scope, agentId: 'main' } },
    goal: unread('TaskSystem'), tasks: unread('TaskSystem'), run: unread('runtime'), actions: unread('session-task-effects/bash-processes'),
    origin: unread('sessions'), execution: unread('execution-domain'),
  } }] };
}
function messages(query: SessionCollaborationMessageQuery) {
  return { schemaVersion: 'SessionCollaborationMessages/v1', requester: query.requester, state: 'ready', items: [], receipt, nextCursor: null, capturedAt: 2 };
}
function api() {
  const rpc = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    if (method === 'sessions.describe') return { session: { sessionId: mocks.generation } };
    if (payload.query) return { page: await mocks.query(payload.query) };
    return mocks.read(payload);
  });
  return createSessionsApi({ gatewayManager: { rpc } as unknown as GatewayManager });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.listeners.clear(); mocks.generation = reader.sessionGeneration;
  mocks.profile.mockImplementation(async () => profile()); mocks.query.mockImplementation(page);
  mocks.read.mockImplementation(async ({ messages: query, taskContext, materials }) => query ? { messages: messages(query) }
    : taskContext ? { taskContext: { schemaVersion: 'SessionCollaborationTaskContext/v1', scope: taskContext.target,
      state: 'empty', task: null, context: null, evidence: [], capturedAt: 1, legacy: { state: 'unavailable', reason: 'association-not-verified' } } }
      : { materials: emptyMaterialPage(materials, 'empty') });
});

describe('actual desktop collaboration reader', () => {
  it('returns the original receipt to the current reader without changing the owner response', async () => {
    const before = JSON.stringify(receipt);
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'ready', receipt } });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(JSON.stringify(receipt)).toBe(before);
    expect(mocks.listeners.size).toBe(0);
  });
  it.each(['workspaceId', 'projectId', 'sessionKey', 'sessionGeneration'] as const)('rejects a forged requester %s before the message owner read', async field => {
    const result = await api().collaborationMessages({ ...input, requester: { ...reader, [field]: 'forged' } });
    expect(result.messages).toMatchObject({ state: 'stale', receipt: null, items: [], nextCursor: null });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0);
  });
  it('does not read messages when the active requester is unavailable', async () => {
    mocks.profile.mockResolvedValue(null);
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'unavailable', receipt: null, items: [] } });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects navigation during reader qualification before reading any message', async () => {
    mocks.query.mockImplementationOnce((query: SessionCollaborationQuery) => {
      mocks.listeners.forEach(listener => listener());
      return page(query);
    });
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'stale', reason: 'scope-mismatch', receipt: null } });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.listeners.size).toBe(0);
  });
  it.each(['workspace', 'generation'] as const)('discards the receipt after the requester %s changes during reading', async change => {
    mocks.read.mockImplementationOnce(async ({ messages: query }) => {
      if (change === 'generation') mocks.generation = 'next-generation';
      else mocks.profile.mockResolvedValue({ ...profile(), id: 'other-workspace' });
      return { messages: messages(query) };
    });
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'stale', receipt: null, items: [], nextCursor: null } });
    expect(mocks.listeners.size).toBe(0);
  });
  it('rejects a reset while the final reader qualification is awaiting its last profile read', async () => {
    let reads = 0;
    mocks.query.mockImplementation((query: SessionCollaborationQuery) => {
      const result = page(query);
      if (++reads === 2) mocks.generation = 'reset-during-final-check';
      return result;
    });
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'stale', reason: 'generation-changed', receipt: null, items: [] } });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.listeners.size).toBe(0);
  });
  it.each(['generation-changed', 'not-visible'] as const)('drops original message data when the target becomes %s during the final reader check', async reason => {
    mocks.query.mockImplementation((query: SessionCollaborationQuery) => query.target?.sessionKey === target.sessionKey
      ? emptySessionCollaborationPage(query, reason === 'generation-changed' ? 'stale' : 'unavailable', reason) : page(query));
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: {
      state: reason === 'generation-changed' ? 'stale' : 'unavailable', reason, receipt: null, items: [], nextCursor: null,
    } });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.listeners.size).toBe(0);
  });
  it.each(['collaborationMessages', 'collaborationContext', 'collaborationMaterials'] as const)('rejects a navigation away-and-back during %s', async method => {
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementationOnce(async payload => {
      mocks.listeners.forEach(listener => listener());
      mocks.listeners.forEach(listener => listener());
      return read(payload);
    });
    const host = api();
    const result = method === 'collaborationMessages' ? (await host.collaborationMessages(input)).messages
      : method === 'collaborationContext' ? (await host.collaborationContext({ requester: reader, target, limit: 1 })).taskContext
        : (await host.collaborationMaterials({ requester: reader, target })).materials;
    expect(result).toMatchObject({ state: 'stale', reason: 'scope-mismatch' });
    expect(mocks.listeners.size).toBe(0);
  });
  it('drops forged receipt bytes and releases the navigation observer on owner failure', async () => {
    mocks.read.mockResolvedValueOnce({ messages: { ...messages(input), receipt: { ...receipt, message: { ...message, message: 'Changed bytes' } } } });
    expect(await api().collaborationMessages(input)).toMatchObject({ messages: { state: 'unavailable', receipt: null, items: [] } });
    expect(mocks.listeners.size).toBe(0);
  });
});

describe('receipt intent and reply identity', () => {
  const run = normalizeRunScope({ runId: 'receiver-run', scope: target });
  it.each([
    ['wrong message id', { message: { ...message, id: 'forged-id' } }],
    ['new target generation', { message: { ...message, target: { ...target, sessionGeneration: 'reset' } } }],
    ['foreign run', { run: normalizeRunScope({ runId: 'other-run', scope: reader }) }],
    ['task acceptance phase', { phase: 'accepted-by-task-owner' }],
    ['unbound reply', { phase: 'replied', run, replyRef: 'reply', reply: { text: 'Forged reply', sha256: '0'.repeat(64), run, truncated: false } }],
  ])('rejects %s', (_name, patch) => {
    expect(() => validateSessionCollaborationReceipt(message, { ...receipt, ...patch })).toThrow();
  });
});
