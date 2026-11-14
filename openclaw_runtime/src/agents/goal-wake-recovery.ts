// Runtime Lifecycle Governance -- startup + low-frequency durable-helper
// recovery. Level-triggered only: it reconciles protocol files to durable
// task/flow truth and never replays a spawn.
import fs from "node:fs";
import path from "node:path";

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
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { resolveConfigDir } from "../utils.js";
import { goalWakeEnabled, resolveDurableHelperPolicy } from "./goal-wake-config.js";
import { expireOverdueGoalWaits } from "./goal-wake-timeout.js";
import {
  durableRunOutputBytes,
  listDurableHelperRunIds,
  readDurableHelperFiles,
  readDurableHelperTail,
  removeDurableHelperRunDir,
  resolveDurableHelperRoot,
  type DurableHelperExit,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";
import { markSessionDurableHelpersNeedsCleanup } from "./goal-wake-durable-cleanup.js";
import {
  ProcessRunReconciler,
  type DurableProcessReconcileResult,
} from "./process-run-reconciler.js";
import type { GoalWakeTaskRunRow } from "./goal-wake-types.js";
import { GOAL_WAKE_CONTROLLER_ID } from "./goal-wake-read.js";
import {
  beginGoalWakeRecovery,
  isCurrentGoalWakeRecovery,
  matchesGoalWakeRecovery,
  recordGoalWakeRecovery,
  type GoalWakeRecoveryContext,
  type GoalWakeRecoveryGate,
} from "./goal-wake-recovery-admission.js";

type RecoveryDatabase = Pick<OpenClawStateKyselyDatabase, "task_runs" | "flow_runs">;

function isHelperAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isTerminalTaskStatus(status: string): boolean {
  return ["succeeded", "failed", "timed_out", "cancelled", "lost", "needs_cleanup"].includes(
    status,
  );
}

async function getTaskByRunId(runId: string): Promise<GoalWakeTaskRunRow | undefined> {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<RecoveryDatabase>(db);
  return executeSqliteQueryTakeFirstSync(
    db,
    query
      .selectFrom("task_runs")
      .selectAll()
      .where("run_id", "=", runId)
      .where("runtime", "=", "process")
      .where("task_kind", "=", "goal-owned-process"),
  );
}

async function listRecoveryRunIds(): Promise<string[]> {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<RecoveryDatabase>(db);
  const rows = executeSqliteQuerySync<{ run_id: string | null }>(
    db,
    query
      .selectFrom("task_runs")
      .select("run_id")
      .where("runtime", "=", "process")
      .where("task_kind", "=", "goal-owned-process")
      .where("run_id", "is not", null)
      .where((eb) =>
        eb.or([
          eb("status", "in", ["queued", "running"]),
          eb.exists(
            eb
              .selectFrom("flow_runs")
              .select("flow_id")
              .whereRef("blocked_task_id", "=", "task_runs.task_id")
              .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
              .where("flow_runs.status", "in", ["waiting", "running"]),
          ),
        ]),
      ),
  ).rows;
  return [...new Set(rows.map((row) => String(row.run_id)).filter(Boolean))];
}

function mapExitToTaskStatus(
  exit: DurableHelperExit,
  cancelled: boolean,
): "succeeded" | "failed" | "timed_out" | "cancelled" {
  if (cancelled) return "cancelled";
  if (exit.timedOut) return "timed_out";
  if (exit.exitCode === 0) return "succeeded";
  return "failed";
}

async function writeTaskRunningClaim(params: {
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

async function finalizeTaskFromExit(params: {
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
    if (isTerminalTaskStatus(existing.status)) {
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
              : existing.error,
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

async function finalizeTaskLost(params: {
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
    if (params.recovery) recordGoalWakeRecovery(params.recovery, existing, true);
    updated = true;
  });
  return updated;
}

export type DurableRecoveryOutcome = {
  runId: string;
  state: DurableProcessReconcileResult["state"];
  reason: DurableProcessReconcileResult["reason"];
  taskStatus?: string;
};

/** Reconciles one durable run: task terminal first, then flow level-check,
 *  then mission tick effect-owner dedupe through the existing dispatcher. */
export async function reconcileDurableRun(params: {
  runId: string;
  options: DurableHelperProtocolOptions;
  ownerEpoch?: string;
  dispatch?: NonNullable<Parameters<typeof runGoalWakeLevelCheckForTask>[1]>["dispatch"];
  cfg?: OpenClawConfig;
  isHelperAlive?: (pid: number) => boolean | Promise<boolean>;
}): Promise<DurableRecoveryOutcome> {
  const task = await getTaskByRunId(params.runId);
  const files = await readDurableHelperFiles(params.runId, params.options);
  const gate = task
    ? beginGoalWakeRecovery(task, files, params.cfg, params.ownerEpoch)
    : { kind: "legacy" as const };
  return reconcileObservedDurableRun(params, task, gate);
}

async function reconcileObservedDurableRun(
  params: Parameters<typeof reconcileDurableRun>[0],
  task: GoalWakeTaskRunRow | undefined,
  gate: GoalWakeRecoveryGate,
): Promise<DurableRecoveryOutcome> {
  let taskStatus = task?.status;
  if (gate.kind === "rejected")
    return { runId: params.runId, state: "lost", reason: "owner-epoch-mismatch", taskStatus };
  const recovery = gate.kind === "ready" ? gate.context : undefined;
  const levelCheck = async () => {
    if (!task || (recovery && !isCurrentGoalWakeRecovery(recovery))) return;
    taskStatus = (await getTaskByRunId(params.runId))?.status;
    await runGoalWakeLevelCheckForTask(task.task_id, {
      dispatch: params.dispatch,
      cfg: params.cfg,
    });
  };
  const reconciler = new ProcessRunReconciler({
    rootDir: params.options.rootDir,
    isHelperAlive: params.isHelperAlive ?? isHelperAlive,
    onRunning: async ({ helperPid, childPid, runNonce }) => {
      if (!task) return;
      if (
        await writeTaskRunningClaim({
          taskId: task.task_id,
          helperPid,
          childPid,
          runNonce,
          recovery,
        })
      )
        taskStatus = "running";
    },
    onTerminal: async ({ exit }) => {
      if (!task) return;
      const files = await readDurableHelperFiles(params.runId, params.options);
      const tail = await readDurableHelperTail(params.runId, params.options);
      const finalized = await finalizeTaskFromExit({
        taskId: task.task_id,
        exit,
        cancelled: Boolean(files.control),
        tail,
        recovery,
      });
      if (finalized) await levelCheck();
    },
    onLost: async ({ reason }) => {
      if (!task) return;
      if (await finalizeTaskLost({ taskId: task.task_id, reason, recovery })) await levelCheck();
    },
  });

  const result = await reconciler.reconcile({
    runId: params.runId,
    ...(params.ownerEpoch ? { ownerEpoch: params.ownerEpoch } : {}),
  });
  if (recovery && !isCurrentGoalWakeRecovery(recovery)) {
    return {
      runId: params.runId,
      state: "lost",
      reason: "owner-epoch-mismatch",
      taskStatus: (await getTaskByRunId(params.runId))?.status,
    };
  }
  return {
    runId: params.runId,
    state: result.state,
    reason: result.reason,
    ...(taskStatus ? { taskStatus } : {}),
  };
}

function intentAgeMs(
  intent: NonNullable<Awaited<ReturnType<typeof readDurableHelperFiles>>["intent"]>,
  now: number,
): number {
  return Math.max(0, now - Date.parse(intent.createdAt));
}

/** One level-triggered sweep. Returns outcomes for audit/test evidence. */
export async function runDurableHelperSweepOnce(
  params: {
    options?: DurableHelperProtocolOptions;
    cfg?: OpenClawConfig;
    now?: number;
    dispatch?: NonNullable<Parameters<typeof runGoalWakeLevelCheckForTask>[1]>["dispatch"];
  } = {},
): Promise<DurableRecoveryOutcome[]> {
  const options = params.options ?? { rootDir: resolveDurableHelperRoot(resolveConfigDir()) };
  const policy = resolveDurableHelperPolicy(params.cfg);
  const now = params.now ?? Date.now();
  const runIds = new Set([
    ...(await listRecoveryRunIds().catch(() => [])),
    ...(await listDurableHelperRunIds(options).catch(() => [])),
  ]);
  const outcomes: DurableRecoveryOutcome[] = [];

  for (const runId of runIds) {
    const files = await readDurableHelperFiles(runId, options).catch(() => undefined);
    const task = await getTaskByRunId(runId);
    if (!files?.intent && (!task || !isTerminalTaskStatus(task.status))) continue;
    const gate = task
      ? beginGoalWakeRecovery(task, files ?? {}, params.cfg)
      : { kind: "legacy" as const };
    if (gate.kind === "rejected") {
      outcomes.push({
        runId,
        state: "lost",
        reason: "owner-epoch-mismatch",
        taskStatus: task?.status,
      });
      continue;
    }
    if (!files?.intent) {
      if (task && (gate.kind === "legacy" || isCurrentGoalWakeRecovery(gate.context)))
        await runGoalWakeLevelCheckForTask(task.task_id, {
          dispatch: params.dispatch,
          cfg: params.cfg,
        });
      outcomes.push({
        runId,
        state: "terminal",
        reason: "intent-missing",
        taskStatus: task?.status,
      });
      continue;
    }
    const ageMs = intentAgeMs(files.intent, now);
    const expired = policy.runTtlMs > 0 && ageMs > policy.runTtlMs;
    if (expired) {
      if (files.exit || !files.started || !isHelperAlive(files.started.helperPid)) {
        const outcome = await reconcileObservedDurableRun(
          { runId, options, dispatch: params.dispatch, cfg: params.cfg },
          task,
          gate,
        );
        outcomes.push(outcome);
        if (
          ["terminal", "lost"].includes(outcome.state) &&
          outcome.reason !== "owner-epoch-mismatch"
        )
          await removeDurableHelperRunDir(runId, options).catch(() => undefined);
        continue;
      }
    }

    if (task && !isTerminalTaskStatus(task.status)) {
      const outputBytes = await durableRunOutputBytes(runId, options).catch(() => 0);
      if (policy.maxOutputBytesPerRun > 0 && outputBytes > policy.maxOutputBytesPerRun) {
        if (gate.kind === "ready" && !isCurrentGoalWakeRecovery(gate.context)) continue;
        await markSessionDurableHelpersNeedsCleanup(task.owner_key, options);
        outcomes.push({
          runId,
          state: "lost",
          reason: "intent-without-started",
          taskStatus: "needs_cleanup",
        });
        continue;
      }
      const ownerEpoch = (() => {
        try {
          return JSON.parse(task.progress_summary ?? "{}") as { ownerEpoch?: unknown };
        } catch {
          return {};
        }
      })();
      const outcome = await reconcileObservedDurableRun(
        {
          runId,
          options,
          ...(typeof ownerEpoch.ownerEpoch === "string"
            ? { ownerEpoch: ownerEpoch.ownerEpoch }
            : {}),
          dispatch: params.dispatch,
          cfg: params.cfg,
        },
        task,
        gate,
      );
      outcomes.push(outcome);
    } else {
      if (task && (gate.kind === "legacy" || isCurrentGoalWakeRecovery(gate.context)))
        await runGoalWakeLevelCheckForTask(task.task_id, {
          dispatch: params.dispatch,
          cfg: params.cfg,
        });
      outcomes.push({
        runId,
        state: files.exit
          ? "terminal"
          : files.started && isHelperAlive(files.started.helperPid)
            ? "running"
            : "lost",
        reason: files.exit
          ? "exit-observed"
          : files.started
            ? "helper-live"
            : "intent-without-started",
        ...(task ? { taskStatus: task.status } : {}),
      });
    }
  }
  return outcomes;
}

export type DurableHelperRecoveryService = {
  started: boolean;
  stop: () => void;
  sweepOnce: () => Promise<DurableRecoveryOutcome[]>;
};

/**
 * Starts the startup reconciliation + low-frequency sweep. No spawn replay is
 * possible: every path goes through ProcessRunReconciler and file/OS liveness.
 */
export function startDurableHelperRecoveryService(
  params: {
    cfg?: OpenClawConfig;
    options?: DurableHelperProtocolOptions;
    now?: () => number;
    dispatch?: NonNullable<Parameters<typeof runGoalWakeLevelCheckForTask>[1]>["dispatch"];
  } = {},
): DurableHelperRecoveryService {
  const policy = resolveDurableHelperPolicy(params.cfg);
  // Wait deadlines must be enforced whenever goal-wake is on, not only when the
  // Phase 4 durable helper is. A same-gateway wait has no run dir for the
  // durable sweep to find, so gating deadline enforcement on the helper policy
  // would leave `timeoutMs` unenforced on exactly the default path.
  const deadlineSweepEnabled = goalWakeEnabled(params.cfg);
  if (!policy.enabled && !deadlineSweepEnabled) {
    return {
      started: false,
      stop: () => {},
      sweepOnce: async () => [],
    };
  }

  const options = params.options ?? { rootDir: resolveDurableHelperRoot(resolveConfigDir()) };
  let stopped = false;
  let sweepTimer: NodeJS.Timeout | null = null;
  const watchers = new Map<string, fs.FSWatcher>();
  const debounce = new Map<string, NodeJS.Timeout>();

  const sweepOnce = async (): Promise<DurableRecoveryOutcome[]> => {
    // Deadline enforcement rides the same sweep tick; it never gets its own
    // timer. Failures here must not skip the durable reconciliation below.
    if (deadlineSweepEnabled) {
      await expireOverdueGoalWaits({
        ...(params.cfg ? { cfg: params.cfg } : {}),
        ...(params.now ? { now: params.now() } : {}),
        ...(params.dispatch ? { dispatch: params.dispatch } : {}),
        options,
      }).catch(() => undefined);
    }
    if (!policy.enabled) return [];
    const outcomes = await runDurableHelperSweepOnce({
      options,
      cfg: params.cfg,
      now: params.now?.(),
      dispatch: params.dispatch,
    });
    for (const outcome of outcomes) {
      if (outcome.state !== "running") continue;
      const runDir = path.join(options.rootDir, outcome.runId);
      if (watchers.has(outcome.runId)) continue;
      const onEvent = () => {
        const timer = debounce.get(outcome.runId);
        if (timer) clearTimeout(timer);
        const next = setTimeout(() => {
          debounce.delete(outcome.runId);
          void runDurableHelperSweepOnce({
            options,
            cfg: params.cfg,
            now: params.now?.(),
            dispatch: params.dispatch,
          }).catch(() => undefined);
        }, 250);
        next.unref?.();
        debounce.set(outcome.runId, next);
      };
      try {
        const watcher = fs.watch(runDir, { persistent: false }, onEvent);
        watcher.unref?.();
        watchers.set(outcome.runId, watcher);
      } catch {
        // Some filesystems do not support fs.watch on the runDir. The
        // low-frequency sweep remains the fail-closed fallback.
      }
    }
    return outcomes;
  };

  const schedule = () => {
    if (stopped || policy.sweepIntervalMs <= 0) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      void sweepOnce().finally(schedule);
    }, policy.sweepIntervalMs);
    sweepTimer.unref?.();
  };

  void sweepOnce().finally(schedule);

  return {
    started: true,
    stop: () => {
      stopped = true;
      if (sweepTimer) clearTimeout(sweepTimer);
      for (const watcher of watchers.values()) watcher.close();
      for (const timer of debounce.values()) clearTimeout(timer);
      watchers.clear();
      debounce.clear();
    },
    sweepOnce,
  };
}
