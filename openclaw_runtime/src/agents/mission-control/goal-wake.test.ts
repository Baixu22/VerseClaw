import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../../state/openclaw-state-schema.generated.js";
import { goalWakeController } from "../goal-wake-controller.js";
import { TaskFlowCasStore } from "../../tasks/task-flow-cas.js";
import type { MissionRunRecord } from "./types.js";
import { getMissionRun, saveMissionRun } from "./store.js";

const tempRoots: string[] = [];
let stateDir = "";

function fixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-goal-wake-1",
    sessionKey: "agent:agent-a:main",
    agentId: "agent-a",
    objective: "prove mission fencing",
    acceptance: [],
    status: "idle",
    phase: "intake",
    tick: 0,
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
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-phase0-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("goal-wake mission fencing foundation (Phase 0)", () => {
  it("mission_runs round-trips revision/active_tick_id/last_wake_id through the read model", () => {
    const record = fixture();
    saveMissionRun(record);
    goalWakeController.saveMissionRunFenced({
      ...getMissionRun(record.missionId)!,
      status: "running",
      activeTickId: "tick-1",
      lastWakeId: "wake-1",
      updatedAt: Date.now(),
    });
    const row = getMissionRun(record.missionId);
    expect(row?.revision).toBe(1);
    expect(row?.activeTickId).toBe("tick-1");
    expect(row?.lastWakeId).toBe("wake-1");
  });

  it("legacy blind upsert remains the default-off path", () => {
    const record = fixture();
    saveMissionRun(record);
    saveMissionRun({ ...record, status: "running", updatedAt: Date.now() });
    expect(getMissionRun(record.missionId)?.revision).toBe(0);
    expect(goalWakeController.isMissionFencingEnabled()).toBe(false);
  });

  it("rejects a stale mission writer with revision CAS", () => {
    const record = fixture();
    saveMissionRun(record);
    const loaded = getMissionRun(record.missionId);
    expect(loaded?.revision).toBe(0);
    goalWakeController.saveMissionRunFenced({
      ...loaded!,
      status: "running",
      updatedAt: Date.now(),
    });
    expect(getMissionRun(record.missionId)?.revision).toBe(1);
    expect(() =>
      goalWakeController.saveMissionRunFenced({
        ...loaded!,
        status: "blocked",
        updatedAt: Date.now(),
      }),
    ).toThrow(/expected revision 0, got 1/);
    expect(getMissionRun(record.missionId)?.revision).toBe(1);
  });

  it("claimMissionTick fences on revision + allowed status and rejects duplicate wake ids", () => {
    const record = fixture();
    saveMissionRun(record);
    const first = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-1",
      wakeId: "wake-1",
      allowedStatuses: ["idle", "sleeping", "ask_user"],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.revision).toBe(1);
    expect(first.row.tick_count).toBe(1);
    expect(first.row.active_tick_id).toBe("tick-1");
    expect(first.row.last_wake_id).toBe("wake-1");

    const duplicate = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 1,
      activeTickId: "tick-2",
      wakeId: "wake-1",
      allowedStatuses: ["running"],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toBe("duplicate-wake");
    expect(getMissionRun(record.missionId)?.tick).toBe(1);

    const stale = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-stale",
      wakeId: "wake-2",
      allowedStatuses: ["running"],
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("revision-conflict");
  });

  it("finishMissionTick clears active_tick_id and preserves the consumed wake id", () => {
    const record = fixture();
    saveMissionRun(record);
    const claimed = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-1",
      wakeId: "wake-1",
      allowedStatuses: ["idle", "sleeping", "ask_user"],
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const finished = goalWakeController.finishMissionTick({
      missionId: record.missionId,
      expectedRevision: 1,
      activeTickId: "tick-1",
      status: "sleeping",
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.revision).toBe(2);
    expect(finished.row.active_tick_id).toBeNull();
    expect(finished.row.last_wake_id).toBe("wake-1");
    expect(finished.row.status).toBe("sleeping");
  });

  it("claimMissionTick rejects disallowed mission statuses and active_tick_id mismatch on finish", () => {
    const record = fixture({ status: "blocked" });
    saveMissionRun(record);
    const claim = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-1",
      allowedStatuses: ["idle", "sleeping", "ask_user"],
    });
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("status-conflict");

    const claimed = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-1",
      allowedStatuses: ["blocked", "idle", "sleeping", "ask_user"],
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const mismatch = goalWakeController.finishMissionTick({
      missionId: record.missionId,
      expectedRevision: 1,
      activeTickId: "tick-wrong",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toBe("revision-conflict");
  });

  it("existing mission/flow tables are migrated with the new fencing columns and indexes", () => {
    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(OPENCLAW_STATE_SCHEMA_SQL);
    legacy.exec(`
      ALTER TABLE mission_runs DROP COLUMN revision;
      ALTER TABLE mission_runs DROP COLUMN active_tick_id;
      ALTER TABLE mission_runs DROP COLUMN last_wake_id;
      DROP INDEX idx_flow_runs_blocked_task;
      DROP INDEX idx_flow_runs_controller_status;
    `);
    legacy.close();

    saveMissionRun(fixture());
    const migrated = new DatabaseSync(dbPath);
    const missionColumns = migrated.prepare("PRAGMA table_info(mission_runs)").all() as Array<{ name: string }>;
    expect(missionColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["revision", "active_tick_id", "last_wake_id"]),
    );
    const flowIndexes = migrated
      .prepare("PRAGMA index_list(flow_runs)")
      .all() as Array<{ name: string }>;
    expect(flowIndexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["idx_flow_runs_blocked_task", "idx_flow_runs_controller_status"]),
    );
    migrated.close();
  });

  it("fenced save persists through a real database close/reopen", () => {
    saveMissionRun(fixture());
    goalWakeController.saveMissionRunFenced({
      ...getMissionRun("mission-goal-wake-1")!,
      status: "running",
      activeTickId: "tick-1",
      updatedAt: Date.now(),
    });
    closeOpenClawStateDatabase();
    const row = getMissionRun("mission-goal-wake-1");
    expect(row?.revision).toBe(1);
    expect(row?.activeTickId).toBe("tick-1");
    expect(row?.status).toBe("running");
  });
});

