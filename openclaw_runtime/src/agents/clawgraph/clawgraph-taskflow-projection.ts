// RC-06B ClawGraph lifecycle on the TaskFlow owner. Event projection
// (projection mode) and status commits (taskflow mode, the cutover) both go
// through the shared workflow lifecycle owner, so every rejected write is
// recorded as drift instead of being dropped.
import type { ClawGraphRunEvent, ClawGraphRunStatus } from './types.js';
import type { FlowStatus } from '../../tasks/task-flow-cas.js';
import {
  commitWorkflowLifecycle,
  readWorkflowLifecycle,
  settleOrphanedWorkflowLifecycles,
  type WorkflowLifecycleOptions,
} from '../../tasks/workflow-lifecycle-owner.js';

export const CLAWGRAPH_PROJECTION_FLAG = 'rc06b.clawgraphProjection';
export const CLAWGRAPH_PROJECTION_SCHEMA_VERSION = '1';

export type ClawgraphProjectionOptions = WorkflowLifecycleOptions & {
  enabled?: boolean;
  /** The run's own status after the event. When given it decides the flow
   *  status, so a terminal event reports what the run actually became
   *  (run_blocked is emitted for both blocked and failed runs). */
  runStatus?: ClawGraphRunStatus;
};

export type ClawgraphProjectionResult = {
  projected: boolean;
  flowId?: string;
  revision?: number;
  status?: FlowStatus;
  skippedReason?: 'flag-off' | 'unknown-event' | 'revision-conflict' | 'illegal-transition' | 'error';
};

const EVENT_TO_FLOW_STATUS: Record<string, FlowStatus> = {
  run_started: 'running',
  node_started: 'running',
  node_ready: 'running',
  node_handoff: 'running',
  node_audit: 'running',
  node_done: 'running',
  // A failed node does not end the run: ClawGraph may retry it; the run's own
  // terminal event carries the terminal status.
  node_failed: 'running',
  review_requested: 'blocked',
  review_resolved: 'running',
  run_completed: 'succeeded',
  run_blocked: 'blocked',
  run_aborted: 'cancelled',
};

const RUN_STATUS_TO_FLOW_STATUS: Record<ClawGraphRunStatus, FlowStatus> = {
  queued: 'queued',
  running: 'running',
  review: 'blocked',
  blocked: 'blocked',
  complete: 'succeeded',
  failed: 'failed',
  aborted: 'cancelled',
};

const FLOW_STATUS_TO_RUN_STATUS: Record<FlowStatus, ClawGraphRunStatus> = {
  queued: 'queued',
  running: 'running',
  waiting: 'running',
  blocked: 'blocked',
  succeeded: 'complete',
  failed: 'failed',
  cancelled: 'aborted',
  lost: 'failed',
};

export function clawgraphRunStatusToFlowStatus(status: ClawGraphRunStatus): FlowStatus {
  return RUN_STATUS_TO_FLOW_STATUS[status];
}

export function flowStatusToClawgraphRunStatus(status: FlowStatus): ClawGraphRunStatus {
  return FLOW_STATUS_TO_RUN_STATUS[status];
}

/** Projection mode: copy one run event's lifecycle into TaskFlow. */
export function projectClawgraphRunEvent(
  event: ClawGraphRunEvent,
  options: ClawgraphProjectionOptions = {},
): ClawgraphProjectionResult {
  if (options.enabled !== true) {
    return { projected: false, skippedReason: 'flag-off' };
  }
  const targetStatus = options.runStatus
    ? RUN_STATUS_TO_FLOW_STATUS[options.runStatus]
    : EVENT_TO_FLOW_STATUS[event.type];
  if (!targetStatus) {
    return { projected: false, skippedReason: 'unknown-event' };
  }
  const committed = commitWorkflowLifecycle({
    domain: 'clawgraph',
    id: event.runId,
    status: targetStatus,
    currentStep: event.nodeId ? `node:${event.nodeId}` : undefined,
    options,
  });
  if (!committed.ok) {
    return {
      projected: false,
      skippedReason:
        committed.reason === 'illegal-transition'
          ? 'illegal-transition'
          : committed.reason === 'error'
            ? 'error'
            : 'revision-conflict',
    };
  }
  return { projected: true, flowId: `clawgraph:${event.runId}`, revision: committed.revision, status: targetStatus };
}

/** Read a ClawGraph run's lifecycle back from TaskFlow (e.g. after restart). */
export function recoverClawgraphProjection(
  runId: string,
  options: ClawgraphProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const row = readWorkflowLifecycle('clawgraph', runId, options);
  if (!row) {
    return { recovered: false };
  }
  return { flowId: row.flow_id, status: row.status as FlowStatus, recovered: true };
}

/** Restart recovery: settle ClawGraph lifecycles whose run is gone as lost. */
export function settleOrphanedClawgraphRuns(
  isLive: (runId: string) => boolean,
  options: WorkflowLifecycleOptions = {},
): string[] {
  return settleOrphanedWorkflowLifecycles({ domain: 'clawgraph', isLive, options });
}
