import { describe, expect, it } from 'vitest';
import type {
  TaskLedgerEvent,
  TaskLedgerEventInput,
  TaskLedgerWorkingContextField,
} from '../../shared/types/task-ledger';
import {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  emptyTaskLedgerWorkingContextSnapshot,
  mergeTaskLedgerWorkingContext,
  projectTaskLedgerWorkingContext,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
} from '../../shared/task-ledger-working-context';
import { projectTaskLedgerSnapshot } from '../../electron/services/task-ledger-service';

const workspaceId = 'workspace-stage3-contract';
const baseTime = '2026-06-16T10:00:00.000Z';
const later = '2026-06-16T10:05:00.000Z';
const taskId = 'tlroot_contract';

function toEvent(event: TaskLedgerEventInput, id: string): TaskLedgerEvent {
  return {
    ...event,
    id,
    workspaceId,
    taskId: event.taskId ?? taskId,
    sessionId: event.sessionId ?? null,
    createdAt: event.createdAt ?? baseTime,
  } as TaskLedgerEvent;
}

function proposalEvent(
  proposalId: string,
  field: TaskLedgerWorkingContextField,
  value: string | string[] | { type: 'tool'; ref: string }[],
  actor: 'user' | 'assistant' = 'assistant',
  createdAt = baseTime,
) {
  const result = createTaskLedgerWorkingContextProposal({
    proposalId,
    field,
    value: value as never,
    version: 1,
    actor,
    taskId,
    evidenceRefs: [{ type: 'tool', ref: `tool:${proposalId}` }],
    createdAt,
  });
  if (!result.ok) throw new Error(result.reason);
  return toEvent(result.event, `p-${proposalId}`);
}

function acceptEvent(proposalId: string, field: TaskLedgerWorkingContextField, createdAt = later) {
  const result = createTaskLedgerWorkingContextDecision({
    proposalId,
    field,
    version: 1,
    decision: 'accepted',
    actor: 'user',
    taskId,
    policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
    createdAt,
  });
  if (!result.ok) throw new Error(result.reason);
  return toEvent(result.event, `a-${proposalId}`);
}

function rejectEvent(proposalId: string, field: TaskLedgerWorkingContextField) {
  const result = createTaskLedgerWorkingContextDecision({
    proposalId,
    field,
    version: 1,
    decision: 'rejected',
    actor: 'user',
    taskId,
    policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
    rejectionReason: 'owner rejected',
    createdAt: later,
  });
  if (!result.ok) throw new Error(result.reason);
  return toEvent(result.event, `r-${proposalId}`);
}

