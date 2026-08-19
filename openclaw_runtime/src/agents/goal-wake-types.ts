// Runtime Lifecycle Governance — shared goal-wake type contracts.
import type { Selectable } from "kysely";

import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import type { CasFlowRow } from "../tasks/task-flow-cas.js";

export type GoalWakeTaskRunRow = Selectable<OpenClawStateKyselyDatabase["task_runs"]>;

export type GoalWakeBarrier = "pending" | "acked";

export type GoalWakeWaitJson = {
  v: 1;
  turnBarrier: GoalWakeBarrier;
  continuation: "mission_tick";
  missionId: string;
  sessionKey: string;
  tickId?: string;
  dependency: {
    kind: "process";
    taskId: string;
  };
  timeoutMs?: number;
  commandDigest?: string;
  /** Durable helper metadata; omitted on the Phase 3 same-gateway path. */
  runId?: string;
  ownerEpoch?: string;
  runNonce?: string;
};

export type GoalWakeBudgets = {
  enabled: boolean;
  maxActiveGoalWaits: number;
  maxFlows: number;
  tickFailureBackoffMs: number;
};

export type GoalWakeArmInput = {
  missionId: string;
  sessionKey: string;
  agentId?: string;
  expectedRevision: number;
  activeTickId?: string | null;
  taskId?: string;
  flowId?: string;
  /** Sanitized command reference. Raw argv/env/command text is never persisted. */
  label?: string;
  commandDigest?: string;
  timeoutMs?: number;
  wakeId?: string;
  /** Set only when the explicit Phase 4 durable-helper gate is enabled. */
  durableRun?: {
    runId: string;
    ownerEpoch: string;
    nonce: string;
    policyRevision: string;
  };
};

export type GoalWakeArmFailureReason =
  | "flag-disabled"
  | "revision-conflict"
  | "mission-not-found"
  | "session-mismatch"
  | "status-conflict"
  | "duplicate-wait"
  | "budget-exceeded"
  | "illegal-transition"
  | "arm-failed";

export type GoalWakeArmResult =
  | {
      ok: true;
      taskId: string;
      flowId: string;
      missionRevision: number;
      flowRevision: number;
      turnBarrier: GoalWakeBarrier;
      taskStatus: GoalWakeTaskRunRow["status"];
      flowStatus: CasFlowRow["status"];
      terminalLevelCheck: "queued" | "terminal";
    }
  | { ok: false; reason: GoalWakeArmFailureReason; message?: string };

export type GoalWakeAckResult =
  | { ok: true; flowId: string; revision: number; alreadyAcked: boolean; dispatched: boolean }
  | {
      ok: false;
      reason:
        | "flag-disabled"
        | "not-found"
        | "not-goal-wake"
        | "revision-conflict"
        | "illegal-transition"
        | "session-mismatch"
        | "error";
      message?: string;
    };

export type GoalWakeTaskExitInput = {
  taskId: string;
  status: "succeeded" | "failed" | "timed_out" | "cancelled" | "lost";
  exitCode?: number | null;
  exitSignal?: string | null;
  endedAt?: number;
  lastEventAt?: number;
  error?: string;
  terminalSummary?: string;
  terminalOutcome?: "succeeded" | "blocked";
};

export type GoalWakeDispatchInput = {
  missionId: string;
  sessionKey: string;
  flowId: string;
  wakeId: string;
  taskId: string;
  taskStatus: GoalWakeTaskRunRow["status"];
  exitCode?: number | null;
  exitSignal?: string | null;
  error?: string;
  terminalSummary?: string;
};

export type GoalWakeDispatchResult =
  | { ok: true; duplicate: boolean; missionRevision?: number }
  | { ok: false; reason: string; message?: string };

export type GoalWakeDispatch = (
  input: GoalWakeDispatchInput,
) => Promise<GoalWakeDispatchResult>;

export type GoalWakeLevelCheckResult = {
  taskId: string;
  taskStatus: GoalWakeTaskRunRow["status"];
  terminal: boolean;
  flows: Array<{
    flowId: string;
    outcome:
      | "barrier-pending"
      | "dispatched"
      | "duplicate-wake"
      | "already-terminal"
      | "dispatch-failed"
      | "flow-missing";
    reason?: string;
  }>;
};

export type GoalWakeArmFailure = Error & { reason: GoalWakeArmFailureReason };

export function normalizeGoalWakeNumber(
  value: number | bigint | null | undefined,
): number | undefined {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

export function parseGoalWakeWaitJson(raw: string | null | undefined): GoalWakeWaitJson | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<GoalWakeWaitJson>;
    if (parsed?.v !== 1 || typeof parsed.turnBarrier !== "string") return undefined;
    return {
      v: 1,
      turnBarrier: parsed.turnBarrier === "acked" ? "acked" : "pending",
      continuation: "mission_tick",
      missionId: typeof parsed.missionId === "string" ? parsed.missionId : "",
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : "",
      ...(typeof parsed.tickId === "string" ? { tickId: parsed.tickId } : {}),
      dependency: {
        kind: "process",
        taskId:
          parsed.dependency && typeof parsed.dependency === "object"
            ? String((parsed.dependency as { taskId?: unknown }).taskId ?? "")
            : "",
      },
      ...(typeof parsed.timeoutMs === "number" ? { timeoutMs: parsed.timeoutMs } : {}),
      ...(typeof parsed.commandDigest === "string" ? { commandDigest: parsed.commandDigest } : {}),
      ...(typeof parsed.runId === "string" ? { runId: parsed.runId } : {}),
      ...(typeof parsed.ownerEpoch === "string" ? { ownerEpoch: parsed.ownerEpoch } : {}),
      ...(typeof parsed.runNonce === "string" ? { runNonce: parsed.runNonce } : {}),
    };
  } catch {
    return undefined;
  }
}
