import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTaskDomain } from "../../../shared/task-system/identity.js";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import type { SessionEntry } from "../config/sessions.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  buildRecoveryAdmissionKey,
  prepareOwnerRecoveryAdmission,
} from "./recovery-authority/owner-admission.js";
import { reconcileOrphanedRestoredRuns } from "./subagent-registry-helpers.js";
import { createSubagentRegistryLifecycleController } from "./subagent-registry-lifecycle.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const state = vi.hoisted(() => ({ store: {} as Record<string, SessionEntry> }));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => state.store,
  resolveAgentIdFromSessionKey: () => "main",
  resolveStorePath: () => "owner-store",
  updateSessionStore: vi.fn(),
}));
vi.mock("../runtime.js", () => ({ defaultRuntime: { log: vi.fn(), error: vi.fn() } }));
vi.mock("../sessions/session-lifecycle-events.js", () => ({ emitSessionLifecycleEvent: vi.fn() }));
vi.mock("../tasks/detached-task-runtime.js", () => ({
  completeTaskRunByRunId: vi.fn(),
  failTaskRunByRunId: vi.fn(),
  setDetachedTaskDeliveryStatusByRunId: vi.fn(),
}));
vi.mock("./agent-bundle-mcp-tools.js", () => ({ retireSessionMcpRuntimeForSessionKey: vi.fn() }));
vi.mock("./subagent-session-reconciliation.js", () => ({
  loadSubagentSessionEntry: (input: { childSessionKey: string }) =>
    state.store[input.childSessionKey],
}));

const key = "agent:main:subagent:reserved";
beforeEach(() => {
  state.store = {};
  vi.clearAllMocks();
});

function fixture(effect: "unknown" | "not_applied") {
  const now = Date.now();
  const idempotencyKey = buildRecoveryAdmissionKey(
    "subagent-orphan",
    "original",
    "generation",
    "original",
  );
  const result = prepareOwnerRecoveryAdmission({
    requestId: idempotencyKey,
    entry: "subagent-orphan",
    owner: { kind: "subagent-run", ownerId: "original", runId: "original", sessionKey: key },
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
    effect,
    requestedAction: "resume",
    idempotencyKey,
    evidence: [],
    requestedAt: now,
  });
  if (!result.record) throw new Error("fixture record missing");
  state.store[key] = {
    sessionId: "generation",
    updatedAt: now,
    lifecycleRunId: effect === "unknown" ? "original" : idempotencyKey,
    status: effect === "unknown" ? "killed" : "running",
    abortedLastRun: effect === "unknown",
    subagentRecovery: { authority: result.record },
  };
  const original: SubagentRunRecord = {
    runId: "original",
    childSessionKey: key,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "original task",
    cleanup: "keep",
    createdAt: now - 3 * 60 * 60 * 1000,
  };
  return { original, runs: new Map([[original.runId, original]]) };
}

