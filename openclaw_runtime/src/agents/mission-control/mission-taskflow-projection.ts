// RC-06C Mission lifecycle on the TaskFlow owner. Mission definitions stay in
// mission_runs; the lifecycle status is committed through the shared workflow
// lifecycle owner (projection mode: observational copy with drift; taskflow
// mode: the cutover, where mission_runs is written only after the commit).
import type { FlowStatus } from '../../tasks/task-flow-cas.js';
import {
  commitWorkflowLifecycle,
  readWorkflowLifecycle,
  type WorkflowLifecycleCommit,
  type WorkflowLifecycleOptions,
} from '../../tasks/workflow-lifecycle-owner.js';

export const MISSION_PROJECTION_FLAG = 'rc06c.missionProjection';
export const MISSION_PROJECTION_SCHEMA_VERSION = '1';

export type MissionProjectionOptions = WorkflowLifecycleOptions & {
  enabled?: boolean;
};

export type MissionProjectionInput = {
  missionId: string;
  sessionKey?: string;
  status: string;
  phase?: string;
  tick?: number;
  /** Wait semantics: mission is asking the user, sleeping, or paused. */
  waitMode?: 'ask_user' | 'sleep' | 'pause' | 'none';
};

export type MissionProjectionResult = {
  projected: boolean;
  flowId?: string;
  revision?: number;
  status?: FlowStatus;
  skippedReason?: 'flag-off' | 'unknown-status' | 'conflict';
  commit?: WorkflowLifecycleCommit;
};

const MISSION_STATUS_TO_FLOW: Record<string, FlowStatus> = {
  idle: 'queued',
  running: 'running',
  sleeping: 'waiting',
  paused: 'waiting',
  ask_user: 'waiting',
  complete: 'succeeded',
  // A blocked mission is final (tickMission never leaves it); TaskFlow's
  // blocked is resumable, so the terminal mission maps to failed.
  blocked: 'failed',
  cancelled: 'cancelled',
  error: 'failed',
};

export function missionStatusToFlowStatus(status: string): FlowStatus | undefined {
  return MISSION_STATUS_TO_FLOW[status];
}

export function missionWaitMode(status: string): MissionProjectionInput['waitMode'] {
  if (status === 'ask_user') return 'ask_user';
  if (status === 'paused') return 'pause';
  if (status === 'sleeping') return 'sleep';
  return 'none';
}

/** Commit one Mission status to its TaskFlow lifecycle row. */
export function projectMissionRun(
  input: MissionProjectionInput,
  options: MissionProjectionOptions = {},
): MissionProjectionResult {
  if (options.enabled !== true) {
    return { projected: false, skippedReason: 'flag-off' };
  }
  const flowStatus = MISSION_STATUS_TO_FLOW[input.status];
  if (!flowStatus) {
    return { projected: false, skippedReason: 'unknown-status' };
  }
  const commit = commitWorkflowLifecycle({
    domain: 'mission',
    id: input.missionId,
    status: flowStatus,
    currentStep: input.phase,
    stateJson: JSON.stringify({
      missionId: input.missionId,
      sessionKey: input.sessionKey,
      missionStatus: input.status,
      waitMode: input.waitMode ?? missionWaitMode(input.status),
      tick: input.tick,
    }),
    options,
  });
  if (!commit.ok) {
    return { projected: false, skippedReason: 'conflict', commit };
  }
  return { projected: true, flowId: `mission:${input.missionId}`, revision: commit.revision, status: flowStatus, commit };
}

/** Read a Mission's lifecycle back from TaskFlow (e.g. after restart). */
export function recoverMissionProjection(
  missionId: string,
  options: MissionProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; waitMode?: string; missionStatus?: string; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const row = readWorkflowLifecycle('mission', missionId, options);
  if (!row) {
    return { recovered: false };
  }
  let state: { waitMode?: string; missionStatus?: string } = {};
  try {
    state = row.state_json ? (JSON.parse(row.state_json) as typeof state) : {};
  } catch {
    state = {};
  }
  return {
    flowId: row.flow_id,
    status: row.status as FlowStatus,
    waitMode: state.waitMode && state.waitMode !== 'none' ? state.waitMode : undefined,
    missionStatus: state.missionStatus,
    recovered: true,
  };
}
