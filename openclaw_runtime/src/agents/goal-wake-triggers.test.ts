import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import { runDurableHelperSweepOnce } from "./goal-wake-recovery.js";
import { buildMissionContinuation, runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";
import { missionFencingController } from "./goal-wake-fencing.js";
import { armGoalWaitTimer } from "./goal-wake-timer.js";
import {
  findGoalWaitChildTaskBySessionKey,
  findGoalWaitTimerTaskByCronJobId,
  getGoalWakeFlowRow,
  getGoalWakeTaskRunRow,
} from "./goal-wake-read.js";
import {
  ackGoalWaitYield,
  finalizeGoalWaitTaskProcess,
  fireGoalWaitChild,
  fireGoalWaitTimer,
} from "./goal-wake-runtime.js";
import {
  parseGoalWakeWaitJson,
  type GoalWakeDispatchInput,
  type GoalWakeTriggerKind,
} from "./goal-wake-types.js";
import { saveMissionRun } from "./mission-control/store.js";
import type { MissionRunRecord } from "./mission-control/types.js";

const tempRoots: string[] = [];
const SESSION_KEY = "agent:trigger-main:main";

function fixture(missionId: string): MissionRunRecord {
  const now = Date.now();
  return {
    missionId,
    sessionKey: SESSION_KEY,
    agentId: "trigger-main",
    objective: "trigger coverage",
    acceptance: [],
    status: "running",
    phase: "execute",
    tick: 1,
    repairTicks: 0,
    maxTicks: 8,
    maxRepairTicks: 3,
    progress: 0,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ticks: [],
    activeTickId: null,
  };
}

function enable() {
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-triggers-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
  delete process.env.OPENCLAW_CONFIG_PATH;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows WAL close race; test evidence does not depend on cleanup.
    }
  }
});

const FIRE_AT = 1_800_000_000_000;

const TRIGGERS: Array<{
  kind: GoalWakeTriggerKind;
  missionId: string;
  arm: NonNullable<Parameters<typeof armGoalWaitProcess>[0]["trigger"]>;
}> = [
  { kind: "process", missionId: "mission-trigger-process", arm: { kind: "process" } },
  {
    kind: "child",
    missionId: "mission-trigger-child",
    arm: { kind: "child", childSessionKey: "agent:trigger-main:child-1" },
  },
  {
    kind: "timer",
    missionId: "mission-trigger-timer",
    arm: { kind: "timer", fireAt: FIRE_AT, cronJobId: "cron-timer-1" },
  },
  {
    kind: "approval",
    missionId: "mission-trigger-approval",
    arm: { kind: "approval", approvalId: "approval-1" },
  },
  {
    kind: "event",
    missionId: "mission-trigger-event",
    arm: { kind: "event", eventId: "event-1", eventKind: "webhook" },
  },
];

