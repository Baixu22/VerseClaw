// Stage 3 Electron-side Working Context adapter. It reuses the existing
// workspace Task Ledger JSONL appender and read path; it adds no table,
// snapshot file, daemon, or second store.
import type { TaskLedgerEventInput } from '../../shared/types/task-ledger';
import {
  projectTaskLedgerWorkingContext,
} from '../../shared/task-ledger-working-context';
import {
  appendTaskLedgerEvents,
  readTaskLedgerEvents,
} from './task-ledger-service';

export {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  emptyTaskLedgerWorkingContextSnapshot,
  mergeTaskLedgerWorkingContext,
  projectTaskLedgerWorkingContext,
  STAGE3_WORKING_CONTEXT_LIMITS,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
  STAGE3_WORKING_CONTEXT_RULE_ID,
} from '../../shared/task-ledger-working-context';

export async function appendTaskLedgerWorkingContextEvents(
  workspaceId: string | null | undefined,
  inputs: TaskLedgerEventInput[],
  batchIdempotencyKey?: string | null,
) {
  return appendTaskLedgerEvents(workspaceId, inputs, batchIdempotencyKey);
}

export async function readTaskLedgerWorkingContext(
  workspaceId: string | null | undefined,
  taskIds?: readonly string[],
) {
  const { events } = await readTaskLedgerEvents(workspaceId);
  const scope = taskIds ? new Set(taskIds) : null;
  return projectTaskLedgerWorkingContext(scope ? events.filter(event => event.taskId && scope.has(event.taskId)) : events);
}
