import { describe, expect, it } from 'vitest';
import {
  applyPlanEditOperation,
  buildPlanEditLedgerEvents,
  createPlanEditDraft,
} from '@/lib/orchestration-plan-edit-draft';

const timestamp = '2026-07-06T10:00:00.000Z';

const nodes = [
  { id: 'goal-1', title: 'Plan: ship feature', parentId: null, metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
  { id: 'task-a', title: 'planner: plan', parentId: 'goal-1', metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
  { id: 'task-b', title: 'tester: test', parentId: 'goal-1', metadata: { readonlyProjection: true, source: 'orchestrator.plan' } },
];

describe('orchestration plan edit draft', () => {
  it('applies reorder, disable, and note operations without editing the source projection', () => {
    const draft = createPlanEditDraft({ baseProjectionId: 'goal-1', nodes });
    const reordered = applyPlanEditOperation(draft, { type: 'reorder_node', nodeId: 'task-b', beforeNodeId: 'task-a' });
    const disabled = applyPlanEditOperation(reordered, { type: 'disable_node', nodeId: 'task-a' });
    const noted = applyPlanEditOperation(disabled, { type: 'note_node', nodeId: 'task-b', note: 'Run smoke first' });

    expect(noted.order).toEqual(['goal-1', 'task-b', 'task-a']);
    expect(noted.disabledNodeIds).toEqual(['task-a']);
    expect(noted.notesByNodeId).toEqual({ 'task-b': 'Run smoke first' });
    expect(nodes[1].metadata).toEqual({ readonlyProjection: true, source: 'orchestrator.plan' });
  });

  it('builds Task Ledger events with projectionEdit metadata', () => {
    const draft = applyPlanEditOperation(
      createPlanEditDraft({ baseProjectionId: 'goal-1', nodes }),
      { type: 'disable_node', nodeId: 'task-a' },
    );
    const events = buildPlanEditLedgerEvents({
      draft,
      workspaceId: 'workspace-1',
      sessionKey: 'agent:main:main',
      timestamp,
      auditReason: 'User disabled planner slice',
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node_updated',
        taskId: 'task-a',
        payload: expect.objectContaining({
          patch: expect.objectContaining({
            metadata: expect.objectContaining({
              readonlyProjection: true,
              projectionEdit: expect.objectContaining({
                baseProjectionId: 'goal-1',
                operations: [expect.objectContaining({ type: 'disable_node', nodeId: 'task-a' })],
                auditReason: 'User disabled planner slice',
              }),
            }),
          }),
        }),
      }),
    ]));
  });
});