describe("goal-wake arm transaction / turn barrier / wake loop (Phase 3)", () => {
  function enablePhase3() {
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS = "10";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS = "20";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
  }

  function runningFixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
    return fixture({
      status: "running",
      activeTickId: "tick-active",
      ...overrides,
    });
  }

  it("arm transaction count is exactly one immediate transaction", async () => {
    enablePhase3();
    saveMissionRun(runningFixture());
    const database = openOpenClawStateDatabase();
    let beginImmediateCount = 0;
    const originalExec = database.db.exec.bind(database.db);
    database.db.exec = ((sql: string) => {
      if (sql.trim().toUpperCase().startsWith("BEGIN IMMEDIATE")) {
        beginImmediateCount += 1;
      }
      return originalExec(sql);
    }) as typeof database.db.exec;

    const arm = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      agentId: "agent-a",
      expectedRevision: 0,
      activeTickId: "tick-active",
      label: "arm-count-fixture",
      commandDigest: "digest-arm-count",
    });

    console.log(`[runtime-lifecycle-audit] armTxCount=${beginImmediateCount}`);
    expect(beginImmediateCount).toBe(1);
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    expect(goalWakeController.getGoalWaitTask(arm.taskId)?.status).toBe("queued");
    expect(new TaskFlowCasStore().getById(arm.flowId)?.status).toBe("waiting");
    const mission = getMissionRun("mission-goal-wake-1");
    expect(mission?.status).toBe("sleeping");
    expect(mission?.revision).toBe(1);
    expect(
      (mission?.metadata?.activeWaitFlowIds as string[] | undefined)?.includes(arm.flowId),
    ).toBe(true);
  });

  it("arm commits task+flow+mission in one rollback unit and arm failure leaves no rows", async () => {
    enablePhase3();
    saveMissionRun(runningFixture());
    const failed = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      expectedRevision: 999,
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.reason).toBe("revision-conflict");

    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    const db = new DatabaseSync(dbPath);
    const taskCount = db.prepare("SELECT COUNT(*) AS count FROM task_runs").get() as { count: number | bigint };
    const flowCount = db.prepare("SELECT COUNT(*) AS count FROM flow_runs").get() as { count: number | bigint };
    expect(Number(taskCount.count)).toBe(0);
    expect(Number(flowCount.count)).toBe(0);
    expect(getMissionRun("mission-goal-wake-1")?.status).toBe("running");
    db.close();
  });

  it("turnBarrier is persisted pending by arm and acked only after the caller acks", async () => {
    enablePhase3();
    saveMissionRun(runningFixture());
    const arm = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      agentId: "agent-a",
      expectedRevision: 0,
      activeTickId: "tick-active",
      commandDigest: "digest-barrier",
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;

    const before = new TaskFlowCasStore().getById(arm.flowId);
    expect(before?.wait_json).toContain('"turnBarrier":"pending"');

    const taskExit = await goalWakeController.finalizeGoalWaitTaskProcess({
      taskId: arm.taskId,
      status: "succeeded",
    });
    expect(taskExit.levelCheck.flows[0]?.outcome).toBe("barrier-pending");
    expect(new TaskFlowCasStore().getById(arm.flowId)?.status).toBe("waiting");

    let effects = 0;
    const ack = await goalWakeController.ackGoalWaitYield({
      flowId: arm.flowId,
      sessionKey: "agent:agent-a:main",
    });
    expect(ack.ok).toBe(true);
    const acked = new TaskFlowCasStore().getById(arm.flowId);
    expect(acked?.wait_json).toContain('"turnBarrier":"acked"');

    const wake = await goalWakeController.runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async (_input) => {
        effects += 1;
        return { ok: true, duplicate: effects > 1 };
      },
    });
    expect(wake.flows[0]?.outcome).toBe("dispatched");
    expect(effects).toBe(1);
    expect(new TaskFlowCasStore().getById(arm.flowId)?.status).toBe("succeeded");
  });

  it("mission wake fencing consumes a wake id once (duplicate wake has no duplicate effect)", () => {
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    const record = fixture({ status: "sleeping" });
    saveMissionRun(record);
    const first = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 0,
      activeTickId: "tick-1",
      wakeId: "wake-dup",
      allowedStatuses: ["sleeping"],
      requireIdle: true,
    });
    expect(first.ok).toBe(true);

    const duplicate = goalWakeController.claimMissionTick({
      missionId: record.missionId,
      expectedRevision: 1,
      activeTickId: "tick-2",
      wakeId: "wake-dup",
      allowedStatuses: ["sleeping", "running"],
      requireIdle: true,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toBe("duplicate-wake");
    expect(getMissionRun(record.missionId)?.tick).toBe(1);
  });

  it("spawn outcome unknown finalizes task_runs as lost and never replays the command", async () => {
    enablePhase3();
    saveMissionRun(runningFixture());
    const arm = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      agentId: "agent-a",
      expectedRevision: 0,
      activeTickId: "tick-active",
      commandDigest: "digest-unknown",
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const result = await goalWakeController.markGoalWaitSpawnUnknown(arm.taskId);
    expect(goalWakeController.getGoalWaitTask(arm.taskId)?.status).toBe("lost");
    expect(result.flows[0]?.outcome).toBe("barrier-pending");
    expect(new TaskFlowCasStore().getById(arm.flowId)?.status).toBe("waiting");
  });

  it("max active goal waits and max goal-wake flows are enforced before any row is written", async () => {
    enablePhase3();
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS = "1";
    saveMissionRun(runningFixture({ missionId: "mission-goal-wake-1" }));
    const first = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      expectedRevision: 0,
      activeTickId: "tick-active",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    saveMissionRun(
      runningFixture({
        missionId: "mission-goal-wake-2",
        agentId: "agent-a",
        updatedAt: Date.now(),
      }),
    );
    const second = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-2",
      sessionKey: "agent:agent-a:main",
      expectedRevision: 0,
      activeTickId: "tick-active",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("budget-exceeded");

    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    const db = new DatabaseSync(dbPath);
    const flowCount = db.prepare(
      "SELECT COUNT(*) AS count FROM flow_runs WHERE controller_id = 'goal-wake'",
    ).get() as { count: number | bigint };
    expect(Number(flowCount.count)).toBe(1);
    db.close();
  });

  it("goal wake path is default-off and leaves durable rows untouched", async () => {
    saveMissionRun(runningFixture());
    const arm = await goalWakeController.armGoalWaitProcess({
      missionId: "mission-goal-wake-1",
      sessionKey: "agent:agent-a:main",
      expectedRevision: 0,
    });
    expect(arm.ok).toBe(false);
    if (arm.ok) return;
    expect(arm.reason).toBe("flag-disabled");
    expect(getMissionRun("mission-goal-wake-1")?.status).toBe("running");
    const dbPath = path.join(stateDir, "state", "openclaw.sqlite");
    const db = new DatabaseSync(dbPath);
    const taskCount = db.prepare("SELECT COUNT(*) AS count FROM task_runs").get() as {
      count: number | bigint;
    };
    expect(Number(taskCount.count)).toBe(0);
    db.close();
  });
});