describe('Stage 3 Working Context contract', () => {
  it('constructs bounded proposals with owner defaults and rejects raw content', () => {
    const built = createTaskLedgerWorkingContextProposal({
      proposalId: 'p-defaults',
      field: 'Objective',
      value: 'Ship Stage 3',
      version: 1,
      actor: 'assistant',
      taskId,
      evidenceRefs: [{ type: 'file', ref: 'file:spec.md' }],
      createdAt: baseTime,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.event.type).toBe('working_context_proposed');
    expect(built.event.payload.workingContextProposal).toMatchObject({
      sensitivity: 'workspace',
      trust: 'proposed',
      ttl: { issuedAt: baseTime },
    });

    expect(createTaskLedgerWorkingContextProposal({
      proposalId: 'p-key',
      field: 'Objective',
      value: 'sk-0123456789abcdef',
      version: 1,
      actor: 'assistant',
      taskId,
      evidenceRefs: [{ type: 'tool', ref: 'tool:x' }],
      createdAt: baseTime,
    }).ok).toBe(false);

    expect(createTaskLedgerWorkingContextProposal({
      proposalId: 'p-long',
      field: 'Objective',
      value: 'x'.repeat(2_001),
      version: 1,
      actor: 'assistant',
      taskId,
      evidenceRefs: [{ type: 'tool', ref: 'tool:x' }],
      createdAt: baseTime,
    }).ok).toBe(false);
  });

  it('projects proposals/accept/reject deterministically and only accepted entries become candidates', () => {
    const events = [
      proposalEvent('p1', 'Objective', 'v1'),
      acceptEvent('p1', 'Objective'),
      proposalEvent('p2', 'NextAction', 'Run tests'),
      rejectEvent('p2', 'NextAction'),
    ];
    const first = projectTaskLedgerWorkingContext(events);
    const second = projectTaskLedgerWorkingContext(events);
    expect(first).toEqual(second);
    expect(first.warnings).toEqual([]);
    expect(first.fields.Objective.current).toMatchObject({
      proposalId: 'p1',
      value: 'v1',
      version: 1,
      actor: 'assistant',
    });
    expect(first.fields.NextAction.rejected).toHaveLength(1);
    expect(first.fields.NextAction.rejected[0].rejectionReason).toBe('owner rejected');
    expect(first.promotionCandidates).toHaveLength(1);
    expect(first.promotionCandidates[0]).toMatchObject({
      schema: 'MemPromotionCandidate/v1',
      proposalId: 'p1',
      field: 'Objective',
    });
  });

  it('fails closed on duplicate accept and records the reason', () => {
    const events = [
      proposalEvent('p-dup', 'Objective', 'v1'),
      acceptEvent('p-dup', 'Objective'),
      acceptEvent('p-dup', 'Objective', '2026-06-16T10:06:00.000Z'),
    ];
    const projection = projectTaskLedgerWorkingContext(events);
    expect(projection.fields.Objective.history).toHaveLength(1);
    expect(projection.warnings).toContainEqual(expect.objectContaining({
      type: 'duplicate_accept',
      proposalId: 'p-dup',
    }));
  });

  it('never accepts expired proposals and keeps them queryable as expired', () => {
    const expiredAt = '2026-06-16T11:00:00.000Z';
    const result = createTaskLedgerWorkingContextProposal({
      proposalId: 'p-expired',
      field: 'Objective',
      value: 'expired value',
      version: 1,
      actor: 'assistant',
      taskId,
      evidenceRefs: [{ type: 'tool', ref: 'tool:x' }],
      ttl: { issuedAt: baseTime, expiresAt: '2026-06-16T10:10:00.000Z' },
      createdAt: baseTime,
    });
    if (!result.ok) throw new Error(result.reason);
    const proposal = toEvent(result.event, 'p-expired');
    const accept = acceptEvent('p-expired', 'Objective', expiredAt);
    const projection = projectTaskLedgerWorkingContext([proposal, accept], { asOf: expiredAt });
    expect(projection.fields.Objective.current).toBeUndefined();
    expect(projection.fields.Objective.expired).toHaveLength(1);
    expect(projection.promotionCandidates).toEqual([]);
    expect(projection.warnings).toContainEqual(expect.objectContaining({ type: 'expired_accept' }));
  });

  it('preserves concurrent cross-actor proposals as a conflict set', () => {
    const events = [
      proposalEvent('p-user', 'Constraints', ['A'], 'user'),
      proposalEvent('p-assistant', 'Constraints', ['B'], 'assistant', later),
    ];
    const projection = projectTaskLedgerWorkingContext(events);
    expect(projection.fields.Constraints.pending).toEqual([]);
    expect(projection.fields.Constraints.conflicts).toHaveLength(2);
    expect(projection.fields.Constraints.conflicts.map((item) => item.proposalId).sort())
      .toEqual(['p-assistant', 'p-user']);
  });

  it('merges only explicit copyFields and preserves parent/child conflicts', () => {
    const parent = projectTaskLedgerWorkingContext([
      proposalEvent('pp-objective', 'Objective', 'parent objective'),
      acceptEvent('pp-objective', 'Objective'),
      proposalEvent('pp-next', 'NextAction', 'parent next'),
      acceptEvent('pp-next', 'NextAction'),
      proposalEvent('pp-files', 'ActiveFiles', ['a.ts']),
      acceptEvent('pp-files', 'ActiveFiles'),
    ]);
    const child = projectTaskLedgerWorkingContext([
      proposalEvent('cp-objective', 'Objective', 'child objective'),
      acceptEvent('cp-objective', 'Objective'),
      proposalEvent('cp-next', 'NextAction', 'parent next'),
      acceptEvent('cp-next', 'NextAction'),
    ]);
    const merged = mergeTaskLedgerWorkingContext(parent, child, {
      copyFields: ['Objective', 'NextAction'],
      relation: 'handoff_from',
    });
    expect(merged.copiedFields).toEqual(['NextAction', 'Objective']);
    expect(Object.keys(merged.fields).sort()).toEqual(['NextAction', 'Objective']);
    expect(merged.fields.Objective?.current).toBeUndefined();
    expect(merged.fields.Objective?.conflicts).toHaveLength(1);
    expect(merged.fields.Objective?.conflicts[0].parent?.value).toBe('parent objective');
    expect(merged.fields.Objective?.conflicts[0].child?.value).toBe('child objective');
    expect(merged.fields.NextAction?.current?.value).toBe('parent next');
  });

  it('keeps the legacy snapshot projection side-effect free for Stage 3 events', () => {
    const legacy: TaskLedgerEvent = {
      id: 'legacy',
      workspaceId,
      type: 'node_created',
      actor: 'system',
      taskId,
      sessionId: null,
      idempotencyKey: null,
      createdAt: baseTime,
      payload: {
        node: {
          id: 'goal-1',
          title: 'Goal',
          kind: 'goal',
          status: 'doing',
          parentId: null,
          createdAt: baseTime,
          updatedAt: baseTime,
        },
      },
    };
    const stage3 = [
      proposalEvent('p-legacy', 'Objective', 'v1'),
      acceptEvent('p-legacy', 'Objective'),
    ];
    const withStage3 = projectTaskLedgerSnapshot(workspaceId, [legacy, ...stage3]);
    const withoutStage3 = projectTaskLedgerSnapshot(workspaceId, [legacy]);
    expect(withStage3.nodes).toEqual(withoutStage3.nodes);
    expect(withStage3.edges).toEqual(withoutStage3.edges);
    expect(withStage3.sessionLinks).toEqual(withoutStage3.sessionLinks);
  });

  it('fails closed on malformed decisions with queryable reasons', () => {
    const proposal = proposalEvent('p-negative', 'Objective', 'v');
    function decision(
      id: string,
      overrides: Partial<NonNullable<TaskLedgerEvent['payload']['workingContextDecision']>>,
      actor: TaskLedgerEvent['actor'] = 'user',
      type: TaskLedgerEvent['type'] = 'working_context_proposal_accepted',
    ): TaskLedgerEvent {
      return {
        id,
        workspaceId,
        type,
        actor,
        taskId,
        sessionId: null,
        idempotencyKey: null,
        createdAt: later,
        payload: {
          workingContextDecision: {
            proposalId: 'p-negative',
            field: 'Objective',
            version: 1,
            decision: 'accepted',
            policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
            ...overrides,
          },
        },
      };
    }
    const projection = projectTaskLedgerWorkingContext([
      proposal,
      decision('bad-policy', { policyDigest: 'not-a-digest' }),
      decision('missing-proposal', { proposalId: 'p-missing' }),
      decision('wrong-version', { version: 2 }),
      decision('illegal-actor', {}, 'assistant'),
      decision('type-mismatch', { decision: 'accepted' }, 'user', 'working_context_proposal_rejected'),
    ]);
    expect(projection.fields.Objective.current).toBeUndefined();
    expect(projection.warnings.map((warning) => warning.type)).toEqual(
      expect.arrayContaining([
        'invalid_event',
        'missing_proposal',
        'version_mismatch',
        'illegal_actor',
        'invalid_decision',
      ]),
    );
  });

  it('fails closed when a proposal event has an illegal actor', () => {
    const event: TaskLedgerEvent = {
      id: 'p-system-actor',
      workspaceId,
      type: 'working_context_proposed',
      actor: 'system',
      taskId,
      sessionId: null,
      idempotencyKey: null,
      createdAt: baseTime,
      payload: {
        workingContextProposal: {
          proposalId: 'p-system-actor',
          field: 'Objective',
          value: 'system proposal',
          version: 1,
          evidenceRefs: [{ type: 'tool', ref: 'tool:system' }],
          ttl: { issuedAt: baseTime, expiresAt: '2026-06-16T11:00:00.000Z' },
          sensitivity: 'workspace',
          trust: 'proposed',
        },
      },
    };
    const projection = projectTaskLedgerWorkingContext([event]);
    expect(projection.fields.Objective.pending).toEqual([]);
    expect(projection.fields.Objective.current).toBeUndefined();
    expect(projection.warnings).toContainEqual(expect.objectContaining({
      type: 'illegal_actor',
      eventId: 'p-system-actor',
    }));
  });

  it('exposes an empty deterministic snapshot', () => {
    expect(emptyTaskLedgerWorkingContextSnapshot()).toEqual(
      emptyTaskLedgerWorkingContextSnapshot(),
    );
  });
});
