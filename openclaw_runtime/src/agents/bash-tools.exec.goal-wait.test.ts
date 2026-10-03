import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { goalWakeController } from "./goal-wake-controller.js";
import { getMissionRun, saveMissionRun } from "./mission-control/store.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { TaskFlowCasStore } from "../tasks/task-flow-cas.js";

const tempRoots: string[] = [];
let stateDir = "";

function fixtureMission() {
  const now = Date.now();
  return {
    missionId: "mission-exec-goal",
    sessionKey: "agent:exec-main:main",
    agentId: "exec-main",
    objective: "exec wait=goal coverage",
    acceptance: [],
    status: "running" as const,
    phase: "execute" as const,
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

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exec-goal-wait-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  resetProcessRegistryForTests();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows WAL close race; test evidence does not depend on temp cleanup.
    }
  }
});

async function waitForTaskTerminal(taskId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = goalWakeController.getGoalWaitTask(taskId)?.status;
    if (
      status === "succeeded" ||
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled" ||
      status === "lost"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`task ${taskId} did not reach terminal state`);
}

describe("exec wait=goal Phase 3 path", () => {
  it("arms before spawn, yields, and delivers a push wake without process.poll", async () => {
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
    saveMissionRun(fixtureMission());
    const onYield = vi.fn(async () => {});

    const tool = createExecTool({
      host: "gateway",
      sessionKey: "agent:exec-main:main",
      sessionId: "exec-session-1",
      onYield,
    });
    const result = await tool.execute(
      "call-goal",
      {
        command: `${process.execPath} -e "setTimeout(() => process.exit(0), 80)"`,
        background: true,
        wait: "goal",
      },
      undefined,
      undefined,
    );
    const details = result.details as {
      status?: string;
      wait?: string;
      taskId?: string;
      flowId?: string;
      turnBarrier?: string;
    };
    expect(details.status).toBe("running");
    expect(details.wait).toBe("goal");
    expect(details.taskId).toBeTruthy();
    expect(details.flowId).toBeTruthy();
    expect(details.turnBarrier).toBe("pending");
    expect(onYield).toHaveBeenCalledOnce();

    await waitForTaskTerminal(details.taskId!);
    const ack = await goalWakeController.ackGoalWaitYield({
      flowId: details.flowId!,
      sessionKey: "agent:exec-main:main",
    });
    expect(ack.ok).toBe(true);

    const effects: string[] = [];
    const wake = await goalWakeController.runGoalWakeLevelCheckForTask(details.taskId!, {
      dispatch: async (input) => {
        effects.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(wake.flows[0]?.outcome).toBe("dispatched");
    expect(effects).toHaveLength(1);
    expect(new TaskFlowCasStore().getById(details.flowId!)?.status).toBe("succeeded");
    expect(getMissionRun("mission-exec-goal")?.status).toBe("sleeping");
  });

  it("wait=goal requires background=true and is default-off without the flag", async () => {
    const tool = createExecTool({
      host: "gateway",
      sessionKey: "agent:exec-main:main",
      sessionId: "exec-session-1",
    });
    await expect(
      tool.execute(
        "call-no-bg",
        { command: "echo no-bg", wait: "goal" },
        undefined,
        undefined,
      ),
    ).rejects.toThrow('exec wait="goal" requires background=true');

    saveMissionRun(fixtureMission());
    await expect(
      tool.execute(
        "call-flag-off",
        {
          command: `${process.execPath} -e "setTimeout(() => process.exit(0), 50)"`,
          background: true,
          wait: "goal",
        },
        undefined,
        undefined,
      ),
    ).rejects.toThrow(/goal-wake arm failed: flag-disabled/);
  });

  it("exec(background=true) with no wait keeps the Phase 2 running contract", async () => {
    const tool = createExecTool({
      host: "gateway",
      sessionKey: "agent:exec-main:main",
      sessionId: "exec-session-1",
    });
    const result = await tool.execute(
      "call-default",
      {
        command: `${process.execPath} -e "setTimeout(() => process.exit(0), 80)"`,
        background: true,
      },
      undefined,
      undefined,
    );
    const details = result.details as {
      status?: string;
      wait?: string;
      taskId?: string;
      flowId?: string;
    };
    expect(details.status).toBe("running");
    expect(details.wait).toBeUndefined();
    expect(details.taskId).toBeUndefined();
    expect(details.flowId).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});
