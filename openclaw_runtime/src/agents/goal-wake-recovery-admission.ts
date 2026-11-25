/** Bind durable-helper observations to the original task and Session owner. */
import { createHash } from "node:crypto";
import type { RecoveryOwnerAdmission } from "../../../shared/recovery-authority/contract.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../state/openclaw-state-db.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import {
  buildRecoveryAdmissionKey,
  isRecoveryAuthorityEnabled,
  prepareOwnerRecoveryAdmission,
} from "./recovery-authority/owner-admission.js";
import type { DurableHelperFiles, DurableHelperExit } from "./goal-wake-helper-protocol.js";
import type { GoalWakeTaskRunRow } from "./goal-wake-types.js";
import { getMissionRun } from "./mission-control/store.js";

type RecoveryDatabase = Pick<DB, "task_runs">;
type TaskProgress = Record<string, unknown> & { recoveryAuthority?: RecoveryOwnerAdmission };

export type GoalWakeRecoveryContext = {
  task: GoalWakeTaskRunRow;
  cfg?: OpenClawConfig;
  missionId: string;
  epoch: string;
  nonce: string;
  boundary: string;
  progress: string;
};

export type GoalWakeRecoveryGate =
  | { kind: "legacy" }
  | { kind: "rejected" }
  | { kind: "ready"; context: GoalWakeRecoveryContext };

function progress(raw: string | null): TaskProgress {
  if (!raw) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Durable helper task progress is malformed.");
  return value as TaskProgress;
}

function currentTask(taskId: string): GoalWakeTaskRunRow | undefined {
  const { db } = openOpenClawStateDatabase();
  return executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<RecoveryDatabase>(db)
      .selectFrom("task_runs")
      .selectAll()
      .where("task_id", "=", taskId),
  );
}

function ownerMatches(context: GoalWakeRecoveryContext, task: GoalWakeTaskRunRow): boolean {
  const original = context.task;
  if (
    task.task_id !== original.task_id ||
    task.run_id !== original.run_id ||
    task.owner_key !== original.owner_key ||
    task.agent_id !== original.agent_id ||
    task.source_id !== original.source_id ||
    task.runtime !== "process"
  )
    return false;
  const saved = progress(task.progress_summary);
  if (
    saved.runId !== task.run_id ||
    saved.ownerEpoch !== context.epoch ||
    saved.runNonce !== context.nonce
  )
    return false;
  const mission = getMissionRun(context.missionId);
  if (
    !mission ||
    mission.sessionKey !== task.owner_key ||
    (task.agent_id && mission.agentId !== task.agent_id)
  )
    return false;
  const store = resolveStorePath(context.cfg?.session?.store, {
    agentId: task.agent_id ?? mission.agentId,
  });
  const entry = loadSessionStore(store, { skipCache: true })[task.owner_key];
  return Boolean(
    entry?.sessionId &&
    createHash("sha256").update(`${entry.sessionId}\u0000${context.missionId}`).digest("hex") ===
      context.epoch,
  );
}

/** Called inside the original task transaction, before task or wait mutation. */
export function matchesGoalWakeRecovery(
  context: GoalWakeRecoveryContext,
  task: GoalWakeTaskRunRow,
): boolean {
  return ownerMatches(context, task) && task.progress_summary === context.progress;
}

