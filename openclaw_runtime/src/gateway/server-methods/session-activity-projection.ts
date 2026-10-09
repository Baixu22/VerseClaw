// Runtime Lifecycle Governance — Phase 5 read-only session activity projection.
//
// This module has no write path. It only reads:
//   - mission_runs through the existing mission-control store read model,
//   - goal-wake flow_runs / task_runs through read-only SQLite queries,
//   - the bash process registry running/finished snapshots,
//   - the process supervisor session snapshot,
//   - the subagent registry lineage reads.
//
// TF-0082 owner path 5 adds the lineage join: each projected effect carries a
// `lineage` correlation ref copied from the owner that already records it, so
// mission / goal-wake flow / goal-owned process / subagent run all resolve to
// the same session, run, and mission identifiers without a second identity
// source and without deriving one identifier from another.
// TF-0084 owner path 1 moved the owner reads into
// `session-lifecycle-owner-views.ts` so this projection and the lifecycle ledger
// describe the same owner records instead of each opening their own queries.
import { parseGoalWakeWaitJson } from "../../agents/goal-wake-types.js";
import {
  type FinishedSession,
  type ProcessSession,
  classifyBashProcessIdle,
} from "../../agents/bash-process-registry.js";
import type { MissionRunRecord } from "../../agents/mission-control/types.js";
import type { SubagentRunRecord } from "../../agents/subagent-registry.js";
import type {
  ProcessSupervisor,
  SupervisorSessionRunSnapshot,
} from "../../process/supervisor/index.js";
import {
  GOAL_PROJECTION_LIMIT,
  LINEAGE_PROJECTION_LIMIT,
  PROCESS_PROJECTION_LIMIT,
  type GoalWakeTaskJoin,
  type SessionActivityLineageRef,
  type SessionLifecycleFlowRow as SessionActivityFlowRow,
  type SessionLifecycleTaskRunRow as SessionActivityTaskRunRow,
  bashSessionMatches,
  collectSessionLifecycleOwnerViews,
  finiteNumber,
  goalWakeJoinsByTaskId,
  lineageRef,
  nonEmptyString,
  optionalFiniteNumber,
} from "./session-lifecycle-owner-views.js";

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

/**
 * Correlation identity for one projected effect, re-exported from the shared
 * owner-read layer so this projection and the lifecycle ledger cannot diverge.
 */
type SessionActivityGoalProjection = {
  id: string;
  kind: SessionActivityGoalKind;
  label: string;
  status: SessionActivityGoalStatus;
  phase?: string;
  progress?: number;
  digest?: string;
  lineage?: SessionActivityLineageRef;
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
  /** TF-0081 idle classification for still-running bash sessions (observability only). */
  idleClassification?: "running-process" | "idle";
  lineage?: SessionActivityLineageRef;
  updatedAt: number;
};

type SessionActivityLineageKind = "parent" | "child";
type SessionActivityLineageStatus = "started" | "yielded" | "completed" | "aborted" | "error";

type SessionActivityLineageProjection = {
  id: string;
  kind: SessionActivityLineageKind;
  sessionKey: string;
  role?: string;
  status: SessionActivityLineageStatus;
  lineage?: SessionActivityLineageRef;
  updatedAt: number;
};

type SessionActivityReadProjection = {
  goals: SessionActivityGoalProjection[];
  processes: SessionActivityProcessProjection[];
  lineage: SessionActivityLineageProjection[];
  /**
   * Whether the DB-backed goal-wake owner read completed.
   *
   * `unknown` means the query failed, so the empty goal/process arrays are a
   * missing answer rather than an answer of "nothing is waiting". Consumers must
   * carry this to the session activity snapshot instead of rendering the empty
   * arrays as fact (#121); the in-memory owner reads (bash/supervisor/lineage
   * registries) cannot fail this way.
   */
  ownerRead: "known" | "unknown";
};

function clampProgress(value: unknown): number | undefined {
  const progress = finiteNumber(value, Number.NaN);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : undefined;
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
  // A yielded run sets endedAt but clears outcome and endedReason, so it must be
  // matched before the terminal branches — otherwise a normal parent yield reads
  // as an error and escalates the session to attention level.
  if (run.pauseReason === "sessions_yield") {
    return "yielded";
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
    lineage: lineageRef({
      missionId: mission.missionId,
      sessionId: mission.lineage?.sessionId,
      runId: mission.lineage?.loopRunId ?? mission.taskLoopRunId,
    }),
    updatedAt: finiteNumber(mission.updatedAt, finiteNumber(mission.createdAt)),
  };
}

/**
 * Goal-wake join key lives in the shared owner-read layer so both read models
 * resolve a goal-owned process to the same mission; see `goalWakeJoinsByTaskId`
 * in `session-lifecycle-owner-views.ts`.
 */
function flowToGoal(row: SessionActivityFlowRow): SessionActivityGoalProjection {
  const wait = parseGoalWakeWaitJson(row.wait_json);
  return {
    id: row.flow_id,
    kind: "flow",
    label: `Goal wait ${row.flow_id}`,
    status: ledgerStatus(row.status).goal,
    digest: nonEmptyString(wait?.commandDigest),
    lineage: lineageRef({
      missionId: wait?.missionId,
      runId: wait?.runId,
      ownerEpoch: wait?.ownerEpoch,
    }),
    updatedAt: finiteNumber(row.updated_at, finiteNumber(row.created_at)),
  };
}

