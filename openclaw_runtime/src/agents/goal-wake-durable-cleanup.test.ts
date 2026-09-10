// Phase 4 session reset/delete durable helper cancellation and reaping.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import {
  cancelAndReapDurableHelpersForSession,
  countActiveDurableHelperRunsForSession,
  markSessionDurableHelpersNeedsCleanup,
} from "./goal-wake-durable-cleanup.js";
import {
  createDurableHelperIntent,
  durableOutcomeDigest,
  readDurableHelperFiles,
  writeDurableHelperExit,
  writeDurableHelperStarted,
} from "./goal-wake-helper-protocol.js";
import { getGoalWakeFlowRow, getGoalWaitTask } from "./goal-wake-read.js";
import { drainScope } from "../gateway/session-drain-service.js";
import { sessionAdmissionRegistry } from "../sessions/session-admission-registry.js";
import { saveMissionRun } from "./mission-control/store.js";
import type { MissionRunRecord } from "./mission-control/types.js";

const tempRoots: string[] = [];
let rootDir = "";
let stateDir = "";
const SESSION_KEY = "agent:cleanup:main";
const liveChildren: Array<ReturnType<typeof spawn>> = [];

function fixture(): MissionRunRecord {
  const now = Date.now();
  return {
    missionId: "mission-cleanup",
    sessionKey: SESSION_KEY,
    agentId: "cleanup",
    objective: "cleanup durable helper",
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

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "durable-cleanup-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  rootDir = path.join(stateDir, "background-processes");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
});

afterEach(async () => {
  for (const child of liveChildren.splice(0)) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

async function armRun(runId: string, epoch = "epoch-cleanup") {
  const intent = await createDurableHelperIntent(
    {
      runId,
      commandDigest: "c".repeat(64),
      policyRevision: "runtime-lifecycle-phase4-cleanup-v1",
      ownerEpoch: epoch,
    },
    { rootDir },
  );
  saveMissionRun(fixture());
  const arm = await armGoalWaitProcess({
    missionId: "mission-cleanup",
    sessionKey: SESSION_KEY,
    agentId: "cleanup",
    expectedRevision: 0,
    commandDigest: intent.commandDigest,
    durableRun: {
      runId,
      ownerEpoch: epoch,
      nonce: intent.nonce,
      policyRevision: intent.policyRevision,
    },
  });
  if (!arm.ok) throw new Error(`arm failed: ${arm.reason}`);
  return { intent, arm };
}

describe("durable helper session cleanup", () => {
  it("session delete/reset reap cancels the helper, finalizes task/flow, and removes runDir", async () => {
    const { intent, arm } = await armRun("run_cleanup_exit");
    await writeDurableHelperExit(
      {
        runId: "run_cleanup_exit",
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    expect(await countActiveDurableHelperRunsForSession(SESSION_KEY)).toBe(1);

    const first = await cancelAndReapDurableHelpersForSession({
      sessionKey: SESSION_KEY,
      options: { rootDir },
      timeoutMs: 5_000,
    });
    expect(first).toMatchObject({ ok: true, removed: 1 });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("cancelled");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
    expect(fs.existsSync(path.join(rootDir, "run_cleanup_exit"))).toBe(false);
    expect(await countActiveDurableHelperRunsForSession(SESSION_KEY)).toBe(0);

    const retry = await cancelAndReapDurableHelpersForSession({
      sessionKey: SESSION_KEY,
      options: { rootDir },
      timeoutMs: 5_000,
    });
    expect(retry).toMatchObject({ ok: true, cancelled: 0, removed: 0 });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("cancelled");
  });

  it("intent without started and no live helper finalizes lost and never replays", async () => {
    const { arm } = await armRun("run_cleanup_lost");
    const result = await cancelAndReapDurableHelpersForSession({
      sessionKey: SESSION_KEY,
      options: { rootDir },
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ ok: true, removed: 1 });
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("lost");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
    expect(fs.existsSync(path.join(rootDir, "run_cleanup_lost"))).toBe(false);
  });

  it("a live helper that ignores control fails closed and leaves task/flow truth active", async () => {
    const { intent, arm } = await armRun("run_cleanup_timeout");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    liveChildren.push(child);
    await writeDurableHelperStarted(
      {
        runId: "run_cleanup_timeout",
        runNonce: intent.nonce,
        helperPid: child.pid!,
        childPid: child.pid!,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    const result = await cancelAndReapDurableHelpersForSession({
      sessionKey: SESSION_KEY,
      options: { rootDir },
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("helper-timeout");
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("queued");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("waiting");
    expect(fs.existsSync(path.join(rootDir, "run_cleanup_timeout"))).toBe(true);
  });


  it("drainScope is the session reset/delete seam: cancels helper claim, finalizes rows, removes runDir", async () => {
    const { intent, arm } = await armRun("run_drain_integration");
    await writeDurableHelperExit(
      {
        runId: "run_drain_integration",
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    const identity = {
      agentId: "cleanup",
      canonicalSessionKey: SESSION_KEY,
      expectedSessionId: "session-cleanup-1",
    };
    const fence = await sessionAdmissionRegistry.fence(identity);
    const drain = await drainScope(identity, 5_000);
    expect(drain.ok).toBe(true);
    if (!drain.ok) {
      fence.release();
      throw new Error(`drain failed: ${drain.reason} ${drain.message}`);
    }
    fence.release();
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("cancelled");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
    expect(fs.existsSync(path.join(rootDir, "run_drain_integration"))).toBe(false);
  });

  it("quota overflow transitions existing rows to needs_cleanup without clearing truth", async () => {
    const { arm } = await armRun("run_cleanup_quota");
    const marked = await markSessionDurableHelpersNeedsCleanup(SESSION_KEY, { rootDir });
    expect(marked).toBe(1);
    expect(getGoalWaitTask(arm.taskId)?.status).toBe("needs_cleanup");
    expect(getGoalWakeFlowRow(arm.flowId)?.status).toBe("cancelled");
    expect((await readDurableHelperFiles("run_cleanup_quota", { rootDir })).intent).toBeDefined();
    expect(await countActiveDurableHelperRunsForSession(SESSION_KEY)).toBe(0);
  });
});
