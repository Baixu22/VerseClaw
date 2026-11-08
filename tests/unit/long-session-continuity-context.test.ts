import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemorySurfaceEntry, MemorySurfaceSnapshot } from '@shared/types/memory';
import type {
  TaskLedgerSnapshot,
  TaskLedgerWorkingContextAcceptedRecord,
  TaskLedgerWorkingContextProposalRecord,
  TaskLedgerWorkingContextSnapshot,
} from '@shared/types/task-ledger';
import {
  buildLongSessionContinuityContext,
  renderLongSessionContinuityContext,
} from '@shared/long-session-continuity';

const {
  loadTaskLedgerSnapshotMock,
  readTaskLedgerWorkingContextMock,
  getPersistedCoordinatorBindingMock,
  getWorkspaceRootPathByIdMock,
} = vi.hoisted(() => ({
  loadTaskLedgerSnapshotMock: vi.fn(),
  readTaskLedgerWorkingContextMock: vi.fn(),
  getPersistedCoordinatorBindingMock: vi.fn(),
  getWorkspaceRootPathByIdMock: vi.fn(),
}));

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: (...args: unknown[]) => loadTaskLedgerSnapshotMock(...args),
}));
vi.mock('@electron/services/task-ledger-working-context', () => ({
  readTaskLedgerWorkingContext: (...args: unknown[]) => readTaskLedgerWorkingContextMock(...args),
}));
vi.mock('@electron/services/workspaces-api', () => ({
  getPersistedCoordinatorBinding: (...args: unknown[]) => getPersistedCoordinatorBindingMock(...args),
  getWorkspaceRootPathById: (...args: unknown[]) => getWorkspaceRootPathByIdMock(...args),
}));

vi.mock('@electron/utils/token-usage', () => ({
  getSessionTokenUsageSummary: vi.fn(async () => ({ totalTokens: 0, estimatedCostUsd: 0 })),
}));
vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => true),
}));

const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const WORKSPACE_ID = 'workspace-a';
const SESSION_KEY = 'agent:architect:long-session';
const ROOT = process.cwd();
const POLICY = `sha256:${'a'.repeat(64)}`;

function acceptedWorkingContextRecord(
  field: TaskLedgerWorkingContextAcceptedRecord['field'],
  value: TaskLedgerWorkingContextAcceptedRecord['value'],
  proposalId: string,
): TaskLedgerWorkingContextAcceptedRecord {
  return {
    proposalId,
    field,
    value,
    version: 1,
    actor: 'assistant',
    evidenceRefs: [{ type: 'session', ref: SESSION_KEY }],
    ttl: { issuedAt: '2026-10-23T05:00:00.000Z', expiresAt: '2026-10-24T05:00:00.000Z' },
    sensitivity: 'workspace',
    trust: 'confirmed',
    taskId: 'task-1',
    eventId: `event-${proposalId}`,
    createdAt: '2026-10-23T05:00:00.000Z',
    acceptedEventId: `accept-${proposalId}`,
    policyDigest: POLICY,
    acceptedAt: '2026-10-23T05:00:01.000Z',
  };
}

function pendingWorkingContextRecord(
  field: TaskLedgerWorkingContextProposalRecord['field'],
  value: TaskLedgerWorkingContextProposalRecord['value'],
  proposalId: string,
): TaskLedgerWorkingContextProposalRecord {
  return {
    proposalId,
    field,
    value,
    version: 1,
    actor: 'assistant',
    evidenceRefs: [{ type: 'session', ref: SESSION_KEY }],
    ttl: { issuedAt: '2026-10-23T05:00:00.000Z', expiresAt: '2026-10-24T05:00:00.000Z' },
    sensitivity: 'workspace',
    trust: 'proposed',
    taskId: 'task-1',
    eventId: `event-${proposalId}`,
    createdAt: '2026-10-23T05:00:00.000Z',
  };
}