function taskRunToProcess(
  row: SessionActivityTaskRunRow,
  join?: GoalWakeTaskJoin,
): SessionActivityProcessProjection {
  return {
    id: row.task_id,
    kind: "goalOwned",
    label: nonEmptyString(row.label) ?? `Goal process ${row.task_id}`,
    status: ledgerStatus(row.status).process,
    digest: nonEmptyString(sha256Prefix(row.task ?? "")),
    lineage: lineageRef({
      runId: nonEmptyString(row.run_id) ?? join?.runId,
      parentSessionKey: row.requester_session_key,
      missionId: join?.missionId,
      ownerEpoch: join?.ownerEpoch,
    }),
    updatedAt: finiteNumber(
      row.last_event_at,
      finiteNumber(row.ended_at, finiteNumber(row.created_at)),
    ),
  };
}

function bashToProcess(session: ProcessSession | FinishedSession): SessionActivityProcessProjection {
  const running = "endedAt" in session ? null : session;
  // exited:false can only yield running-process/idle; the explicit match keeps
  // the projection field narrower than the classifier's full union.
  const idle =
    running && !running.exited
      ? classifyBashProcessIdle({
          exited: false,
          lastActivityAtMs: running.lastOutputAt ?? running.startedAt,
          nowMs: Date.now(),
        })
      : undefined;
  return {
    id: session.id,
    kind: "bash",
    label: `Process ${session.id}`,
    status: bashProcessStatus(session),
    pid: optionalFiniteNumber("pid" in session ? session.pid : undefined),
    ...(idle === "running-process" || idle === "idle" ? { idleClassification: idle } : {}),
    lineage: lineageRef({ sessionId: session.lifecycleExpectedSessionId }),
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
    lineage: lineageRef({
      runId: run.runId,
      sessionId: run.lifecycleExpectedSessionId,
    }),
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
    // `sessionId` is the TF-0082 spawn-time generation pin, so a reader can see
    // which parent generation a completion is allowed to steer.
    lineage: lineageRef({
      runId: run.runId,
      parentSessionKey: run.requesterSessionKey,
      sessionId: run.requesterSessionId,
    }),
    updatedAt: finiteNumber(run.endedAt, finiteNumber(run.startedAt, finiteNumber(run.createdAt))),
  };
}

/**
 * Builds the goal/process/lineage projection from already-read views.
 * All inputs are optional; empty and terminal-state inputs return empty arrays.
 *
 * Exported so the TF-0084 consistency check can build this projection and the
 * lifecycle ledger from one identical owner snapshot, instead of reading the
 * owners twice and assuming both reads saw the same thing.
 */
export function buildSessionActivityReadProjection(input: {
  sessionKey: string;
  mission?: MissionRunRecord;
  flows?: readonly SessionActivityFlowRow[];
  tasks?: readonly SessionActivityTaskRunRow[];
  bashProcesses?: readonly (ProcessSession | FinishedSession)[];
  supervisorRuns?: readonly SupervisorSessionRunSnapshot[];
  lineageRuns?: readonly SubagentRunRecord[];
  parentRun?: SubagentRunRecord;
  /**
   * Owner-read state for the goal-wake rows. Callers that pass explicit `flows`
   * and `tasks` have already read them, so the default is `known`; the
   * collecting callers below forward the state reported by the owner layer.
   */
  goalWakeRead?: "known" | "unknown";
}): SessionActivityReadProjection {
  const key = nonEmptyString(input.sessionKey);
  if (!key) {
    return { goals: [], processes: [], lineage: [], ownerRead: "known" };
  }

  const mission = input.mission?.sessionKey === key ? missionToGoal(input.mission) : undefined;
  const ownedFlows = (input.flows ?? []).filter((row) => row.owner_key === key);
  const flows = ownedFlows.map(flowToGoal);
  const goalWakeJoins = goalWakeJoinsByTaskId(ownedFlows);
  const goalTasks = (input.tasks ?? [])
    .filter((row) => row.runtime === "process" && row.owner_key === key)
    .map((row) => taskRunToProcess(row, goalWakeJoins.get(row.task_id)));
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
    ownerRead: input.goalWakeRead ?? "known",
  };
}

/**
 * Collects the read-only projection for a session. The optional `mission` is
 * the same mission row already read by the activity handler; passing it avoids
 * a second mission query and keeps the handler on existing read models.
 *
 * The owner reads themselves live in `session-lifecycle-owner-views.ts`, shared
 * with the TF-0084 lifecycle ledger so both describe the same owner records.
 */
export function collectSessionActivityReadProjection(
  sessionKey: string,
  mission?: MissionRunRecord,
  options?: { supervisor?: Pick<ProcessSupervisor, "snapshotRunsForSession"> },
): SessionActivityReadProjection {
  const views = collectSessionLifecycleOwnerViews(sessionKey, {
    mission,
    supervisor: options?.supervisor,
  });
  // Forward the owner-read state explicitly rather than relying on the shared
  // field name surviving a rename: a goal-wake DB failure must stay visible.
  return buildSessionActivityReadProjection({ ...views, goalWakeRead: views.goalWakeRead });
}
