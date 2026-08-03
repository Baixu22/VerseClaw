// RC-06D Task Loop -> TaskFlow read-only projection. Migrates the Task Loop
// lifecycle (waiting, cancel, terminal state) to TaskFlow last. long_task_checkpoints
// retain checkpoint material only; replay never executes effects. After this package,
// TaskFlow/TaskRegistry are the only workflow lifecycle writers. This is a read-only
// projection behind a default-off flag; the legacy Task Loop controller remains
// authoritative until a writer cutover with proof.
import { TaskFlowCasStore, type FlowStatus } from '../tasks/task-flow-cas.js';

export const TASK_LOOP_PROJECTION_FLAG = 'rc06d.taskLoopProjection';
export const TASK_LOOP_PROJECTION_SCHEMA_VERSION = '1';

export type TaskLoopProjectionOptions = {
  enabled?: boolean;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
};

export type TaskLoopProjectionInput = {
  runId: string;
  sessionKey?: string;
  status: string;
  phase?: string;
  /** Wait semantics: the loop is blocked waiting on a user or manual review. */
  waiting?: boolean;
  checkpointRef?: string;
};

export type TaskLoopProjectionResult = {
  projected: boolean;
  flowId?: string;
  revision?: number;
  status?: FlowStatus;
  skippedReason?: 'flag-off' | 'unknown-status' | 'conflict';
};

const TASK_LOOP_STATUS_TO_FLOW: Record<string, FlowStatus> = {
  running: 'running',
  complete: 'succeeded',
  blocked: 'blocked',
  error: 'failed',
};

/**
 * Project a Task Loop status/phase transition into flow_runs via the CAS store.
 * long_task_checkpoints retain checkpoint material only; the projection never
 * executes effects.
 */
export function projectTaskLoopRun(
  input: TaskLoopProjectionInput,
  options: TaskLoopProjectionOptions = {},
): TaskLoopProjectionResult {
  if (options.enabled !== true) {
    return { projected: false, skippedReason: 'flag-off' };
  }
  const flowStatus = TASK_LOOP_STATUS_TO_FLOW[input.status];
  if (!flowStatus) {
    return { projected: false, skippedReason: 'unknown-status' };
  }
  const flowId = `taskloop:${input.runId}`;
  const store = new TaskFlowCasStore(options.database ?? {});
  const existing = store.getById(flowId);
  const expectedRevision = existing ? Number(existing.revision) || 0 : 0;
  // Waiting (blocked for user/manual review) maps to a waiting flow state so
  // resume/cancel semantics are preserved in the projection.
  const effectiveStatus: FlowStatus =
    input.waiting === true && flowStatus === 'blocked' ? 'waiting' : flowStatus;
  const waitJson = input.waiting === true ? JSON.stringify({ waitMode: 'manual_review', phase: input.phase }) : undefined;
  const result = store.casUpsert({
    flowId,
    expectedRevision,
    status: effectiveStatus,
    ownerKey: 'task-loop-controller',
    currentStep: input.phase,
    waitJson,
    stateJson: JSON.stringify({ runId: input.runId, sessionKey: input.sessionKey, checkpointRef: input.checkpointRef }),
  });
  if (!result.ok) {
    return { projected: false, skippedReason: 'conflict' };
  }
  return { projected: true, flowId, revision: result.revision, status: effectiveStatus };
}

/** Recover a Task Loop run's projected flow state after restart. */
export function recoverTaskLoopProjection(
  runId: string,
  options: TaskLoopProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; waiting?: boolean; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const store = new TaskFlowCasStore(options.database ?? {});
  const row = store.getById(`taskloop:${runId}`);
  if (!row) {
    return { recovered: false };
  }
  let waiting = false;
  if (row.wait_json) {
    try {
      waiting = (JSON.parse(row.wait_json) as { waitMode?: string }).waitMode === 'manual_review';
    } catch {
      waiting = false;
    }
  }
  return { flowId: row.flow_id, status: row.status as FlowStatus, waiting, recovered: true };
}
