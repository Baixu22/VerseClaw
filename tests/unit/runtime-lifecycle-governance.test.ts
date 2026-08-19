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
  RUNTIME_LIFECYCLE_ADMISSION_ENABLED_ENV,
  sessionAdmissionEnabled,
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../../openclaw_runtime/src/sessions/session-admission-registry.js";
import {
  RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED_ENV,
  sessionDeleteOperationJournalEnabled,
} from "../../openclaw_runtime/src/gateway/session-delete-operation-journal.js";
import { drainScope } from "../../openclaw_runtime/src/gateway/session-drain-service.js";
import { getProcessSupervisor } from "../../openclaw_runtime/src/process/supervisor/index.js";
import { isPidDefinitelyDead } from "../../openclaw_runtime/src/shared/pid-alive.js";
import { goalWakeController } from "../../openclaw_runtime/src/agents/goal-wake-controller.js";

afterEach(() => {
  delete process.env[RUNTIME_LIFECYCLE_ADMISSION_ENABLED_ENV];
  delete process.env[RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED_ENV];
  delete process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED;
  delete process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED;
  sessionAdmissionRegistry.clearForTests();
  resetProcessRegistryForTests();
});

async function measureHeapMb(): Promise<number> {
  if (typeof globalThis.gc === "function") {
    for (let index = 0; index < 3; index += 1) {
      globalThis.gc();
    }
    return v8.getHeapStatistics().used_heap_size / 1024 / 1024;
  }

  // Node without --expose-gc cannot call gc() synchronously. Repeatedly build
  // a short memory-pressure wave, yield to the event loop, and sample
  // used_heap_size. V8 eventually runs a natural scavenge/mark-compact; the
  // minimum of the post-wave samples is the natural-GC floor. The same floor
  // is measured before and after the 50-cycle window, so the delta remains an
  // honest leak measurement rather than a GC-timing artifact.
  const samples: number[] = [];
  for (let wave = 0; wave < 20; wave += 1) {
    const pressure: number[][] = [];
    for (let index = 0; index < 8; index += 1) {
      pressure.push(new Array<number>(1024 * 1024).fill(index));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    pressure.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 10));
    samples.push(v8.getHeapStatistics().used_heap_size / 1024 / 1024);
  }
  return Math.min(...samples);
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

async function startLeakFixtureTree(
  identity: SessionAdmissionIdentity,
): Promise<{ runId: string; parentPid: number; childPid: number }> {
  const supervisor = getProcessSupervisor();
  let childPid = -1;
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
      const match = chunk.match(/child-pid=(\d+)/u);
      if (match) {
        childPid = Number(match[1]);
      }
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

describe("Runtime Lifecycle Governance — Phase 0 default-off contract", () => {
  it("admission permit hook is default-off and leaves the registry untouched", () => {
    expect(sessionAdmissionEnabled()).toBe(false);
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
    })?.totalPermits).toBeUndefined();
  });

  it("delete operation journal probe is default-off", () => {
    expect(sessionDeleteOperationJournalEnabled()).toBe(false);
  });

  it("mission fencing save path is default-off", () => {
    expect(goalWakeController.isMissionFencingEnabled()).toBe(false);
  });

  it("goal wake arm path is default-off", () => {
    expect(goalWakeController.goalWakeEnabled()).toBe(false);
  });

  it("all three Phase 0 flags are kill switches and only turn on with explicit truthy values", () => {
    process.env[RUNTIME_LIFECYCLE_ADMISSION_ENABLED_ENV] = "1";
    process.env[RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED_ENV] = "1";
    process.env.RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED = "1";
    process.env.RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED = "1";
    expect(sessionAdmissionEnabled()).toBe(true);
    expect(sessionDeleteOperationJournalEnabled()).toBe(true);
    expect(goalWakeController.isMissionFencingEnabled()).toBe(true);
    expect(goalWakeController.goalWakeEnabled()).toBe(true);
  });
});

describe("Runtime Lifecycle Governance — Phase 1 50-cycle leak fixture", () => {
  it("drains 50 create/stop process-tree cycles without registry, timer, or heap leaks", async () => {
    const heapMethod =
      typeof globalThis.gc === "function"
        ? "gc+used_heap_size"
        : "v8.getHeapStatistics.used_heap_size";
    console.log(`[runtime-lifecycle-audit] leak50CycleHeapMethod=${heapMethod}`);
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
    console.log(`[runtime-lifecycle-audit] leak50CycleHeapDeltaMb=${heapDeltaMb.toFixed(3)}`);
    console.log(`[runtime-lifecycle-audit] leak50CycleActiveRecords=${activeRecords}`);
    expect(activeRecords).toBe(0);
    expect(heapDeltaMb).toBeLessThanOrEqual(2);
  }, 300_000);
});
