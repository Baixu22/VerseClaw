// Runtime Lifecycle Governance — Phase 5 read-only session activity projection.
//
// This module has no write path. It only reads:
//   - mission_runs through the existing mission-control store read model,
//   - goal-wake flow_runs / task_runs through read-only SQLite queries,
//   - the bash process registry running/finished snapshots,
//   - the process supervisor session snapshot,
//   - the subagent registry lineage reads.
import type { Selectable } from "kysely";

import { GOAL_WAKE_CONTROLLER_ID } from "../../agents/goal-wake-read.js";
import { parseGoalWakeWaitJson } from "../../agents/goal-wake-types.js";
import {
  type FinishedSession,
  type ProcessSession,
  listFinishedSessions,
  listRunningSessions,
} from "../../agents/bash-process-registry.js";
import { getLatestMissionForSession } from "../../agents/mission-control/store.js";
import type { MissionRunRecord } from "../../agents/mission-control/types.js";
import {
  type SubagentRunRecord,
  getLatestSubagentRunByChildSessionKey,
  listSubagentRunsForRequester,
} from "../../agents/subagent-registry.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import {
  type ProcessSupervisor,
  type SupervisorSessionRunSnapshot,
  getProcessSupervisor,
} from "../../process/supervisor/index.js";

type SessionActivityGoalKind = "mission" | "flow";
type SessionActivityGoalStatus =
  | "queued"
  | "waiting"
  | "running"
  | "sleeping"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "aborted"
  | "lost";

type SessionActivityGoalProjection = {
  id: string;
  kind: SessionActivityGoalKind;
  label: string;
  status: SessionActivityGoalStatus;
  phase?: string;
  progress?: number;
  digest?: string;
  updatedAt: number;
};

type SessionActivityProcessKind = "bash" | "supervisor" | "goalOwned";
type SessionActivityProcessStatus =
  | "queued"
  | "starting"
  | "running"
  | "exiting"
  | "exited"
  | "completed"
  | "failed"
  | "killed"
  | "aborted"
  | "lost";

type SessionActivityProcessProjection = {
  id: string;
  kind: SessionActivityProcessKind;
  label: string;
  status: SessionActivityProcessStatus;
  pid?: number;
  digest?: string;
  updatedAt: number;
};

type SessionActivityLineageKind = "parent" | "child";
type SessionActivityLineageStatus = "started" | "completed" | "aborted" | "error";

type SessionActivityLineageProjection = {
  id: string;
  kind: SessionActivityLineageKind;
  sessionKey: string;
  role?: string;
  status: SessionActivityLineageStatus;
  updatedAt: number;
};

type SessionActivityReadProjection = {
  goals: SessionActivityGoalProjection[];
  processes: SessionActivityProcessProjection[];
  lineage: SessionActivityLineageProjection[];
};

type SessionActivityReadDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "flow_runs" | "task_runs"
>;

type SessionActivityFlowRow = Selectable<OpenClawStateKyselyDatabase["flow_runs"]>;
type SessionActivityTaskRunRow = Selectable<OpenClawStateKyselyDatabase["task_runs"]>;

const GOAL_PROJECTION_LIMIT = 4;
const PROCESS_PROJECTION_LIMIT = 8;
const LINEAGE_PROJECTION_LIMIT = 8;

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function clampProgress(value: unknown): number | undefined {
  const progress = finiteNumber(value, Number.NaN);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sortNewest<T extends { updatedAt: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt);
}

function sha256Prefix(value: string): string | undefined {
  const digest = value.match(/sha256:([a-f0-9]{16,64})/iu)?.[1];
  return digest?.slice(0, 16);
}

function missionGoalStatus(status: MissionRunRecord["status"]): SessionActivityGoalStatus {
  switch (status) {
    case "idle":
      return "queued";
    case "ask_user":
      return "waiting";
    case "sleeping":
      return "sleeping";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    case "complete":
      return "completed";
    case "cancelled":
      return "aborted";
    case "error":
      return "failed";
    default:
      return "queued";
  }
}

function ledgerStatus(status: string): {
  goal: SessionActivityGoalStatus;
  process: SessionActivityProcessStatus;
} {
  switch (status) {
    case "queued":
      return { goal: "queued", process: "queued" };
    case "waiting":
      return { goal: "waiting", process: "queued" };
    case "running":
      return { goal: "running", process: "running" };
    case "blocked":
      return { goal: "blocked", process: "failed" };
    case "succeeded":
    case "complete":
    case "completed":
      return { goal: "completed", process: "completed" };
    case "failed":
    case "error":
    case "timed_out":
      return { goal: "failed", process: "failed" };
    case "cancelled":
      return { goal: "aborted", process: "aborted" };
    case "lost":
      return { goal: "lost", process: "lost" };
    default:
      return { goal: "queued", process: "queued" };
  }
}

