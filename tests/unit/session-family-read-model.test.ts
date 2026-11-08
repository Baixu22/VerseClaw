import { describe, expect, it, vi } from 'vitest';
import { classifyDerivation, deriveSessionLineage, readSessionDerivationFacts } from '@shared/types/session-derivation';
import { deriveSessionStage } from '@shared/types/session-stage';
import { threadSessionsByLineage, type SidebarSessionEntry } from '@/components/layout/session-buckets';
import { getTranscriptEntryId, readSessionListPages, readSessionTaskContainer, type SessionTaskRead } from '@/lib/session-read-model';
import type { ChatSession } from '@shared/chat/types';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';

const row = (key: string, facts: Partial<ChatSession> = {}): SidebarSessionEntry => ({ session: { key, ...facts }, activityMs: 0 });

describe('session family list read model', () => {
  it('retains a parent on the next owner page without loading a transcript for every older row', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ sessions: Array.from({ length: 100 }, (_, index) => ({ key: `child-${index}`, parentSessionKey: 'parent' })), hasMore: true, nextOffset: 100, totalCount: 101 })
      .mockResolvedValueOnce({ sessions: [{ key: 'parent', sessionId: 'parent-generation' }], hasMore: false, nextOffset: null, totalCount: 101 });
    const result = await readSessionListPages(read);
    expect(result.sessions).toHaveLength(101);
    expect(read).toHaveBeenNthCalledWith(2, { offset: 100, includeDerivedTitles: false, includeLastMessage: false });
    const rows = threadSessionsByLineage((result.sessions as ChatSession[]).map((session) => ({ session, activityMs: 0 })));
    expect(rows[0].entry.session.key).toBe('parent');
    expect(rows.filter((entry) => entry.originKey === 'parent')).toHaveLength(100);
  });
  it('rejects a non-progressing owner cursor', async () => {
    await expect(readSessionListPages(async () => ({ sessions: [], hasMore: true, nextOffset: 0, totalCount: 100 })))
      .rejects.toThrow('pagination');
  });
  it('uses transcript entry metadata for message actions before provider or optimistic IDs', () => {
    expect(getTranscriptEntryId({ role: 'user', content: 'Question', id: 'optimistic-id', __openclaw: { id: 'entry-leaf' } })).toBe('entry-leaf');
    expect(getTranscriptEntryId({ role: 'assistant', content: 'Answer', __openclaw: { id: 'assistant-leaf' } })).toBe('assistant-leaf');
    expect(getTranscriptEntryId({ role: 'user', content: 'Question' })).toBeUndefined();
    expect(getTranscriptEntryId({ role: 'user', content: 'Question', id: 'provider-id', __openclaw: { seq: 1 } })).toBeUndefined();
  });
  it('retains actual list generation and spawn/fork fields and shares precedence with continuity stages', () => {
    const facts = readSessionDerivationFacts({ sessionId: 'physical-2', spawnedBy: 'parent', parentSessionKey: 'parent',
      forkedFromParent: false, forkedFromTimestamp: 123 });
    expect(facts).toMatchObject({ sessionId: 'physical-2', spawnedBy: 'parent', parentSessionKey: 'parent', forkedFromTimestamp: 123 });
    expect(classifyDerivation(facts)).toEqual({ kind: 'spawn', parentSessionKey: 'parent' });
    expect(deriveSessionStage(facts).stageEvidence).toMatchObject({ derivationKind: 'spawn', reasons: ['spawn-parent-key'] });
    const conflict = { ...facts, parentSessionKey: 'other-parent' };
    expect(classifyDerivation(conflict)).toEqual({ kind: 'spawn', parentSessionKey: 'parent', diagnostics: ['parent-spawn-conflict'] });
    expect(deriveSessionStage(conflict).stageEvidence.reasons).toContain('contradictory-stage-facts');
    expect(classifyDerivation({ ...facts, forkedFromParent: true, forkedFromLeafId: 'leaf' }).kind).toBe('fork');
  });

  it.each([2, 20, 100])('preserves all %i descendants with one visual indentation level', (count) => {
    const entries = [row('parent'), ...Array.from({ length: count }, (_, index) => row(`worker-${index}`, { spawnedBy: 'parent', parentSessionKey: 'parent' }))];
    const before = JSON.stringify(entries);
    const rows = threadSessionsByLineage(entries);
    expect(new Set(rows.map((entry) => entry.entry.session.key)).size).toBe(count + 1);
    expect(rows.slice(1).every((entry) => entry.originKey === 'parent' && entry.lineageDepth === 1 && entry.relation?.kind === 'spawn')).toBe(true);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it('retains the direct source of a grandchild even when visually grouped at the family root', () => {
    const rows = threadSessionsByLineage([row('root'), row('child', { parentSessionKey: 'root' }), row('grandchild', { spawnedBy: 'child' })]);
    expect(rows[2]).toMatchObject({ originKey: 'root', lineageDepth: 1, relation: { kind: 'spawn', parentSessionKey: 'child' } });
  });

  it('keeps cross-project/workstream parents outside the group while allowing source navigation', () => {
    const sessions = [row('other-project'), row('child', { parentSessionKey: 'other-project' }), row('grandchild', { spawnedBy: 'child' })];
    const rows = threadSessionsByLineage(sessions.slice(1), { knownSessions: sessions.map((entry) => entry.session) });
    expect(rows.map((entry) => entry.entry.session.key)).toEqual(['child', 'grandchild']);
    expect(rows[0]).toMatchObject({ lineageDepth: 0, sourceStatus: 'outside-group', relation: { parentSessionKey: 'other-project' } });
    expect(rows[1].originKey).toBe('child');
  });

  it('does not confuse unloaded sources with an owner-confirmed missing parent', () => {
    const child = row('child', { parentSessionKey: 'not-loaded' });
    expect(threadSessionsByLineage([child])[0].sourceStatus).toBe('parent-unloaded');
    const owner = deriveSessionLineage({ rootSessionKey: 'child', readEntry: (key) => key === 'child' ? child.session : null });
    expect(threadSessionsByLineage([child], { derivations: new Map([['child', owner]]) })[0].sourceStatus).toBe('parent-missing');
  });

  it('keeps cycles, incomplete fork facts and truncated chains visible without fabricating roots', () => {
    const cyclic = threadSessionsByLineage([row('a', { parentSessionKey: 'b' }), row('b', { spawnedBy: 'a' })]);
    expect(cyclic.map((entry) => entry.sourceStatus)).toEqual(['cycle', 'cycle']);
    expect(cyclic.every((entry) => entry.lineageDepth === 0)).toBe(true);
    expect(threadSessionsByLineage([row('broken', { forkedFromLeafId: 'leaf' })])[0].sourceStatus).toBe('source-unavailable');
    const chain = Array.from({ length: 100 }, (_, index) => row(`s${index}`, index ? { parentSessionKey: `s${index - 1}` } : {}));
    const rows = threadSessionsByLineage(chain, { maxDepth: 8 });
    expect(new Set(rows.map((entry) => entry.entry.session.key)).size).toBe(100);
    expect(rows.some((entry) => entry.sourceStatus === 'bound-exceeded')).toBe(true);
  });
});

