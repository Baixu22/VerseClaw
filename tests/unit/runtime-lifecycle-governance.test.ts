// @vitest-environment node
import v8 from "node:v8";
import { afterEach, describe, expect, it } from "vitest";

import {
  addSession,
  getBashProcessRegistryState,
  resetProcessRegistryForTests,
  snapshotProcessSessionsForLifecycle,
  type ProcessSession,
} from "../../openclaw_runtime/src/agents/bash-process-registry.js";
import {
  acquireSessionAdmissionPermit,
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../../openclaw_runtime/src/sessions/session-admission-registry.js";
import { drainScope } from "../../openclaw_runtime/src/gateway/session-drain-service.js";
import { getProcessSupervisor } from "../../openclaw_runtime/src/process/supervisor/index.js";
import { isPidDefinitelyDead } from "../../openclaw_runtime/src/shared/pid-alive.js";
import { goalWakeController } from "../../openclaw_runtime/src/agents/goal-wake-controller.js";

afterEach(() => {
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  sessionAdmissionRegistry.clearForTests();
  resetProcessRegistryForTests();
});

async function measureHeapMb(): Promise<number> {
  const collect = globalThis.gc;
  if (typeof collect !== "function") {
    throw new Error("The retained-heap gate requires a Node worker with --expose-gc.");
  }
  for (let index = 0; index < 3; index += 1) {
    collect();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return v8.getHeapStatistics().used_heap_size / 1024 / 1024;
}

function buildLeakChildTreeScript(): string {
  return [
    'const { spawn } = require("node:child_process");',
    "const child = spawn(process.execPath, [\"-e\", \"setInterval(() => {}, 1000)\"], {",
    '  stdio: "ignore",',
    "});",
    'console.log(`child-pid=${child.pid}`);',
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

function makeLeakBashSession(params: {
  id: string;
  identity: SessionAdmissionIdentity;
  pid?: number;
  lifecycleCancel: () => void;
  lifecycleExitPromise: Promise<unknown>;
}): ProcessSession {
  const now = Date.now();
  return {
    id: params.id,
    command: "leak-fixture",
    scopeKey: params.identity.canonicalSessionKey,
    sessionKey: params.identity.canonicalSessionKey,
    lifecycleOwner: "native",
    lifecycleAgentId: params.identity.agentId,
    lifecycleCanonicalSessionKey: params.identity.canonicalSessionKey,
    lifecycleExpectedSessionId: params.identity.expectedSessionId,
    lifecycleCancel: params.lifecycleCancel,
    lifecycleExitPromise: params.lifecycleExitPromise,
    pid: params.pid,
    startedAt: now,
    maxOutputChars: 1000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    truncated: false,
    backgrounded: false,
    cursorKeyMode: "normal",
  };
}

async function waitForPidDeath(pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidDefinitelyDead(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`pid ${pid} survived drain`);
}

function createChildPidReader(): (chunk: string) => number {
  let output = "";
  return (chunk) => {
    output += chunk;
    const match = /(?:^|\n)child-pid=(\d+)\r?\n/u.exec(output);
    const pid = match ? Number(match[1]) : -1;
    return Number.isSafeInteger(pid) && pid > 0 ? pid : -1;
  };
}

async function startLeakFixtureTree(
  identity: SessionAdmissionIdentity,
): Promise<{ runId: string; parentPid: number; childPid: number }> {
  const supervisor = getProcessSupervisor();
  let childPid = -1;
  const readChildPid = createChildPidReader();
  const run = await supervisor.spawn({
    sessionId: identity.expectedSessionId,
    backendId: "leak50-test",
    scopeKey: identity.canonicalSessionKey,
    lifecycleAgentId: identity.agentId,
    lifecycleCanonicalSessionKey: identity.canonicalSessionKey,
    lifecycleExpectedSessionId: identity.expectedSessionId,
    mode: "child",
    argv: [process.execPath, "-e", buildLeakChildTreeScript()],
    captureOutput: false,
    onStdout: (chunk) => {
      childPid = readChildPid(chunk);
    },
  });
  const deadline = Date.now() + 10_000;
  while (childPid < 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (childPid < 0) {
    throw new Error("leak fixture child did not report its pid");
  }
  return { runId: run.runId, parentPid: run.pid ?? -1, childPid };
}

async function runLeakDrainCycle(index: number): Promise<number> {
  const identity: SessionAdmissionIdentity = {
    agentId: "leak-agent",
    canonicalSessionKey: "agent:leak-agent:main",
    expectedSessionId: `leak-session-${index}`,
  };
  const supervisor = getProcessSupervisor();
  const tree = await startLeakFixtureTree(identity);
  addSession(
    makeLeakBashSession({
      id: `leak-bash-${index}`,
      identity,
      pid: tree.parentPid,
      lifecycleCancel: () => {
        supervisor.cancel(tree.runId, "manual-cancel");
      },
      lifecycleExitPromise: (async () => {
        const active = supervisor.snapshotRunsForLifecycle(identity)[0];
        await active?.wait().catch(() => undefined);
      })(),
    }),
  );
  const fence = await sessionAdmissionRegistry.fence(identity);
  try {
    const result = await drainScope(identity, 15_000);
    if (!result.ok) {
      throw new Error(`cycle ${index} drain failed: ${result.reason} ${result.message}`);
    }
  } finally {
    fence.release();
  }
  await waitForPidDeath(tree.parentPid);
  await waitForPidDeath(tree.childPid);

  const bashRecords = snapshotProcessSessionsForLifecycle(identity).length;
  const supervisorRecords = supervisor.countActiveRunsForLifecycle(identity);
  if (bashRecords !== 0 || supervisorRecords !== 0) {
    throw new Error(
      `cycle ${index} left active records: bash=${bashRecords} supervisor=${supervisorRecords}`,
    );
  }
  if (getBashProcessRegistryState().sweeperActive) {
    throw new Error(`cycle ${index} left the bash registry sweeper active`);
  }
  return bashRecords + supervisorRecords;
}

describe("Runtime Lifecycle Governance — Phase 0 lifecycle safety contract", () => {
  it.each([
    ["child-", "pid=12345\n"],
    ["child-pid=12", "345\r\n"],
  ])("reads the complete child PID across stdout chunks %j", (first, rest) => {
    const readChildPid = createChildPidReader();
    expect(readChildPid(first)).toBe(-1);
    expect(readChildPid(rest)).toBe(12345);
  });

  it("required admission permit hook is live without an env opt-in", () => {
    const release = acquireSessionAdmissionPermit(
      {
        agentId: "agent-a",
        canonicalSessionKey: "agent:agent-a:main",
        expectedSessionId: "session-1",
      },
      "chat-send",
    );
    release();
    expect(sessionAdmissionRegistry.snapshot({
      agentId: "agent-a",
      canonicalSessionKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
    })?.totalPermits).toBe(1);
  });

  it("mission fencing save path is default-off", () => {
    expect(goalWakeController.isMissionFencingEnabled()).toBe(false);
  });

  it("goal wake arm path is default-off", () => {
    expect(goalWakeController.goalWakeEnabled()).toBe(false);
  });

  it("remaining Goal-wake flags are kill switches and only turn on with explicit truthy values", () => {
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
    expect(goalWakeController.isMissionFencingEnabled()).toBe(true);
    expect(goalWakeController.goalWakeEnabled()).toBe(true);
  });
});

describe("Runtime Lifecycle Governance — Phase 1 50-cycle leak fixture", () => {
  it(
    "drains 50 create/stop process-tree cycles without registry, timer, or heap leaks",
    async () => {
    process.stdout.write("[runtime-lifecycle-audit] leak50CycleHeapMethod=gc+used_heap_size\n");
    for (let warmup = 0; warmup < 2; warmup += 1) {
      await runLeakDrainCycle(warmup);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeHeapMb = await measureHeapMb();
    let activeRecords = 0;
    for (let index = 2; index < 52; index += 1) {
      activeRecords += await runLeakDrainCycle(index);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterHeapMb = await measureHeapMb();
    const heapDeltaMb = afterHeapMb - beforeHeapMb;
    process.stdout.write(`[runtime-lifecycle-audit] leak50CycleHeapDeltaMb=${heapDeltaMb.toFixed(3)}\n`);
    process.stdout.write(`[runtime-lifecycle-audit] leak50CycleActiveRecords=${activeRecords}\n`);
    expect(activeRecords).toBe(0);
    expect(heapDeltaMb).toBeLessThanOrEqual(2);
    },
    300_000,
  );
});
