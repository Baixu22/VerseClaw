// RC-06C Mission -> TaskFlow read-only projection. Mission definitions become
// TaskFlow templates/controllers behind a default-off flag; mission_runs/events
// remain compatibility reads until migration proof permits retirement. Mission
// restart, wait, resume, and cancel semantics are preserved in the projection.
// Indefinite dual-write is not a migration strategy.
import { CAS_CREATE_SENTINEL, TaskFlowCasStore, type FlowStatus } from '../../tasks/task-flow-cas.js';

export const MISSION_PROJECTION_FLAG = 'rc06c.missionProjection';
export const MISSION_PROJECTION_SCHEMA_VERSION = '1';

export type MissionProjectionOptions = {
  enabled?: boolean;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
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
};

const MISSION_STATUS_TO_FLOW: Record<string, FlowStatus> = {
  idle: 'queued',
  running: 'running',
  sleeping: 'waiting',
  paused: 'waiting',
  ask_user: 'waiting',
  complete: 'succeeded',
  blocked: 'blocked',
  cancelled: 'cancelled',
  error: 'failed',
};

/**
 * Project a Mission status/phase transition into flow_runs via the CAS store.
 * The legacy mission_runs/events tables remain authoritative; this is an
 * observational projection only.
 */
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
  const flowId = `mission:${input.missionId}`;
  const store = new TaskFlowCasStore(options.database ?? {});
  const existing = store.getById(flowId);
  // RC-06A create sentinel: a missing row requires expectedRevision = -1.
  const expectedRevision = existing ? Number(existing.revision) || 0 : CAS_CREATE_SENTINEL;
  const waitJson =
    input.waitMode && input.waitMode !== 'none'
      ? JSON.stringify({ waitMode: input.waitMode, phase: input.phase, tick: input.tick })
      : null;
  const result = store.casUpsert({
    flowId,
    expectedRevision,
    status: flowStatus,
    ownerKey: 'mission-control',
    currentStep: input.phase,
    waitJson,
    stateJson: JSON.stringify({ missionId: input.missionId, sessionKey: input.sessionKey, tick: input.tick }),
  });
  if (!result.ok) {
    return { projected: false, skippedReason: 'conflict' };
  }
  return { projected: true, flowId, revision: result.revision, status: flowStatus };
}

/** Recover a Mission's projected flow state after restart. */
export function recoverMissionProjection(
  missionId: string,
  options: MissionProjectionOptions = {},
): { flowId?: string; status?: FlowStatus; waitMode?: string; recovered: boolean } {
  if (options.enabled !== true) {
    return { recovered: false };
  }
  const store = new TaskFlowCasStore(options.database ?? {});
  const row = store.getById(`mission:${missionId}`);
  if (!row) {
    return { recovered: false };
  }
  let waitMode: string | undefined;
  if (row.wait_json) {
    try {
      waitMode = (JSON.parse(row.wait_json) as { waitMode?: string }).waitMode;
    } catch {
      waitMode = undefined;
    }
  }
  return { flowId: row.flow_id, status: row.status as FlowStatus, waitMode, recovered: true };
}
