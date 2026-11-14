// Phase 4 startup/sweep recovery tests with explicit clocks and temp runDirs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";
import { updateSessionStoreAtomic } from "../config/sessions/store.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { closeTrackedSqliteHandlesUnder } from "../infra/node-sqlite.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import {
  appendDurableHelperOutput,
  createDurableHelperIntent,
  durableOutcomeDigest,
  writeDurableHelperExit,
  writeDurableHelperStarted,
  removeDurableHelperRunDir,
} from "./goal-wake-helper-protocol.js";
import {
  reconcileDurableRun,
  runDurableHelperSweepOnce,
  startDurableHelperRecoveryService,
} from "./goal-wake-recovery.js";
import { ackGoalWaitYield } from "./goal-wake-runtime.js";
import { getGoalWaitTask } from "./goal-wake-read.js";
import { saveMissionRun } from "./mission-control/store.js";
import type { MissionRunRecord } from "./mission-control/types.js";

const tempRoots: string[] = [];
let rootDir = "";
let stateDir = "";

function fixture(): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-recovery",
    sessionKey: "agent:recovery:main",
    agentId: "recovery",
    objective: "sweep recovery",
    acceptance: [],
    status: "running",
    phase: "execute",
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
    activeTickId: null,
  };
}

function enable() {
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
  process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED = "1";
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-recovery-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  rootDir = path.join(root, "background-processes");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.OPENCLAW_CONFIG_PATH;
});

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS;
  delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS;
  delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES;
  delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS;
  delete process.env.OPENCLAW_RECOVERY_AUTHORITY_MODE;
  for (const root of tempRoots.splice(0)) {
    closeTrackedSqliteHandlesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

async function armDurable(runId: string, ownerEpoch = "epoch-recovery") {
  const intent = await createDurableHelperIntent(
    {
      runId,
      commandDigest: "a".repeat(64),
      policyRevision: "runtime-lifecycle-phase4-recovery-v1",
      ownerEpoch,
    },
    { rootDir },
  );
  saveMissionRun(fixture());
  const arm = await armGoalWaitProcess({
    missionId: "mission-recovery",
    sessionKey: "agent:recovery:main",
    agentId: "recovery",
    expectedRevision: 0,
    commandDigest: intent.commandDigest,
    durableRun: {
      runId,
      ownerEpoch: intent.ownerEpoch,
      nonce: intent.nonce,
      policyRevision: intent.policyRevision,
    },
  });
  if (!arm.ok) throw new Error(`arm failed: ${arm.reason}`);
  return { intent, arm };
}

async function armGatedDurable(runId: string, terminal = true) {
  enable();
  process.env.OPENCLAW_RECOVERY_AUTHORITY_MODE = "authority";
  const store = path.join(stateDir, "agents", "recovery", "sessions", "sessions.json");
  await updateSessionStoreAtomic(store, (sessions) => {
    sessions["agent:recovery:main"] = { sessionId: "recovery-generation", updatedAt: 1 };
  });
  const ownerEpoch = createHash("sha256")
    .update("recovery-generation\u0000mission-recovery")
    .digest("hex");
  const seeded = await armDurable(runId, ownerEpoch);
  if (terminal)
    await writeDurableHelperExit(
      {
        runId,
        nonce: seeded.intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
  await ackGoalWaitYield({ flowId: seeded.arm.flowId, sessionKey: "agent:recovery:main" });
  return { ...seeded, cfg: { session: { store } } };
}

describe("durable helper authority admission", () => {
  it("keeps a lost helper outcome unknown when no durable exit was observed", async () => {
    const { cfg, arm } = await armGatedDurable("run_lost_uncertain", false);
    await runDurableHelperSweepOnce({
      options: { rootDir },
      cfg,
      dispatch: async () => ({ ok: true, duplicate: false }),
    });
    const task = getGoalWaitTask(arm.taskId)!;
    const authority = JSON.parse(task.progress_summary!).recoveryAuthority;
    expect(task.status).toBe("lost");
    expect(authority.decision).toMatchObject({ kind: "reconcile", effect: "unknown" });
  });
  it("keeps a live helper in reconciliation across repeated sweeps and legacy rollback", async () => {
    const { arm, cfg, intent } = await armGatedDurable("run_live_owner", false);
    await writeDurableHelperStarted(
      {
        runId: "run_live_owner",
        runNonce: intent.nonce,
        helperPid: process.pid,
        childPid: process.pid,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg });
    process.env.OPENCLAW_RECOVERY_AUTHORITY_MODE = "legacy";
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg });
    const task = getGoalWaitTask(arm.taskId)!;
    const state = JSON.parse(task.progress_summary!);
    expect(task.status).toBe("running");
    expect(state.recoveryAuthority).toMatchObject({
      attempts: 0,
      decision: { authorityId: "recovery-authority/v1", kind: "reconcile" },
    });
    expect(fs.readdirSync(rootDir)).toEqual(["run_live_owner"]);
  });

  it("recovers the terminal wait even after its settled helper files have been pruned", async () => {
    const { cfg, arm } = await armGatedDurable("run_pruned_terminal");
    await expect(
      reconcileDurableRun({
        runId: "run_pruned_terminal",
        options: { rootDir },
        cfg,
        dispatch: async () => {
          throw new Error("wake ack lost");
        },
      }),
    ).rejects.toThrow("wake ack lost");
    await removeDurableHelperRunDir("run_pruned_terminal", { rootDir });
    let wakes = 0;
    const dispatch = async () => {
      wakes += 1;
      return { ok: true as const, duplicate: false };
    };
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg, dispatch });
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg, dispatch });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("succeeded");
    expect(wakes).toBe(1);
  });

  it("rejects an old callback when its admitted Session rotates during helper observation", async () => {
    const { cfg, arm, intent } = await armGatedDurable("run_observation_race", false);
    await writeDurableHelperStarted(
      {
        runId: "run_observation_race",
        runNonce: intent.nonce,
        helperPid: process.pid,
        childPid: process.pid,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const outcome = await reconcileDurableRun({
      runId: "run_observation_race",
      options: { rootDir },
      cfg,
      isHelperAlive: async () => {
        await updateSessionStoreAtomic(cfg.session.store, (sessions) => {
          sessions["agent:recovery:main"] = {
            sessionId: "new-observation-generation",
            updatedAt: 2,
          };
        });
        return false;
      },
    });
    expect(outcome.reason).toBe("owner-epoch-mismatch");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
  });
  it("retries the level-check after task terminal persistence outlives its wake acknowledgement", async () => {
    const { arm, cfg } = await armGatedDurable("run_terminal_lost_ack");
    await expect(
      reconcileDurableRun({
        runId: "run_terminal_lost_ack",
        options: { rootDir },
        cfg,
        dispatch: async () => {
          throw new Error("wake acknowledgement lost");
        },
      }),
    ).rejects.toThrow("wake acknowledgement lost");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("succeeded");
    let wakes = 0;
    const dispatch = async () => {
      wakes += 1;
      return { ok: true as const, duplicate: false };
    };
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg, dispatch });
    await runDurableHelperSweepOnce({ options: { rootDir }, cfg, dispatch });
    expect(wakes).toBe(1);
  });

  it("refuses an exit whose helper nonce does not match its original task", async () => {
    const { arm, cfg } = await armGatedDurable("run_task_nonce_mismatch");
    const db = openOpenClawStateDatabase().db;
    const row = db
      .prepare("SELECT progress_summary FROM task_runs WHERE task_id = ?")
      .get(arm.taskId)!;
    db.prepare("UPDATE task_runs SET progress_summary = ? WHERE task_id = ?").run(
      JSON.stringify({ ...JSON.parse(String(row.progress_summary)), runNonce: "different-nonce" }),
      arm.taskId,
    );
    await runDurableHelperSweepOnce({
      options: { rootDir },
      cfg,
      dispatch: async () => ({ ok: true, duplicate: false }),
    });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
  });

  it("refuses a helper after its owning Session generation has changed", async () => {
    const { arm, cfg } = await armGatedDurable("run_session_epoch_mismatch");
    await updateSessionStoreAtomic(cfg.session.store, (sessions) => {
      sessions["agent:recovery:main"] = { sessionId: "replacement-generation", updatedAt: 2 };
    });
    await runDurableHelperSweepOnce({
      options: { rootDir },
      cfg,
      dispatch: async () => ({ ok: true, duplicate: false }),
    });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
  });

  it("stops before terminal mutation when the authority owner write fails", async () => {
    const { arm, cfg } = await armGatedDurable("run_authority_write_failure");
    openOpenClawStateDatabase().db.exec(
      "CREATE TRIGGER block_goal_admission BEFORE UPDATE OF progress_summary ON task_runs BEGIN SELECT RAISE(ABORT, 'goal admission write failed'); END",
    );
    await expect(
      runDurableHelperSweepOnce({
        options: { rootDir },
        cfg,
        dispatch: async () => ({ ok: true, duplicate: false }),
      }),
    ).rejects.toThrow("goal admission write failed");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
  });

  it("commits an expired helper exit before pruning its protocol directory", async () => {
    const { arm, cfg, intent } = await armGatedDurable("run_expired_terminal");
    process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS = "1";
    await runDurableHelperSweepOnce({
      options: { rootDir },
      cfg,
      now: Date.parse(intent.createdAt) + 100,
      dispatch: async () => ({ ok: true, duplicate: false }),
    });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("succeeded");
    expect(fs.existsSync(path.join(rootDir, "run_expired_terminal"))).toBe(false);
  });
});

