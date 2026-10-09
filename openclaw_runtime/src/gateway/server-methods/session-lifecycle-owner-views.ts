// Runtime Lifecycle Governance — TF-0084 owner path 1: one owner-read layer.
//
// Both read models in this directory (the Phase 5 session activity projection
// and the TF-0084 lifecycle ledger) must describe the same owner records, so
// they share this read layer instead of each opening its own queries. A second
// read layer is exactly how a projection and a ledger drift apart and produce
// the "the code exists but the lifecycle does not close" gap TF-0084 exists to
// rule out.
//
// There is no write path here. Every read degrades to an empty result instead of
// throwing, and a failed read is reported as `unknown` rather than being passed
// off as an owner that simply had nothing to say (#121); no identifier is ever
// derived from another one.
import type { Selectable } from "kysely";

import {
  type FinishedSession,
  type ProcessSession,
  listFinishedSessions,
  listRunningSessions,
} from "../../agents/bash-process-registry.js";
import { GOAL_WAKE_CONTROLLER_ID } from "../../agents/goal-wake-read.js";
import { parseGoalWakeWaitJson } from "../../agents/goal-wake-types.js";
import { getLatestMissionForSession } from "../../agents/mission-control/store.js";
import type { MissionRunRecord } from "../../agents/mission-control/types.js";
import {
  type SubagentRunRecord,
  getLatestSubagentRunByChildSessionKey,
  listSubagentRunsForRequester,
} from "../../agents/subagent-registry.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import {
  type ProcessSupervisor,
  type SupervisorSessionRunSnapshot,
  getProcessSupervisor,
} from "../../process/supervisor/index.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";

/**
 * Correlation identity for one projected effect (TF-0082 owner path 5).
 *
 * Mirrors `SessionActivityLineageRef` in `shared/types/session-activity.ts`; the
 * two shapes must stay in sync because the gateway response is forwarded
 * verbatim to the renderer.
 */
export type SessionActivityLineageRef = {
  sessionId?: string;
  runId?: string;
  parentSessionKey?: string;
  ownerEpoch?: string;
  missionId?: string;
};

type SessionLifecycleReadDatabase = Pick<OpenClawStateKyselyDatabase, "flow_runs" | "task_runs">;

export type SessionLifecycleFlowRow = Selectable<OpenClawStateKyselyDatabase["flow_runs"]>;
export type SessionLifecycleTaskRunRow = Selectable<OpenClawStateKyselyDatabase["task_runs"]>;

/** Default read widths; the activity projection renders exactly these many rows. */
export const GOAL_PROJECTION_LIMIT = 4;
export const PROCESS_PROJECTION_LIMIT = 8;
export const LINEAGE_PROJECTION_LIMIT = 8;

/** Same bound as `runtime-core/lineage.ts`: correlation ids only, never text. */
export const MAX_LINEAGE_ID_LENGTH = 256;

const LINEAGE_REF_KEYS = [
  "sessionId",
  "runId",
  "parentSessionKey",
  "ownerEpoch",
  "missionId",
] as const;

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function boundedLineageId(value: unknown): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized && normalized.length <= MAX_LINEAGE_ID_LENGTH ? normalized : undefined;
}

/**
 * Builds the correlation ref from whatever the owner actually recorded. No field
 * is inferred from another, and an all-empty ref is omitted so a caller can tell
 * "the owner records no identity" from "the identity is unknown".
 */
export function lineageRef(
  input: Partial<Record<(typeof LINEAGE_REF_KEYS)[number], unknown>>,
): SessionActivityLineageRef | undefined {
  const ref: SessionActivityLineageRef = {};
  for (const key of LINEAGE_REF_KEYS) {
    const value = boundedLineageId(input[key]);
    if (value) {
      ref[key] = value;
    }
  }
  return Object.keys(ref).length > 0 ? ref : undefined;
}

export function bashSessionMatches(
  session: ProcessSession | FinishedSession,
  sessionKey: string,
): boolean {
  return (
    ("sessionKey" in session && session.sessionKey === sessionKey) ||
    session.lifecycleCanonicalSessionKey === sessionKey
  );
}

/**
 * Goal-wake join key: a waiting flow names the process task it depends on, so
 * the flow row is what ties a goal-owned process back to its mission and durable
 * owner epoch. Keyed by dependency task id, and shared by both read models so
 * they resolve a goal-owned process to the same mission.
 */
export type GoalWakeTaskJoin = {
  missionId?: string;
  runId?: string;
  ownerEpoch?: string;
};

export function goalWakeJoinsByTaskId(
  flows: readonly SessionLifecycleFlowRow[],
): Map<string, GoalWakeTaskJoin> {
  const joins = new Map<string, GoalWakeTaskJoin>();
  for (const row of flows) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    const taskId = nonEmptyString(wait?.dependency?.taskId);
    if (!taskId || joins.has(taskId)) {
      continue;
    }
    joins.set(taskId, {
      missionId: nonEmptyString(wait?.missionId),
      runId: nonEmptyString(wait?.runId),
      ownerEpoch: nonEmptyString(wait?.ownerEpoch),
    });
  }
  return joins;
}

