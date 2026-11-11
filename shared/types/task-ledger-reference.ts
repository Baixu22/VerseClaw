import {
  normalizeAutonomySessionScope,
  type AutonomySessionScope,
  type TaskId,
} from './identity-scope.js';

/** New autonomy references carry the existing owner rather than a bare taskId. */
export type ScopedTaskReference = { scope: AutonomySessionScope } & (
  | { owner: 'task-ledger'; taskNodeId: TaskId }
  | { owner: 'task-forest'; taskNodeId: string }
);

export type TaskForestExecutionAnchor = {
  owner: 'task-ledger';
  taskNodeId: TaskId;
  scope: AutonomySessionScope;
  externalRef: ScopedTaskReference & {
    owner: 'task-forest';
    direction: 'execution-to-task-forest';
  };
};

function taskReferenceRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Task reference requires an object');
  }
  const input = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Task reference requires a plain object');
  }
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new TypeError('Task reference forbids bare taskId, mixed owner or completion fields');
  }
  return input;
}

export function normalizeScopedTaskReference(
  value: unknown,
  ownerScope: AutonomySessionScope | null,
): ScopedTaskReference {
  const input = taskReferenceRecord(value, ['owner', 'taskNodeId', 'scope']);
  if (input.owner !== 'task-ledger' && input.owner !== 'task-forest') {
    throw new TypeError('Task reference requires an explicit completion owner');
  }
  if (typeof input.taskNodeId !== 'string' || !input.taskNodeId.trim()) {
    throw new TypeError('Task reference requires taskNodeId');
  }
  return {
    owner: input.owner,
    taskNodeId: input.taskNodeId,
    scope: normalizeAutonomySessionScope(input.scope, ownerScope),
  } as ScopedTaskReference;
}

/** This pointer owns neither Forest task status nor a second completion decision. */
export function normalizeTaskForestExecutionAnchor(
  value: unknown,
  ownerScope: AutonomySessionScope | null,
): TaskForestExecutionAnchor {
  const input = taskReferenceRecord(value, ['owner', 'taskNodeId', 'scope', 'externalRef']);
  const anchor = normalizeScopedTaskReference({ owner: input.owner, taskNodeId: input.taskNodeId, scope: input.scope }, ownerScope);
  const external = taskReferenceRecord(input.externalRef, ['owner', 'taskNodeId', 'scope', 'direction']);
  if (anchor.owner !== 'task-ledger' || external.direction !== 'execution-to-task-forest') {
    throw new TypeError('Task Forest execution anchor must point one way from Ledger execution');
  }
  const reference = normalizeScopedTaskReference({ owner: external.owner, taskNodeId: external.taskNodeId, scope: external.scope }, anchor.scope);
  if (reference.owner !== 'task-forest') throw new TypeError('External completion authority must remain Task Forest');
  return { ...anchor, externalRef: { ...reference, direction: external.direction } };
}

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

/**
 * TF-0449: explicit inheritance semantics for the one-way Workboard -> Task
 * Ledger link.
 *
 * TF-0371 froze the *direction* (workboard-to-task-ledger, never mirrored back)
 * but never said what travels across it. Without this table every caller had to
 * guess, and two callers could guess differently.
 *
 * The table is deliberately narrow. It governs only reference fields that
 * describe *task facts*; it never grants write authority and never implies the
 * Workboard and the Ledger are two-way synced. `product-semantics.ts` already
 * forbids mirroring, so inheritance here is one-way projection only.
 */
export type TaskLedgerReferenceInheritedField =
  | 'priority'
  | 'tags'
  | 'labels'
  | 'owner';

/**
 * Fields that deliberately do NOT cross the reference.
 *
 * - `status`: the Ledger owns task status. A Workboard scheduling state must
 *   never overwrite it (product-semantics: Workboard references the Ledger
 *   one-way).
 * - `projectId`: project scope belongs to the Ledger node itself; a
 *   scheduling reference must not re-home a task.
 * - `assignee`/actor: responsibility is a Ledger fact, not a scheduling hint.
 */
export type TaskLedgerReferenceNonInheritedField =
  | 'status'
  | 'projectId'
  | 'assignee'
  | 'team'
  | 'cycle';

/** The full, closed inheritance decision table. */
export const TASK_LEDGER_REFERENCE_INHERITANCE = {
  // Explicitly covers the Linear-style property set: team / priority /
  // project / cycle / labels. `tags` and `labels` are treated as the same
  // task-fact class here; the Ledger owns both.
  inherits: ['priority', 'tags', 'labels', 'owner'],
  doesNotInherit: ['status', 'projectId', 'assignee', 'team', 'cycle'],
} as const satisfies {
  inherits: readonly TaskLedgerReferenceInheritedField[];
  doesNotInherit: readonly TaskLedgerReferenceNonInheritedField[];
};

export function isTaskLedgerReferenceInheritedField(
  field: string,
): field is TaskLedgerReferenceInheritedField {
  return (TASK_LEDGER_REFERENCE_INHERITANCE.inherits as readonly string[]).includes(field);
}

export function isTaskLedgerReferenceNonInheritedField(
  field: string,
): field is TaskLedgerReferenceNonInheritedField {
  return (TASK_LEDGER_REFERENCE_INHERITANCE.doesNotInherit as readonly string[]).includes(field);
}

/**
 * Apply the table to a candidate patch coming from a Workboard reference.
 *
 * Returns only the fields that are allowed to cross. Non-inherited fields are
 * dropped rather than rejected, because callers legitimately carry a whole
 * scheduling card; this keeps the boundary declarative instead of throwing at
 * runtime on a shape the type never promised to be safe.
 */
export function applyTaskLedgerReferenceInheritance<T extends Record<string, unknown>>(
  candidate: T,
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(candidate)) {
    if (isTaskLedgerReferenceInheritedField(field)) {
      result[field] = value;
    }
  }
  return result as Partial<T>;
}