describe("reserved owners in real registry lifecycle and restore helpers", () => {
  it.each([
    ["requester_generation_stale", "AGENT_SESSION_GENERATION_STALE"],
    ["requester_owner_retired", "AGENT_CONTINUATION_OWNER_RETIRED"],
  ] as const)("persists terminal %s without retrying after duplicate delivery or restore", async (reason, error) => {
    const { original, runs } = fixture("not_applied");
    state.store = {};
    original.requesterSessionId = "original-parent-generation";
    original.expectsCompletionMessage = true;
    original.endedAt = Date.now();
    original.outcome = { status: "ok" };
    original.execution = { status: "terminal", endedAt: original.endedAt, outcome: original.outcome };
    const saved: SubagentRunRecord[] = [];
    const resume = vi.fn();
    const announce = vi.fn(async (input: Parameters<typeof import("./subagent-announce.js").runSubagentAnnounceFlow>[0]) => {
      expect(input.expectedRequesterSessionId).toBe("original-parent-generation");
      input.onDeliveryResult?.({ delivered: false, path: "none", terminal: true, reason, error });
      return false;
    });
    const controller = createSubagentRegistryLifecycleController({
      runs, resumedRuns: new Set(), subagentAnnounceTimeoutMs: 1000,
      persist: () => saved.push(structuredClone(runs.get(original.runId)!)),
      clearPendingLifecycleError: vi.fn(), countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false, shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(), notifyContextEngineSubagentEnded: vi.fn(),
      resumeSubagentRun: resume, callGateway: vi.fn(), captureSubagentCompletionReply: vi.fn(),
      runSubagentAnnounceFlow: announce, warn: vi.fn(),
    });
    expect(controller.startSubagentAnnounceCleanupFlow(original.runId, original)).toBe(true);
    expect(controller.startSubagentAnnounceCleanupFlow(original.runId, original)).toBe(false);
    await vi.waitFor(() => expect(original.cleanupCompletedAt).toEqual(expect.any(Number)));
    const restored = structuredClone(saved.at(-1)!);
    expect(restored.delivery).toMatchObject({ status: "failed", lastDropReason: reason });
    runs.set(restored.runId, restored);
    expect(controller.startSubagentAnnounceCleanupFlow(restored.runId, restored)).toBe(false);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it("retains an admitted run before cold-start stale orphan pruning", () => {
    const { original, runs } = fixture("not_applied");
    expect(reconcileOrphanedRestoredRuns({ runs, resumedRuns: new Set() })).toBe(false);
    expect(runs.get(original.runId)).toBe(original);
    expect(original.endedAt).toBeUndefined();
  });

  it("settles a remapped worker's cancelled delegation without announcing or resuming after restore", async () => {
    await withTempDir("cancel-remapped-worker-", async (workspaceDir) => {
      const { original } = fixture("not_applied");
      const parentGeneration = "parent-generation";
      const worker = { ...original, runId: "remapped", initialRunId: original.runId, workspaceDir, expectsCompletionMessage: true };
      state.store = {
        [original.requesterSessionKey]: { sessionId: parentGeneration, updatedAt: Date.now() },
        [key]: { sessionId: "generation", updatedAt: Date.now() },
      };
      const ledger = new TaskSystemStore(resolveTaskDomain(workspaceDir));
      try {
        const taskId = ledger.create({
          objective: "Verify cancelled worker settlement", target: "result.txt", constraints: [],
          acceptance: [{ id: "proof", description: "Verify output", verification: { kind: "owner-receipt", owner: "fixture" } }],
        }, "create").task.contract.taskNodeId;
        const parent = ledger.claim(taskId, original.requesterSessionKey, parentGeneration, "claim").claim!;
        const delegation = ledger.prepareWriterDelegation(parent, {
          delegationId: original.runId, childRunId: original.runId, childSessionKey: key,
          childGeneration: "generation", childWorktree: workspaceDir, mode: "writer",
        });
        ledger.recordDelegationDispatch(key, original.runId, "dispatched");
        expect(ledger.control(delegation.child, "cancel").contract.state).toBe("cancelling");

        const runs = new Map<string, SubagentRunRecord>([[worker.runId, worker]]);
        const saved: SubagentRunRecord[] = [];
        const announce = vi.fn();
        const resume = vi.fn();
        const controller = createSubagentRegistryLifecycleController({
          runs, resumedRuns: new Set(), subagentAnnounceTimeoutMs: 1000,
          persist: () => saved.push(structuredClone(runs.get(worker.runId)!)),
          clearPendingLifecycleError: vi.fn(), countPendingDescendantRuns: () => 0,
          suppressAnnounceForSteerRestart: () => false, shouldEmitEndedHookForRun: () => false,
          emitSubagentEndedHookForRun: vi.fn(), notifyContextEngineSubagentEnded: vi.fn(),
          resumeSubagentRun: resume, callGateway: vi.fn(), captureSubagentCompletionReply: vi.fn(),
          runSubagentAnnounceFlow: announce, cleanupBrowserSessionsForLifecycleEnd: vi.fn(), warn: vi.fn(),
        });
        const lateSuccess = { runId: worker.runId, outcome: { status: "ok" }, reason: "subagent-complete", triggerCleanup: true } as const;
        await controller.completeSubagentRun(lateSuccess);
        await vi.waitFor(() => expect(saved.at(-1)?.cleanupCompletedAt).toEqual(expect.any(Number)));
        const restored = saved.at(-1)!;
        expect(restored).toMatchObject({ endedReason: "subagent-killed", expectsCompletionMessage: false });
        runs.set(worker.runId, restored);
        await controller.completeSubagentRun(lateSuccess);
        expect(controller.startSubagentAnnounceCleanupFlow(worker.runId, restored)).toBe(false);

        expect(ledger.delegationForChild(key)).toMatchObject({
          phase: "returned", terminalReceipt: { runId: original.runId, outcome: "cancelled", parentGeneration },
        });
        expect(ledger.get(taskId)).toMatchObject({ contract: { state: "cancelled" }, claim: { state: "released" } });
        expect(ledger.history(taskId).filter((event) => event.kind === "cancelled")).toHaveLength(1);
        expect(ledger.getTaskEvidence(taskId)).toEqual([]);
        expect(announce).not.toHaveBeenCalled();
        expect(resume).not.toHaveBeenCalled();
      } finally {
        ledger.close();
      }
    });
  });

  it.each(["unknown", "not_applied"] as const)(
    "rejects an original terminal callback with effect=%s",
    async (effect) => {
      const { original, runs } = fixture(effect);
      const persist = vi.fn();
      const clearError = vi.fn();
      const controller = createSubagentRegistryLifecycleController({
        runs,
        resumedRuns: new Set(),
        subagentAnnounceTimeoutMs: 1000,
        persist,
        clearPendingLifecycleError: clearError,
        countPendingDescendantRuns: () => 0,
        suppressAnnounceForSteerRestart: () => false,
        shouldEmitEndedHookForRun: () => false,
        emitSubagentEndedHookForRun: vi.fn(),
        notifyContextEngineSubagentEnded: vi.fn(),
        resumeSubagentRun: vi.fn(),
        callGateway: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        runSubagentAnnounceFlow: vi.fn(),
        warn: vi.fn(),
      });
      await controller.completeSubagentRun({
        runId: original.runId,
        endedAt: Date.now(),
        outcome: { status: "error", error: "old original terminal callback" },
        reason: "subagent-error",
        triggerCleanup: false,
      });
      expect(original.endedAt).toBeUndefined();
      expect(persist).not.toHaveBeenCalled();
      expect(clearError).not.toHaveBeenCalled();
    },
  );
});