function bashProcessStatus(session: ProcessSession | FinishedSession): SessionActivityProcessStatus {
  if ("status" in session) {
    return session.status;
  }
  if (!session.exited) {
    return "running";
  }
  if (session.exitCode === 0) {
    return "completed";
  }
  if (session.exitReason === "manual-cancel" || session.exitSignal != null) {
    return "killed";
  }
  return "failed";
}

function subagentLineageStatus(run: SubagentRunRecord): SessionActivityLineageStatus {
  if (!run.endedAt) {
    return "started";
  }
  if (run.outcome?.status === "ok") {
    return "completed";
  }
  return run.endedReason ? "aborted" : "error";
}

function missionToGoal(mission: MissionRunRecord): SessionActivityGoalProjection {
  return {
    id: mission.missionId,
    kind: "mission",
    label: `Mission ${mission.missionId}`,
    status: missionGoalStatus(mission.status),
    phase: nonEmptyString(mission.phase),
    progress: clampProgress(mission.progress),
    updatedAt: finiteNumber(mission.updatedAt, finiteNumber(mission.createdAt)),
  };
}

function flowToGoal(row: SessionActivityFlowRow): SessionActivityGoalProjection {
  const wait = parseGoalWakeWaitJson(row.wait_json);
  return {
    id: row.flow_id,
    kind: "flow",
    label: `Goal wait ${row.flow_id}`,
    status: ledgerStatus(row.status).goal,
    digest: nonEmptyString(wait?.commandDigest),
    updatedAt: finiteNumber(row.updated_at, finiteNumber(row.created_at)),
  };
}

function taskRunToProcess(row: SessionActivityTaskRunRow): SessionActivityProcessProjection {
  return {
    id: row.task_id,
    kind: "goalOwned",
    label: nonEmptyString(row.label) ?? `Goal process ${row.task_id}`,
    status: ledgerStatus(row.status).process,
    digest: nonEmptyString(sha256Prefix(row.task ?? "")),
    updatedAt: finiteNumber(
      row.last_event_at,
      finiteNumber(row.ended_at, finiteNumber(row.created_at)),
    ),
  };
}

function bashToProcess(session: ProcessSession | FinishedSession): SessionActivityProcessProjection {
  return {
    id: session.id,
    kind: "bash",
    label: `Process ${session.id}`,
    status: bashProcessStatus(session),
    pid: optionalFiniteNumber("pid" in session ? session.pid : undefined),
    updatedAt: "endedAt" in session ? finiteNumber(session.endedAt) : finiteNumber(session.startedAt),
  };
}

function supervisorRunToProcess(run: SupervisorSessionRunSnapshot): SessionActivityProcessProjection {
  return {
    id: run.runId,
    kind: "supervisor",
    label: `Supervised process ${run.runId}`,
    status: run.state,
    pid: optionalFiniteNumber(run.pid),
    updatedAt: finiteNumber(run.updatedAtMs, finiteNumber(run.startedAtMs)),
  };
}

function lineageFromRun(
  run: SubagentRunRecord,
  kind: SessionActivityLineageKind,
): SessionActivityLineageProjection {
  return {
    id: run.runId,
    kind,
    sessionKey: kind === "child" ? run.childSessionKey : run.requesterSessionKey,
    role: nonEmptyString(run.orchestration?.roleName) ?? nonEmptyString(run.label),
    status: subagentLineageStatus(run),
    updatedAt: finiteNumber(run.endedAt, finiteNumber(run.startedAt, finiteNumber(run.createdAt))),
  };
}

function bashSessionMatches(session: ProcessSession | FinishedSession, sessionKey: string): boolean {
  return (
    ("sessionKey" in session && session.sessionKey === sessionKey) ||
    session.lifecycleCanonicalSessionKey === sessionKey
  );
}

/**
 * Builds the goal/process/lineage projection from already-read views.
 * All inputs are optional; empty and terminal-state inputs return empty arrays.
 */
