import { describe, expect, it } from 'vitest';
import type { TaskLedgerEvent } from '../../shared/types/task-ledger';
import {
  parseTaskLedgerEventLog,
  projectTaskLedgerSnapshot,
} from '../../electron/services/task-ledger-service';

const workspaceId = 'workspace-test';
const baseTime = '2026-06-16T10:00:00.000Z';

function event(partial: Partial<TaskLedgerEvent> & Pick<TaskLedgerEvent, 'type' | 'payload'>): TaskLedgerEvent {
  return {
    id: partial.id ?? `event-${Math.random()}`,
    workspaceId,
    type: partial.type,
    actor: partial.actor ?? 'assistant',
    taskId: partial.taskId ?? partial.payload.nodeId ?? partial.payload.node?.id ?? null,
    sessionId: partial.sessionId ?? null,
    idempotencyKey: partial.idempotencyKey ?? null,
    payload: partial.payload,
    createdAt: partial.createdAt ?? baseTime,
  };
}

describe('task ledger service', () => {
  it('projects nodes, dependencies, review state, decisions, and session links', () => {
    const events: TaskLedgerEvent[] = [
      event({
        id: 'create-goal',
        type: 'node_created',
        payload: {
          node: {
            id: 'goal-1',
            title: 'Ship task ledger',
            kind: 'goal',
            status: 'doing',
            parentId: null,
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'create-task',
        type: 'node_created',
        payload: {
          node: {
            id: 'task-1',
            title: 'Add projection tests',
            kind: 'task',
            status: 'todo',
            parentId: 'goal-1',
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'dependency',
        type: 'dependency_added',
        payload: {
          edge: {
            id: 'edge-1',
            from: 'task-1',
            to: 'goal-1',
            type: 'depends_on',
            createdAt: baseTime,
          },
        },
      }),
      event({
        id: 'review',
        type: 'review_requested',
        taskId: 'task-1',
        payload: { nodeId: 'task-1', reviewReason: 'Needs user confirmation' },
      }),
      event({
        id: 'decision',
        type: 'decision_recorded',
        payload: {
          node: {
            id: 'decision-1',
            title: 'Use append-only JSONL',
            kind: 'decision',
            status: 'done',
            parentId: 'goal-1',
            createdAt: baseTime,
            updatedAt: '2026-06-16T10:05:00.000Z',
          },
        },
      }),
      event({
        id: 'session',
        type: 'session_linked',
        sessionId: 'agent:main:main',
        payload: {
          sessionLink: {
            id: 'link-1',
            nodeId: 'task-1',
            sessionKey: 'agent:main:main',
            relation: 'forked_from',
            sourceSessionKey: 'agent:main:parent',
            summary: 'Implementation session',
            createdAt: baseTime,
          },
        },
      }),
    ];

    const snapshot = projectTaskLedgerSnapshot(workspaceId, events);

    expect(snapshot.currentGoalId).toBe('goal-1');
    expect(snapshot.rootNodeIds).toEqual(['goal-1']);
    expect(snapshot.reviewNodeIds).toContain('task-1');
    expect(snapshot.activeNodeIds).toEqual(['goal-1']);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.recentDecisions.map((node) => node.id)).toEqual(['decision-1']);
    expect(snapshot.sessionLinks).toHaveLength(1);
    expect(snapshot.sessionLinks[0]).toMatchObject({
      relation: 'forked_from',
      sourceSessionKey: 'agent:main:parent',
    });
  });

  it('removes deleted nodes and related edges from the snapshot', () => {
    const events: TaskLedgerEvent[] = [
      event({
        id: 'create-a',
        type: 'node_created',
        payload: {
          node: { id: 'a', title: 'A', kind: 'task', status: 'todo', createdAt: baseTime, updatedAt: baseTime },
        },
      }),
      event({
        id: 'create-b',
        type: 'node_created',
        payload: {
          node: { id: 'b', title: 'B', kind: 'task', status: 'todo', createdAt: baseTime, updatedAt: baseTime },
        },
      }),
      event({
        id: 'edge',
        type: 'edge_added',
        payload: { edge: { id: 'edge', from: 'a', to: 'b', type: 'blocks', createdAt: baseTime } },
      }),
      event({ id: 'delete-a', type: 'node_deleted', taskId: 'a', payload: { nodeId: 'a' } }),
    ];

    const snapshot = projectTaskLedgerSnapshot(workspaceId, events);

    expect(snapshot.nodes.map((node) => node.id)).toEqual(['b']);
    expect(snapshot.edges).toEqual([]);
  });

  it('preserves long conversation control metadata and review tags without auto-clearing review state', () => {
    const events: TaskLedgerEvent[] = [
      event({
        id: 'create-review',
        type: 'node_created',
        payload: {
          node: {
            id: 'review-1',
            title: 'Review missing validation',
            kind: 'review',
            status: 'review',
            tags: ['mission-control', 'validation-missing', 'evidence-gap'],
            metadata: {
              longConversationControl: {
                controlSignals: [{ kind: 'validation_missing', severity: 'blocking', message: 'tests not run' }],
                validationState: { status: 'missing', checks: ['unit tests'], evidenceRefs: [] },
              },
            },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'request-review',
        type: 'review_requested',
        taskId: 'review-1',
        payload: { nodeId: 'review-1', reviewReason: 'Evidence gap remains open' },
      }),
    ];

    const snapshot = projectTaskLedgerSnapshot(workspaceId, events);
    const review = snapshot.nodes.find((node) => node.id === 'review-1');

    expect(review).toMatchObject({
      status: 'review',
      tags: ['mission-control', 'validation-missing', 'evidence-gap'],
      metadata: {
        reviewReason: 'Evidence gap remains open',
        longConversationControl: {
          controlSignals: [{ kind: 'validation_missing', severity: 'blocking', message: 'tests not run' }],
          validationState: { status: 'missing', checks: ['unit tests'], evidenceRefs: [] },
        },
      },
    });
    expect(snapshot.reviewNodeIds).toContain('review-1');
  });

  it('projects long-task root children for checkpoints decisions deviations evidence and review', () => {
    const events: TaskLedgerEvent[] = [
      event({
        id: 'root',
        type: 'node_created',
        payload: {
          node: {
            id: 'tlroot_1',
            title: 'Ship /loop persistence',
            kind: 'goal',
            status: 'doing',
            parentId: null,
            tags: ['long-task', 'task_loop'],
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'checkpoint',
        type: 'node_created',
        taskId: 'check-1',
        payload: {
          node: {
            id: 'check-1',
            title: 'Checkpoint: guide',
            kind: 'check',
            status: 'doing',
            parentId: 'tlroot_1',
            tags: ['long-task', 'checkpoint'],
            evidenceRefs: [{ type: 'other', ref: 'tlroot_1', label: 'Task Ledger root' }],
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'decision',
        type: 'decision_recorded',
        taskId: 'decision-1',
        payload: {
          decision: 'Restart from revised goal',
          node: {
            id: 'decision-1',
            title: 'Restart from revised goal',
            kind: 'decision',
            status: 'done',
            parentId: 'tlroot_1',
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'deviation',
        type: 'deviation_logged',
        taskId: 'deviation-1',
        payload: {
          deviation: 'User revised the goal',
          node: {
            id: 'deviation-1',
            title: 'User revised the goal',
            kind: 'deviation',
            status: 'review',
            parentId: 'tlroot_1',
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'evidence',
        type: 'node_created',
        taskId: 'evidence-1',
        payload: {
          node: {
            id: 'evidence-1',
            title: 'session evidence',
            kind: 'check',
            status: 'done',
            parentId: 'tlroot_1',
            tags: ['long-task', 'evidence'],
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
      event({
        id: 'review-node',
        type: 'node_created',
        taskId: 'review-1',
        payload: {
          node: {
            id: 'review-1',
            title: 'manual review needed',
            kind: 'review',
            status: 'review',
            parentId: 'tlroot_1',
            metadata: { taskLedgerRootId: 'tlroot_1' },
            createdAt: baseTime,
            updatedAt: baseTime,
          },
        },
      }),
    ];

    const snapshot = projectTaskLedgerSnapshot(workspaceId, events);

    expect(snapshot.rootNodeIds).toEqual(['tlroot_1']);
    expect(snapshot.nodes.filter((node) => node.parentId === 'tlroot_1').map((node) => node.kind))
      .toEqual(['check', 'decision', 'deviation', 'check', 'review']);
    expect(snapshot.nodes.filter((node) => node.parentId === 'tlroot_1'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ metadata: expect.objectContaining({ taskLedgerRootId: 'tlroot_1' }) }),
      ]));
    expect(snapshot.reviewNodeIds).toEqual(expect.arrayContaining(['deviation-1', 'review-1']));
  });

  it('keeps valid JSONL events and reports damaged lines', () => {
    const valid = event({
      id: 'create',
      type: 'node_created',
      payload: {
        node: { id: 'node', title: 'Node', kind: 'task', status: 'todo', createdAt: baseTime, updatedAt: baseTime },
      },
    });
    const parsed = parseTaskLedgerEventLog(`${JSON.stringify(valid)}\n{bad json}\n{}\n`);

    expect(parsed.events.map((item) => item.id)).toEqual(['create']);
    expect(parsed.warnings.map((warning) => warning.type)).toEqual(['invalid_jsonl', 'invalid_event']);
  });
});
