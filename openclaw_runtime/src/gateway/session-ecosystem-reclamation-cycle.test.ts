/**
 * TF-0081 reclamation cycle fixture.
 *
 * Cycles one session identity through the shared stop/reset/delete resource
 * half (admission fence -> drainScope) 50 times with a real supervisor process
 * tree and a bound bash registry record, then asserts zero active residual:
 * active records, owned PIDs (including descendants), bash records, and the
 * retention sweeper timer. Exited supervisor diagnostics records are capped by
 * the registry and are asserted bounded, not zero.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { __resetWorktreeRegistry, createWorktreeService } from "../agents/worktree-service.js";
import {
  addSession,
  getBashProcessRegistryState,
  getSession,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "../agents/bash-process-registry.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import { drainScope } from "./session-drain-service.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";
import { isPidDefinitelyDead } from "../shared/pid-alive.js";

const CYCLES = 50;
const DRAIN_BUDGET_MS = 8_000;

const WORKTREE_OWNER = {
  agentId: "agent-reclaim",
  sessionKey: "agent:agent-reclaim:main",
  expectedSessionId: "session-reclaim",
} as const;
const identity = (): SessionAdmissionIdentity => ({
  agentId: "agent-reclaim",
  canonicalSessionKey: "agent:agent-reclaim:main",
  expectedSessionId: "session-reclaim",
});

function buildChildTreeScript(): string {
  return [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
    '  stdio: "ignore",',
    "});",
    "console.log(`child-pid=${child.pid}`);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

function makeBashSession(params: {
  id: string;
  cancel: () => void;
  exitPromise: Promise<unknown>;
  pid?: number;
}): ProcessSession {
  const now = Date.now();
  return {
    id: params.id,
    command: "fixture",
    scopeKey: "agent:agent-reclaim:main",
    sessionKey: "agent:agent-reclaim:main",
    lifecycleOwner: "native",
    lifecycleAgentId: "agent-reclaim",
    lifecycleCanonicalSessionKey: "agent:agent-reclaim:main",
    lifecycleExpectedSessionId: "session-reclaim",
    lifecycleCancel: params.cancel,
    lifecycleExitPromise: params.exitPromise,
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

async function spawnProcessTree(
  onChildPid: (pid: number) => void,
): Promise<{ runId: string; parentPid: number; exitPromise: Promise<unknown> }> {
  const supervisor = getProcessSupervisor();
  const run = await supervisor.spawn({
    sessionId: "session-reclaim",
    backendId: "reclaim-cycle",
    scopeKey: "agent:agent-reclaim:main",
    lifecycleAgentId: "agent-reclaim",
    lifecycleCanonicalSessionKey: "agent:agent-reclaim:main",
    lifecycleExpectedSessionId: "session-reclaim",
    mode: "child",
    argv: [process.execPath, "-e", buildChildTreeScript()],
    captureOutput: false,
    onStdout: (chunk: string) => {
      const match = chunk.match(/child-pid=(\d+)/u);
      if (match) {
        onChildPid(Number(match[1]));
      }
    },
  });
  return {
    runId: run.runId,
    parentPid: run.pid ?? -1,
    // The bash record's exit promise settles on the real process exit, so the
    // drain wait follows actual OS reclamation instead of a manual release.
    exitPromise: run.wait(),
  };
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

let tempRoot: string | null = null;

afterEach(() => {
  resetProcessRegistryForTests();
  sessionAdmissionRegistry.clearForTests();
  __resetWorktreeRegistry();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("session ecosystem reclamation cycle", () => {
  it(
    "50 create/spawn/stop-reset-delete cycles leave zero active residual",
    async () => {
      const supervisor = getProcessSupervisor();
      const mutations = ["stop", "reset", "delete"] as const;
      const tempBase = process.platform === "win32" ? "D:\\tmp" : os.tmpdir();
      tempRoot = mkdtempSync(path.join(tempBase, "openclaw-reclaim-cycle-"));
      const worktrees = createWorktreeService(tempRoot);
      let helperResidual = 0;
      let waiterResidual = 0;
      let worktreeResidual = 0;
      let ownedPidResidual = 0;
      let activeRecordResidual = 0;
      let finishedResidual = 0;
      const exitedDiagnosticsRunIds: string[] = [];

      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        const mutation = mutations[cycle % mutations.length]!;
        const releasePermit = sessionAdmissionRegistry.acquirePermit(identity(), "exec-spawn");
        const fencePromise = sessionAdmissionRegistry.fence(identity());
        const waitingSnapshot = sessionAdmissionRegistry.snapshot(identity());
        if (waitingSnapshot?.waiters !== 1 || waitingSnapshot.active !== 1) waiterResidual += 1;
        let childPid = -1;
        const tree = await spawnProcessTree((pid) => {
          childPid = pid;
        });
        const childDeadline = Date.now() + 10_000;
        while (childPid < 0 && Date.now() < childDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(childPid).toBeGreaterThan(0);

        const bashId = `reclaim-bash-${cycle}`;
        addSession(
          makeBashSession({
            id: bashId,
            cancel: () => {
              supervisor.cancel(tree.runId, "manual-cancel");
            },
            exitPromise: tree.exitPromise,
            pid: tree.parentPid,
          }),
        );
        const worktree = worktrees.create(`cycle-${cycle}`, {
          owner: {
            agentId: identity().agentId,
            sessionKey: identity().canonicalSessionKey,
            expectedSessionId: identity().expectedSessionId,
            retention: "delete",
          },
        });
        expect(getBashProcessRegistryState().runningCount).toBe(1);
        expect(supervisor.countActiveRunsForLifecycle(identity())).toBe(1);

        releasePermit();
        const fence = await fencePromise;
        const drained = await drainScope(identity(), DRAIN_BUDGET_MS);
        if (!drained.ok) {
          // Report the failing cycle precisely instead of a bare expect.
          throw new Error(
            `cycle ${cycle} (${mutation}) drain failed: ${drained.reason}: ${drained.message}`,
          );
        }

        if (!isPidDefinitelyDead(tree.parentPid)) {
          const dead = await waitForPidDeath(tree.parentPid);
          if (!dead) {
            ownedPidResidual += 1;
          }
        }
        if (!isPidDefinitelyDead(childPid)) {
          const dead = await waitForPidDeath(childPid);
          if (!dead) {
            ownedPidResidual += 1;
          }
        }
        if (supervisor.countActiveRunsForLifecycle(identity()) !== 0) {
          activeRecordResidual += 1;
        }
        if (getSession(bashId) !== undefined) {
          activeRecordResidual += 1;
        }
        const record = supervisor.getRecord(tree.runId);
        if (record !== undefined) {
          if (record.state !== "exited") {
            activeRecordResidual += 1;
          }
          exitedDiagnosticsRunIds.push(tree.runId);
        }

        if (drained.helperClaimProtocol !== 0) helperResidual += 1;
        const worktreeCleanup = worktrees.cleanupOwned(WORKTREE_OWNER);
        if (worktreeCleanup.failed !== 0 || worktreeCleanup.reclaimed !== 1) {
          worktreeResidual += 1;
        }
        if (worktrees.listOwned(WORKTREE_OWNER).some((entry) => entry.id === worktree.id)) {
          worktreeResidual += 1;
        }

        fence.release();
        const snapshot = sessionAdmissionRegistry.snapshot(identity());
        if ((snapshot?.active ?? 0) !== 0 || (snapshot?.waiters ?? 0) !== 0) {
          activeRecordResidual += 1;
        }
      }

      const finalState = getBashProcessRegistryState();
      if (finalState.runningCount !== 0 || finalState.finishedCount !== 0) {
        finishedResidual = finalState.runningCount + finalState.finishedCount;
      }

      console.log(
        `[reclamation-audit] cycles=${CYCLES} activeRecordResidual=${activeRecordResidual} ` +
          `ownedPidResidual=${ownedPidResidual} finishedResidual=${finishedResidual} ` +
          `helperResidual=${helperResidual} waiterResidual=${waiterResidual} worktreeResidual=${worktreeResidual} ` +
          `sweeperActive=${finalState.sweeperActive} ` +
          `exitedDiagnosticsRecords=${exitedDiagnosticsRunIds.length}`,
      );

      expect(activeRecordResidual).toBe(0);
      expect(ownedPidResidual).toBe(0);
      expect(finishedResidual).toBe(0);
      expect(helperResidual).toBe(0);
      expect(waiterResidual).toBe(0);
      expect(worktreeResidual).toBe(0);
      expect(finalState.sweeperActive).toBe(false);
      // Exited diagnostics records are capped by the run registry (default
      // 2000), so 50 cycles must retain at most 50 bounded records.
      expect(exitedDiagnosticsRunIds.length).toBeLessThanOrEqual(CYCLES);
    },
    240_000,
  );
});
