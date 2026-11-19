import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import {
  buildRecoveryAdmissionKey,
  prepareOwnerRecoveryAdmission,
} from "./recovery-authority/owner-admission.js";
import { createSubagentRunManager } from "./subagent-registry-run-manager.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

vi.mock("../gateway/call.js", () => ({ callGateway: vi.fn() }));
vi.mock("../tasks/detached-task-runtime.js", () => ({ createRunningTaskRun: vi.fn() }));
const recoveryState = vi.hoisted(() => ({ owner: undefined as SessionEntry | undefined }));
vi.mock("./subagent-session-reconciliation.js", () => ({
  loadSubagentSessionEntry: () => recoveryState.owner,
}));
beforeEach(() => {
  recoveryState.owner = undefined;
});
vi.mock("./subagent-registry-helpers.js", () => ({
  getSubagentSessionRuntimeMs: () => 0,
  getSubagentSessionStartedAt: () => 100,
  persistSubagentSessionTiming: vi.fn(),
  resolveArchiveAfterMs: () => 60_000,
  safeRemoveAttachmentsDir: vi.fn(),
}));

describe("recovery adoption in the actual subagent run manager", () => {
  it("preserves the original owner when its wait finishes after a recovery admission", async () => {
    const original: SubagentRunRecord = {
      runId: "original",
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "original task",
      cleanup: "keep",
      createdAt: 100,
    };
    let finish!: (result: {
      status: string;
      startedAt: number;
      endedAt: number;
      error: string;
    }) => void;
    const gateway = vi.fn();
    gateway.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const complete = vi.fn();
    const schedule = vi.fn();
    const manager = createSubagentRunManager({
      runs: new Map([[original.runId, original]]),
      resumedRuns: new Set(),
      endedHookInFlightRunIds: new Set(),
      persist: vi.fn(),
      persistOrThrow: vi.fn(),
      callGateway: gateway,
      getRuntimeConfig: () => ({}),
      ensureRuntimePluginsLoaded: vi.fn(),
      ensureListener: vi.fn(),
      startSweeper: vi.fn(),
      stopSweeper: vi.fn(),
      resumeSubagentRun: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      resolveSubagentWaitTimeoutMs: () => 1000,
      scheduleOrphanRecovery: schedule,
      resolveSubagentSessionCompletion: () => null,
      resolveSubagentSessionStartedAt: () => 100,
      notifyContextEngineSubagentEnded: vi.fn(),
      completeCleanupBookkeeping: vi.fn(),
      completeSubagentRun: complete,
    });
    const waiting = manager.waitForSubagentCompletion("original", 1000, original);
    const idempotencyKey = buildRecoveryAdmissionKey(
      "subagent-orphan",
      "original",
      "generation",
      "original",
    );
    const prepared = prepareOwnerRecoveryAdmission({
      requestId: idempotencyKey,
      entry: "subagent-orphan",
      owner: {
        kind: "subagent-run",
        ownerId: "original",
        runId: "original",
        sessionKey: original.childSessionKey,
      },
      admission: {
        trigger: "gateway-restart",
        requiredPreState: "active-subagent-run",
        admitted: true,
        visibleOutputObserved: false,
      },
      budget: {
        attempts: { current: 0, max: 2 },
        backoff: { initialMs: 5000, multiplier: 2 },
        wedge: { afterAttempts: 2, wedged: false },
      },
      replayClass: "reconcile",
      effect: "not_applied",
      requestedAction: "resume",
      idempotencyKey,
      evidence: [],
      requestedAt: 150,
    });
    if (!prepared.admitted) throw new Error("fixture admission missing");
    recoveryState.owner = {
      sessionId: "generation",
      updatedAt: 150,
      lifecycleRunId: idempotencyKey,
      status: "running",
      abortedLastRun: false,
      subagentRecovery: { authority: prepared.record },
    };
    finish({ status: "error", startedAt: 100, endedAt: 200, error: "original run interrupted" });
    await waiting;
    expect(original.endedAt).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith({ delayMs: 1000 });
  });

  it("keeps an installed terminal destination when a delayed acknowledgement remaps again", () => {
    const original: SubagentRunRecord = {
      runId: "original",
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      requesterSessionId: "parent-generation",
      requesterDisplayKey: "main",
      task: "original task",
      cleanup: "keep",
      createdAt: 100,
    };
    const runs = new Map([[original.runId, original]]);
    const persist = vi.fn();
    const manager = createSubagentRunManager({
      runs,
      resumedRuns: new Set(),
      endedHookInFlightRunIds: new Set(),
      persist,
      persistOrThrow: vi.fn(),
      callGateway: vi.fn(),
      getRuntimeConfig: () => ({}),
      ensureRuntimePluginsLoaded: vi.fn(),
      ensureListener: vi.fn(),
      startSweeper: vi.fn(),
      stopSweeper: vi.fn(),
      resumeSubagentRun: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      resolveSubagentWaitTimeoutMs: () => 1000,
      scheduleOrphanRecovery: vi.fn(),
      resolveSubagentSessionCompletion: () => null,
      resolveSubagentSessionStartedAt: () => 100,
      notifyContextEngineSubagentEnded: vi.fn(),
      completeCleanupBookkeeping: vi.fn(),
      completeSubagentRun: vi.fn(),
    });
    const remap = {
      previousRunId: "original",
      nextRunId: "admitted",
      fallback: original,
      startedAt: 150,
    };
    expect(manager.replaceSubagentRunAfterSteer(remap)).toBe(true);
    const installed = runs.get("admitted")!;
    expect(installed.startedAt).toBe(150);
    expect(installed.initialRunId).toBe("original");
    installed.endedAt = 200;
    installed.cleanupHandled = true;
    installed.completion = {
      ...installed.completion,
      required: true,
      resultText: "completed result",
      capturedAt: 200,
    };
    const writes = persist.mock.calls.length;
    expect(manager.replaceSubagentRunAfterSteer(remap)).toBe(true);
    expect(runs.get("admitted")).toBe(installed);
    expect(installed.endedAt).toBe(200);
    expect(installed.cleanupHandled).toBe(true);
    expect(installed.completion?.resultText).toBe("completed result");
    expect(persist).toHaveBeenCalledTimes(writes);
    expect(manager.replaceSubagentRunAfterSteer({ previousRunId: "admitted", nextRunId: "recovered" })).toBe(true);
    expect(runs.get("recovered")?.initialRunId).toBe("original");
  });
});
