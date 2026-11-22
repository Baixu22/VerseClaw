import { describe, expect, it } from 'vitest';

import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';
import type { Principle, Trajectory } from '../../openclaw_runtime/src/knowledge/sekb/types';
import {
  collectSessionCascadeTargets,
  createInMemoryCascadeStores,
  createKnowledgeStoreCascadeAdapter,
  executeSessionCascadeDelete,
  locateDerivativeLineage,
  purgeExpiredSekbTrajectories,
  type SessionCascadeStores,
} from '../../openclaw_runtime/src/knowledge/sekb/session-cascade-delete';

const SESSION = 'agent:main:session-p3-004-canary';
const CANARY = 'P3-004-CANARY-UNIQUE-TOKEN-9f3c2a';

function principle(id: string, extra: Partial<Principle> = {}): Principle {
  return {
    principle_id: id,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    title: `Principle ${id}`,
    condition: 'when testing cascade',
    action: 'delete derivatives',
    reason: 'privacy',
    full_content: `full ${id} ${CANARY}`,
    task_types: ['test'],
    context_tags: ['p3-004'],
    embedding: null,
    source_trajectories: [],
    created_by: 'human',
    status: 'active',
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: 'medium',
    pinned: false,
    metadata: {
      confirmProvenance: { sessionId: SESSION },
    },
    ...extra,
  };
}