function buildSessionActivityReadProjection(input: {
  sessionKey: string;
  mission?: MissionRunRecord;
  flows?: readonly SessionActivityFlowRow[];
  tasks?: readonly SessionActivityTaskRunRow[];
  bashProcesses?: readonly (ProcessSession | FinishedSession)[];
  supervisorRuns?: readonly SupervisorSessionRunSnapshot[];
  lineageRuns?: readonly SubagentRunRecord[];
  parentRun?: SubagentRunRecord;
}): SessionActivityReadProjection {
  const key = nonEmptyString(input.sessionKey);
  if (!key) {
    return { goals: [], processes: [], lineage: [] };
  }

  const mission = input.mission?.sessionKey === key ? missionToGoal(input.mission) : undefined;
  const flows = (input.flows ?? []).filter((row) => row.owner_key === key).map(flowToGoal);
  const goalTasks = (input.tasks ?? [])
    .filter((row) => row.runtime === "process" && row.owner_key === key)
    .map(taskRunToProcess);
  const bashProcesses = (input.bashProcesses ?? [])
    .filter((session) => bashSessionMatches(session, key))
    .map(bashToProcess);
  const supervisorProcesses = (input.supervisorRuns ?? [])
    .filter((run) => run.lifecycleCanonicalSessionKey === key)
    .map(supervisorRunToProcess);
  const lineage = (input.lineageRuns ?? [])
    .filter((run) => run.requesterSessionKey === key && nonEmptyString(run.childSessionKey))
    .slice(0, LINEAGE_PROJECTION_LIMIT)
    .map((run) => lineageFromRun(run, "child"));

  if (input.parentRun?.childSessionKey === key && nonEmptyString(input.parentRun.requesterSessionKey)) {
    lineage.push(lineageFromRun(input.parentRun, "parent"));
  }

  return {
    goals: sortNewest(mission ? [mission, ...flows] : flows).slice(0, GOAL_PROJECTION_LIMIT),
    processes: sortNewest([...goalTasks, ...bashProcesses, ...supervisorProcesses]).slice(
      0,
      PROCESS_PROJECTION_LIMIT,
    ),
    lineage: sortNewest(lineage).slice(0, LINEAGE_PROJECTION_LIMIT),
  };
}

/**
 * Read-only goal-wake ledger rows for one session. Failures degrade to empty
 * arrays; this function never writes and never throws.
 */
function readGoalWakeRowsForSession(
  sessionKey: string,
): { flows: SessionActivityFlowRow[]; tasks: SessionActivityTaskRunRow[] } {
  const key = nonEmptyString(sessionKey);
  if (!key) {
    return { flows: [], tasks: [] };
  }
  try {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<SessionActivityReadDatabase>(db);
    const flows = executeSqliteQuerySync(
      db,
      query
        .selectFrom("flow_runs")
        .selectAll()
        .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
        .where("owner_key", "=", key)
        .orderBy("updated_at", "desc")
        .orderBy("flow_id", "desc")
        .limit(GOAL_PROJECTION_LIMIT),
    ).rows;
    const tasks = executeSqliteQuerySync(
      db,
      query
        .selectFrom("task_runs")
        .selectAll()
        .where("runtime", "=", "process")
        .where("owner_key", "=", key)
        .orderBy("last_event_at", "desc")
        .orderBy("task_id", "desc")
        .limit(PROCESS_PROJECTION_LIMIT),
    ).rows;
    return { flows, tasks };
  } catch {
    return { flows: [], tasks: [] };
  }
}

function readBashProcessesForSession(sessionKey: string): Array<ProcessSession | FinishedSession> {
  const key = nonEmptyString(sessionKey);
  if (!key) {
    return [];
  }
  try {
    return [
      ...listRunningSessions().filter((session) => bashSessionMatches(session, key)),
      ...listFinishedSessions().filter((session) => bashSessionMatches(session, key)),
    ];
  } catch {
    return [];
  }
}

function readLineageForSession(sessionKey: string): {
  lineageRuns: SubagentRunRecord[];
  parentRun?: SubagentRunRecord;
} {
  const key = nonEmptyString(sessionKey);
  if (!key) {
    return { lineageRuns: [] };
  }
  try {
    return {
      lineageRuns: listSubagentRunsForRequester(key),
      parentRun: getLatestSubagentRunByChildSessionKey(key) ?? undefined,
    };
  } catch {
    return { lineageRuns: [] };
  }
}

/**
 * Collects the read-only projection for a session. The optional `mission` is
 * the same mission row already read by the activity handler; passing it avoids
 * a second mission query and keeps the handler on existing read models.
 */
export function collectSessionActivityReadProjection(
  sessionKey: string,
  mission?: MissionRunRecord,
  options?: { supervisor?: Pick<ProcessSupervisor, "snapshotRunsForSession"> },
): SessionActivityReadProjection {
  const key = nonEmptyString(sessionKey);
  const { flows, tasks } = readGoalWakeRowsForSession(key ?? "");
  const supervisor = options?.supervisor ?? getProcessSupervisor();
  let supervisorRuns: SupervisorSessionRunSnapshot[] = [];
  if (key) {
    try {
      supervisorRuns = supervisor.snapshotRunsForSession(key);
    } catch {
      supervisorRuns = [];
    }
  }
  const lineage = readLineageForSession(key ?? "");
  let resolvedMission = mission;
  if (!resolvedMission && key) {
    try {
      resolvedMission = getLatestMissionForSession(key);
    } catch {
      resolvedMission = undefined;
    }
  }
  return buildSessionActivityReadProjection({
    sessionKey: key ?? "",
    mission: resolvedMission,
    flows,
    tasks,
    bashProcesses: readBashProcessesForSession(key ?? ""),
    supervisorRuns,
    lineageRuns: lineage.lineageRuns,
    parentRun: lineage.parentRun,
  });
}
