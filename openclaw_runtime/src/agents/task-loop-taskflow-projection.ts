// RC-06D Task Loop lifecycle on the TaskFlow owner. long_task_checkpoints keep
// checkpoint material only and replay never executes effects. The lifecycle
// status goes through the shared workflow lifecycle owner: projection mode is
// an observational copy with drift recorded; taskflow mode is the cutover,
// where the controller commits a status before it acts on it.
import type { FlowStatus } from '../tasks/task-flow-cas.js';
import {
  commitWorkflowLifecycle,
  readWorkflowLifecycle,
  type WorkflowLifecycleCommit,
  type WorkflowLifecycleOptions,
} from '../tasks/workflow-lifecycle-owner.js';

export const TASK_LOOP_PROJECTION_FLAG = 'rc06d.taskLoopProjection';
export const TASK_LOOP_PROJECTION_SCHEMA_VERSION = '1';

export type TaskLoopProjectionOptions = WorkflowLifecycleOptions & {
  enabled?: boolean;
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
  commit?: WorkflowLifecycleCommit;
};

const TASK_LOOP_STATUS_TO_FLOW: Record<string, FlowStatus> = {
  running: 'running',
  complete: 'succeeded',
  blocked: 'blocked',
  error: 'failed',
  // Cancel is an explicit terminal, never represented as blocked/waiting.
  cancelled: 'cancelled',
};

const FLOW_TO_TASK_LOOP_STATUS: Record<FlowStatus, string> = {
  queued: 'running',
  running: 'running',
  waiting: 'blocked',
  blocked: 'blocked',
  succeeded: 'complete',
  failed: 'error',
  cancelled: 'cancelled',
  lost: 'error',
};

export function taskLoopStatusFromFlowStatus(status: FlowStatus): string {
  return FLOW_TO_TASK_LOOP_STATUS[status];
}

export function taskLoopFlowStatus(input: Pick<TaskLoopProjectionInput, 'status' | 'waiting'>): FlowStatus | undefined {
  const flowStatus = TASK_LOOP_STATUS_TO_FLOW[input.status];
  // A loop blocked on a human decision is waiting, so resume stays legal.
  return input.waiting === true && flowStatus === 'blocked' ? 'waiting' : flowStatus;
}

/** Commit one Task Loop status to its TaskFlow lifecycle row. */
export function projectTaskLoopRun(
  input: TaskLoopProjectionInput,
  options: TaskLoopProjectionOptions = {},
): TaskLoopProjectionResult {
  if (options.enabled !== true) {
    return { projected: false, skippedReason: 'flag-off' };
  }
  const effectiveStatus = taskLoopFlowStatus(input);
  if (!effectiveStatus) {
    return { projected: false, skippedReason: 'unknown-status' };
  }
  const commit = commitWorkflowLifecycle({
    domain: 'task-loop',
    id: input.runId,
    status: effectiveStatus,
    currentStep: input.phase,
    stateJson: JSON.stringify({
      runId: input.runId,
      sessionKey: input.sessionKey,
      taskLoopStatus: input.status,
      waitMode: input.waiting === true ? 'manual_review' : 'none',
      checkpointRef: input.checkpointRef,
    }),
    options,
  });
  if (!commit.ok) {
    return { projected: false, skippedReason: 'conflict', commit };
  }
  return { projected: true, flowId: `task-loop:${input.runId}`, revision: commit.revision, status: effectiveStatus, commit };
}

/** Read a Task Loop's lifecycle back from TaskFlow. Pure read: never replays effects. */
export function recoverTaskLoopProjection(
  runId: string,
  options: TaskLoopProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; waiting?: boolean; checkpointRef?: string; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const row = readWorkflowLifecycle('task-loop', runId, options);
  if (!row) {
    return { recovered: false };
  }
  let state: { waitMode?: string; checkpointRef?: string } = {};
  try {
    state = row.state_json ? (JSON.parse(row.state_json) as typeof state) : {};
  } catch {
    state = {};
  }
  return {
    flowId: row.flow_id,
    status: row.status as FlowStatus,
    waiting: row.status === 'waiting' || state.waitMode === 'manual_review',
    checkpointRef: state.checkpointRef,
    recovered: true,
  };
}