function snapshot(): TaskLedgerSnapshot {
  return { schemaVersion: 1, workspaceId: 'owner-normalized-workspace', sourceWorkspaceId: 'workspace-a', generatedAt: '2026-11-07T00:00:00Z',
    nodes: [{ id: 'task', title: 'Task', kind: 'task', status: 'done', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' }],
    sessionLinks: [{ id: 'link', nodeId: 'task', sessionKey: 'session', sessionGeneration: 'generation', createdAt: '2026-11-07T00:00:00Z' }],
    edges: [], rootNodeIds: ['task'], activeNodeIds: [], reviewNodeIds: [], blockedNodeIds: [], currentGoalId: null,
    recentDecisions: [], eventsCount: 2, warnings: [] };
}
const session = { key: 'session', sessionId: 'generation' };
function read(patch: Partial<SessionTaskRead> = {}): SessionTaskRead {
  return { workspaceId: 'workspace-a', sessionKey: session.key, generation: session.sessionId, snapshot: snapshot(), ...patch };
}

describe('scoped task container', () => {
  it('reads linked business tasks and keeps their recorded status', () => {
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read() })).toMatchObject({ status: 'ready', nodes: [{ id: 'task', status: 'done' }] });
  });
  it('distinguishes a discussion container from owner failure', () => {
    const empty = snapshot(); empty.sessionLinks = [];
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read({ snapshot: empty }) }).status).toBe('empty');
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read({ error: 'offline' }) }).status).toBe('unavailable');
  });
  it.each([{ workspaceId: 'workspace-b' }, { sessionKey: 'other' }, { generation: 'old' }])('rejects a response for another scope: %j', (patch) => {
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read(patch) })).toMatchObject({ status: 'stale', nodes: [] });
  });
  it('preserves stale business-task diagnostics even if a current turn-check link exists', () => {
    const stale = snapshot(); stale.sessionLinks[0].sessionGeneration = 'old';
    stale.nodes.push({ ...stale.nodes[0], id: 'turn', kind: 'check' });
    stale.sessionLinks.push({ ...stale.sessionLinks[0], id: 'turn-link', nodeId: 'turn', sessionGeneration: 'generation' });
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read({ snapshot: stale }) }).status).toBe('stale');
  });
  it('does not use task link source fields to establish a session lineage', () => {
    const linked = snapshot(); linked.sessionLinks[0].sourceSessionKey = 'pretend-parent'; linked.sessionLinks[0].relation = 'handoff_from';
    expect(readSessionTaskContainer({ workspaceId: 'workspace-a', session, read: read({ snapshot: linked }) }).status).toBe('ready');
    expect(threadSessionsByLineage([row(session.key)])[0].sourceStatus).toBe('root');
  });
});