function workingContextSnapshot(): TaskLedgerWorkingContextSnapshot {
  const fields = Object.fromEntries(
    ['Objective', 'Constraints', 'ConfirmedFacts', 'Decisions', 'OpenRisks', 'ActiveFiles', 'Evidence', 'NextAction']
      .map((field) => [field, { history: [], pending: [], conflicts: [], rejected: [], expired: [] }]),
  ) as unknown as TaskLedgerWorkingContextSnapshot['fields'];
  fields.Objective.current = acceptedWorkingContextRecord('Objective', 'Keep the long-session task recoverable.', 'wc-objective');
  fields.Constraints.current = acceptedWorkingContextRecord('Constraints', ['Preserve workspace boundaries.', 'Do not inject candidates.'], 'wc-constraints');
  fields.Decisions.current = acceptedWorkingContextRecord('Decisions', 'Use SQLite owners; do not create a second memory database.', 'wc-decisions');
  fields.NextAction.current = acceptedWorkingContextRecord('NextAction', 'Verify the bounded continuity pack.', 'wc-next');
  fields.Evidence.current = acceptedWorkingContextRecord('Evidence', [{ type: 'session', ref: SESSION_KEY }], 'wc-evidence');
  fields.OpenRisks.pending.push(pendingWorkingContextRecord('OpenRisks', 'Unverified model narrative must not become a fact.', 'wc-pending-risk'));
  return { schemaVersion: 1, fields, promotionCandidates: [], warnings: [] };
}

function ledgerSnapshot(): TaskLedgerSnapshot {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    generatedAt: '2026-10-23T05:30:00.000Z',
    nodes: [
      {
        id: 'task-1', title: 'Implement D1', kind: 'task', status: 'doing', parentId: null,
        description: 'Consume accepted owner facts.', evidenceRefs: [{ type: 'session', ref: SESSION_KEY }],
        metadata: { nextAction: 'Finish the context integration.' }, createdAt: '2026-10-23T04:00:00.000Z', updatedAt: '2026-10-23T05:20:00.000Z',
      },
      {
        id: 'task-2', title: 'Run scope negatives', kind: 'check', status: 'blocked', parentId: 'task-1',
        createdAt: '2026-10-23T04:10:00.000Z', updatedAt: '2026-10-23T05:10:00.000Z',
      },
      {
        id: 'decision-1', title: 'Keep one context authority', kind: 'decision', status: 'done', parentId: 'task-1',
        description: 'Reuse Context Orchestrator and existing owners.', createdAt: '2026-10-23T04:20:00.000Z', updatedAt: '2026-10-23T05:15:00.000Z',
      },
      {
        id: 'task-other', title: 'Unrelated workspace task', kind: 'task', status: 'blocked', parentId: null,
        createdAt: '2026-10-23T04:00:00.000Z', updatedAt: '2026-10-23T05:00:00.000Z',
      },
    ],
    edges: [{
      id: 'edge-1', from: 'task-2', to: 'task-1', type: 'depends_on', createdAt: '2026-10-23T04:30:00.000Z',
    }],
    sessionLinks: [{
      id: 'link-1', sessionKey: SESSION_KEY, nodeId: 'task-1', agentId: 'architect', relation: 'related', createdAt: '2026-10-23T04:31:00.000Z',
    }],
    rootNodeIds: ['task-1', 'task-other'],
    reviewNodeIds: [],
    activeNodeIds: ['task-1'],
    blockedNodeIds: ['task-2', 'task-other'],
    currentGoalId: null,
    recentDecisions: [],
    eventsCount: 7,
    warnings: [],
  };
}

