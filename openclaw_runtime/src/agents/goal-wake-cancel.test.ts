import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import { cancelGoalWakeWaitsForMission } from "./goal-wake-cancel.js";
import {
  runGoalWakeLevelCheckForMission,
  runGoalWakeLevelCheckForTask,
} from "./goal-wake-dispatch.js";
import { missionFencingController } from "./goal-wake-fencing.js";
import {
  getGoalWakeFlowRow,
  getGoalWakeTaskRunRow,
  listActiveGoalWakeFlowsForMission,
} from "./goal-wake-read.js";
import { ackGoalWaitYield, finalizeGoalWaitTaskProcess } from "./goal-wake-runtime.js";
import { cancelMission, pauseMission, resumeMission } from "./mission-control/controller.js";
import { getMissionRun, saveMissionRun } from "./mission-control/store.js";
import type { MissionRunRecord } from "./mission-control/types.js";

const tempRoots: string[] = [];

const MISSION_ID = "mission-cancel-cascade";
const SESSION_KEY = "agent:cancel-main:main";

function fixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: MISSION_ID,
    sessionKey: SESSION_KEY,
    agentId: "cancel-main",
    objective: "cancel cascade coverage",
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
    ...overrides,
  };
}

function enable() {
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
}

/** Arm one wait and drive its dependency to terminal with the barrier acked. */
async function armAndSettleDependency(): Promise<{ taskId: string; flowId: string }> {
  const arm = await armGoalWaitProcess({
    missionId: MISSION_ID,
    sessionKey: SESSION_KEY,
    expectedRevision: 0,
  });
  if (!arm.ok) throw new Error(`arm failed: ${arm.reason}`);
  await finalizeGoalWaitTaskProcess({ taskId: arm.taskId, status: "succeeded" });
  await ackGoalWaitYield({ flowId: arm.flowId });
  return { taskId: arm.taskId, flowId: arm.flowId };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-cancel-"));
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

describe("mission cancel cascade", () => {
  it("drives task, flow and mission pointer list to terminal", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    expect(getMissionRun(MISSION_ID)?.metadata?.activeWaitFlowIds).toEqual([arm.flowId]);

    cancelMission(MISSION_ID);
    const cascade = await cancelGoalWakeWaitsForMission({ missionId: MISSION_ID });

    expect(cascade.finalizedTasks).toEqual([arm.taskId]);
    expect(cascade.flows).toHaveLength(1);
    expect(cascade.flows[0]?.outcome).toBe("cancelled");
    expect(cascade.clearedWaitFlowIds).toBe(1);
    expect(cascade.helperCancelFailures).toEqual([]);

    // Every layer is terminal, and the pointer list no longer names the flow.
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("cancelled");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
    expect(getGoalWakeFlowRow(arm.flowId)?.wait_json).toBeNull();
    expect(getMissionRun(MISSION_ID)?.status).toBe("cancelled");
    expect(getMissionRun(MISSION_ID)?.metadata?.activeWaitFlowIds).toEqual([]);
    expect(listActiveGoalWakeFlowsForMission(MISSION_ID)).toEqual([]);
  });

  it("produces no continuation after cancel even when the dependency already finished", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId } = await armAndSettleDependency();

    cancelMission(MISSION_ID);
    await cancelGoalWakeWaitsForMission({ missionId: MISSION_ID });

    // The dependency is terminal and acked — before the cascade this was
    // exactly the state that dispatched a continuation.
    const dispatched: string[] = [];
    const after = await runGoalWakeLevelCheckForTask(taskId, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(after.terminal).toBe(true);
    expect(after.flows).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("settles the flow and refuses to retry when the mission is already terminal", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId, flowId } = await armAndSettleDependency();
    // Cancel the mission without the cascade, so the dispatcher itself is the
    // only thing standing between a dead mission and an endless retry loop.
    cancelMission(MISSION_ID);

    const dispatched: string[] = [];
    const result = await runGoalWakeLevelCheckForTask(taskId, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: false, reason: "should-not-be-called" };
      },
    });
    // The injected dispatch is bypassed: the guard is in the level check, so a
    // custom dispatcher cannot be handed a dead mission either.
    expect(result.flows[0]?.outcome).toBe("mission-cancelled");
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("cancelled");

    // Second pass finds nothing: the settled flow left the selector, which is
    // what stops the dispatch-failed -> scheduleRetry live-lock.
    const second = await runGoalWakeLevelCheckForTask(taskId);
    expect(second.flows).toEqual([]);
  });

  it("keeps a mid-tick cancel from being reverted by the finishing tick", async () => {
    enable();
    saveMissionRun(fixture({ status: "sleeping" }));
    const claim = missionFencingController.claimMissionTick({
      missionId: MISSION_ID,
      expectedRevision: 0,
      activeTickId: "tick-midflight",
      allowedStatuses: ["idle", "sleeping", "ask_user"],
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    // Cancel lands while the tick is in flight.
    cancelMission(MISSION_ID);
    expect(getMissionRun(MISSION_ID)?.status).toBe("cancelled");

    // The tick now finishes carrying its pre-cancel in-memory status.
    const finished = missionFencingController.finishMissionTick({
      missionId: MISSION_ID,
      expectedRevision: getMissionRun(MISSION_ID)?.revision ?? 0,
      activeTickId: "tick-midflight",
      status: "sleeping",
    });
    expect(finished.ok).toBe(true);
    expect(getMissionRun(MISSION_ID)?.status).toBe("cancelled");
    expect(getMissionRun(MISSION_ID)?.activeTickId).toBeNull();
  });
});

