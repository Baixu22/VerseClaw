// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import type { SessionEntry } from '../../openclaw_runtime/src/config/sessions/types';

const mocks = vi.hoisted(() => ({ load: vi.fn(), filter: vi.fn(), unusedOwner: vi.fn() }));
vi.mock('../../openclaw_runtime/src/config/sessions/combined-store-gateway.js', () => ({ loadCombinedSessionStoreForGateway: mocks.load }));
vi.mock('../../openclaw_runtime/src/gateway/session-archive-index.js', () => ({ filterArchivedSessionStore: mocks.filter }));
// The fields=[] access check must not load task, process, or lifecycle owners.
vi.mock('../../openclaw_runtime/src/agents/session-task-scope.js', () => ({ readSessionTaskEffectRequests: mocks.unusedOwner }));
vi.mock('../../openclaw_runtime/src/agents/bash-process-registry.js', () => ({ listRunningSessions: mocks.unusedOwner }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-lifecycle-owner-views.js', () => ({ bashSessionMatches: mocks.unusedOwner }));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-activity-projection.js', () => ({ buildSessionActivityReadProjection: mocks.unusedOwner }));
vi.mock('../../openclaw_runtime/src/gateway/call.js', () => ({ callGateway: mocks.unusedOwner }));
import { readSessionCollaborationQuery } from '../../openclaw_runtime/src/gateway/server-methods/session-collaboration-query';
const reader = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:reader', sessionGeneration: 'reader-generation' } }).requester;
const target = { ...reader, sessionKey: 'agent:main:target' as typeof reader.sessionKey, sessionGeneration: 'target-generation' };
const query = parseSessionCollaborationQuery({ requester: reader, target, fields: [], limit: 1 });
const context = { getRuntimeConfig: () => ({ tools: { sessions: { visibility: 'all' } } }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.unusedOwner.mockImplementation(() => { throw new Error('Unexpected owner hydration'); });
  mocks.load.mockImplementation(() => ({ store: {
    [reader.sessionKey]: { workspaceId: reader.workspaceId, sessionId: reader.sessionGeneration },
    [target.sessionKey]: { workspaceId: target.workspaceId, sessionId: target.sessionGeneration },
  } }));
  mocks.filter.mockImplementation(async (_config, store) => store);
});

it('authorizes the current reader and target together without hydrating task or message owners', async () => {
  expect(await readSessionCollaborationQuery(query, context as never)).toMatchObject({ state: 'ready', requester: reader,
    items: [{ detail: { scope: target }, sources: { tasks: { state: 'not_read' }, run: { state: 'not_read' } } }] });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.unusedOwner).not.toHaveBeenCalled();
});
it.each(['reader', 'target'] as const)('fences the %s reset inside the final target access query', async side => {
  let reads = 0;
  mocks.filter.mockImplementation(async (_config, store: Record<string, SessionEntry>) => {
    if (++reads === 2) store[side === 'reader' ? reader.sessionKey : target.sessionKey].sessionId = 'reset';
    return store;
  });
  expect(await readSessionCollaborationQuery(query, context as never)).toMatchObject({ state: 'stale', reason: 'generation-changed', items: [], nextCursor: null });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.unusedOwner).not.toHaveBeenCalled();
});
