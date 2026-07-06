export type TaskLedgerReference = {
  direction: 'workboard-to-task-ledger';
  taskLedgerNodeId: string;
  workboardCardId?: string;
  source: 'workboard' | 'plugin' | 'runtime';
};

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createTaskLedgerReference(input: {
  taskLedgerNodeId: string;
  workboardCardId?: string | null;
  source?: TaskLedgerReference['source'];
}): TaskLedgerReference {
  const taskLedgerNodeId = input.taskLedgerNodeId.trim();
  if (!taskLedgerNodeId) {
    throw new Error('TaskLedgerReference requires a taskLedgerNodeId');
  }
  const workboardCardId = normalizeOptionalText(input.workboardCardId);
  return {
    direction: 'workboard-to-task-ledger',
    taskLedgerNodeId,
    ...(workboardCardId ? { workboardCardId } : {}),
    source: input.source ?? 'runtime',
  };
}

export function isTaskLedgerReference(value: unknown): value is TaskLedgerReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowedKeys = new Set(['direction', 'source', 'taskLedgerNodeId', 'workboardCardId']);
  if (keys.some((key) => !allowedKeys.has(key))) return false;
  return record.direction === 'workboard-to-task-ledger'
    && typeof record.taskLedgerNodeId === 'string'
    && record.taskLedgerNodeId.trim().length > 0
    && (record.workboardCardId === undefined || typeof record.workboardCardId === 'string')
    && (record.source === 'workboard' || record.source === 'plugin' || record.source === 'runtime');
}
