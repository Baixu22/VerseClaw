// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSessionCollaborationQuery, emptySessionCollaborationPage } from '../../shared/types/session-collaboration';
import { parseSessionCollaborationWatch, validateSessionCollaborationWatch } from '../../shared/types/session-collaboration-watch';
import { waitForSessionCollaboration, type SessionCollaborationObservation } from '../../shared/session-collaboration-watch';
import { emitAgentEvent } from '../../openclaw_runtime/src/infra/agent-events';
import { readScopedAgentRunOutcome } from '../../openclaw_runtime/src/gateway/server-methods/agent-job';
import { normalizeTaskReference } from '../../shared/types/identity-scope';

const scope = { workspaceId: 'watch-workspace', projectId: 'watch-workspace', sessionKey: 'agent:main:watch', sessionGeneration: 'watch-generation' };
const request = (condition = 'changed') => parseSessionCollaborationWatch({ id: 'watch-1', condition, timeoutMs: 0,
  query: parseSessionCollaborationQuery({ requester: scope, target: scope, limit: 1, fields: ['run', 'actions', 'tasks'] }) });
function observation(): SessionCollaborationObservation {
  const input = request(), page = emptySessionCollaborationPage(input.query, 'ready');
  page.scanned = 1;
  const unread = (owner: string) => ({ owner, state: 'not_read' as const, readAt: null, value: null, reason: 'source-not-read' as const });
  page.items.push({ sessionKey: input.query.target!.sessionKey, label: 'Watch session', status: 'idle', detail: { scope: input.query.target! }, sources: {
    session: { owner: 'sessions', state: 'ready', value: { scope: input.query.target!, agentId: 'main' }, readAt: 1 },
    run: { owner: 'runtime', state: 'empty', value: null, readAt: 1 }, actions: { owner: 'session-task-effects/bash-processes', state: 'empty', value: [], readAt: 1 },
    tasks: { owner: 'TaskSystem', state: 'empty', value: [], readAt: 1 }, goal: unread('TaskSystem'), origin: unread('sessions'), execution: unread('execution-domain'),
  } });
  return { page };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('scoped collaboration waits', () => {
  it('does not confuse an idle session with task acceptance and does not repeat an acknowledged idle event', async () => {
    const read = vi.fn(async () => observation()), cleanup = vi.fn(), subscribe = vi.fn(() => cleanup);
    const idle = await waitForSessionCollaboration(request('idle'), { read, subscribe });
    expect(idle.state).toBe('satisfied'); expect(idle.event?.kind).toBe('idle');
    const repeated = await waitForSessionCollaboration({ ...request('idle'), cursor: idle.cursor! }, { read, subscribe });
    expect(repeated.state).toBe('timeout'); expect(repeated.event).toBeNull();
    const task = await waitForSessionCollaboration(request('task-receipt'), { read, subscribe });
    expect(task.state).toBe('unknown'); expect(cleanup).toHaveBeenCalledTimes(3);
    expect(validateSessionCollaborationWatch(request('idle'), idle)).toEqual(idle);
  });
  it('binds cursors to scope and condition while ignoring fresh observation timestamps', async () => {
    const first = await waitForSessionCollaboration(request(), { read: async () => observation(), subscribe: () => () => {} });
    const current = observation(); current.page.capturedAt += 100; current.page.items[0].sources.session.readAt = 2;
    const next = await waitForSessionCollaboration({ ...request(), cursor: first.cursor! }, { read: async () => current, subscribe: () => () => {} });
    expect(next.cursor).toBe(first.cursor); expect(next.state).toBe('timeout');
    const wrong = await waitForSessionCollaboration({ ...request('idle'), cursor: first.cursor! }, { read: async () => current, subscribe: () => () => {} });
    expect(wrong.state).toBe('stale'); expect(wrong.page.reason).toBe('scope-mismatch');
  });
  it('returns a real owner receipt once without turning session idleness into acceptance', async () => {
    const current = observation();
    const task = normalizeTaskReference({ kind: 'ledger', taskNodeId: 'task-watch' });
    if (task.kind !== 'ledger') throw new Error('Fixture task owner missing');
    current.page.items[0].sources.tasks = { owner: 'TaskSystem', state: 'ready', readAt: 1, value: [
      { authorityId: 'owner-domain', taskNodeId: task.taskNodeId, revision: 1, digest: 'owner-digest', state: 'review', referenceOnly: true, claim: null },
    ] };
    current.receipts = [
      { id: 'owner-domain:task-watch:44', owner: 'TaskSystem', kind: 'task-receipt', sequence: 44,
        taskNodeId: 'task-watch', revision: 1, status: 'accepted', receiptId: 'receipt-44' },
      { id: 'owner-domain:task-watch:42', owner: 'TaskSystem', kind: 'task-receipt', sequence: 42,
        taskNodeId: 'task-watch', revision: 1, status: 'owner_verified', receiptId: 'receipt-42' },
    ];
    const input = request('task-receipt');
    const first = await waitForSessionCollaboration(input, { read: async () => current, subscribe: () => () => {} });
    expect(first.state).toBe('satisfied'); expect(first.event?.receiptId).toBe('receipt-42');
    expect(first.page.items[0].sources.tasks.value?.[0].state).toBe('review');
    const next = await waitForSessionCollaboration({ ...input, cursor: first.cursor! }, { read: async () => current, subscribe: () => () => {} });
    expect(next.state).toBe('satisfied'); expect(next.event?.receiptId).toBe('receipt-44');
    const repeat = await waitForSessionCollaboration({ ...input, cursor: next.cursor! }, { read: async () => current, subscribe: () => () => {} });
    expect(repeat.state).toBe('timeout'); expect(repeat.event).toBeNull();
    current.receiptTruncated = true; current.receiptFloor = 100;
    const gap = await waitForSessionCollaboration({ ...input, cursor: first.cursor! }, { read: async () => current, subscribe: () => () => {} });
    expect(gap.state).toBe('unknown'); expect(gap.event).toBeNull();
  });
  it('rereads changes arriving during an owner read and releases its listener', async () => {
    let wake!: () => void, count = 0;
    const cleanup = vi.fn();
    const result = await waitForSessionCollaboration({ ...request(), timeoutMs: 1000 }, {
      subscribe: listener => { wake = listener; return cleanup; },
      read: async () => { const value = observation(); if (count++ === 0) wake(); else value.page.items[0].label = 'Changed owner'; return value; },
    });
    expect(result.state).toBe('changed'); expect(count).toBe(2); expect(cleanup).toHaveBeenCalledOnce();
  });
  it('finishes cancellation and a deadline while the owner read is still pending', async () => {
    vi.useFakeTimers();
    const never = () => new Promise<SessionCollaborationObservation>(() => {}), cleanup = vi.fn(), controller = new AbortController();
    const pending = waitForSessionCollaboration({ ...request(), timeoutMs: 1000 }, { read: never, subscribe: () => cleanup, signal: controller.signal });
    controller.abort(); expect((await pending).state).toBe('cancelled');
    const timed = waitForSessionCollaboration({ ...request(), timeoutMs: 1000 }, { read: never, subscribe: () => cleanup });
    await vi.advanceTimersByTimeAsync(1000); expect((await timed).state).toBe('timeout'); expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it('returns the original owner generation rejection without publishing a notification', async () => {
    const page = emptySessionCollaborationPage(request().query, 'stale', 'generation-changed');
    const result = await waitForSessionCollaboration(request(), { read: async () => ({ page }), subscribe: () => () => {} });
    expect(result.state).toBe('stale'); expect(result.page).toEqual(page); expect(result.event).toBeNull();
  });
  it('reads terminal identity from the existing runtime owner and rejects the old generation', () => {
    const runId = 'scoped-watch-terminal';
    emitAgentEvent({ runId, stream: 'lifecycle', sessionKey: scope.sessionKey, sessionId: scope.sessionGeneration, data: { phase: 'end', endedAt: 10 } });
    expect(readScopedAgentRunOutcome(runId, scope.sessionKey, scope.sessionGeneration)?.status).toBe('ok');
    expect(readScopedAgentRunOutcome(runId, scope.sessionKey, 'old-generation')).toBeNull();
    emitAgentEvent({ runId, stream: 'lifecycle', sessionKey: scope.sessionKey, sessionId: scope.sessionGeneration, data: { phase: 'start' } });
    expect(readScopedAgentRunOutcome(runId, scope.sessionKey, scope.sessionGeneration)).toBeNull();
  });
  it('rejects mixed watch requests before subscribing', async () => {
    expect(() => parseSessionCollaborationWatch({ ...request(), owner: 'forged' })).toThrow();
    expect(() => parseSessionCollaborationWatch({ ...request(), condition: 'run-terminal' })).toThrow();
    expect(() => parseSessionCollaborationWatch({ ...request(), timeoutMs: 25_001 })).toThrow();
  });
});
