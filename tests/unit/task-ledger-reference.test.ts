import { describe, expect, it } from 'vitest';
import {
  createTaskLedgerReference,
  isTaskLedgerReference,
  normalizeScopedTaskReference,
  normalizeTaskForestExecutionAnchor,
} from '@shared/types/task-ledger-reference';
import { resolveProjectIdForWorkspace, type AutonomySessionScope, type SessionKey, type WorkspaceId } from '@shared/types/identity-scope';

describe('TaskLedgerReference contract', () => {
  it('creates a one-way Workboard to Task Ledger reference', () => {
    const reference = createTaskLedgerReference({
      taskLedgerNodeId: ' ledger-node-1 ',
      workboardCardId: ' card-1 ',
      source: 'workboard',
    });

    expect(reference).toEqual({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      workboardCardId: 'card-1',
      source: 'workboard',
    });
    expect(reference).not.toHaveProperty('sync');
    expect(reference).not.toHaveProperty('taskLedgerMirror');
  });

  it('rejects empty Task Ledger node ids', () => {
    expect(() => createTaskLedgerReference({ taskLedgerNodeId: '   ' }))
      .toThrow(/taskLedgerNodeId/);
  });

  it('recognizes only the canonical one-way shape', () => {
    expect(isTaskLedgerReference({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
    })).toBe(true);
    expect(isTaskLedgerReference({
      direction: 'task-ledger-to-workboard',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
    })).toBe(false);
    expect(isTaskLedgerReference({
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: 'ledger-node-1',
      source: 'runtime',
      sync: true,
    })).toBe(false);
  });
});

describe('Task Forest execution anchor contract', () => {
  const scope: AutonomySessionScope = {
    workspaceId: 'workspace-A' as WorkspaceId,
    projectId: resolveProjectIdForWorkspace('workspace-A' as WorkspaceId),
    sessionKey: 'session-A' as SessionKey,
    sessionGeneration: 'generation-A',
  };
  const anchor = {
    owner: 'task-ledger', taskNodeId: ' ledger-A ', scope,
    externalRef: { owner: 'task-forest', taskNodeId: 'TF-0670', scope, direction: 'execution-to-task-forest' },
  };

  it('preserves a one-way pointer without copying completion status or rewriting ID bytes', () => {
    expect(normalizeTaskForestExecutionAnchor(anchor, scope)).toEqual(anchor);
    expect(normalizeScopedTaskReference({ owner: 'task-forest', taskNodeId: 'TF-0670', scope }, scope)).toEqual({ owner: 'task-forest', taskNodeId: 'TF-0670', scope });
    expect(anchor).not.toHaveProperty('status');
    expect(anchor.externalRef).not.toHaveProperty('completedAt');
  });

  it.each([
    { owner: 'task-ledger', taskId: 'bare', scope },
    { owner: 'task-forest', taskNodeId: 'TF-0670', scope, status: 'done' },
    { owner: 'runtime', taskNodeId: 'runtime-A', scope },
    { taskNodeId: 'ledger-A', scope },
    { owner: 'task-ledger', taskNodeId: '', scope },
    { owner: 'task-ledger', taskNodeId: 'ledger-A', scope: { ...scope, workspaceId: 'other' } },
    { owner: 'task-ledger', taskNodeId: 'ledger-A', scope: { ...scope, sessionGeneration: 'old' } },
  ])('rejects an ambiguous, stale or completing task reference: %j', (input) => {
    expect(() => normalizeScopedTaskReference(input, scope)).toThrow(TypeError);
  });

  it.each([
    { ...anchor, status: 'done' },
    { ...anchor, progress: 100 },
    { ...anchor, owner: 'task-forest' },
    { ...anchor, externalRef: { ...anchor.externalRef, direction: 'task-forest-to-execution' } },
    { ...anchor, externalRef: { ...anchor.externalRef, owner: 'task-ledger' } },
    { ...anchor, externalRef: { ...anchor.externalRef, completedAt: '2026-11-02' } },
    { ...anchor, externalRef: { ...anchor.externalRef, scope: { ...scope, projectId: 'other' } } },
  ])('rejects reverse authority or mirrored completion: %j', (input) => {
    expect(() => normalizeTaskForestExecutionAnchor(input, scope)).toThrow(TypeError);
  });
});
