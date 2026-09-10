// Phase 4 startup/sweep recovery tests with explicit clocks and temp runDirs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import {
  appendDurableHelperOutput,
  createDurableHelperIntent,
  durableOutcomeDigest,
  writeDurableHelperExit,
  writeDurableHelperStarted,
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
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

async function armDurable(runId: string) {
  const intent = await createDurableHelperIntent(
    {
      runId,
      commandDigest: "a".repeat(64),
      policyRevision: "runtime-lifecycle-phase4-recovery-v1",
      ownerEpoch: "epoch-recovery",
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
    expect(outcomes.some((item) => item.runId === "run_sweep_exit" && item.state === "terminal")).toBe(true);
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
    expect(outcomes.some((item) => item.runId === "run_sweep_ttl" && item.state === "lost")).toBe(true);
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