describe("goal-wake trigger kinds", () => {
  for (const trigger of TRIGGERS) {
    it(`produces exactly one deduped continuation for a ${trigger.kind} trigger`, async () => {
      enable();
      saveMissionRun(fixture(trigger.missionId));
      const arm = await armGoalWaitProcess({
        missionId: trigger.missionId,
        sessionKey: SESSION_KEY,
        expectedRevision: 0,
        trigger: trigger.arm,
      });
      expect(arm.ok).toBe(true);
      if (!arm.ok) return;

      // The kind round-trips through the durable wait ledger.
      const wait = parseGoalWakeWaitJson(getGoalWakeFlowRow(arm.flowId)?.wait_json);
      expect(wait?.dependency.kind).toBe(trigger.kind);
      expect(getGoalWakeTaskRunRow(arm.taskId)?.task_kind).toBe(`goal-owned-${trigger.kind}`);

      // Trigger-owned waits have no helper run; a helper sweep preserves their pending task.
      expect(getGoalWakeTaskRunRow(arm.taskId)?.run_id).toBeNull();
      expect(
        await runDurableHelperSweepOnce({
          options: { rootDir: path.join(process.env.OPENCLAW_STATE_DIR!, "background-processes") },
        }),
      ).toEqual([]);
      expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("queued");

      await finalizeGoalWaitTaskProcess({ taskId: arm.taskId, status: "succeeded" });
      await ackGoalWaitYield({ flowId: arm.flowId });

      const seen: GoalWakeDispatchInput[] = [];
      const first = await runGoalWakeLevelCheckForTask(arm.taskId, {
        dispatch: async (input) => {
          seen.push(input);
          return { ok: true, duplicate: false };
        },
      });
      expect(first.flows[0]?.outcome).toBe("dispatched");
      expect(seen).toHaveLength(1);

      // All three kinds converge on one typed continuation shape.
      const continuation = buildMissionContinuation(seen[0]!);
      expect(continuation.kind).toBe(trigger.kind);
      expect(continuation.taskId).toBe(arm.taskId);
      expect(continuation.taskStatus).toBe("succeeded");
      if (continuation.kind === "child") {
        expect(continuation.childSessionKey).toBe("agent:trigger-main:child-1");
      }
      if (continuation.kind === "timer") {
        expect(continuation.fireAt).toBe(FIRE_AT);
        expect(continuation.cronJobId).toBe("cron-timer-1");
        expect(typeof continuation.firedAt).toBe("number");
      }
      if (continuation.kind === "approval") {
        expect(continuation.approvalId).toBe("approval-1");
      }
      if (continuation.kind === "event") {
        expect(continuation.eventId).toBe("event-1");
        expect(continuation.eventKind).toBe("webhook");
      }

      // Re-delivery is at-least-once, so the level check must be re-runnable
      // without producing a second continuation. The settled flow is the dedupe.
      expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");
      const second = await runGoalWakeLevelCheckForTask(arm.taskId, {
        dispatch: async (input) => {
          seen.push(input);
          return { ok: true, duplicate: false };
        },
      });
      expect(second.flows).toEqual([]);
      expect(seen).toHaveLength(1);
    });
  }

  it("refuses a replayed wakeId at the mission fence for every trigger kind", async () => {
    enable();
    for (const trigger of TRIGGERS) {
      const missionId = `${trigger.missionId}-fence`;
      saveMissionRun(fixture(missionId));
      const wakeId = `wake-${trigger.kind}`;
      const claim = missionFencingController.claimMissionTick({
        missionId,
        expectedRevision: 0,
        activeTickId: `tick-${trigger.kind}`,
        wakeId,
        allowedStatuses: ["idle", "running", "sleeping", "ask_user"],
      });
      expect(claim.ok).toBe(true);
      if (!claim.ok) return;
      const finished = missionFencingController.finishMissionTick({
        missionId,
        expectedRevision: claim.revision,
        activeTickId: `tick-${trigger.kind}`,
        lastWakeId: wakeId,
        status: "sleeping",
      });
      expect(finished.ok).toBe(true);
      if (!finished.ok) return;

      // Same wake delivered twice: the durable last_wake_id refuses it.
      const replay = missionFencingController.claimMissionTick({
        missionId,
        expectedRevision: finished.revision,
        activeTickId: `tick-${trigger.kind}-replay`,
        wakeId,
        allowedStatuses: ["idle", "running", "sleeping", "ask_user"],
      });
      expect(replay.ok).toBe(false);
      if (replay.ok) return;
      expect(replay.reason).toBe("duplicate-wake");
    }
  });
});