function memoryEntry(overrides: Partial<MemorySurfaceEntry>): MemorySurfaceEntry {
  return {
    key: 'role-memory-card:mem-1',
    id: 'mem-1',
    source: 'role-memory-card',
    state: 'accepted',
    stateLabel: 'active',
    content: 'Accepted memory content is not copied into the continuity block.',
    scope: 'workspace',
    scopeKey: ROOT,
    roleTags: [],
    sourceLabel: 'user',
    createdAt: '2026-10-23T05:00:00.000Z',
    updatedAt: '2026-10-23T05:00:00.000Z',
    sensitivity: 'normal',
    confidence: 0.9,
    importance: 0.8,
    evidenceCount: 1,
    provenance: ['manual:d1-test'],
    injectable: true,
    retrievable: true,
    modelVisible: true,
    deletable: true,
    ...overrides,
  };
}

function memorySurface(): MemorySurfaceSnapshot {
  const accepted = memoryEntry({});
  const outOfScope = memoryEntry({
    key: 'role-memory-card:mem-other', id: 'mem-other', scopeKey: 'D:/other-workspace', content: 'OTHER_WORKSPACE_SECRET',
  });
  const ownerGateClosed = memoryEntry({
    key: 'role-memory-card:mem-closed', id: 'mem-closed', modelVisible: false, injectable: false,
  });
  const candidate = memoryEntry({
    key: 'role-memory-card:proposal:1', id: 'proposal-1', state: 'candidate', stateLabel: 'needs_review',
    injectable: false, retrievable: false, modelVisible: false, content: 'UNAPPROVED_CANDIDATE',
  });
  return {
    schemaVersion: 'MemorySurface/v1',
    generatedAt: '2026-10-23T05:30:00.000Z',
    accepted: [accepted, outOfScope, ownerGateClosed],
    candidates: [candidate],
    status: {
      roleMemory: { owner: 'role-memory-card-governance', enabled: true, readGate: 'open', writeGate: 'open', candidateCapture: true, candidatePersistence: true, modelRetrieval: true },
      runtimeMemory: { owner: 'runtime-memory-store', enabled: false, readGate: 'closed', writeGate: 'closed', candidateCapture: false, candidatePersistence: false, modelRetrieval: false, persist: false, provider: false, injectionPilotEnabled: true, injectionProviders: ['role-memory'] },
      legacySources: [],
    },
    model: {
      acceptedOnly: true, acceptedKeys: ['role-memory-card:mem-1'], candidateKeysExcluded: ['role-memory-card:proposal:1'],
      candidateBoundary: 'Candidates never enter model context.', productDescription: 'Memory', approvalBoundary: 'Accepted only.',
    },
    counts: { accepted: 3, candidates: 1, modelVisible: 2 },
  };
}

