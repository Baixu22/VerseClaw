// Phase 4 crash-matrix tests: durable helper file protocol vs task/flow truth.
// No test waits on a real 24h TTL and no test relies on a cross-machine fs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import {
  armGoalWaitProcess,
} from "./goal-wake-arm.js";
import {
  createDurableHelperIntent,
  durableOutcomeDigest,
  writeDurableHelperExit,
  writeDurableHelperStarted,
} from "./goal-wake-helper-protocol.js";
import {
  ProcessRunReconciler,
} from "./process-run-reconciler.js";
import { goalWakeController } from "./goal-wake-controller.js";
import {
  reconcileDurableRun,
} from "./goal-wake-recovery.js";
import {
  ackGoalWaitYield,
} from "./goal-wake-runtime.js";
import {
  getGoalWakeFlowRow,
  getGoalWaitTask,
} from "./goal-wake-read.js";
import { getMissionRun, saveMissionRun } from "./mission-control/store.js";
import type { GoalWakeDispatchInput, GoalWakeDispatchResult } from "./goal-wake-types.js";
import type { MissionRunRecord } from "./mission-control/types.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";

const tempRoots: string[] = [];
let rootDir = "";
let stateDir = "";

const ALIVE_PID = 424242;
const DEAD_PID = 424243;

function fixture(overrides: Partial<MissionRunRecord> = {}): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-phase4-crash",
    sessionKey: "agent:phase4:main",
    agentId: "phase4",
    objective: "durable crash matrix",
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
    ...overrides,
  };
}

function enable() {
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
  process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED = "1";
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "process-run-reconciler-"));
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
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

async function createRun(runId: string, ownerEpoch = "epoch-phase4") {
  return await createDurableHelperIntent(
    {
      runId,
      commandDigest: "b".repeat(64),
      policyRevision: "runtime-lifecycle-phase4-test-v1",
      ownerEpoch,
    },
    { rootDir },
  );
}