describe("timer fire seam", () => {
  it("resolves the wait from its cron job id and fires exactly once", async () => {
    enable();
    saveMissionRun(fixture("mission-timer-fire"));
    const arm = await armGoalWaitProcess({
      missionId: "mission-timer-fire",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      trigger: { kind: "timer", fireAt: FIRE_AT, cronJobId: "cron-fire-1" },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    // Cron knows only its job id; this is the join into the goal-wake ledger.
    const resolved = findGoalWaitTimerTaskByCronJobId("cron-fire-1");
    expect(resolved?.taskId).toBe(arm.taskId);
    expect(resolved?.missionId).toBe("mission-timer-fire");
    expect(resolved?.fireAt).toBe(FIRE_AT);
    expect(findGoalWaitTimerTaskByCronJobId("cron-unknown")).toBeUndefined();

    const fired = await fireGoalWaitTimer({ taskId: arm.taskId, firedAt: FIRE_AT + 25 });
    expect(fired.task?.status).toBe("succeeded");
    expect(fired.levelCheck.flows[0]?.outcome).toBe("dispatched");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");

    // Cron delivery is at-least-once: a redelivered fire must be a no-op.
    const again = await fireGoalWaitTimer({ taskId: arm.taskId, firedAt: FIRE_AT + 900 });
    expect(again.task?.status).toBe("succeeded");
    expect(again.levelCheck.flows).toEqual([]);
    // The settled wait is no longer reachable from the cron job id either.
    expect(findGoalWaitTimerTaskByCronJobId("cron-fire-1")).toBeUndefined();
  });
});

describe("child fire seam", () => {
  it("resolves the wait from its child session key and fires exactly once", async () => {
    enable();
    saveMissionRun(fixture("mission-child-fire"));
    const childSessionKey = "agent:trigger-main:child-fire";
    const arm = await armGoalWaitProcess({
      missionId: "mission-child-fire",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      trigger: { kind: "child", childSessionKey },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    // The completion path knows only the child session key.
    const resolved = findGoalWaitChildTaskBySessionKey(childSessionKey);
    expect(resolved?.taskId).toBe(arm.taskId);
    expect(resolved?.missionId).toBe("mission-child-fire");
    expect(findGoalWaitChildTaskBySessionKey("agent:trigger-main:other")).toBeUndefined();

    const fired = await fireGoalWaitChild({ taskId: arm.taskId });
    expect(fired.task?.status).toBe("succeeded");
    expect(fired.levelCheck.flows[0]?.outcome).toBe("dispatched");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");

    // A redelivered completion must be a no-op.
    const again = await fireGoalWaitChild({ taskId: arm.taskId });
    expect(again.task?.status).toBe("succeeded");
    expect(again.levelCheck.flows).toEqual([]);
    expect(findGoalWaitChildTaskBySessionKey(childSessionKey)).toBeUndefined();
  });

  it("carries a failed subagent outcome into the continuation", async () => {
    enable();
    saveMissionRun(fixture("mission-child-failed"));
    const arm = await armGoalWaitProcess({
      missionId: "mission-child-failed",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      trigger: { kind: "child", childSessionKey: "agent:trigger-main:child-failed" },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    const seen: GoalWakeDispatchInput[] = [];
    await fireGoalWaitChild({ taskId: arm.taskId, status: "failed", error: "child crashed" });
    const levelCheck = await runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async (input) => {
        seen.push(input);
        return { ok: true, duplicate: false };
      },
    });
    // Already dispatched by the fire itself; the re-run is a no-op.
    expect(levelCheck.flows).toEqual([]);
    expect(seen).toEqual([]);
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("failed");
    expect(getGoalWakeTaskRunRow(arm.taskId)?.error).toBe("child crashed");
  });
});

describe("timer wait scheduling on cron", () => {
  function fakeCron() {
    const added: Array<Record<string, unknown>> = [];
    const removed: string[] = [];
    let next = 0;
    return {
      added,
      removed,
      facade: {
        add: async (input: Record<string, unknown>) => {
          added.push(input);
          next += 1;
          return { id: `cron-job-${next}` };
        },
        remove: async (id: string) => {
          removed.push(id);
          return undefined;
        },
      },
    };
  }

  it("hands the deadline to cron as a one-shot at job and binds it to the wait", async () => {
    enable();
    saveMissionRun(fixture("mission-timer-cron"));
    const cron = fakeCron();
    const fireAt = Date.now() + 60_000;
    const armed = await armGoalWaitTimer({
      missionId: "mission-timer-cron",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      fireAt,
      cron: cron.facade as never,
    });
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;

    // Exactly one job, one-shot, carrying only ledger identity.
    expect(cron.added).toHaveLength(1);
    const job = cron.added[0]!;
    expect(job.schedule).toEqual({ kind: "at", at: new Date(fireAt).toISOString() });
    expect(job.deleteAfterRun).toBe(true);
    expect(job.payload).toEqual({
      kind: "missionContinuation",
      taskId: armed.taskId,
      missionId: "mission-timer-cron",
    });
    expect(cron.removed).toEqual([]);

    // The wait knows which job owns its deadline, and vice versa.
    expect(armed.cronJobId).toBe("cron-job-1");
    expect(findGoalWaitTimerTaskByCronJobId("cron-job-1")?.taskId).toBe(armed.taskId);

    // Firing it via the cron seam produces the continuation exactly once.
    await ackGoalWaitYield({ flowId: armed.flowId });
    const fired = await fireGoalWaitTimer({ taskId: armed.taskId });
    expect(fired.levelCheck.flows[0]?.outcome).toBe("dispatched");
    expect(getGoalWakeFlowRow(armed.flowId)?.status).toBe("succeeded");
  });

  it("removes the scheduled job when the arm is refused", async () => {
    enable();
    // No mission row: the arm must fail, and the deadline must not survive it.
    const cron = fakeCron();
    const armed = await armGoalWaitTimer({
      missionId: "mission-timer-missing",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      fireAt: Date.now() + 60_000,
      cron: cron.facade as never,
    });
    expect(armed.ok).toBe(false);
    if (armed.ok) return;
    expect(armed.reason).toBe("mission-not-found");
    expect(cron.added).toHaveLength(1);
    expect(cron.removed).toEqual(["cron-job-1"]);
  });

  it("refuses a deadline that cron could never schedule", async () => {
    enable();
    saveMissionRun(fixture("mission-timer-past"));
    const cron = fakeCron();
    const armed = await armGoalWaitTimer({
      missionId: "mission-timer-past",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      fireAt: Date.now() - 1_000,
      cron: cron.facade as never,
    });
    expect(armed.ok).toBe(false);
    // Refused before anything was scheduled or armed.
    expect(cron.added).toEqual([]);
  });
});

describe("goal-wake trigger defaults", () => {
  it("defaults a wait with no recorded trigger kind to process", async () => {
    enable();
    saveMissionRun(fixture("mission-trigger-default"));
    const arm = await armGoalWaitProcess({
      missionId: "mission-trigger-default",
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    expect(parseGoalWakeWaitJson(getGoalWakeFlowRow(arm.flowId)?.wait_json)?.dependency.kind).toBe(
      "process",
    );
    // Rows written before the union existed carry no kind at all.
    expect(
      parseGoalWakeWaitJson(
        JSON.stringify({
          v: 1,
          turnBarrier: "pending",
          continuation: "mission_tick",
          missionId: "legacy",
          sessionKey: SESSION_KEY,
          dependency: { taskId: "task-legacy" },
        }),
      )?.dependency,
    ).toEqual({ kind: "process", taskId: "task-legacy" });
  });
});