describe("durable helper sweep recovery", () => {
  it("sweep reads exit.json, finalizes task first, then flow level-check dispatches once", async () => {
    enable();
    const { intent, arm } = await armDurable("run_sweep_exit");
    await writeDurableHelperStarted(
      {
        runId: "run_sweep_exit",
        runNonce: intent.nonce,
        helperPid: 999001,
        childPid: 999002,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await writeDurableHelperExit(
      {
        runId: "run_sweep_exit",
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    await ackGoalWaitYield({ flowId: arm.flowId, sessionKey: "agent:recovery:main" });
    let deliveries = 0;
    const outcomes = await runDurableHelperSweepOnce({
      options: { rootDir },
      dispatch: async (input) => {
        void input;
        deliveries += 1;
        return { ok: true, duplicate: false };
      },
    });
    expect(
      outcomes.some((item) => item.runId === "run_sweep_exit" && item.state === "terminal"),
    ).toBe(true);
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("succeeded");
    expect(deliveries).toBe(1);
  });

  it("TTL-expired intent without started finalizes lost and removes only the stale runDir", async () => {
    enable();
    process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS = "1";
    const { intent, arm } = await armDurable("run_sweep_ttl");
    const outcomes = await runDurableHelperSweepOnce({
      options: { rootDir },
      now: Date.parse(intent.createdAt) + 100,
    });
    expect(outcomes.some((item) => item.runId === "run_sweep_ttl" && item.state === "lost")).toBe(
      true,
    );
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("lost");
    expect(fs.existsSync(path.join(rootDir, "run_sweep_ttl"))).toBe(false);
  });

  it("output quota overflow marks the session needs_cleanup without clearing task/flow truth", async () => {
    enable();
    process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES = "1024";
    const { intent, arm } = await armDurable("run_sweep_quota");
    await writeDurableHelperStarted(
      {
        runId: "run_sweep_quota",
        runNonce: intent.nonce,
        helperPid: 999003,
        childPid: 999004,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await appendDurableHelperOutput(
      { runId: "run_sweep_quota", output: "x".repeat(2048) },
      { rootDir },
    );
    const outcomes = await runDurableHelperSweepOnce({
      options: { rootDir },
    });
    expect(outcomes.some((item) => item.runId === "run_sweep_quota")).toBe(true);
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("needs_cleanup");
    expect(fs.existsSync(path.join(rootDir, "run_sweep_quota"))).toBe(true);
  });

  it("owner epoch mismatch is never adopted by a new session generation", async () => {
    enable();
    const { arm } = await armDurable("run_sweep_epoch");
    const outcome = await reconcileDurableRun({
      runId: "run_sweep_epoch",
      options: { rootDir },
      ownerEpoch: "epoch-new-session",
      isHelperAlive: () => false,
    });
    expect(outcome).toMatchObject({ state: "lost", reason: "owner-epoch-mismatch" });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
  });

  it("recovery service is default-off and exposes a stop handle when enabled", async () => {
    delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED;
    const off = startDurableHelperRecoveryService({ options: { rootDir } });
    expect(off.started).toBe(false);
    expect(await off.sweepOnce()).toEqual([]);
    off.stop();

    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS = "60000";
    const on = startDurableHelperRecoveryService({ options: { rootDir } });
    expect(on.started).toBe(true);
    on.stop();
  });
});
