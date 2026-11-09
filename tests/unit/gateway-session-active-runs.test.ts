// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionsReadHandlers } from '../../openclaw_runtime/src/gateway/server-methods/sessions.read.js';
import type { ChatAbortControllerEntry } from '../../openclaw_runtime/src/gateway/chat-abort.js';

const target = vi.hoisted(() => ({ key: 'agent:main:worker', canonicalKey: 'agent:main:worker', agentId: 'main' }));
vi.mock('../../openclaw_runtime/src/config/sessions.js', () => ({
  loadSessionStore: () => ({ [target.canonicalKey]: { sessionId: 'worker-generation' } }),
}));
vi.mock('../../openclaw_runtime/src/agents/agent-scope.js', () => ({ resolveDefaultAgentId: () => 'main' }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({
  buildGatewaySessionRow: () => ({ key: target.canonicalKey, sessionId: 'worker-generation' }),
  resolveFreshestSessionEntryFromStoreKeys: (store: Record<string, unknown>) => store[target.canonicalKey],
}));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/sessions.shared.js', () => ({
  requireSessionKey: (key: string) => key,
  resolveGatewaySessionTargetFromKey: () => ({ storePath: 'fixture-store', target: { ...target, storeKeys: [target.canonicalKey] } }),
}));
vi.mock('../../openclaw_runtime/src/gateway/sessions-resolve.js', () => ({}));
vi.mock('../../openclaw_runtime/src/gateway/session-archive-index.js', () => ({}));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/session-change-event.js', () => ({}));
vi.mock('../../openclaw_runtime/src/infra/diagnostics-timeline.js', () => ({}));

type ActiveRun = Pick<ChatAbortControllerEntry, 'sessionKey' | 'controller' | 'projectSessionActive' | 'controlUiVisible' | 'agentId'>;
const run = (patch: Partial<ActiveRun> = {}): ActiveRun => ({
  sessionKey: target.canonicalKey, controller: new AbortController(), projectSessionActive: true, controlUiVisible: true, ...patch,
});
function hasActiveRun(runs: Map<string, ActiveRun>) {
  const respond = vi.fn();
  sessionsReadHandlers['sessions.describe']({ params: { key: target.key }, respond,
    context: { getRuntimeConfig: () => ({}), chatAbortControllers: runs },
  } as unknown as Parameters<(typeof sessionsReadHandlers)['sessions.describe']>[0]);
  expect(respond).toHaveBeenCalledWith(true, { session: { key: target.canonicalKey, sessionId: 'worker-generation', hasActiveRun: expect.any(Boolean) } }, undefined);
  return respond.mock.calls[0][1].session.hasActiveRun as boolean;
}

describe('sessions.describe tracked active runs', () => {
  beforeEach(() => Object.assign(target, { key: 'agent:main:worker', canonicalKey: 'agent:main:worker', agentId: 'main' }));
  it('keeps a terminal abort entry for idempotency without keeping the worker busy', () => {
    const retained = run({ projectSessionActive: false });
    const runs = new Map([['finished-run', retained]]);
    expect(hasActiveRun(runs)).toBe(false);
    expect(retained.controller.signal.aborted).toBe(false);
    expect(runs.has('finished-run')).toBe(true);
    runs.set('follow-up-run', run());
    expect(hasActiveRun(runs)).toBe(true);
  });
  it('does not project hidden background runs into worker activity', () => {
    expect(hasActiveRun(new Map([['hidden-run', run({ controlUiVisible: false })]]))).toBe(false);
  });
  it('does not borrow an active run from another coordinator', () => {
    expect(hasActiveRun(new Map([['other-run', run({ sessionKey: 'agent:main:other' })]]))).toBe(false);
  });
  it('keeps global aliases scoped to their owning agent', () => {
    Object.assign(target, { key: 'agent:other:global', canonicalKey: 'global', agentId: 'other' });
    const runs = new Map([['main-run', run({ agentId: 'main' })]]);
    expect(hasActiveRun(runs)).toBe(false);
    runs.set('other-run', run({ agentId: 'other' }));
    expect(hasActiveRun(runs)).toBe(true);
  });
});
