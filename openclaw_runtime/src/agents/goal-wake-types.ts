// Runtime Lifecycle Governance — shared goal-wake type contracts.
import type { Selectable } from "kysely";

import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import type { CasFlowRow } from "../tasks/task-flow-cas.js";

export type GoalWakeTaskRunRow = Selectable<OpenClawStateKyselyDatabase["task_runs"]>;

export type GoalWakeBarrier = "pending" | "acked";

/**
 * The condition sources a mission may park on.
 *
 * All of them are modelled as a dependency on one `task_runs` row so they share
 * a single ledger, a single level-check, and a single dedupe path. `timer` in
 * particular does NOT get its own scheduler: the existing Cron service fires an
 * `at` job that finalizes the timer's task row, after which the normal
 * level-check produces the continuation.
 *
 * `approval` and `event` are kept distinct because `MissionTickInput.reason`
 * already distinguishes them, and a mission that resumes from a human decision
 * is not the same audit story as one that resumes from an external signal.
 */
export type GoalWakeTriggerKind = "process" | "child" | "timer" | "approval" | "event";

export const GOAL_WAKE_TRIGGER_KINDS: readonly GoalWakeTriggerKind[] = [
  "process",
  "child",
  "timer",
  "approval",
  "event",
];

export function isGoalWakeTriggerKind(value: unknown): value is GoalWakeTriggerKind {
  return (
    typeof value === "string" &&
    (GOAL_WAKE_TRIGGER_KINDS as readonly string[]).includes(value)
  );
}

/** A wait's single dependency. `taskId` is the join key for every kind. */
export type GoalWakeDependency = {
  kind: GoalWakeTriggerKind;
  taskId: string;
  /** `child` only: the spawned session this wait is bound to. */
  childSessionKey?: string;
  /** `timer` only: epoch ms the Cron `at` job is scheduled for. */
  fireAt?: number;
  /** `timer` only: the Cron job id that owns the fire, for cancel cascade. */
  cronJobId?: string;
  /** `approval` only: the approval request this wait is bound to. */
  approvalId?: string;
  /** `event` only: the external signal this wait is bound to. */
  eventId?: string;
  eventKind?: string;
};

export type GoalWakeWaitJson = {
  v: 1;
  turnBarrier: GoalWakeBarrier;
  continuation: "mission_tick";
  missionId: string;
  sessionKey: string;
  tickId?: string;
  dependency: GoalWakeDependency;
  timeoutMs?: number;
  commandDigest?: string;
  /** Durable helper metadata; omitted on the Phase 3 same-gateway path. */
  runId?: string;
  ownerEpoch?: string;
  runNonce?: string;
};

/**
 * The single typed continuation payload handed to `tickMission`.
 *
 * Every trigger kind converges here, so a mission tick reads one discriminated
 * shape instead of an untyped bag whose fields depend on which subsystem woke
 * it. `kind` mirrors the dependency kind that produced the wake.
 */
export type MissionContinuation =
  | {
      kind: "process";
      taskId: string;
      taskStatus: string;
      exitCode?: number;
      exitSignal?: string;
      error?: string;
      terminalSummary?: string;
    }
  | {
      kind: "child";
      taskId: string;
      taskStatus: string;
      childSessionKey?: string;
      error?: string;
      terminalSummary?: string;
    }
  | {
      kind: "timer";
      taskId: string;
      taskStatus: string;
      /** When the timer was scheduled to fire. */
      fireAt?: number;
      /** When the fire was actually observed (late fires are normal). */
      firedAt: number;
      cronJobId?: string;
    }
  | {
      kind: "approval";
      taskId: string;
      /** `succeeded` means approved; any other terminal status means it was not. */
      taskStatus: string;
      approvalId?: string;
      error?: string;
      terminalSummary?: string;
    }
  | {
      kind: "event";
      taskId: string;
      taskStatus: string;
      eventId?: string;
      eventKind?: string;
      error?: string;
      terminalSummary?: string;
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
  /**
   * Which condition this wait parks on. Defaults to `process`, so every
   * existing caller keeps its exact behaviour.
   */
  trigger?: {
    kind: GoalWakeTriggerKind;
    /** `child` only. */
    childSessionKey?: string;
    /** `timer` only: epoch ms. */
    fireAt?: number;
    /** `timer` only: owning Cron job id. */
    cronJobId?: string;
    /** `approval` only. */
    approvalId?: string;
    /** `event` only. */
    eventId?: string;
    eventKind?: string;
  };
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
  /** The wait's dependency, so the dispatcher can build the typed payload. */
  dependency?: GoalWakeDependency;
  exitCode?: number | null;
  exitSignal?: string | null;
  error?: string;
  terminalSummary?: string;
};

export type GoalWakeDispatchResult =
  | { ok: true; duplicate: boolean; missionRevision?: number }
  | {
      ok: false;
      reason: string;
      message?: string;
      /**
       * `false` means the failure is not transient: the mission can never
       * accept this wake again (cancelled/terminal) or is deliberately parked
       * (paused). The level check must NOT arm a retry timer for these, or a
       * dead mission live-locks the dispatcher every backoff window.
       */
      retryable?: boolean;
      /** Set when the mission is terminal, so the level check settles the flow. */
      missionTerminal?: boolean;
    };

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
      | "mission-cancelled"
      | "mission-parked"
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
    const dependency =
      parsed.dependency && typeof parsed.dependency === "object"
        ? (parsed.dependency as Record<string, unknown>)
        : {};
    // Unknown/absent kinds fall back to `process`: rows written before the
    // trigger union existed carry no kind and are all process waits.
    const kind = isGoalWakeTriggerKind(dependency.kind) ? dependency.kind : "process";
    return {
      v: 1,
      turnBarrier: parsed.turnBarrier === "acked" ? "acked" : "pending",
      continuation: "mission_tick",
      missionId: typeof parsed.missionId === "string" ? parsed.missionId : "",
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : "",
      ...(typeof parsed.tickId === "string" ? { tickId: parsed.tickId } : {}),
      dependency: {
        kind,
        taskId: String(dependency.taskId ?? ""),
        ...(typeof dependency.childSessionKey === "string"
          ? { childSessionKey: dependency.childSessionKey }
          : {}),
        ...(typeof dependency.fireAt === "number" ? { fireAt: dependency.fireAt } : {}),
        ...(typeof dependency.cronJobId === "string" ? { cronJobId: dependency.cronJobId } : {}),
        ...(typeof dependency.approvalId === "string"
          ? { approvalId: dependency.approvalId }
          : {}),
        ...(typeof dependency.eventId === "string" ? { eventId: dependency.eventId } : {}),
        ...(typeof dependency.eventKind === "string" ? { eventKind: dependency.eventKind } : {}),
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
