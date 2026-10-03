import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import { ackGoalWaitYield, finalizeGoalWaitTaskProcess } from "./goal-wake-runtime.js";
import {
  countActiveGoalWakeRowsForSession,
  getGoalWakeFlowRow,
  getGoalWaitTask,
  getLatestMissionForSession,
} from "./goal-wake-read.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";
import { resolveGoalWakeBudgets } from "./goal-wake-config.js";
import { TaskFlowCasStore } from "../tasks/task-flow-cas.js";
import type { MissionRunRecord } from "./mission-control/types.js";
import { getMissionRun, saveMissionRun } from "./mission-control/store.js";

const tempRoots: string[] = [];
let stateDir = "";

function fixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-runtime-goal",
    sessionKey: "agent:runtime-main:main",
    agentId: "runtime-main",
    objective: "runtime goal wake coverage",
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

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-runtime-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
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
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows WAL close race; test evidence does not depend on cleanup.
    }
  }
});

describe("goal-wake arm validation", () => {
  it("rejects arm when mission status is not running", async () => {
    enable();
    saveMissionRun(fixture({ status: "sleeping" }));
    const result = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("status-conflict");
  });

  it("rejects arm for another session and another agent", async () => {
    enable();
    saveMissionRun(fixture());
    const wrongSession = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:other:main",
      expectedRevision: 0,
    });
    expect(wrongSession.ok).toBe(false);
    if (wrongSession.ok) return;
    expect(wrongSession.reason).toBe("session-mismatch");

    const wrongAgent = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      agentId: "other-agent",
      expectedRevision: 0,
    });
    expect(wrongAgent.ok).toBe(false);
    if (wrongAgent.ok) return;
    expect(wrongAgent.reason).toBe("session-mismatch");
  });

  it("rejects a stale active tick id and leaves the mission untouched", async () => {
    enable();
    saveMissionRun(fixture({ activeTickId: "tick-real" }));
    const result = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
      activeTickId: "tick-stale",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("status-conflict");
    expect(getMissionRun("mission-runtime-goal")?.status).toBe("running");
    expect(getMissionRun("mission-runtime-goal")?.revision).toBe(0);
  });

  it("returns the existing wait idempotently instead of creating a second ledger row", async () => {
    enable();
    saveMissionRun(fixture());
    const first = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
      taskId: "task-idempotent",
      flowId: "flow-idempotent",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const mission = getMissionRun("mission-runtime-goal");
    expect(mission?.status).toBe("sleeping");

    saveMissionRun({
      ...getMissionRun("mission-runtime-goal")!,
      status: "running",
      activeTickId: null,
    });
    const second = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 1,
      taskId: "task-idempotent",
      flowId: "flow-idempotent",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.flowId).toBe("flow-idempotent");
    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    const db = new DatabaseSync(dbPath);
    const flowCount = db.prepare(
      "SELECT COUNT(*) AS count FROM flow_runs WHERE controller_id = 'goal-wake'",
    ).get() as { count: number | bigint };
    expect(Number(flowCount.count)).toBe(1);
    db.close();
  });

  it("honors max active waits and max flows budgets independently", async () => {
    enable();
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS = "0";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS = "1";
    saveMissionRun(fixture({ missionId: "mission-runtime-goal-a" }));
    const first = await armGoalWaitProcess({
      missionId: "mission-runtime-goal-a",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(first.ok).toBe(true);
    saveMissionRun(fixture({ missionId: "mission-runtime-goal-b" }));
    const second = await armGoalWaitProcess({
      missionId: "mission-runtime-goal-b",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("budget-exceeded");
    expect(resolveGoalWakeBudgets().maxFlows).toBe(1);
  });

  it("frees flow budget as waits reach terminal so history never exhausts capacity", async () => {
    enable();
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS = "2";
    // Drive more waits than the budget through to terminal, one at a time.
    // Before the active-row fix the third arm failed: two settled rows were
    // still counted as held capacity, so the budget never recovered.
    for (let index = 0; index < 4; index += 1) {
      const missionId = `mission-budget-history-${index}`;
      saveMissionRun(fixture({ missionId }));
      const arm = await armGoalWaitProcess({
        missionId,
        sessionKey: "agent:runtime-main:main",
        expectedRevision: 0,
      });
      expect(arm.ok, `arm #${index} must not be refused by historical rows`).toBe(true);
      if (!arm.ok) return;
      await finalizeGoalWaitTaskProcess({ taskId: arm.taskId, status: "succeeded" });
      await ackGoalWaitYield({ flowId: arm.flowId });
      await runGoalWakeLevelCheckForTask(arm.taskId, {
        dispatch: async () => ({ ok: true, duplicate: false }),
      });
      expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");
    }

    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    const db = new DatabaseSync(dbPath);
    const total = db
      .prepare("SELECT COUNT(*) AS count FROM flow_runs WHERE controller_id = 'goal-wake'")
      .get() as { count: number | bigint };
    db.close();
    // History accumulated well past maxFlows without ever blocking an arm.
    expect(Number(total.count)).toBe(4);
  });

  it("still refuses a new wait while the budget is genuinely held by active rows", async () => {
    enable();
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS = "2";
    for (let index = 0; index < 2; index += 1) {
      saveMissionRun(fixture({ missionId: `mission-budget-active-${index}` }));
      const arm = await armGoalWaitProcess({
        missionId: `mission-budget-active-${index}`,
        sessionKey: "agent:runtime-main:main",
        expectedRevision: 0,
      });
      expect(arm.ok).toBe(true);
    }
    saveMissionRun(fixture({ missionId: "mission-budget-active-overflow" }));
    const overflow = await armGoalWaitProcess({
      missionId: "mission-budget-active-overflow",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.reason).toBe("budget-exceeded");
  });
});

describe("goal-wake barrier and task finalization", () => {
  it("acks only waiting goal-wake flows owned by the caller session", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;

    const missing = await ackGoalWaitYield({ flowId: "flow-missing" });
    expect(missing.ok).toBe(false);
    const wrongSession = await ackGoalWaitYield({
      flowId: arm.flowId,
      sessionKey: "agent:other:main",
    });
    expect(wrongSession.ok).toBe(false);
    if (wrongSession.ok) return;
    expect(wrongSession.reason).toBe("session-mismatch");

    const ack = await ackGoalWaitYield({
      flowId: arm.flowId,
      sessionKey: "agent:runtime-main:main",
    });
    expect(ack.ok).toBe(true);
    expect(ack.alreadyAcked).toBe(false);
    const again = await ackGoalWaitYield({
      flowId: arm.flowId,
      sessionKey: "agent:runtime-main:main",
    });
    expect(again.ok).toBe(true);
    expect(again.alreadyAcked).toBe(true);
    expect(getGoalWakeFlowRow(arm.flowId)?.wait_json).toContain('"turnBarrier":"acked"');
  });

  it("refuses to ack a non-goal-wake flow and non-waiting statuses", async () => {
    enable();
    const store = new TaskFlowCasStore();
    store.casUpsert({
      flowId: "flow-other-controller",
      expectedRevision: -1,
      status: "waiting",
      controllerId: "core/legacy-restored",
    });
    const wrongController = await ackGoalWaitYield({ flowId: "flow-other-controller" });
    expect(wrongController.ok).toBe(false);
    if (wrongController.ok) return;
    expect(wrongController.reason).toBe("not-goal-wake");

    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const claim = new TaskFlowCasStore().casUpsert({
      flowId: arm.flowId,
      expectedRevision: 0,
      status: "running",
      controllerId: "goal-wake",
      ownerKey: "agent:runtime-main:main",
    });
    expect(claim.ok).toBe(true);
    const nonWaiting = await ackGoalWaitYield({ flowId: arm.flowId });
    expect(nonWaiting.ok).toBe(false);
    if (nonWaiting.ok) return;
    expect(nonWaiting.reason).toBe("illegal-transition");
  });

  it("finalizes only task_runs and reports a missing task", async () => {
    enable();
    const missing = await finalizeGoalWaitTaskProcess({
      taskId: "task-missing",
      status: "succeeded",
    });
    expect(missing.task).toBeUndefined();
    expect(missing.levelCheck.flows[0]?.outcome).toBe("flow-missing");

    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const finalized = await finalizeGoalWaitTaskProcess({
      taskId: arm.taskId,
      status: "failed",
      exitCode: 7,
      error: "fixture failure",
    });
    expect(finalized.task?.status).toBe("failed");
    expect(finalized.task?.error).toBe("fixture failure");
    expect(finalized.levelCheck.flows[0]?.outcome).toBe("barrier-pending");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("waiting");
    expect(getMissionRun("mission-runtime-goal")?.status).toBe("sleeping");
  });

  it("level-check dispatches only acked terminal tasks and flow succeeds on effect ack", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const queued = await runGoalWakeLevelCheckForTask(arm.taskId);
    expect(queued.terminal).toBe(false);

    await finalizeGoalWaitTaskProcess({ taskId: arm.taskId, status: "succeeded" });
    const pending = await runGoalWakeLevelCheckForTask(arm.taskId);
    expect(pending.flows[0]?.outcome).toBe("barrier-pending");

    await ackGoalWaitYield({ flowId: arm.flowId });
    const effects: string[] = [];
    const wake = await runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async (input) => {
        effects.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(wake.flows[0]?.outcome).toBe("dispatched");
    expect(effects).toHaveLength(1);
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");
  });
});

describe("goal-wake read probes", () => {
  it("counts active task/flow rows and exposes mission context", async () => {
    enable();
    expect(countActiveGoalWakeRowsForSession("agent:runtime-main:main")).toEqual({
      tasks: 0,
      flows: 0,
    });
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-runtime-goal",
      sessionKey: "agent:runtime-main:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    expect(countActiveGoalWakeRowsForSession("agent:runtime-main:main")).toEqual({
      tasks: 1,
      flows: 1,
    });
    expect(getGoalWaitTask(arm.taskId)?.runtime).toBe("process");
    expect(getLatestMissionForSession("agent:runtime-main:main")?.missionId).toBe(
      "mission-runtime-goal",
    );
    await finalizeGoalWaitTaskProcess({ taskId: arm.taskId, status: "succeeded" });
    await ackGoalWaitYield({ flowId: arm.flowId });
    await runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async () => ({ ok: true, duplicate: false }),
    });
    expect(countActiveGoalWakeRowsForSession("agent:runtime-main:main")).toEqual({
      tasks: 0,
      flows: 0,
    });
  });
});
