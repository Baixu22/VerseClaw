// Runtime Lifecycle Governance -- session-scoped durable-helper cancellation
// and reaping. This is the only cleanup writer for the helper claim protocol;
// it never kills agent-wide and never replays a spawn.

import fs from "node:fs/promises";
import path from "node:path";

import { resolveConfigDir } from "../utils.js";
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
import { TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import {
  listDurableHelperRunIds,
  readDurableHelperFiles,
  removeDurableHelperRunDir,
  requestDurableHelperCancellation,
  resolveDurableHelperRoot,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";
import { GOAL_WAKE_CONTROLLER_ID } from "./goal-wake-read.js";

type DurableCleanupDatabase = Pick<OpenClawStateKyselyDatabase, "flow_runs" | "task_runs">;
type GoalWakeTaskRunRow = {
  task_id: string;
  run_id: string | null;
  owner_key: string;
  status: string;
  progress_summary: string | null;
};

export type DurableHelperReapResult =
  | {
      ok: true;
      cancelled: number;
      finalized: number;
      removed: number;
      timedOut: boolean;
    }
  | {
      ok: false;
      reason: "helper-timeout" | "unknown-owner";
      message: string;
      cancelled: number;
      finalized: number;
      removed: number;
      timedOut: boolean;
    };

type DurableClaim = {
  runId: string;
  nonce: string;
  ownerEpoch: string;
};

function parseClaim(raw: string | null | undefined): DurableClaim | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { runId?: unknown; runNonce?: unknown; ownerEpoch?: unknown };
    if (
      typeof parsed.runId === "string" &&
      typeof parsed.runNonce === "string" &&
      typeof parsed.ownerEpoch === "string"
    ) {
      return { runId: parsed.runId, nonce: parsed.runNonce, ownerEpoch: parsed.ownerEpoch };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isHelperAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function countActiveDurableHelperRunsForSession(
  sessionKey: string,
): Promise<number> {
  if (!sessionKey.trim()) return 0;
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<DurableCleanupDatabase>(db);
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("task_runs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("runtime", "=", "process")
      .where("owner_key", "=", sessionKey.trim())
      .where("run_id", "is not", null)
      .where("status", "in", ["queued", "running"]),
  ).rows[0];
  return Number(row?.count ?? 0);
}

async function listDurableTaskRowsForSession(sessionKey: string): Promise<GoalWakeTaskRunRow[]> {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<DurableCleanupDatabase>(db);
  return executeSqliteQuerySync<GoalWakeTaskRunRow>(
    db,
    query
      .selectFrom("task_runs")
      .select(["task_id", "run_id", "owner_key", "status", "progress_summary"])
      .where("runtime", "=", "process")
      .where("owner_key", "=", sessionKey)
      .where("run_id", "is not", null),
  ).rows;
}

async function cancelGoalWakeFlowsForTask(taskId: string): Promise<number> {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<DurableCleanupDatabase>(db);
  const rows = executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("blocked_task_id", "=", taskId)
      .where("status", "in", ["waiting", "running"]),
  ).rows;
  let cancelled = 0;
  for (const row of rows) {
    const store = new TaskFlowCasStore();
    const result = store.casUpsert({
      flowId: row.flow_id,
      expectedRevision: Number(row.revision ?? 0),
      status: "cancelled",
      controllerId: GOAL_WAKE_CONTROLLER_ID,
      ownerKey: row.owner_key,
      currentStep: "session-cleanup",
      stateJson: row.state_json ?? undefined,
      waitJson: null,
      blockedTaskId: row.blocked_task_id ?? undefined,
      blockedSummary: row.blocked_summary ?? undefined,
      deliveryState: "session-cleanup",
    });
    if (result.ok) cancelled += 1;
  }
  return cancelled;
}

/** Terminal truth is exit.json/control protocol; cleanup never calls wake. */
export async function finalizeDurableCleanupRows(params: {
  taskId: string;
  status: "cancelled" | "lost" | "needs_cleanup";
  error?: string;
  terminalSummary?: string;
}): Promise<{ taskStatus: string; cancelledFlows: number }> {
  let taskStatus = "queued";
  runOpenClawStateWriteTransaction(() => {
    const { db } = openOpenClawStateDatabase();
    const query = getNodeSqliteKysely<DurableCleanupDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("task_runs").selectAll().where("task_id", "=", params.taskId),
    );
    taskStatus = existing?.status ?? taskStatus;
    if (
      existing &&
      existing.status !== "succeeded" &&
      existing.status !== "failed" &&
      existing.status !== "timed_out" &&
      existing.status !== "cancelled" &&
      existing.status !== "lost" &&
      existing.status !== "needs_cleanup"
    ) {
      executeSqliteQuerySync(
        db,
        query
          .updateTable("task_runs")
          .set({
            status: params.status,
            ended_at: Date.now(),
            last_event_at: Date.now(),
            error: params.error ?? existing.error,
            terminal_summary: params.terminalSummary ?? existing.terminal_summary,
            terminal_outcome: "cancelled",
          })
          .where("task_id", "=", params.taskId),
      );
      taskStatus = params.status;
    }
  });
  return { taskStatus, cancelledFlows: await cancelGoalWakeFlowsForTask(params.taskId) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDirExists(runId: string, options: DurableHelperProtocolOptions): Promise<boolean> {
  try {
    await fs.access(path.join(options.rootDir, runId));
    return true;
  } catch {
    return false;
  }
}

/** PIDs of live started helpers for OS containment evidence during drain. */
export async function snapshotDurableHelperPidsForSession(
  sessionKey: string,
  options: DurableHelperProtocolOptions = {
    rootDir: resolveDurableHelperRoot(resolveConfigDir()),
  },
): Promise<number[]> {
  const rows = await listDurableTaskRowsForSession(sessionKey);
  const pids = new Set<number>();
  for (const row of rows) {
    if (!row.run_id) continue;
    const files = await readDurableHelperFiles(row.run_id, options).catch(() => undefined);
    if (!files?.started) continue;
    if (isHelperAlive(files.started.helperPid)) pids.add(files.started.helperPid);
    if (isHelperAlive(files.started.childPid)) pids.add(files.started.childPid);
  }
  return [...pids].sort((a, b) => a - b);
}

async function waitForHelperToSettle(
  runId: string,
  files: Awaited<ReturnType<typeof readDurableHelperFiles>>,
  options: DurableHelperProtocolOptions,
  deadlineMs: number,
): Promise<Awaited<ReturnType<typeof readDurableHelperFiles>>> {
  let current = files;
  while (Date.now() < deadlineMs) {
    if (current.exit) return current;
    if (!current.started || !isHelperAlive(current.started.helperPid)) return current;
    await delay(100);
    current = await readDurableHelperFiles(runId, options).catch(() => current);
  }
  return current;
}

/**
 * Cancel + reap every durable helper row owned by a session. Called inside
 * drainScope while the admission fence is closed. A live helper that ignores
 * control.json within the budget makes the whole drain fail closed.
 */
export async function cancelAndReapDurableHelpersForSession(params: {
  sessionKey: string;
  options?: DurableHelperProtocolOptions;
  timeoutMs: number;
  now?: number;
}): Promise<DurableHelperReapResult> {
  const options =
    params.options ?? { rootDir: resolveDurableHelperRoot(resolveConfigDir()) };
  const startedAt = params.now ?? Date.now();
  const deadlineMs = startedAt + Math.max(1, Math.floor(params.timeoutMs));
  const rows = await listDurableTaskRowsForSession(params.sessionKey);
  if (rows.length === 0) {
    return { ok: true, cancelled: 0, finalized: 0, removed: 0, timedOut: false };
  }
  let cancelled = 0;
  let finalized = 0;
  let removed = 0;

  for (const row of rows) {
    const runId = row.run_id;
    if (!runId) continue;
    const claim = parseClaim(row.progress_summary);
    const terminal = ["succeeded", "failed", "timed_out", "cancelled", "lost", "needs_cleanup"].includes(
      row.status,
    );
    let files = await readDurableHelperFiles(runId, options).catch(() => undefined);
    if (!files?.intent) {
      if (!terminal) {
        const final = await finalizeDurableCleanupRows({
          taskId: row.task_id,
          status: "lost",
          error: "durable helper intent missing during session cleanup",
          terminalSummary: "durable helper intent missing; command was not replayed",
        });
        finalized += final.taskStatus === "lost" ? 1 : 0;
      }
      if (await runDirExists(runId, options)) {
        await removeDurableHelperRunDir(runId, options).catch(() => undefined);
        removed += 1;
      }
      continue;
    }

    const effectiveClaim = claim ?? {
      runId,
      nonce: files.intent.nonce,
      ownerEpoch: files.intent.ownerEpoch,
    };

    if (!files.control && !files.exit && files.started && isHelperAlive(files.started.helperPid)) {
      await requestDurableHelperCancellation(
        {
          runId,
          nonce: effectiveClaim.nonce,
          ownerEpoch: effectiveClaim.ownerEpoch,
          reason: "session-lifecycle",
        },
        options,
      ).catch(async (error) => {
        throw new Error(
          `durable helper cancellation claim failed for ${runId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      cancelled += 1;
    }

    files = await waitForHelperToSettle(runId, files, options, deadlineMs);
    if (files.exit) {
      if (!terminal) {
        const final = await finalizeDurableCleanupRows({
          taskId: row.task_id,
          status: "cancelled",
          terminalSummary: `session cleanup reaped durable helper exitCode=${files.exit.exitCode ?? "none"} signal=${files.exit.signal ?? "none"} timedOut=${files.exit.timedOut}`,
        });
        finalized += final.taskStatus === "cancelled" ? 1 : 0;
      }
    } else if (!files.started || !isHelperAlive(files.started.helperPid)) {
      if (!terminal) {
        const final = await finalizeDurableCleanupRows({
          taskId: row.task_id,
          status: "lost",
          error: "durable helper is not live during session cleanup; command was not replayed",
          terminalSummary: "durable helper lost during session cleanup",
        });
        finalized += final.taskStatus === "lost" ? 1 : 0;
      }
    } else {
      return {
        ok: false,
        reason: "helper-timeout",
        message: `durable helper ${runId} did not settle within ${params.timeoutMs}ms`,
        cancelled,
        finalized,
        removed,
        timedOut: true,
      };
    }

    if (await runDirExists(runId, options)) {
      await removeDurableHelperRunDir(runId, options).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      removed += 1;
    }
  }

  for (const orphanRunId of await listDurableHelperRunIds(options).catch(() => [])) {
    const orphanFiles = await readDurableHelperFiles(orphanRunId, options).catch(() => undefined);
    if (!orphanFiles?.intent) continue;
    const ownerEpoch = orphanFiles.intent.ownerEpoch;
    const belongsToSession = rows.some((row) => {
      const rowClaim = parseClaim(row.progress_summary);
      return (rowClaim?.ownerEpoch ?? "") === ownerEpoch;
    });
    if (!belongsToSession) continue;
    if (await runDirExists(orphanRunId, options)) {
      await removeDurableHelperRunDir(orphanRunId, options).catch(() => undefined);
      removed += 1;
    }
  }

  return { ok: true, cancelled, finalized, removed, timedOut: false };
}

/** Quota overflow transitions existing rows to needs_cleanup without clearing
 *  task/flow truth. The helper is still asked to exit through control.json. */
export async function markSessionDurableHelpersNeedsCleanup(
  sessionKey: string,
  options: DurableHelperProtocolOptions = {
    rootDir: resolveDurableHelperRoot(resolveConfigDir()),
  },
): Promise<number> {
  const rows = await listDurableTaskRowsForSession(sessionKey);
  let marked = 0;
  for (const row of rows) {
    if (["succeeded", "failed", "timed_out", "cancelled", "lost", "needs_cleanup"].includes(row.status)) {
      continue;
    }
    const claim = parseClaim(row.progress_summary);
    if (claim) {
      const files = await readDurableHelperFiles(claim.runId, options).catch(() => undefined);
      if (files?.intent && !files.exit && files.started && isHelperAlive(files.started.helperPid)) {
        await requestDurableHelperCancellation(
          {
            runId: claim.runId,
            nonce: claim.nonce,
            ownerEpoch: claim.ownerEpoch,
            reason: "run-dir-quota",
          },
          options,
        ).catch(() => undefined);
      }
    }
    const final = await finalizeDurableCleanupRows({
      taskId: row.task_id,
      status: "needs_cleanup",
      error: "durable helper quota reached; runDir cleanup required",
      terminalSummary: "durable helper quota reached",
    });
    if (final.taskStatus === "needs_cleanup") marked += 1;
  }
  return marked;
}
