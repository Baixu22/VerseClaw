import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import { containDurableHelper } from "./goal-wake-cancel.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";
import { getGoalWakeFlowRow, getGoalWakeTaskRunRow } from "./goal-wake-read.js";
import { startDurableHelperRecoveryService } from "./goal-wake-recovery.js";
import { ackGoalWaitYield, finalizeGoalWaitTaskProcess } from "./goal-wake-runtime.js";
import { expireOverdueGoalWaits, listOverdueGoalWaits } from "./goal-wake-timeout.js";
import { saveMissionRun } from "./mission-control/store.js";
import type { MissionRunRecord } from "./mission-control/types.js";

const tempRoots: string[] = [];
const SESSION_KEY = "agent:timeout-main:main";
const MISSION_ID = "mission-timeout";

function fixture(missionId = MISSION_ID): MissionRunRecord {
  const now = Date.now();
  return {
    missionId,
    sessionKey: SESSION_KEY,
    agentId: "timeout-main",
    objective: "goal wait deadline coverage",
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-timeout-"));
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

const HOUR = 60 * 60 * 1000;

describe("goal wait deadlines", () => {
  it("does not expire a wait that is still inside its bound", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      timeoutMs: HOUR,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;

    expect(listOverdueGoalWaits(Date.now())).toEqual([]);
    const outcomes = await expireOverdueGoalWaits({ now: Date.now() });
    expect(outcomes).toEqual([]);
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("queued");
  });

  it("ignores a wait that was armed without a bound", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    // An unbounded wait is a deliberate choice, not an overdue one.
    expect(listOverdueGoalWaits(Date.now() + 10 * HOUR)).toEqual([]);
    expect(await expireOverdueGoalWaits({ now: Date.now() + 10 * HOUR })).toEqual([]);
  });

  it("expires an overdue wait into one timed_out continuation", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      timeoutMs: 1_000,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    const now = Date.now() + 5_000;
    const overdue = listOverdueGoalWaits(now);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.taskId).toBe(arm.taskId);
    expect(overdue[0]?.missionId).toBe(MISSION_ID);

    const dispatched: string[] = [];
    const outcomes = await expireOverdueGoalWaits({
      now,
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.taskStatus).toBe("timed_out");
    expect(outcomes[0]?.continuation).toBe("dispatched");
    expect(outcomes[0]?.helperCancelRequested).toBe(false);
    expect(outcomes[0]?.helperCancelError).toBeUndefined();
    expect(dispatched).toHaveLength(1);

    // Durable terminal truth on every layer, and the wait is settled.
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("timed_out");
    expect(getGoalWakeTaskRunRow(arm.taskId)?.error).toContain("1000ms bound");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");

    // Sweeping again must not produce a second continuation.
    const again = await expireOverdueGoalWaits({
      now: now + 60_000,
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(again).toEqual([]);
    expect(dispatched).toHaveLength(1);
  });

  it("never rewrites the truth of a dependency that beat the deadline", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      timeoutMs: 1_000,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    // The process exits before the sweep runs; its truth must win.
    await finalizeGoalWaitTaskProcess(
      { taskId: arm.taskId, status: "succeeded" },
      { skipWake: true },
    );

    const outcomes = await expireOverdueGoalWaits({ now: Date.now() + 60_000 });
    // The wait is revisited rather than skipped, but only to reconcile its wake:
    // the barrier is still pending here, so there is nothing to dispatch yet.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.reconciledOnly).toBe(true);
    expect(outcomes[0]?.continuation).toBe("barrier-pending");
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("succeeded");
  });

  it("stays terminal and produces nothing new across a restart", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      timeoutMs: 1_000,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    const dispatched: string[] = [];
    await expireOverdueGoalWaits({
      now: Date.now() + 5_000,
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(dispatched).toHaveLength(1);

    // Restart: drop every in-memory artefact and re-derive from durable rows.
    closeOpenClawStateDatabase();
    const after = await expireOverdueGoalWaits({
      now: Date.now() + 120_000,
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(after).toEqual([]);
    const levelCheck = await runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(levelCheck.flows).toEqual([]);
    expect(dispatched).toHaveLength(1);
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("timed_out");
  });
});

describe("deadline sweep gating and reconciliation", () => {
  it("starts nothing when goal-wake and the durable helper are both off", () => {
    // Default config must behave exactly as before the deadline sweep existed:
    // relaxing the service gate must not introduce a timer where there was none.
    const service = startDurableHelperRecoveryService({});
    expect(service.started).toBe(false);
    service.stop();
  });

  it("reconciles a wake that was lost after the terminal write", async () => {
    enable();
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: MISSION_ID,
      sessionKey: SESSION_KEY,
      expectedRevision: 0,
      timeoutMs: 1_000,
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await ackGoalWaitYield({ flowId: arm.flowId });

    // Reproduce the hole: the row is terminal but the wake never landed, so the
    // flow is still live and nothing else in the system revisits this row.
    await finalizeGoalWaitTaskProcess(
      { taskId: arm.taskId, status: "succeeded" },
      { skipWake: true },
    );
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("succeeded");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("waiting");

    const dispatched: string[] = [];
    const outcomes = await expireOverdueGoalWaits({
      now: Date.now() + 5_000,
      dispatch: async (input) => {
        dispatched.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.reconciledOnly).toBe(true);
    expect(outcomes[0]?.taskStatus).toBe("succeeded");
    expect(outcomes[0]?.continuation).toBe("dispatched");
    expect(dispatched).toHaveLength(1);
    // The dependency's own truth is preserved: it was not rewritten to timed_out.
    expect(getGoalWakeTaskRunRow(arm.taskId)?.status).toBe("succeeded");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");
  });

  it("does not treat a missing helper claim as a containment failure", async () => {
    // A reaped run dir means our helper is already gone, not uncontained.
    // Reporting it as a failure would fail every ordinary cancel closed.
    const contained = await containDurableHelper(
      { runId: "run-missing", nonce: "nonce-1", ownerEpoch: "epoch-1" },
      "cancelled",
      { rootDir: path.join(os.tmpdir(), "goal-wake-timeout-no-such-root") },
    );
    expect(contained.state).toBe("already-gone");
    if (contained.state !== "already-gone") return;
    expect(contained.reason).toContain("already reaped");
  });
});
