import { describe, expect, it } from 'vitest';
import {
  buildOrchestrationPlanLedgerEvents,
  isReadOnlyTaskLedgerProjection,
} from '@/lib/task-ledger-plan-projection';
import type { TaskLedgerNode } from '../../shared/types/task-ledger';

const timestamp = '2026-07-05T10:00:00.000Z';

describe('orchestration plan Task Ledger projection', () => {
  it('builds read-only goal, task, verifier, and edge events from an orchestration plan', () => {
    const events = buildOrchestrationPlanLedgerEvents({
      task: 'Stabilize provider-free smoke tests',
      plan: {
        mode: 'lead-workers',
        leadRole: 'planner',
        verifierRole: 'reviewer',
        workers: [
          { roleName: 'planner', task: 'Plan the stabilization work' },
          { roleName: 'tester', task: 'Verify the smoke tests' },
        ],
        reasons: ['explicit-workers'],
        taskGraph: {
          graphRunId: 'explicit-workers',
          status: 'planned' as never,
          nodes: [
            {
              taskNodeId: 'planner-1',
              roleName: 'planner',
              task: 'Plan the stabilization work',
              phase: 'planning',
              dependsOn: [],
              scope: 'Plan the stabilization work',
              requiredCapabilities: ['planning'],
              status: 'ready',
            } as never,
            {
              taskNodeId: 'tester-1',
              roleName: 'tester',
              task: 'Verify the smoke tests',
              phase: 'verification',
              dependsOn: ['planner-1'],
              scope: 'Verify the smoke tests',
              requiredCapabilities: ['test'],
              status: 'planned',
            } as never,
            {
              taskNodeId: 'reviewer-1',
              roleName: 'reviewer',
              task: 'Verify completion as reviewer',
              phase: 'verifier',
              dependsOn: ['planner-1', 'tester-1'],
              scope: 'Verify worker evidence',
              requiredCapabilities: ['verification'],
              status: 'planned' as never,
              isVerifier: true,
            } as never,
          ],
          edges: [
            { from: 'planner-1', to: 'tester-1', type: 'dependency' },
            { from: 'planner-1', to: 'reviewer-1', type: 'verification' },
            { from: 'tester-1', to: 'reviewer-1', type: 'verification' },
          ],
        },
        executionWaves: [{ wave: 1, taskNodeIds: ['planner-1'], roles: ['planner'] }],
        routeDiagnostics: {
          difficulty: 'moderate',
          confidence: 0.8,
          reasons: ['difficulty:moderate'],
          selectedRoles: ['planner', 'tester', 'reviewer'],
          rejectedRoles: [],
          requiredCapabilities: ['planning', 'test'],
          capabilityGaps: [],
        },
      },
      sessionKey: 'agent:main:abc',
      timestamp,
    });

    const createdNodes = events
      .filter((event) => event.type === 'node_created')
      .map((event) => event.payload.node);
    expect(createdNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:goal',
        title: 'Plan: Stabilize provider-free smoke tests',
        kind: 'goal',
        status: 'doing',
        parentId: null,
      }),
      expect.objectContaining({
        id: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:planner-1',
        title: 'planner: Plan the stabilization work',
        kind: 'task',
        parentId: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:goal',
        status: 'todo',
      }),
      expect.objectContaining({
        id: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:reviewer-1',
        title: 'reviewer: Verify completion as reviewer',
        kind: 'review',
        status: 'review',
      }),
    ]));
    expect(createdNodes.every((node) => node?.metadata?.readonlyProjection === true)).toBe(true);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'dependency_added',
        payload: {
          edge: expect.objectContaining({
            from: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:planner-1',
            to: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:tester-1',
            type: 'depends_on',
          }),
        },
      }),
      expect.objectContaining({
        type: 'edge_added',
        payload: {
          edge: expect.objectContaining({
            from: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:planner-1',
            to: 'orch-plan:agent-main-abc:stabilize-provider-free-smoke-tests:reviewer-1',
            type: 'needs_review',
          }),
        },
      }),
      expect.objectContaining({
        type: 'session_linked',
        sessionId: 'agent:main:abc',
      }),
    ]));
    expect(events.every((event) => event.createdAt === timestamp)).toBe(true);
    expect(events.every((event) => event.idempotencyKey?.startsWith('orchestration-plan:agent:main:abc:Stabilize provider-free smoke tests')))
      .toBe(true);
  });

  it('recognizes read-only projection metadata without treating ordinary nodes as read-only', () => {
    const projected = {
      id: 'node-1',
      title: 'Projected',
      kind: 'task',
      status: 'todo',
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: { readonlyProjection: true, source: 'orchestrator.plan' },
    } satisfies TaskLedgerNode;

    const ordinary = {
      ...projected,
      id: 'node-2',
      metadata: { source: 'manual' },
    } satisfies TaskLedgerNode;

    expect(isReadOnlyTaskLedgerProjection(projected)).toBe(true);
    expect(isReadOnlyTaskLedgerProjection(ordinary)).toBe(false);
  });
});
