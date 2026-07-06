import type { TaskLedgerEventInput } from '@shared/types/task-ledger';

type PlanNodeLike = {
  id: string;
  title: string;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
};

export type PlanEditOperation =
  | { type: 'reorder_node'; nodeId: string; beforeNodeId: string | null }
  | { type: 'disable_node'; nodeId: string }
  | { type: 'enable_node'; nodeId: string }
  | { type: 'note_node'; nodeId: string; note: string };

export type PlanEditDraft = {
  baseProjectionId: string;
  operations: PlanEditOperation[];
  order: string[];
  disabledNodeIds: string[];
  notesByNodeId: Record<string, string>;
  nodesById: Record<string, PlanNodeLike>;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function moveBefore(order: string[], nodeId: string, beforeNodeId: string | null): string[] {
  const without = order.filter((id) => id !== nodeId);
  if (!beforeNodeId) return [...without, nodeId];
  const index = without.indexOf(beforeNodeId);
  if (index < 0) return [...without, nodeId];
  return [...without.slice(0, index), nodeId, ...without.slice(index)];
}

export function createPlanEditDraft(input: {
  baseProjectionId: string;
  nodes: PlanNodeLike[];
}): PlanEditDraft {
  return {
    baseProjectionId: input.baseProjectionId,
    operations: [],
    order: input.nodes.map((node) => node.id),
    disabledNodeIds: [],
    notesByNodeId: {},
    nodesById: Object.fromEntries(input.nodes.map((node) => [node.id, { ...node }])),
  };
}

export function applyPlanEditOperation(draft: PlanEditDraft, operation: PlanEditOperation): PlanEditDraft {
  if (!draft.nodesById[operation.nodeId]) return draft;
  if (operation.type === 'reorder_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      order: moveBefore(draft.order, operation.nodeId, operation.beforeNodeId),
    };
  }
  if (operation.type === 'disable_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      disabledNodeIds: unique([...draft.disabledNodeIds, operation.nodeId]),
    };
  }
  if (operation.type === 'enable_node') {
    return {
      ...draft,
      operations: [...draft.operations, operation],
      disabledNodeIds: draft.disabledNodeIds.filter((id) => id !== operation.nodeId),
    };
  }
  const note = operation.note.trim();
  return {
    ...draft,
    operations: [...draft.operations, { ...operation, note }],
    notesByNodeId: note
      ? { ...draft.notesByNodeId, [operation.nodeId]: note }
      : Object.fromEntries(Object.entries(draft.notesByNodeId).filter(([id]) => id !== operation.nodeId)),
  };
}

export function buildPlanEditLedgerEvents(input: {
  draft: PlanEditDraft;
  workspaceId?: string | null;
  sessionKey?: string | null;
  timestamp?: string;
  auditReason: string;
}): TaskLedgerEventInput[] {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const changedNodeIds = unique([
    ...input.draft.disabledNodeIds,
    ...Object.keys(input.draft.notesByNodeId),
    ...input.draft.operations.flatMap((operation) => (
      operation.type === 'reorder_node' ? [operation.nodeId] : []
    )),
  ]);

  return changedNodeIds
    .map((nodeId): TaskLedgerEventInput | null => {
      const node = input.draft.nodesById[nodeId];
      if (!node) return null;
      return {
        id: `${input.draft.baseProjectionId}:plan-edit:${nodeId}:${timestamp}`,
        type: 'node_updated',
        actor: 'user',
        taskId: nodeId,
        sessionId: input.sessionKey ?? null,
        idempotencyKey: `plan-edit:${input.draft.baseProjectionId}:${timestamp}`,
        createdAt: timestamp,
        payload: {
          patch: {
            metadata: {
              ...(node.metadata ?? {}),
              readonlyProjection: true,
              projectionEdit: {
                baseProjectionId: input.draft.baseProjectionId,
                disabled: input.draft.disabledNodeIds.includes(nodeId),
                order: input.draft.order,
                note: input.draft.notesByNodeId[nodeId],
                operations: input.draft.operations,
                auditReason: input.auditReason,
                workspaceId: input.workspaceId ?? null,
              },
            },
          },
        },
      };
    })
    .filter((event): event is TaskLedgerEventInput => Boolean(event));
}