describe("ProcessRunReconciler pure file protocol", () => {
  it("resolves intent without started and no live helper to lost without replaying spawn", async () => {
    await createRun("run_intent_lost");
    let spawnReplays = 0;
    let lostReason = "";
    const reconciler = new ProcessRunReconciler({
      rootDir,
      isHelperAlive: () => false,
      onLost: async ({ reason }) => {
        spawnReplays += 1;
        lostReason = reason;
      },
    });
    const result = await reconciler.reconcile({ runId: "run_intent_lost" });
    expect(result.state).toBe("lost");
    expect(result.reason).toBe("intent-without-started");
    expect(lostReason).toBe("intent-without-started");
    expect(spawnReplays).toBe(1);
  });

  it("resolves started + live helper as running", async () => {
    const intent = await createRun("run_running");
    await writeDurableHelperStarted(
      {
        runId: "run_running",
        runNonce: intent.nonce,
        helperPid: ALIVE_PID,
        childPid: ALIVE_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const reconciler = new ProcessRunReconciler({
      rootDir,
      isHelperAlive: (pid) => pid === ALIVE_PID,
      onRunning: async () => {},
    });
    const result = await reconciler.reconcile({ runId: "run_running" });
    expect(result.state).toBe("running");
    expect(result.reason).toBe("helper-live");
  });

  it("resolves started + dead helper without exit as lost", async () => {
    const intent = await createRun("run_dead_helper");
    await writeDurableHelperStarted(
      {
        runId: "run_dead_helper",
        runNonce: intent.nonce,
        helperPid: DEAD_PID,
        childPid: DEAD_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const reconciler = new ProcessRunReconciler({
      rootDir,
      isHelperAlive: () => false,
      onLost: async () => {},
    });
    const result = await reconciler.reconcile({ runId: "run_dead_helper" });
    expect(result.state).toBe("lost");
    expect(result.reason).toBe("started-helper-dead");
  });

  it("reads exit.json as terminal first truth even when a started pid is dead", async () => {
    const intent = await createRun("run_exit_truth");
    await writeDurableHelperStarted(
      {
        runId: "run_exit_truth",
        runNonce: intent.nonce,
        helperPid: DEAD_PID,
        childPid: DEAD_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const exit = await writeDurableHelperExit(
      {
        runId: "run_exit_truth",
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    let terminalExit;
    const reconciler = new ProcessRunReconciler({
      rootDir,
      isHelperAlive: () => false,
      onTerminal: async ({ exit: next }) => {
        terminalExit = next;
      },
    });
    const result = await reconciler.reconcile({ runId: "run_exit_truth" });
    expect(result.state).toBe("terminal");
    expect(result.reason).toBe("exit-observed");
    expect(terminalExit).toEqual(exit);
  });

  it("never adopts a run for a different owner epoch", async () => {
    await createRun("run_wrong_epoch", "epoch-old");
    let terminalCalls = 0;
    const reconciler = new ProcessRunReconciler({
      rootDir,
      isHelperAlive: () => false,
      onTerminal: async () => {
        terminalCalls += 1;
      },
    });
    const result = await reconciler.reconcile({ runId: "run_wrong_epoch", ownerEpoch: "epoch-new" });
    expect(result.state).toBe("lost");
    expect(result.reason).toBe("owner-epoch-mismatch");
    expect(terminalCalls).toBe(0);
  });

  it("resolves missing runId as missing", async () => {
    const reconciler = new ProcessRunReconciler({ rootDir });
    expect(await reconciler.reconcile({ runId: "run_missing" })).toMatchObject({
      state: "missing",
      reason: "intent-missing",
    });
  });
});

describe("durable helper crash matrix", () => {
  it("crash after arm commit and before spawn resolves lost and never auto-restarts", async () => {
    enable();
    const runId = "run_crash_after_arm";
    const intent = await createRun(runId);
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-crash",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
      expectedRevision: 0,
      commandDigest: intent.commandDigest,
      durableRun: {
        runId,
        ownerEpoch: intent.ownerEpoch,
        nonce: intent.nonce,
        policyRevision: intent.policyRevision,
      },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const task = getGoalWaitTask(arm.taskId);
    const flow = getGoalWakeFlowRow(arm.flowId);
    const persistedLedger = JSON.stringify({ task, flow });
    for (const raw of ["raw-command-text", "SECRET_PERSISTENCE_PROBE", "password=hunter2"]) {
      expect(persistedLedger).not.toContain(raw);
    }
    let spawnReplayAttempts = 0;
    const outcome = await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: () => false,
      dispatch: async (input) => {
        void input;
        spawnReplayAttempts += 1;
        return { ok: true, duplicate: false };
      },
    });
    expect(outcome).toMatchObject({ state: "lost", reason: "intent-without-started" });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("lost");
    expect(spawnReplayAttempts).toBe(0);
  });

  it("crash after spawn and before started resolves lost without spawn replay", async () => {
    enable();
    const runId = "run_crash_before_started";
    const intent = await createRun(runId);
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-crash",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
      expectedRevision: 0,
      commandDigest: intent.commandDigest,
      durableRun: {
        runId,
        ownerEpoch: intent.ownerEpoch,
        nonce: intent.nonce,
        policyRevision: intent.policyRevision,
      },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    const outcome = await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: () => false,
    });
    expect(outcome.state).toBe("lost");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("lost");
    expect((getGoalWaitTask(arm.taskId)?.error ?? "").toLowerCase()).toContain("not replayed");
  });

  it("crash after started resolves running and marks the task running", async () => {
    enable();
    const runId = "run_crash_after_started";
    const intent = await createRun(runId);
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-crash",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
      expectedRevision: 0,
      commandDigest: intent.commandDigest,
      durableRun: {
        runId,
        ownerEpoch: intent.ownerEpoch,
        nonce: intent.nonce,
        policyRevision: intent.policyRevision,
      },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await writeDurableHelperStarted(
      {
        runId,
        runNonce: intent.nonce,
        helperPid: ALIVE_PID,
        childPid: ALIVE_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const outcome = await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: (pid) => pid === ALIVE_PID,
    });
    expect(outcome).toMatchObject({ state: "running", taskStatus: "running" });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("running");
  });

  it("crash before exit with dead helper resolves lost and never re-spawns", async () => {
    enable();
    const runId = "run_crash_before_exit";
    const intent = await createRun(runId);
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-crash",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
      expectedRevision: 0,
      commandDigest: intent.commandDigest,
      durableRun: {
        runId,
        ownerEpoch: intent.ownerEpoch,
        nonce: intent.nonce,
        policyRevision: intent.policyRevision,
      },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await writeDurableHelperStarted(
      {
        runId,
        runNonce: intent.nonce,
        helperPid: DEAD_PID,
        childPid: DEAD_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const outcome = await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: () => false,
    });
    expect(outcome.state).toBe("lost");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("lost");
  });

  it("crash after exit and before flow resume finalizes the task then level-checks once", async () => {
    enable();
    const runId = "run_crash_after_exit";
    const intent = await createRun(runId);
    saveMissionRun(fixture());
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-crash",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
      expectedRevision: 0,
      commandDigest: intent.commandDigest,
      durableRun: {
        runId,
        ownerEpoch: intent.ownerEpoch,
        nonce: intent.nonce,
        policyRevision: intent.policyRevision,
      },
    });
    expect(arm.ok).toBe(true);
    if (!arm.ok) return;
    await writeDurableHelperStarted(
      {
        runId,
        runNonce: intent.nonce,
        helperPid: DEAD_PID,
        childPid: DEAD_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await writeDurableHelperExit(
      {
        runId,
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    const outcome = await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: () => false,
    });
    expect(outcome.state).toBe("terminal");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("succeeded");
    const preAck = await runGoalWakeLevelCheckForTask(arm.taskId);
    expect(preAck.flows[0]?.outcome).toBe("barrier-pending");

    await ackGoalWaitYield({ flowId: arm.flowId, sessionKey: "agent:phase4:main" });
    let deliveries = 0;
    const resumed = await runGoalWakeLevelCheckForTask(arm.taskId, {
      dispatch: async (input) => {
        void input;
        deliveries += 1;
        return { ok: true, duplicate: false };
      },
    });
    expect(resumed.flows[0]?.outcome).toBe("dispatched");
    expect(deliveries).toBe(1);
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("succeeded");
  });

  it("crash after flow resume and before tick claim dedupes the effect owner", async () => {
    enable();
    saveMissionRun(fixture({ missionId: "mission-phase4-tick-claim", status: "running" }));
    const runId = "run_crash_after_flow_resume";
    const intent = await createRun(runId);
    const arm = await armGoalWaitProcess({
      missionId: "mission-phase4-tick-claim",
      sessionKey: "agent:phase4:main",
      agentId: "phase4",
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
    await writeDurableHelperStarted(
      {
        runId,
        runNonce: intent.nonce,
        helperPid: DEAD_PID,
        childPid: DEAD_PID + 1,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await writeDurableHelperExit(
      {
        runId,
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    await reconcileDurableRun({
      runId,
      options: { rootDir },
      ownerEpoch: intent.ownerEpoch,
      isHelperAlive: () => false,
    });
    await ackGoalWaitYield({ flowId: arm.flowId, sessionKey: "agent:phase4:main" });

    // Simulate the crash window: flow has been claimed running but the mission
    // tick claim (effect owner) has not run. Duplicate wake delivery must not
    // duplicate the tick side effect.
    let tickSideEffects = 0;
    const dispatch = async (input: GoalWakeDispatchInput): Promise<GoalWakeDispatchResult> => {
      void input;
      tickSideEffects += 1;
      return { ok: true, duplicate: false };
    };
    const resumed = await runGoalWakeLevelCheckForTask(arm.taskId, { dispatch });
    expect(resumed.flows[0]?.outcome).toBe("dispatched");
    expect(tickSideEffects).toBe(1);
    const duplicate = await runGoalWakeLevelCheckForTask(arm.taskId, { dispatch });
    expect(duplicate.flows).toEqual([]);
    expect(tickSideEffects).toBe(1);
  });

  it("crash after tick claim dedupes the mission wake id exactly like the persisted fence", async () => {
    enable();
    saveMissionRun(fixture({ missionId: "mission-phase4-claim", status: "sleeping" }));
    const first = goalWakeController.claimMissionTick({
      missionId: "mission-phase4-claim",
      expectedRevision: 0,
      activeTickId: "tick-after-crash-1",
      wakeId: "wake-phase4-1",
      allowedStatuses: ["sleeping", "running"],
      requireIdle: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = goalWakeController.claimMissionTick({
      missionId: "mission-phase4-claim",
      expectedRevision: first.revision,
      activeTickId: "tick-after-crash-2",
      wakeId: "wake-phase4-1",
      allowedStatuses: ["running"],
      requireIdle: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("duplicate-wake");
    expect(getMissionRun("mission-phase4-claim")?.tick).toBe(1);
  });
});
