import { describe, expect, it } from 'vitest';
import {
  createTaskLedgerReference,
  isTaskLedgerReference,
} from '@shared/types/task-ledger-reference';

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