/** Observation never admits a new helper execution or consumes a dispatch attempt. */
export function recordGoalWakeRecovery(
  context: GoalWakeRecoveryContext,
  task: GoalWakeTaskRunRow,
  terminal: boolean,
): void {
  const saved = progress(task.progress_summary);
  const previous = saved.recoveryAuthority;
  if (
    previous &&
    (previous.ownerId !== task.task_id ||
      previous.idempotencyKey !== context.boundary ||
      previous.attempts !== 0 ||
      previous.decision?.entry !== "goal-wake-durable")
  )
    throw new Error("Durable helper recovery admission is malformed.");
  const prepared = prepareOwnerRecoveryAdmission(
    {
      requestId: context.boundary,
      entry: "goal-wake-durable",
      owner: {
        kind: "goal-wake",
        ownerId: task.task_id,
        missionId: context.missionId,
        taskId: task.task_id,
        runId: task.run_id ?? undefined,
      },
      admission: {
        trigger: "durable-helper-sweep",
        requiredPreState: "queued-or-running-task",
        admitted: true,
        visibleOutputObserved: false,
      },
      budget: {
        attempts: { current: 0, max: 1 },
        backoff: { initialMs: 0, multiplier: 1, maxMs: 0 },
        wedge: { afterAttempts: 1, wedged: false },
      },
      replayClass: "reconcile",
      effect: terminal ? "reconciled" : "unknown",
      requestedAction: "reconcile",
      idempotencyKey: context.boundary,
      evidence: [
        { kind: "domain-journal", ref: `task_runs:${task.task_id}`, role: "effect-truth" },
      ],
      requestedAt: Date.now(),
    },
    previous,
  );
  if (!prepared.record || !["reconcile", "settle"].includes(prepared.decision.kind))
    throw new Error("Durable helper recovery did not authorize observation.");
  const next = JSON.stringify({ ...saved, recoveryAuthority: prepared.record });
  const { db } = openOpenClawStateDatabase();
  const result = executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<RecoveryDatabase>(db)
      .updateTable("task_runs")
      .set({ progress_summary: next })
      .where("task_id", "=", task.task_id)
      .where("progress_summary", "=", task.progress_summary),
  );
  if (result.numAffectedRows !== 1n) throw new Error("Durable helper recovery owner changed.");
  context.progress = next;
}

export function beginGoalWakeRecovery(
  task: GoalWakeTaskRunRow,
  files: DurableHelperFiles,
  cfg?: OpenClawConfig,
  expectedEpoch?: string,
): GoalWakeRecoveryGate {
  const saved = progress(task.progress_summary);
  if (!isRecoveryAuthorityEnabled() && !saved.recoveryAuthority) return { kind: "legacy" };
  const missionId = task.source_id?.startsWith("goal-wake:")
    ? task.source_id.slice("goal-wake:".length)
    : "";
  if (
    !missionId ||
    !task.run_id ||
    typeof saved.ownerEpoch !== "string" ||
    typeof saved.runNonce !== "string" ||
    !saved.ownerEpoch.trim() ||
    !saved.runNonce.trim() ||
    (expectedEpoch && expectedEpoch !== saved.ownerEpoch)
  )
    return { kind: "rejected" };
  const context: GoalWakeRecoveryContext = {
    task,
    cfg,
    missionId,
    epoch: saved.ownerEpoch,
    nonce: saved.runNonce,
    boundary: buildRecoveryAdmissionKey(
      "goal-wake-durable",
      task.task_id,
      saved.ownerEpoch,
      JSON.stringify([task.run_id, saved.runNonce]),
    ),
    progress: task.progress_summary!,
  };
  const intent = files.intent;
  if (
    intent &&
    (intent.runId !== task.run_id ||
      intent.ownerEpoch !== context.epoch ||
      intent.nonce !== context.nonce ||
      (files.started &&
        (files.started.runNonce !== context.nonce ||
          files.started.commandDigest !== intent.commandDigest)))
  )
    return { kind: "rejected" };
  let ready = false;
  runOpenClawStateWriteTransaction(() => {
    const current = currentTask(task.task_id);
    if (!current || !matchesGoalWakeRecovery(context, current)) return;
    recordGoalWakeRecovery(
      context,
      current,
      !["queued", "running", "lost"].includes(current.status),
    );
    ready = true;
  });
  return ready ? { kind: "ready", context } : { kind: "rejected" };
}

/** Recheck the exact admitted owner before a level-triggered wait continuation. */
export function isCurrentGoalWakeRecovery(context: GoalWakeRecoveryContext): boolean {
  const current = currentTask(context.task.task_id);
  return Boolean(current && matchesGoalWakeRecovery(context, current));
}

export function isTerminalTaskStatus(status: string): boolean {
  return ["succeeded", "failed", "timed_out", "cancelled", "lost", "needs_cleanup"].includes(
    status,
  );
}