describe("cancel/exit race and restart reconciliation", () => {
  it("keeps one terminal outcome when the dependency exits after cancel", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;

    cancelMission(MISSION_ID);
    await cancelGoalWakeWaitsForMission({ missionId: MISSION_ID });
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("cancelled");

    // The real process exits a moment later. Terminal truth is absorbing, so
    // the late exit must not rewrite the row or resurrect the wait.
    const late = await finalizeGoalWaitTaskProcess({
      taskId: arm.taskId,
      status: "succeeded",
    });
    expect(late.task?.status).toBe("cancelled");
    expect(late.levelCheck.flows).toEqual([]);
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
  });

  it("keeps one terminal outcome when cancel lands after the dependency exits", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId, flowId } = await armAndSettleDependency();
    // Exit first, cancel second — the mirror of the race above.
    cancelMission(MISSION_ID);
    const cascade = await cancelGoalWakeWaitsForMission({ missionId: MISSION_ID });
    expect(cascade.flows[0]?.outcome).toBe("cancelled");
    // The task had already succeeded; cancel must not rewrite that truth.
    expect(getGoalWakeTaskRunRow(taskId)?.status).toBe("succeeded");
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("cancelled");

    const dispatched: string[] = [];
    const after = await runGoalWakeLevelCheckForTask(taskId, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(after.flows).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("reconciles from durable rows after a restart and never replays", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId, flowId } = await armAndSettleDependency();

    // Simulate a process restart: drop every in-memory artefact (retry timers,
    // backoff map, DB handle) so the next pass can only use durable rows.
    closeOpenClawStateDatabase();

    const dispatched: string[] = [];
    const reconciled = await runGoalWakeLevelCheckForMission(MISSION_ID, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.flows[0]?.outcome).toBe("dispatched");
    expect(dispatched).toHaveLength(1);
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("succeeded");

    // Restart again: level-triggered means the settled wait produces nothing.
    closeOpenClawStateDatabase();
    const again = await runGoalWakeLevelCheckForMission(MISSION_ID, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(again).toEqual([]);
    expect(dispatched).toHaveLength(1);
    expect(getGoalWakeTaskRunRow(taskId)?.status).toBe("succeeded");
  });

  it("stays terminal across a restart after a cancel cascade", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId, flowId } = await armAndSettleDependency();
    cancelMission(MISSION_ID);
    await cancelGoalWakeWaitsForMission({ missionId: MISSION_ID });

    closeOpenClawStateDatabase();

    const dispatched: string[] = [];
    const reconciled = await runGoalWakeLevelCheckForMission(MISSION_ID, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    // A restart must not revive a cancelled mission's waits.
    expect(reconciled).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("cancelled");
    // The dependency had already succeeded before the cancel; that terminal
    // truth is absorbing and survives the restart unchanged.
    expect(getGoalWakeTaskRunRow(taskId)?.status).toBe("succeeded");
    expect(getMissionRun(MISSION_ID)?.status).toBe("cancelled");
  });
});

describe("mission pause and resume", () => {
  it("parks a wait without retrying, then continues it on resume", async () => {
    enable();
    saveMissionRun(fixture());
    const { taskId, flowId } = await armAndSettleDependency();

    pauseMission(MISSION_ID);
    const parked = await runGoalWakeLevelCheckForTask(taskId);
    expect(parked.flows[0]?.outcome).toBe("mission-parked");
    // Parked is not destroyed, and not claimed either: the wait stays exactly
    // as armed so resume can pick it up without a revision fixup.
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("waiting");

    resumeMission(MISSION_ID);
    const dispatched: string[] = [];
    const reconciled = await runGoalWakeLevelCheckForMission(MISSION_ID, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.flows[0]?.outcome).toBe("dispatched");
    expect(dispatched).toHaveLength(1);
    expect(getGoalWakeFlowRow(flowId)?.status).toBe("succeeded");
  });
});
