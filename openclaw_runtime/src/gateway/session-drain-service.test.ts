/**
 * Phase 1 drain-scope contract tests.
 *
 * These tests use real child processes and the real singleton supervisor so a
 * green run proves that cancellation reaches descendant processes, not just
 * the parent PID.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  addSession,
  deleteSession,
  getBashProcessRegistryState,
  getFinishedSession,
  getSession,
  markExited,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "../agents/bash-process-registry.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import {
  drainScope,
  type DrainScopeResult,
} from "./session-drain-service.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";
import { isPidDefinitelyDead } from "../shared/pid-alive.js";

const identity = (expectedSessionId = "session-1"): SessionAdmissionIdentity => ({
  agentId: "agent-a",
  canonicalSessionKey: "agent:agent-a:main",
  expectedSessionId,
});

function makeBashSession(params: {
  id: string;
  expectedSessionId?: string;
  lifecycleOwner?: ProcessSession["lifecycleOwner"];
  lifecycleCancel?: () => void;
  lifecycleExitPromise?: Promise<unknown>;
  pid?: number;
}): ProcessSession {
  const now = Date.now();
  return {
    id: params.id,
    command: "fixture",
    scopeKey: "agent:agent-a:main",
    sessionKey: "agent:agent-a:main",
    lifecycleOwner: params.lifecycleOwner ?? "native",
    lifecycleAgentId: "agent-a",
    lifecycleCanonicalSessionKey: "agent:agent-a:main",
    lifecycleExpectedSessionId: params.expectedSessionId ?? "session-1",
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

function buildChildTreeScript(): string {
  return [
    'const { spawn } = require("node:child_process");',
    "const child = spawn(process.execPath, [\"-e\", \"setInterval(() => {}, 1000)\"], {",
    '  stdio: "ignore",',
    "});",
    'console.log(`child-pid=${child.pid}`);',
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

async function spawnProcessTreeForIdentity(
  lifecycle: SessionAdmissionIdentity,
): Promise<{ runId: string; parentPid: number; childPid: number }> {
  const supervisor = getProcessSupervisor();
  let childPid = -1;
  const run = await supervisor.spawn({
    sessionId: lifecycle.expectedSessionId,
    backendId: "test-drain",
    scopeKey: lifecycle.canonicalSessionKey,
    lifecycleAgentId: lifecycle.agentId,
    lifecycleCanonicalSessionKey: lifecycle.canonicalSessionKey,
    lifecycleExpectedSessionId: lifecycle.expectedSessionId,
    mode: "child",
    argv: [process.execPath, "-e", buildChildTreeScript()],
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
  expect(childPid).toBeGreaterThan(0);
  return { runId: run.runId, parentPid: run.pid ?? -1, childPid };
}

async function waitForPidDeath(pid: number, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidDefinitelyDead(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

afterEach(() => {
  resetProcessRegistryForTests();
  sessionAdmissionRegistry.clearForTests();
});

describe("drainScope Phase 1 contract", () => {
  it("refuses to drain when the admission fence is open", async () => {
    const result = await drainScope(identity(), 100);
    expect(result.ok).toBe(false);
    expect((result as { ok: false }).reason).toBe("fence-open");
  });

  it("times out fail-closed and leaves the owner record registered", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity());
    addSession(
      makeBashSession({
        id: "never-exits",
        lifecycleCancel: () => {},
        lifecycleExitPromise: new Promise(() => {}),
      }),
    );
    const result = await drainScope(identity(), 30);
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(getSession("never-exits")).toBeDefined();
    expect(getBashProcessRegistryState().runningCount).toBe(1);
    fence.release();
    deleteSession("never-exits");
  });

  it("fails closed for unknown and VerseShell-owned records without a lifecycle cancel", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity());
    addSession(
      makeBashSession({
        id: "vs-unknown-cancel",
        lifecycleOwner: "verseshell",
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await drainScope(identity(), 500);
    expect(result).toMatchObject({ ok: false, reason: "unknown-owner" });
    expect(getSession("vs-unknown-cancel")).toBeDefined();
    fence.release();
    deleteSession("vs-unknown-cancel");
  });

  it("snapshots by lifecycle identity and never cancels other identities", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("target"));
    let targetCancelled = false;
    let otherCancelled = false;
    addSession(
      makeBashSession({
        id: "target",
        expectedSessionId: "target",
        lifecycleCancel: () => {
          targetCancelled = true;
        },
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    addSession(
      makeBashSession({
        id: "other-generation",
        expectedSessionId: "other",
        lifecycleCancel: () => {
          otherCancelled = true;
        },
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await drainScope(identity("target"), 1000);
    expect(result.ok).toBe(true);
    expect(targetCancelled).toBe(true);
    expect(otherCancelled).toBe(false);
    expect(getSession("target")).toBeUndefined();
    expect(getSession("other-generation")).toBeDefined();
    fence.release();
    deleteSession("other-generation");
  });

  it("rejects when the owner registry gains a new record during drain", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("new-record"));
    addSession(
      makeBashSession({
        id: "original",
        expectedSessionId: "new-record",
        lifecycleCancel: () => {
          addSession(
            makeBashSession({
              id: "late-record",
              expectedSessionId: "new-record",
              lifecycleExitPromise: Promise.resolve(),
            }),
          );
        },
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await drainScope(identity("new-record"), 1000);
    expect(result).toMatchObject({ ok: false, reason: "new-records" });
    expect(getSession("original")).toBeDefined();
    expect(getSession("late-record")).toBeDefined();
    fence.release();
    deleteSession("original");
    deleteSession("late-record");
  });

  it("drains native supervisor and bash registry processes by identity and kills the full child tree", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("tree"));
    const supervisor = getProcessSupervisor();
    const { runId, parentPid, childPid } = await spawnProcessTreeForIdentity(identity("tree"));
    expect(supervisor.getRecord(runId)?.pid).toBe(parentPid);
    const treeIdentity = {
      agentId: "agent-a",
      canonicalSessionKey: "agent:agent-a:main",
      expectedSessionId: "tree",
    };
    addSession(
      makeBashSession({
        id: "bash-tree",
        expectedSessionId: "tree",
        pid: parentPid,
        lifecycleCancel: () => {
          supervisor.cancel(runId, "manual-cancel");
        },
        lifecycleExitPromise: (async () => {
          const active = supervisor.snapshotRunsForLifecycle(treeIdentity)[0];
          await active?.wait().catch(() => undefined);
        })(),
      }),
    );

    const result = await drainScope(identity("tree"), 15_000);
    expect(result.ok).toBe(true);
    expect(supervisor.countActiveRunsForLifecycle(treeIdentity)).toBe(0);
    expect(getSession("bash-tree")).toBeUndefined();
    expect(await waitForPidDeath(parentPid)).toBe(true);
    expect(await waitForPidDeath(childPid)).toBe(true);
    fence.release();
  }, 30_000);

  it("drains supervisor-owned process trees when no bash registry records exist", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("supervisor-only"));
    const supervisor = getProcessSupervisor();
    const { parentPid, childPid } = await spawnProcessTreeForIdentity(identity("supervisor-only"));

    const result = await drainScope(identity("supervisor-only"), 15_000);
    expect(result.ok).toBe(true);
    expect(supervisor.countActiveRunsForLifecycle(identity("supervisor-only"))).toBe(0);
    expect(await waitForPidDeath(parentPid)).toBe(true);
    expect(await waitForPidDeath(childPid)).toBe(true);
    fence.release();
  }, 30_000);

  it("leaves supervisor runs of other lifecycle identities untouched", async () => {
    const targetIdentity = identity("target-supervisor");
    const otherIdentity = identity("other-supervisor");
    const targetFence = await sessionAdmissionRegistry.fence(targetIdentity);
    const supervisor = getProcessSupervisor();
    const target = await spawnProcessTreeForIdentity(targetIdentity);
    const other = await spawnProcessTreeForIdentity(otherIdentity);

    const result = await drainScope(targetIdentity, 15_000);
    expect(result.ok).toBe(true);
    expect(supervisor.countActiveRunsForLifecycle(targetIdentity)).toBe(0);
    expect(supervisor.countActiveRunsForLifecycle(otherIdentity)).toBe(1);
    expect(await waitForPidDeath(target.parentPid)).toBe(true);
    expect(await waitForPidDeath(target.childPid)).toBe(true);

    supervisor.cancel(other.runId, "manual-cancel");
    targetFence.release();
    await waitForPidDeath(other.parentPid);
    await waitForPidDeath(other.childPid);
  }, 30_000);

  it("removes retained finished bash sessions for the identity and stops the sweeper", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("finished"));
    const session = makeBashSession({
      id: "finished-record",
      expectedSessionId: "finished",
    });
    session.backgrounded = true;
    addSession(session);
    markExited(session, 0, null, "completed", "exit");
    expect(getFinishedSession("finished-record")).toBeDefined();
    expect(getBashProcessRegistryState().sweeperActive).toBe(true);

    const result = await drainScope(identity("finished"), 1000);
    expect(result.ok).toBe(true);
    expect(getFinishedSession("finished-record")).toBeUndefined();
    expect(getBashProcessRegistryState()).toEqual({
      runningCount: 0,
      finishedCount: 0,
      sweeperActive: false,
    });
    fence.release();
  });

  it("fails closed for a record with an unknown lifecycle owner", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("unknown-owner"));
    addSession(
      makeBashSession({
        id: "owner-missing",
        expectedSessionId: "unknown-owner",
        lifecycleOwner: undefined,
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await drainScope(identity("unknown-owner"), 500);
    expect(result).toMatchObject({ ok: false, reason: "unknown-owner" });
    expect(getSession("owner-missing")).toBeDefined();
    fence.release();
    deleteSession("owner-missing");
  });

  it("treats an empty owner snapshot as a vacuous successful drain", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("empty"));
    const result = await drainScope(identity("empty"), 1000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bashSessionsRemoved).toBe(0);
      expect(result.supervisorRunsDrained).toBe(0);
      expect(result.osContainment).toBe("empty");
    }
    fence.release();
  });

  it("returns explicit vacuous absence for goal rows and helper claims", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity("vacuous"));
    const result = (await drainScope(identity("vacuous"), 1000)) as Extract<
      DrainScopeResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    expect(result.goalTaskFlowRows).toBe(0);
    expect(result.helperClaimProtocol).toBe(0);
    fence.release();
  });
});