/** Everything the owners report for one session, read exactly once. */
export type SessionLifecycleOwnerViews = {
  sessionKey: string;
  mission?: MissionRunRecord;
  flows: SessionLifecycleFlowRow[];
  tasks: SessionLifecycleTaskRunRow[];
  /**
   * Whether the goal-wake owner query completed.
   *
   * `unknown` means the owner could not be read at all, so `flows`/`tasks` are
   * a missing answer rather than an answer of "nothing is waiting". This is the
   * source-side form of the activity snapshot's `backgroundRead` state: the
   * empty arrays alone cannot be told apart from a session that genuinely has
   * nothing in flight, which is the defect this field removes (#121).
   */
  goalWakeRead: SessionLifecycleReadState;
  bashProcesses: Array<ProcessSession | FinishedSession>;
  supervisorRuns: SupervisorSessionRunSnapshot[];
  lineageRuns: SubagentRunRecord[];
  parentRun?: SubagentRunRecord;
};

/** See `SessionLifecycleOwnerViews.goalWakeRead`. */
export type SessionLifecycleReadState = "known" | "unknown";

export type SessionLifecycleOwnerViewOptions = {
  mission?: MissionRunRecord;
  supervisor?: Pick<ProcessSupervisor, "snapshotRunsForSession">;
  goalLimit?: number;
  processLimit?: number;
};

/**
 * Read-only goal-wake ledger rows for one session. Failures degrade to empty
 * arrays and report `read: "unknown"`; this function never writes and never
 * throws. The read state is part of the result because an empty array produced
 * by a failed query and an empty array produced by a query that found nothing
 * are different facts (#121).
 */
export function readGoalWakeRowsForSession(
  sessionKey: string,
  limits: { goalLimit?: number; processLimit?: number } = {},
): {
  flows: SessionLifecycleFlowRow[];
  tasks: SessionLifecycleTaskRunRow[];
  read: SessionLifecycleReadState;
} {
  const key = nonEmptyString(sessionKey);
  if (!key) {
    // No session means no owner rows to read: an empty answer is the answer.
    return { flows: [], tasks: [], read: "known" };
  }
  const goalLimit = limits.goalLimit ?? GOAL_PROJECTION_LIMIT;
  const processLimit = limits.processLimit ?? PROCESS_PROJECTION_LIMIT;
  try {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<SessionLifecycleReadDatabase>(db);
    const flows = executeSqliteQuerySync(
      db,
      query
        .selectFrom("flow_runs")
        .selectAll()
        .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
        .where("owner_key", "=", key)
        .orderBy("updated_at", "desc")
        .orderBy("flow_id", "desc")
        .limit(goalLimit),
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
        .limit(processLimit),
    ).rows;
    return { flows, tasks, read: "known" };
  } catch {
    // The query failed, so "no flows and no tasks" is not a fact we hold. Say so
    // instead of handing the caller an empty result it will render as a session
    // with nothing in flight.
    return { flows: [], tasks: [], read: "unknown" };
  }
}

export function readBashProcessesForSession(
  sessionKey: string,
): Array<ProcessSession | FinishedSession> {
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

export function readLineageForSession(sessionKey: string): {
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
 * Collects every owner view for one session. The optional `mission` is the same
 * mission row an upstream handler may already have read; passing it avoids a
 * second mission query and keeps this on existing read models.
 */
export function collectSessionLifecycleOwnerViews(
  sessionKey: string,
  options: SessionLifecycleOwnerViewOptions = {},
): SessionLifecycleOwnerViews {
  const key = nonEmptyString(sessionKey) ?? "";
  const goalWake = readGoalWakeRowsForSession(key, {
    goalLimit: options.goalLimit,
    processLimit: options.processLimit,
  });
  const supervisor = options.supervisor ?? getProcessSupervisor();
  let supervisorRuns: SupervisorSessionRunSnapshot[] = [];
  if (key) {
    try {
      supervisorRuns = supervisor.snapshotRunsForSession(key);
    } catch {
      supervisorRuns = [];
    }
  }
  const lineage = readLineageForSession(key);
  let mission = options.mission;
  if (!mission && key) {
    try {
      mission = getLatestMissionForSession(key);
    } catch {
      mission = undefined;
    }
  }
  return {
    sessionKey: key,
    mission,
    flows: goalWake.flows,
    tasks: goalWake.tasks,
    goalWakeRead: goalWake.read,
    bashProcesses: readBashProcessesForSession(key),
    supervisorRuns,
    lineageRuns: lineage.lineageRuns,
    parentRun: lineage.parentRun,
  };
}