function trajectory(id: string, extra: Partial<Trajectory> = {}): Trajectory {
  return {
    trajectory_id: id,
    created_at: '2026-07-17T00:00:00.000Z',
    task_intent: `intent ${CANARY}`,
    task_type: 'test',
    context_fingerprint: ['p3-004'],
    steps: [],
    outcome: 'success',
    error_signature: null,
    cost: { tokens: 1, duration_seconds: 1, retries: 0 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: { sessionId: SESSION },
    ...extra,
  };
}

function memory(id: string, extra: Partial<MemoryCard> = {}): MemoryCard {
  return {
    id,
    type: 'fact',
    scope: 'session',
    scopeKey: SESSION,
    roleTags: ['coder'],
    content: `memory ${CANARY}`,
    evidence: ['trace:1'],
    confidence: 0.9,
    importance: 0.5,
    lastAccessedAt: '2026-07-17T00:00:00.000Z',
    createdAt: '2026-07-17T00:00:00.000Z',
    accessCount: 0,
    version: 1,
    status: 'active',
    sensitivity: 'normal',
    durability: 'session',
    source: 'user',
    ...extra,
  };
}

describe('P3-004 session hard-delete cascade + TTL', () => {
  it('A1: canary is gone from all stores after cascade delete', () => {
    const trajLinked = trajectory('traj-linked', {
      metadata: { note: 'linked via principle only' },
      task_intent: `linked ${CANARY}`,
    });
    // No sessionId on linked trajectory metadata — only via principle.source_trajectories
    delete (trajLinked.metadata as { sessionId?: string }).sessionId;

    const stores = createInMemoryCascadeStores({
      principles: [
        principle('prin-1', {
          source_trajectories: ['traj-session', 'traj-linked'],
          full_content: `principle body ${CANARY}`,
        }),
        principle('prin-other', {
          metadata: { confirmProvenance: { sessionId: 'other-session' } },
          full_content: 'other principle no canary',
        }),
      ],
      trajectories: [
        trajectory('traj-session', { task_intent: `session traj ${CANARY}` }),
        trajLinked,
        trajectory('traj-other', {
          metadata: { sessionId: 'other-session' },
          task_intent: 'other traj',
        }),
      ],
      memoryCards: [
        memory('mem-1'),
        memory('mem-label', {
          scope: 'role',
          scopeKey: null,
          retentionLabels: [`session:${SESSION}`],
          content: `label mem ${CANARY}`,
        }),
        memory('mem-other', {
          scope: 'session',
          scopeKey: 'other-session',
          content: 'other memory',
        }),
      ],
      dcsJournalIds: [
        `experience_sekb_${SESSION.replace(/[:/\\]/g, '_')}_1.json`,
        'experience_sekb_other-session_1.json',
      ],
    });

    const before = collectSessionCascadeTargets(SESSION, stores);
    expect(before.map((t) => t.kind).sort()).toEqual(
      [
        'dcs_experience_journal',
        'memory_card',
        'memory_card',
        'sekb_principle',
        'sekb_trajectory',
        'sekb_trajectory',
      ].sort(),
    );
    expect(stores.searchPlaintext?.(CANARY).length).toBeGreaterThan(0);

    const report = executeSessionCascadeDelete(SESSION, stores, { canary: CANARY });
    expect(report.schema).toBe('session-cascade-delete.v1');
    expect(report.taskId).toBe('P3-004');
    expect(report.findingIds).toEqual(['F-DATA-005']);
    expect(report.errors).toEqual([]);
    expect(report.success).toBe(true);
    expect(report.remainingCanaryHits).toBe(0);
    expect(stores.searchPlaintext?.(CANARY) ?? []).toEqual([]);

    // Unrelated session data remains
    expect(stores.listPrinciples().map((p) => p.principle_id)).toEqual(['prin-other']);
    expect(stores.listTrajectories().map((t) => t.trajectory_id)).toEqual(['traj-other']);
    expect(stores.listMemoryCards().map((m) => m.id)).toEqual(['mem-other']);
    expect(stores.listDcsExperienceJournalIds()).toEqual([
      'experience_sekb_other-session_1.json',
    ]);
  });

  it('A2: delete failures are retriable and visible in the report', () => {
    const base = createInMemoryCascadeStores({
      principles: [principle('prin-fail')],
      trajectories: [trajectory('traj-fail')],
      memoryCards: [memory('mem-fail')],
      dcsJournalIds: [`journal_${SESSION}`],
    });

    const stores: SessionCascadeStores = {
      ...base,
      deletePrinciple: (id) => {
        throw new Error(`sqlite locked while deleting principle ${id}`);
      },
      deleteTrajectory: base.deleteTrajectory,
      deleteMemoryCard: base.deleteMemoryCard,
      deleteDcsExperienceJournal: base.deleteDcsExperienceJournal,
      listPrinciples: base.listPrinciples,
      listTrajectories: base.listTrajectories,
      listMemoryCards: base.listMemoryCards,
      listDcsExperienceJournalIds: base.listDcsExperienceJournalIds,
      searchPlaintext: base.searchPlaintext,
    };

    const report = executeSessionCascadeDelete(SESSION, stores, { canary: CANARY });
    expect(report.success).toBe(false);
    expect(report.retryable).toBe(true);
    expect(report.errors.length).toBeGreaterThanOrEqual(1);
    expect(report.errors.every((e) => e.retryable)).toBe(true);
    expect(report.errors.some((e) => e.kind === 'sekb_principle' && e.id === 'prin-fail')).toBe(
      true,
    );
    expect(report.errors[0].error).toMatch(/sqlite locked/i);
    // Other targets still removed
    expect(report.removed.some((r) => r.kind === 'sekb_trajectory')).toBe(true);
    expect(report.removed.some((r) => r.kind === 'memory_card')).toBe(true);
  });

  it('A3: derivative lineage is locatable for removed targets', () => {
    const stores = createInMemoryCascadeStores({
      principles: [
        principle('prin-lineage', {
          source_trajectories: ['traj-lineage'],
        }),
      ],
      trajectories: [trajectory('traj-lineage')],
      memoryCards: [memory('mem-lineage')],
      dcsJournalIds: [`dcs-${SESSION}`],
    });

    const targets = collectSessionCascadeTargets(SESSION, stores);
    const prinLineage = locateDerivativeLineage(targets, 'prin-lineage');
    expect(prinLineage).toEqual(
      expect.arrayContaining([
        `session:${SESSION}`,
        'principle:prin-lineage',
        'trajectory:traj-lineage',
      ]),
    );

    const memLineage = locateDerivativeLineage(targets, 'mem-lineage');
    expect(memLineage).toEqual(
      expect.arrayContaining([`session:${SESSION}`, 'memory:mem-lineage', 'scope:session']),
    );

    const report = executeSessionCascadeDelete(SESSION, stores);
    expect(report.removed.every((t) => Array.isArray(t.lineage) && t.lineage.length >= 2)).toBe(
      true,
    );
    expect(report.removed.find((t) => t.id === 'prin-lineage')?.lineage[0]).toBe(
      `session:${SESSION}`,
    );
  });

  it('TTL: purgeExpiredSekbTrajectories deletes only past expires_at and surfaces retryable errors', () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    const expired = trajectory('traj-expired', {
      expires_at: '2026-07-16T00:00:00.000Z',
      metadata: { sessionId: SESSION },
    });
    const live = trajectory('traj-live', {
      expires_at: '2026-07-18T00:00:00.000Z',
      metadata: { sessionId: SESSION },
    });
    const noTtl = trajectory('traj-no-ttl', {
      expires_at: null,
      metadata: { sessionId: SESSION },
    });

    const deleted: string[] = [];
    const ok = purgeExpiredSekbTrajectories([expired, live, noTtl], now, (id) => {
      deleted.push(id);
    });
    expect(ok.deleted).toEqual(['traj-expired']);
    expect(ok.errors).toEqual([]);
    expect(deleted).toEqual(['traj-expired']);

    const fail = purgeExpiredSekbTrajectories([expired], now, () => {
      throw new Error('disk full');
    });
    expect(fail.deleted).toEqual([]);
    expect(fail.errors).toEqual([
      expect.objectContaining({
        kind: 'sekb_trajectory',
        id: 'traj-expired',
        retryable: true,
        error: expect.stringMatching(/disk full/i),
      }),
    ]);
  });

  it('adapter: KnowledgeStore cascade adapter uses delete_principle/delete_trajectory when present', () => {
    const principles = [principle('p-adapt')];
    const trajectories = [trajectory('t-adapt')];
    const mockStore = {
      query_principles: () => principles,
      query_trajectories: () => trajectories,
      list_adoption_events: () => [],
      delete_principle: (id: string) => {
        const idx = principles.findIndex((p) => p.principle_id === id);
        if (idx >= 0) principles.splice(idx, 1);
      },
      delete_trajectory: (id: string) => {
        const idx = trajectories.findIndex((t) => t.trajectory_id === id);
        if (idx >= 0) trajectories.splice(idx, 1);
      },
      archive_principle: () => {
        throw new Error('should not archive when hard delete exists');
      },
    };

    const adapter = createKnowledgeStoreCascadeAdapter(mockStore as never, {
      listMemoryCards: () => [memory('m-adapt')],
      deleteMemoryCard: () => undefined,
      listDcsExperienceJournalIds: () => [`j-${SESSION}`],
      deleteDcsExperienceJournal: () => undefined,
    });

    const report = executeSessionCascadeDelete(SESSION, adapter, { canary: CANARY });
    // canary still in memory payload objects until delete runs — adapter memory list returns fixed array
    // so remaining canary may be non-zero if search not provided; success may still pass without canary scan
    expect(report.errors).toEqual([]);
    expect(principles).toEqual([]);
    expect(trajectories).toEqual([]);
    expect(report.removed.some((r) => r.kind === 'sekb_principle')).toBe(true);
    expect(report.removed.some((r) => r.kind === 'sekb_trajectory')).toBe(true);
  });
});