function buildPack() {
  return buildLongSessionContinuityContext({
    sessionKey: SESSION_KEY,
    workspaceId: WORKSPACE_ID,
    workspaceRootPath: ROOT,
    bindingRevision: 3,
    activeTaskNodeId: 'task-1',
    taskRefs: ['task-1', 'decision-1'],
    taskLedger: ledgerSnapshot(),
    workingContext: workingContextSnapshot(),
    compression: {
      checkpointId: 'cp-1',
      objective: 'Recover the long-session task.',
      constraints: ['Do not copy raw transcript history.'],
      decisions: ['Keep Context Orchestrator as sole projection authority.'],
      blocked: ['Scope negatives still need execution.'],
      inProgress: ['Integrate continuity references.'],
      nextAction: 'Run the scope and rollback negatives.',
      evidenceRefs: ['compression:cp-1'],
      unverifiedClaims: ['MODEL_NARRATIVE_ONLY'],
    },
    memorySurface: memorySurface(),
    agentId: 'architect',
    knowledgeReferences: [{
      id: 'wiki:decision-1', title: 'Knowledge decision', lookup: 'notes/decision.md', corpus: 'wiki', freshnessLevel: 'fresh', matchedClaimStatus: 'supported',
    }],
    budgetChars: 1_800,
    now: NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskLedgerSnapshotMock.mockResolvedValue(ledgerSnapshot());
  readTaskLedgerWorkingContextMock.mockResolvedValue(workingContextSnapshot());
  getPersistedCoordinatorBindingMock.mockResolvedValue({
    schemaVersion: 1, workspaceId: WORKSPACE_ID, agentId: 'architect', sessionKey: SESSION_KEY,
    sessionGeneration: 'session-generation-1', taskLedgerReferences: [{ direction: 'workboard-to-task-ledger', taskLedgerNodeId: 'task-1', source: 'runtime' }],
    environment: { kind: 'local', canonicalRoot: ROOT, backend: 'local-workspace', branch: 'main', detachedHead: false, setupProfile: null },
    archiveRestorePolicy: 'restore', state: 'active', bindingRevision: 3, invalidationReason: null,
    createdAt: '2026-10-23T04:00:00.000Z', updatedAt: '2026-10-23T04:00:00.000Z',
  });
  getWorkspaceRootPathByIdMock.mockResolvedValue(ROOT);
});

describe('long-session continuity context', () => {
  it('projects accepted owner facts with provenance, freshness, scope and bounded history refs', () => {
    const pack = buildPack();
    const rendered = renderLongSessionContinuityContext(pack);

    expect(pack.schemaVersion).toBe('ContinuityContextPack/v1');
    expect(pack.status).toBe('known');
    expect(pack.complete).toBe(false);
    expect(pack.bindingRevision).toBe(3);
    expect(pack.budget.usedChars).toBeLessThanOrEqual(pack.budget.maxChars);
    expect(pack.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'objective', 'constraint', 'decision', 'open-dependency', 'next-action', 'memory-ref', 'knowledge-ref', 'evidence',
    ]));
    expect(rendered).toContain('Preserve workspace boundaries.');
    expect(rendered).toContain('Use SQLite owners');
    expect(rendered).toContain('Run the scope and rollback negatives.');
    expect(rendered).toContain('role-memory-card:mem-1');
    expect(rendered).toContain('notes/decision.md');
    expect(rendered).toContain('Original history is not copied into this turn');
    expect(rendered).toContain('session:agent:architect:long-session');
    expect(rendered).toContain('task-ledger:workspace-a');
    expect(rendered).toContain('cp-1');
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'role-memory-card:proposal:1', reason: 'candidate-not-accepted' }),
      expect.objectContaining({ ref: 'role-memory-card:mem-other', reason: 'out-of-scope' }),
      expect.objectContaining({ ref: 'role-memory-card:mem-closed', reason: 'owner-gate-closed' }),
      expect.objectContaining({ ref: 'task-ledger-working-context:wc-pending-risk', reason: 'pending-not-accepted' }),
      expect.objectContaining({ reason: 'unverified-claim' }),
    ]));
    expect(rendered).not.toContain('UNAPPROVED_CANDIDATE');
    expect(rendered).not.toContain('OTHER_WORKSPACE_SECRET');
    expect(rendered).not.toContain('MODEL_NARRATIVE_ONLY');
    expect(rendered).not.toContain('Unrelated workspace task');
  });

  it('reports unknown instead of inventing a recovered task when all sources are absent', () => {
    const pack = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      bindingRevision: 4,
      taskLedger: null,
      workingContext: null,
      compression: null,
      memorySurface: null,
      availability: { taskLedger: false, workingContext: false, compression: false, memory: false },
      budgetChars: 1_800,
      now: NOW,
    });
    const rendered = renderLongSessionContinuityContext(pack);

    expect(pack.status).toBe('unknown');
    expect(pack.items).toEqual([]);
    expect(pack.complete).toBe(false);
    expect(rendered).toContain('No accepted continuity items were available');
    expect(rendered).toContain('Unavailable/unknown sources');
    expect(rendered).toContain('compression=unavailable');
  });

  it('truncates deterministically under budget and records every dropped item', () => {
    const first = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 5,
      taskRefs: ['task-1', 'decision-1'],
      taskLedger: ledgerSnapshot(),
      workingContext: workingContextSnapshot(),
      compression: { constraints: ['Long constraint '.repeat(20)], nextAction: 'Next action '.repeat(20) },
      budgetChars: 220,
      now: NOW,
    });
    const second = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 5,
      taskRefs: ['task-1', 'decision-1'],
      taskLedger: ledgerSnapshot(),
      workingContext: workingContextSnapshot(),
      compression: { constraints: ['Long constraint '.repeat(20)], nextAction: 'Next action '.repeat(20) },
      budgetChars: 220,
      now: NOW,
    });

    expect(first.budget.truncated).toBe(true);
    expect(first.budget.droppedItems).toBeGreaterThan(0);
    expect(first.budget.usedChars).toBeLessThanOrEqual(220);
    expect(first.items).toEqual(second.items);
    expect(first.exclusions.filter((entry) => entry.reason === 'budget')).toHaveLength(first.budget.droppedItems);
  });

  it('rebuilds after fork or restart from owner refs without copying the old session transcript', () => {
    const forkSessionKey = 'agent:architect:forked-session';
    const first = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 6,
      taskRefs: ['task-1'],
      taskLedger: ledgerSnapshot(),
      workingContext: workingContextSnapshot(),
      memorySurface: memorySurface(),
      budgetChars: 1_800,
      now: NOW,
    });
    const restarted = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 6,
      taskRefs: ['task-1'],
      taskLedger: ledgerSnapshot(),
      workingContext: workingContextSnapshot(),
      memorySurface: memorySurface(),
      budgetChars: 1_800,
      now: NOW,
    });
    const forked = buildLongSessionContinuityContext({
      sessionKey: forkSessionKey,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 1,
      taskRefs: ['task-1'],
      taskLedger: {
        ...ledgerSnapshot(),
        sessionLinks: [{ ...ledgerSnapshot().sessionLinks[0]!, id: 'link-fork', sessionKey: forkSessionKey }],
      },
      workingContext: workingContextSnapshot(),
      memorySurface: memorySurface(),
      budgetChars: 1_800,
      now: NOW + 1_000,
    });

    expect(restarted.items).toEqual(first.items);
    expect(restarted.originalHistory).toEqual(first.originalHistory);
    expect(first.originalHistory.transcriptRef).toBe(`session:${SESSION_KEY}`);
    expect(forked.originalHistory.transcriptRef).toBe(`session:${forkSessionKey}`);
    expect(forked.originalHistory.compressionAvailable).toBe(false);
    expect(forked.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'constraint', text: expect.stringContaining('Preserve workspace boundaries.') }),
    ]));
    expect(forked.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'compression-artifact' }),
    ]));

    const compacted = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 6,
      taskRefs: ['task-1'],
      taskLedger: ledgerSnapshot(),
      workingContext: workingContextSnapshot(),
      compression: { checkpointId: 'cp-restart', constraints: ['Resume after compact.'], nextAction: 'Read the compact artifact.' },
      memorySurface: memorySurface(),
      budgetChars: 1_800,
      now: NOW + 2_000,
    });
    const handedOff = buildLongSessionContinuityContext({
      sessionKey: forkSessionKey,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 1,
      taskRefs: ['task-1'],
      taskLedger: {
        ...ledgerSnapshot(),
        sessionLinks: [{ ...ledgerSnapshot().sessionLinks[0]!, id: 'link-handoff', sessionKey: forkSessionKey }],
      },
      workingContext: workingContextSnapshot(),
      compression: { checkpointId: 'cp-handoff', constraints: ['Use the handoff artifact.'], nextAction: 'Continue the handed-off task.' },
      memorySurface: memorySurface(),
      budgetChars: 1_800,
      now: NOW + 2_500,
    });
    expect(compacted.originalHistory.compressionAvailable).toBe(true);
    expect(compacted.originalHistory.compressionCheckpointId).toBe('cp-restart');
    expect(compacted.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Resume after compact.', source: 'compression-artifact' }),
    ]));
    expect(handedOff.originalHistory.transcriptRef).toBe(`session:${forkSessionKey}`);
    expect(handedOff.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Use the handoff artifact.' }),
      expect.objectContaining({ text: 'Continue the handed-off task.' }),
    ]));
  });

  it('rejects foreign agent and role memory scopes without leaking their refs', () => {
    const base = memorySurface();
    const foreignAgent = memoryEntry({
      key: 'role-memory-card:mem-agent-other', id: 'mem-agent-other', scope: 'agent', scopeKey: 'reviewer', content: 'FOREIGN_AGENT_SECRET',
    });
    const foreignRole = memoryEntry({
      key: 'role-memory-card:mem-role-other', id: 'mem-role-other', scope: 'role', scopeKey: null, roleTags: ['reviewer'], content: 'FOREIGN_ROLE_SECRET',
    });
    const pack = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 6,
      taskRefs: ['task-1'],
      memorySurface: { ...base, accepted: [...base.accepted, foreignAgent, foreignRole] },
      agentId: 'architect',
      roleName: 'architect',
      budgetChars: 1_800,
      now: NOW,
    });
    const rendered = renderLongSessionContinuityContext(pack);
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: foreignAgent.key, reason: 'out-of-scope' }),
      expect.objectContaining({ ref: foreignRole.key, reason: 'out-of-scope' }),
    ]));
    expect(rendered).not.toContain(foreignAgent.key);
    expect(rendered).not.toContain(foreignRole.key);
    expect(rendered).not.toContain('FOREIGN_AGENT_SECRET');
    expect(rendered).not.toContain('FOREIGN_ROLE_SECRET');
  });
  it('excludes expired, tombstoned, superseded and disabled memory while preserving source provenance', () => {
    const expired = memoryEntry({
      key: 'role-memory-card:mem-expired', id: 'mem-expired', content: 'EXPIRED_MEMORY_SECRET',
      expiresAt: '2026-10-23T05:30:00.000Z',
    });
    const tombstoned = memoryEntry({
      key: 'role-memory-card:mem-deleted', id: 'mem-deleted', stateLabel: 'tombstone', content: 'DELETED_MEMORY_SECRET',
    });
    const superseded = memoryEntry({
      key: 'role-memory-card:mem-superseded', id: 'mem-superseded', stateLabel: 'superseded', content: 'SUPERSEDED_MEMORY_SECRET',
    });
    const base = memorySurface();
    const pack = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      workspaceRootPath: ROOT,
      bindingRevision: 7,
      taskRefs: ['task-1'],
      memorySurface: { ...base, accepted: [...base.accepted, expired, tombstoned, superseded] },
      roleMemoryEnabled: false,
      budgetChars: 1_800,
      now: NOW,
    });
    const rendered = renderLongSessionContinuityContext(pack);
    expect(pack.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expired.key, reason: 'expired' }),
      expect.objectContaining({ ref: tombstoned.key, reason: 'revoked-or-superseded' }),
      expect.objectContaining({ ref: superseded.key, reason: 'revoked-or-superseded' }),
      expect.objectContaining({ ref: 'role-memory-card:mem-1', reason: 'owner-gate-closed' }),
    ]));
    expect(rendered).not.toContain('EXPIRED_MEMORY_SECRET');
    expect(rendered).not.toContain('DELETED_MEMORY_SECRET');
    expect(rendered).not.toContain('SUPERSEDED_MEMORY_SECRET');
    expect(rendered).not.toContain('role-memory-card:mem-1');
    expect(pack.sourceStates.find((state) => state.source === 'memory')?.status).toBe('available');
  });

  it('resolves native compaction ownership from the effective policy production read', async () => {
    getPersistedCoordinatorBindingMock.mockResolvedValueOnce({
      schemaVersion: 1, workspaceId: WORKSPACE_ID, agentId: 'architect', sessionKey: SESSION_KEY,
      sessionGeneration: null, taskLedgerReferences: [{ direction: 'workboard-to-task-ledger', taskLedgerNodeId: 'task-1', source: 'runtime' }],
      environment: { kind: 'local', canonicalRoot: ROOT, backend: 'local-workspace', branch: 'main', detachedHead: false, setupProfile: null },
      archiveRestorePolicy: 'restore', state: 'active', bindingRevision: 10, invalidationReason: null,
      createdAt: '2026-10-23T04:00:00.000Z', updatedAt: '2026-10-23T04:00:00.000Z',
    });
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.compressionArtifact') return { artifact: { constraints: [{ text: 'NATIVE_ARTIFACT_MUST_NOT_BE_CLAIMED' }] } };
        if (method === 'memory.surface') return memorySurface();
        if (method === 'session.activitySnapshot') {
          return { snapshot: { policy: { backend: { effective: { value: { kind: 'native', ownsNativeCompaction: true } } } } } };
        }
        if (method === 'sessions.describe') return { session: { sessionId: 'session-generation-1' } };
        if (method === 'chat.send') return { runId: 'run-native' };
        throw new Error(`unexpected rpc ${method}`);
      }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    const preview = await api.continuityPreview({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      knowledgeReferences: [],
    });
    expect(preview.validation).toBe('current');
    expect(preview.pack?.sourceStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'compression-artifact', status: 'unavailable' }),
    ]));
    expect(gatewayManager.rpc).toHaveBeenCalledWith('session.activitySnapshot', expect.anything(), 15_000);
  });

  it('falls back when the session generation changes after the coordinator binding', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string) => {
        if (method === 'sessions.describe') return { session: { sessionId: 'generation-replaced' } };
        if (method === 'chat.send') return { runId: 'run-reset' };
        throw new Error(`unexpected rpc ${method}`);
      }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });
    const preview = await api.continuityPreview({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      knowledgeReferences: [],
    });
    expect(preview.validation).toBe('invalidated');
    expect(preview.pack).toBeUndefined();
    expect(gatewayManager.rpc.mock.calls.some((call) => call[0] === 'memory.surface')).toBe(false);
  });
  it('keeps native compaction ownership and unknown backend state explicit', () => {
    const native = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      bindingRevision: 8,
      compression: { checkpointId: 'cp-native', nextAction: 'NATIVE_ARTIFACT_MUST_NOT_BE_CLAIMED' },
      nativeBackendOwnsCompaction: true,
      availability: { compression: true },
      budgetChars: 1_800,
      now: NOW,
    });
    const unknown = buildLongSessionContinuityContext({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      bindingRevision: 9,
      compression: null,
      availability: { compression: false, memory: false },
      budgetChars: 1_800,
      now: NOW,
    });
    expect(native.sourceStates.find((state) => state.source === 'compression-artifact')).toMatchObject({
      status: 'unavailable',
      detail: 'native backend owns compaction and continuity projection',
    });
    expect(native.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'NATIVE_ARTIFACT_MUST_NOT_BE_CLAIMED' }),
    ]));
    expect(native.status).toBe('unknown');
    expect(unknown.sourceStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'compression-artifact', status: 'unavailable' }),
      expect.objectContaining({ source: 'memory', status: 'unavailable' }),
    ]));
    expect(unknown.status).toBe('unknown');
    expect(unknown.complete).toBe(false);
  });
  it('routes the explicit coordinator production path through the continuity block and falls back when the binding is invalidated', async () => {
    const gatewayManager = {
      rpc: vi.fn(async (method: string, _payload?: unknown, _timeout?: number) => {
        if (method === 'sessions.compressionArtifact') {
          return {
            ok: true,
            checkpointId: 'cp-1',
            artifact: {
              objective: 'Recover the task.', constraints: [{ text: 'No raw history copy.' }], decisions: [{ text: 'Reuse Context Orchestrator.' }],
              blocked: [{ text: 'Run scope tests.' }], inProgress: [], nextAction: 'Run rollback test.', evidenceRefs: [{ ref: 'trace-1' }], unverifiedClaims: ['unverified prose'],
            },
          };
        }
        if (method === 'memory.surface') return memorySurface();
        if (method === 'sessions.describe') return { session: { sessionId: 'session-generation-1' } };
        if (method === 'session.activitySnapshot') return { snapshot: { policy: undefined } };
        if (method === 'chat.send') return { runId: 'run-d1' };
        throw new Error(`unexpected rpc ${method}`);
      }),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await api.sendWithMedia({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      message: 'Continue the task',
      idempotencyKey: 'idem-d1-active',
      knowledgeReferences: [{ id: 'wiki:decision-1', title: 'Knowledge decision', lookup: 'notes/decision.md', corpus: 'wiki', freshnessLevel: 'fresh' }],
    });

    expect(gatewayManager.rpc.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      'sessions.compressionArtifact', 'memory.surface', 'chat.send',
    ]));
    const preview = await api.continuityPreview({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      activeTaskNodeId: 'task-1',
      knowledgeReferences: [{ id: 'wiki:decision-1', title: 'Knowledge decision', lookup: 'notes/decision.md', corpus: 'wiki' }],
    });
    expect(preview).toMatchObject({
      success: true,
      validation: 'current',
      pack: {
        schemaVersion: 'ContinuityContextPack/v1',
        bindingRevision: 3,
        complete: false,
        originalHistory: { transcriptRef: `session:${SESSION_KEY}`, taskLedgerRef: `task-ledger:${WORKSPACE_ID}` },
      },
    });

    const chatPayload = gatewayManager.rpc.mock.calls.find((call) => call[0] === 'chat.send')?.[1] as { message: string };
    expect(chatPayload.message).toContain('Continuity context (owner-derived');
    expect(chatPayload.message).toContain('No raw history copy.');
    expect(chatPayload.message).toContain('task-ledger:workspace-a');
    expect(chatPayload.message).not.toContain('UNAPPROVED_CANDIDATE');
    expect(chatPayload.message).not.toContain('unverified prose');
    expect(chatPayload.message.endsWith('Continue the task')).toBe(true);

    getPersistedCoordinatorBindingMock.mockResolvedValue({
      schemaVersion: 1, workspaceId: WORKSPACE_ID, agentId: 'architect', sessionKey: SESSION_KEY,
      sessionGeneration: 'session-generation-1', taskLedgerReferences: [{ direction: 'workboard-to-task-ledger', taskLedgerNodeId: 'task-1', source: 'runtime' }],
      environment: { kind: 'local', canonicalRoot: ROOT, backend: 'local-workspace', branch: 'main', detachedHead: false, setupProfile: null },
      archiveRestorePolicy: 'restore', state: 'invalid', bindingRevision: 4, invalidationReason: 'generation_mismatch',
      createdAt: '2026-10-23T04:00:00.000Z', updatedAt: '2026-10-23T05:40:00.000Z',
    });
    gatewayManager.rpc.mockClear();
    const invalidated = await api.sendWithMedia({
      sessionKey: SESSION_KEY,
      workspaceId: WORKSPACE_ID,
      message: 'After reset',
      idempotencyKey: 'idem-d1-invalidated',
    });
    expect(invalidated).toMatchObject({ success: false, error: expect.stringContaining('COORDINATOR_BINDING_INVALID') });
    expect(gatewayManager.rpc.mock.calls.every((call) => call[0] !== 'chat.send')).toBe(true);
    expect(gatewayManager.rpc.mock.calls.every((call) => call[0] !== 'memory.surface' && call[0] !== 'sessions.compressionArtifact')).toBe(true);
  });
});
