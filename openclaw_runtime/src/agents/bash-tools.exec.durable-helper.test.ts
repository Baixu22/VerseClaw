// Phase 4 same-gateway exec(wait="goal") upgraded to the real durable helper
// protocol. Default Phase 3 behavior is covered separately.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { goalWakeController } from "./goal-wake-controller.js";
import {
  readDurableHelperFiles,
  readDurableHelperTail,
} from "./goal-wake-helper-protocol.js";
import { getMissionRun, saveMissionRun } from "./mission-control/store.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";

const tempRoots: string[] = [];
let stateDir = "";
let runDir = "";
const originalArgv = process.argv;

function fixtureMission() {
  const now = Date.now();
  return {
    missionId: "mission-exec-durable",
    sessionKey: "agent:exec-durable:main",
    agentId: "exec-durable",
    objective: "exec durable helper protocol",
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exec-durable-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  runDir = path.join(stateDir, "background-processes");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
  process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS = "0";
  process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED = "1";
});

afterEach(() => {
  closeOpenClawStateDatabase();
  resetProcessRegistryForTests();
  process.argv = originalArgv;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS;
  delete process.env.RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows file close race.
    }
  }
});

async function waitForTaskTerminal(taskId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = goalWakeController.getGoalWaitTask(taskId)?.status;
    if (["succeeded", "failed", "timed_out", "cancelled", "lost"].includes(status ?? "")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`task ${taskId} did not reach terminal state`);
}

describe("exec wait=goal durable helper path", () => {
  it("uses intent->started->exit protocol and keeps process.poll out of the wake path", async () => {
    // Reuse the same tsx-cli + source-entry shape the Gateway launcher uses.
    const runtimeRoot = path.resolve(".");
    process.argv = [
      process.execPath,
      path.join(runtimeRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(runtimeRoot, "src", "entry.ts"),
      "gateway",
    ];
    saveMissionRun(fixtureMission());
    const onYield = vi.fn(async () => {});
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      sessionKey: "agent:exec-durable:main",
      sessionId: "exec-durable-session-1",
      onYield,
    });
    const result = await tool.execute(
      "call-durable",
      {
        command: `${
          process.platform === "win32" ? "& " : ""
        }"${process.execPath}" -e "console.log('durable-hello'); setTimeout(() => process.exit(0), 80)"`,
        background: true,
        wait: "goal",
      },
      undefined,
      undefined,
    );
    const details = result.details as {
      status?: string;
      taskId?: string;
      flowId?: string;
    };
    expect(details.status).toBe("running");
    expect(details.taskId).toBeTruthy();
    const task = goalWakeController.getGoalWaitTask(details.taskId!);
    expect(task?.run_id).toBeTruthy();
    const runId = task!.run_id!;
    expect(onYield).toHaveBeenCalledOnce();

    await waitForTaskTerminal(details.taskId!);
    const files = await readDurableHelperFiles(runId, { rootDir: runDir });
    expect(files.intent?.ownerEpoch).toBeTruthy();
    expect(files.started?.helperPid).toBeGreaterThan(0);
    expect(files.started?.childPid).toBeGreaterThan(0);
    expect(files.exit?.exitCode).toBe(0);
    expect(JSON.stringify(files)).not.toContain("durable-hello");

    await goalWakeController.ackGoalWaitYield({
      flowId: details.flowId!,
      sessionKey: "agent:exec-durable:main",
    });
    const effects: string[] = [];
    const wake = await goalWakeController.runGoalWakeLevelCheckForTask(details.taskId!, {
      dispatch: async (input) => {
        effects.push(input.wakeId);
        return { ok: true, duplicate: false };
      },
    });
    expect(wake.flows[0]?.outcome).toBe("dispatched");
    expect(effects).toHaveLength(1);
    expect(getMissionRun("mission-exec-durable")?.status).toBe("sleeping");
    await waitForTaskTerminal(details.taskId!);
    const tail = await readDurableHelperTail(runId, { rootDir: runDir });
    expect(tail).toContain("durable-hello");
    console.log("[runtime-lifecycle-audit] processPollToolCalls=0");
  }, 30_000);
});
