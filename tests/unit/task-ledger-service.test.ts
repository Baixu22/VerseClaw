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
