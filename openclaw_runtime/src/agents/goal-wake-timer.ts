// Runtime Lifecycle Governance — mission timer waits on the Cron scheduler.
//
// A mission timer deliberately owns no timer of its own. The Cron service
// already runs exactly one self-rescheduling `setTimeout`, so this arms a
// normal goal-wake wait and hands the *deadline* to Cron as a one-shot `at`
// job. When it fires, the injected runner calls `fireGoalWaitTimer`, which
// finalizes the wait's task row and lets the ordinary level check produce the
// continuation. No second scheduler, and no second continuation path.
import { randomUUID } from "node:crypto";

import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import type { CronJobCreate } from "../cron/types.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import type { GoalWakeArmResult } from "./goal-wake-types.js";

/**
 * The slice of the Cron service this needs, injected so the goal-wake layer
 * never imports the cron service at runtime.
 */
export type GoalWaitTimerCronFacade = {
  add(input: CronJobCreate): Promise<{ id: string }>;
  remove(id: string): Promise<unknown>;
};

/**
 * Cron only schedules an `at` job whose time is still in the future, and its
 * loop floors a due re-fire at 2s. Requiring a margin keeps the arm from
 * silently producing a job that is already unschedulable.
 */
export const GOAL_WAIT_TIMER_MIN_LEAD_MS = 2_000;

export type GoalWaitTimerArmResult =
  | (Extract<GoalWakeArmResult, { ok: true }> & { cronJobId: string; fireAt: number })
  | Extract<GoalWakeArmResult, { ok: false }>;

/**
 * Arm a mission wait that continues when a deadline passes.
 *
 * Ordering: the Cron job is created first so the wait is never armed against a
 * deadline that does not exist; if the arm then fails, the job is removed again
 * so no orphan timer survives. The reverse order could park a mission forever
 * behind a timer nobody scheduled.
 */
export async function armGoalWaitTimer(
  params: {
    missionId: string;
    sessionKey: string;
    expectedRevision: number;
    fireAt: number;
    agentId?: string;
    activeTickId?: string | null;
    label?: string;
    cron: GoalWaitTimerCronFacade;
    now?: number;
  },
  cfg?: OpenClawConfig,
  options: OpenClawStateDatabaseOptions = {},
): Promise<GoalWaitTimerArmResult> {
  const now = params.now ?? Date.now();
  if (!Number.isFinite(params.fireAt) || params.fireAt < now + GOAL_WAIT_TIMER_MIN_LEAD_MS) {
    return {
      ok: false,
      reason: "arm-failed",
      message: `timer fireAt must be at least ${GOAL_WAIT_TIMER_MIN_LEAD_MS}ms in the future`,
    };
  }

  // The task id is generated up front because the Cron payload has to name the
  // ledger row it will finalize, and the wait has to name the job that owns its
  // deadline. One of the two ids must exist before either write.
  const taskId = `task_${randomUUID()}`;
  const created = await params.cron.add({
    name: `mission timer ${params.missionId}`,
    enabled: true,
    schedule: { kind: "at", at: new Date(params.fireAt).toISOString() },
    sessionTarget: "isolated",
    wakeMode: "now",
    // One-shot: the Cron loop removes it after a successful fire.
    deleteAfterRun: true,
    payload: {
      kind: "missionContinuation",
      taskId,
      missionId: params.missionId,
    },
  } as CronJobCreate);

  const armed = await armGoalWaitProcess(
    {
      missionId: params.missionId,
      sessionKey: params.sessionKey,
      expectedRevision: params.expectedRevision,
      taskId,
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.activeTickId !== undefined ? { activeTickId: params.activeTickId } : {}),
      ...(params.label ? { label: params.label } : {}),
      trigger: { kind: "timer", fireAt: params.fireAt, cronJobId: created.id },
    },
    cfg,
    options,
  );

  if (!armed.ok) {
    // Fail closed: never leave a scheduled deadline with no wait behind it.
    await params.cron.remove(created.id).catch(() => undefined);
    return armed;
  }
  return { ...armed, cronJobId: created.id, fireAt: params.fireAt };
}