export function mapExitToTaskStatus(
  exit: DurableHelperExit,
  cancelled: boolean,
): "succeeded" | "failed" | "timed_out" | "cancelled" {
  if (cancelled) return "cancelled";
  if (exit.timedOut) return "timed_out";
  if (exit.exitCode === 0) return "succeeded";
  return "failed";
}

export async function writeTaskRunningClaim(params: {
  taskId: string;
  helperPid: number;
  childPid: number;
  runNonce: string;
  recovery?: GoalWakeRecoveryContext;
}): Promise<boolean> {
  let updated = false;
  runOpenClawStateWriteTransaction(() => {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<RecoveryDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("task_runs").selectAll().where("task_id", "=", params.taskId),
    );
    if (!existing || (params.recovery && !matchesGoalWakeRecovery(params.recovery, existing)))
      return;
    if (existing.status !== "queued") {
      updated = existing.status === "running";
      return;
    }
    executeSqliteQuerySync(
      db,
      query
        .updateTable("task_runs")
        .set({
          status: "running",
          started_at: Date.now(),
          last_event_at: Date.now(),
          progress_summary: JSON.stringify({
            ...(() => {
              try {
                return JSON.parse(existing.progress_summary ?? "{}") as Record<string, unknown>;
              } catch {
                return {};
              }
            })(),
            helperPid: params.helperPid,
            childPid: params.childPid,
            runNonce: params.runNonce,
          }),
        })
        .where("task_id", "=", params.taskId),
    );
    if (params.recovery) {
      const current = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom("task_runs").selectAll().where("task_id", "=", params.taskId),
      )!;
      recordGoalWakeRecovery(params.recovery, current, false);
    }
    updated = true;
  });
  return updated;
}

export async function finalizeTaskFromExit(params: {
  taskId: string;
  exit: DurableHelperExit;
  cancelled: boolean;
  tail: string;
  recovery?: GoalWakeRecoveryContext;
}): Promise<boolean> {
  const status = mapExitToTaskStatus(params.exit, params.cancelled);
  let updated = false;
  runOpenClawStateWriteTransaction(() => {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<RecoveryDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("task_runs").selectAll().where("task_id", "=", params.taskId),
    );
    if (!existing || (params.recovery && !matchesGoalWakeRecovery(params.recovery, existing)))
      return;
    if (isTerminalTaskStatus(existing.status) && existing.status !== "lost") {
      if (params.recovery) recordGoalWakeRecovery(params.recovery, existing, true);
      updated = true;
      return;
    }
    executeSqliteQuerySync(
      db,
      query
        .updateTable("task_runs")
        .set({
          status,
          ended_at: params.exit.endedAtMs,
          last_event_at: params.exit.endedAtMs,
          error:
            status === "failed"
              ? `goal-owned process exited ${params.exit.exitCode ?? "without an exit code"}`
              : null,
          terminal_summary:
            params.tail.trim() || `goal-owned process reached durable terminal ${status}`,
          terminal_outcome: status === "succeeded" ? "succeeded" : "blocked",
        })
        .where("task_id", "=", params.taskId),
    );
    if (params.recovery) recordGoalWakeRecovery(params.recovery, existing, true);
    updated = true;
  });
  return updated;
}

export async function finalizeTaskLost(params: {
  taskId: string;
  reason: string;
  recovery?: GoalWakeRecoveryContext;
}): Promise<boolean> {
  let updated = false;
  runOpenClawStateWriteTransaction(() => {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<RecoveryDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("task_runs").selectAll().where("task_id", "=", params.taskId),
    );
    if (!existing || (params.recovery && !matchesGoalWakeRecovery(params.recovery, existing)))
      return;
    if (isTerminalTaskStatus(existing.status)) {
      updated = true;
      return;
    }
    executeSqliteQuerySync(
      db,
      query
        .updateTable("task_runs")
        .set({
          status: "lost",
          ended_at: Date.now(),
          last_event_at: Date.now(),
          error: `durable helper lost: ${params.reason}. Command was not replayed.`,
          terminal_summary: `durable helper lost: ${params.reason}`,
          terminal_outcome: "blocked",
        })
        .where("task_id", "=", params.taskId),
    );
    if (params.recovery) recordGoalWakeRecovery(params.recovery, existing, false);
    updated = true;
  });
  return updated;
}
