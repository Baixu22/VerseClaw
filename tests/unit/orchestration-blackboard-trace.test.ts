import { describe, expect, it } from 'vitest';
import type { BlackboardTraceEvent } from '../../openclaw_runtime/src/agents/orchestration-blackboard-trace';
import { replayBlackboardTrace } from '../../openclaw_runtime/src/agents/orchestration-blackboard-trace';

const knownRoles = ['planner', 'implementer', 'tester', 'reviewer'];

const appendClaimA: BlackboardTraceEvent = {
  sequence: 2,
  kind: 'append',
  occurredAt: '2026-07-07T05:01:00.000Z',
  entry: {
    id: 'bb_claim_a',
    type: 'claim',
    authorRole: 'planner',
    taskId: 'task-trace-a',
    content: { subject: 'runtime', conclusion: 'Windows Node' },
    confidence: 0.7,
    evidenceRefs: ['trace:a'],
    visibility: 'run',
    status: 'open',
    trustBoundary: 'role-output',
  },
};

const appendClaimB: BlackboardTraceEvent = {
  sequence: 1,
  kind: 'append',
  occurredAt: '2026-07-07T05:00:00.000Z',
  entry: {
    id: 'bb_claim_b',
    type: 'claim',
    authorRole: 'tester',
    taskId: 'task-trace-b',
    content: { subject: 'runtime', conclusion: 'WSL Node' },
    confidence: 0.75,
    evidenceRefs: ['trace:b'],
    visibility: 'run',
    status: 'open',
    trustBoundary: 'role-output',
  },
};

describe('orchestration blackboard trace replay', () => {
  it('reconstructs append events in deterministic sequence order', () => {
    const replayed = replayBlackboardTrace([appendClaimA, appendClaimB], knownRoles);

    expect(replayed.issues).toEqual([]);
    expect(replayed.state.entries.map((entry) => entry.id)).toEqual(['bb_claim_b', 'bb_claim_a']);
    expect(replayed.state.entries.map((entry) => entry.createdAt)).toEqual([
      '2026-07-07T05:00:00.000Z',
      '2026-07-07T05:01:00.000Z',
    ]);
  });

  it('reconstructs updates while preserving prior versions', () => {
    const replayed = replayBlackboardTrace([
      appendClaimA,
      {
        sequence: 3,
        kind: 'update',
        occurredAt: '2026-07-07T05:02:00.000Z',
        entryId: 'bb_claim_a',
        patch: {
          content: { subject: 'runtime', conclusion: 'Windows Node after verification' },
          confidence: 0.9,
          evidenceRefs: ['trace:a', 'trace:verified'],
        },
      },
    ], knownRoles);

    expect(replayed.issues).toEqual([]);
    expect(replayed.state.entries).toHaveLength(2);
    expect(replayed.state.entries.map((entry) => `${entry.id}@${entry.version}:${entry.status}`)).toEqual([
      'bb_claim_a@1:superseded',
      'bb_claim_a@2:open',
    ]);
  });

  it('reconstructs conflict events with references to both claims', () => {
    const replayed = replayBlackboardTrace([
      appendClaimB,
      appendClaimA,
      {
        sequence: 3,
        kind: 'conflict',
        occurredAt: '2026-07-07T05:02:00.000Z',
      },
    ], knownRoles);

    const conflict = replayed.state.entries.find((entry) => entry.type === 'conflict');
    expect(replayed.issues).toEqual([]);
    expect(conflict?.conflictsWith).toEqual(['bb_claim_b', 'bb_claim_a']);
  });

  it('reports invalid replay events without mutating successful history', () => {
    const replayed = replayBlackboardTrace([
      appendClaimA,
      {
        sequence: 4,
        kind: 'append',
        occurredAt: '2026-07-07T05:03:00.000Z',
        entry: {
          id: 'bb_invalid',
          type: 'fact',
          authorRole: 'ghost',
          taskId: 'task-invalid',
          content: { text: 'Invalid role.' },
          confidence: 0.4,
          evidenceRefs: ['trace:invalid'],
          visibility: 'run',
          status: 'open',
          trustBoundary: 'role-output',
        },
      },
    ], knownRoles);

    expect(replayed.state.entries.map((entry) => entry.id)).toEqual(['bb_claim_a']);
    expect(replayed.issues.map((issue) => issue.path)).toContain('events.4.authorRole');
  });
});
