import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { mergeSessionEntry } from "../config/sessions/types.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const state = vi.hoisted(() => ({
  store: {} as Record<string, SessionEntry>,
  runs: new Map<string, SubagentRunRecord>(),
  gateway: vi.fn(),
  writeFails: false,
  phaseEnabled: true,
  phase: "none" as "none" | "resume" | "reconcile",
  remap: true,
  steer: vi.fn(),
}));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => state.store,
  resolveAgentIdFromSessionKey: () => "main",
  resolveStorePath: () => "agent-store",
  updateSessionStore: async (_path: string, mutate: (store: typeof state.store) => unknown) => {
    if (state.writeFails) throw new Error("injected durable admission failure");
    return mutate(state.store);
  },
  updateSessionStoreAtomic: async (
    _path: string,
    mutate: (store: typeof state.store) => unknown,
  ) => {
    if (state.writeFails) throw new Error("injected durable admission failure");
    return mutate(state.store);
  },
}));
vi.mock("../gateway/call.js", () => ({ callGateway: state.gateway }));
vi.mock("../gateway/session-utils.fs.js", () => ({
  readSessionMessagesAsync: async () => [{ role: "user", content: "Continue the original task" }],
}));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("./internal-session-effects.js", () => ({
  resolveInternalSessionEffectsTranscriptPath: (runId: string) => runId + ".jsonl",
}));
vi.mock("./subagent-registry-steer-runtime.js", () => ({
  replaceSubagentRunAfterSteer: (params: unknown) => {
    state.steer(params);
    return state.remap;
  },
  finalizeInterruptedSubagentRun: vi.fn(),
}));
vi.mock("./execution-phase/tool-boundary.js", () => ({
  isExecutionPhaseWriterEnabled: () => state.phaseEnabled,
  settlePersistedToolResult: vi.fn(),
}));
vi.mock("./execution-phase/recovery.js", () => ({
  resolveExecutionPhaseRecovery: () => ({
    action: state.phase,
    phases: [],
    reason: "observed durable tool boundary",
  }),
  authorizePendingToolRecovery: vi.fn(),
}));

import {
  recoverOrphanedSubagentSessions,
  scheduleOrphanRecovery,
} from "./subagent-orphan-recovery.js";
import { finalizeInterruptedSubagentRun } from "./subagent-registry-steer-runtime.js";
import { sessionAdmissionRegistry } from "../sessions/session-admission-registry.js";
import { reconcileAcceptedOrphanRun } from "./recovery-authority/subagent-adapter.js";
import { hasReservedSubagentRecovery } from "./subagent-recovery-state.js";

const key = "agent:main:subagent:child";
const recover = () => recoverOrphanedSubagentSessions({ getActiveRuns: () => state.runs });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
  state.writeFails = false;
  state.phaseEnabled = true;
  state.phase = "none";
  state.remap = true;
  sessionAdmissionRegistry.clearForTests();
  state.store = {
    [key]: {
      sessionId: "generation-1",
      updatedAt: 100,
      status: "running",
      lifecycleRunId: "original-run",
      abortedLastRun: true,
    },
  };
  state.runs = new Map([
    [
      "original-run",
      {
        runId: "original-run",
        childSessionKey: key,
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        task: "Complete the original task",
        cleanup: "keep",
        createdAt: 100,
      },
    ],
  ]);
  state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
    if (
      state.store[key].subagentRecovery?.authority?.idempotencyKey === call.params.idempotencyKey
    ) {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = false;
    }
    return { runId: call.params.idempotencyKey };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  sessionAdmissionRegistry.clearForTests();
});

describe("subagent durable recovery admission", () => {
  it.each([0, 2])("reserves an unknown effect with %s consumed attempts", async (attempts) => {
    state.phase = "reconcile";
    state.store[key].status = "killed";
    state.store[key].subagentRecovery = { automaticAttempts: attempts, lastAttemptAt: Date.now() };
    await recover();
    expect(state.gateway).not.toHaveBeenCalled();
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("reconcile");
    expect(hasReservedSubagentRecovery(state.store[key], "original-run")).toBe(true);
  });

  it("rejects an ordinary rotation retaining an older compaction usage family", async () => {
    await recover();
    state.store[key].sessionId = "compaction-successor";
    state.store[key].usageFamilySessionIds = ["generation-1", "compaction-successor"];
    const rotated = mergeSessionEntry(state.store[key], { sessionId: "ordinary-rotation" });
    expect(hasReservedSubagentRecovery(rotated, "original-run")).toBe(false);
    expect(rotated.subagentRecovery?.authority).toBeUndefined();
  });

  it("does not redispatch an interrupted admitted run appended during registry adoption", async () => {
    state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = true;
      throw new Error("ACK lost after the admitted run was interrupted");
    });
    await recover();
    state.steer.mockImplementationOnce((remap: { previousRunId: string; nextRunId: string }) => {
      const original = state.runs.get(remap.previousRunId)!;
      state.runs.delete(remap.previousRunId);
      state.runs.set(remap.nextRunId, { ...original, runId: remap.nextRunId });
    });
    const result = await recover();
    expect(result.recovered).toBe(1);
    expect(state.gateway).toHaveBeenCalledTimes(1);
    expect(state.store[key].subagentRecovery?.automaticAttempts).toBe(1);
  });

  it("retains the original owner until the admitted lifecycle has durably started", async () => {
    state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => ({
      runId: call.params.idempotencyKey,
    }));
    const first = await recover();
    expect(first.recovered).toBe(0);
    expect(state.steer).not.toHaveBeenCalled();
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("pending");
    const runId = state.store[key].subagentRecovery!.authority!.idempotencyKey;
    state.store[key].lifecycleRunId = runId;
    state.store[key].abortedLastRun = false;
    const second = await recover();
    expect(second.recovered).toBe(1);
    expect(state.gateway).toHaveBeenCalledTimes(1);
    expect(state.steer).toHaveBeenLastCalledWith(
      expect.objectContaining({ previousRunId: "original-run", nextRunId: runId }),
    );
  });

  it("reserves the original registry owner while its admitted run is already active after ACK loss", async () => {
    state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = false;
      throw new Error("ACK lost after start");
    });
    await recover();
    expect(hasReservedSubagentRecovery(state.store[key], "original-run")).toBe(true);
    expect(hasReservedSubagentRecovery(state.store[key], state.store[key].lifecycleRunId!)).toBe(
      false,
    );
  });

  it("releases a reservation copied into an unrelated session generation", async () => {
    state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = false;
      throw new Error("ACK lost after start");
    });
    await recover();
    state.store[key].sessionId = "unrelated-generation";
    expect(hasReservedSubagentRecovery(state.store[key], "original-run")).toBe(false);
  });

  it("rejects a stale adoption snapshot before mutating the registry", async () => {
    state.gateway.mockRejectedValue(new Error("ACK lost"));
    await recover();
    const cached = structuredClone(state.store[key]);
    cached.lifecycleRunId = cached.subagentRecovery!.authority!.idempotencyKey;
    state.store[key] = {
      sessionId: "new-generation",
      updatedAt: 200,
      lifecycleRunId: "new-run",
      abortedLastRun: true,
    };
    const adopted = await reconcileAcceptedOrphanRun({
      entry: cached,
      storePath: "agent-store",
      sessionKey: key,
      originalRunId: "original-run",
      originalRun: state.runs.get("original-run")!,
    });
    expect(adopted).toBe(false);
    expect(state.steer).not.toHaveBeenCalled();
    expect(state.store[key].lifecycleRunId).toBe("new-run");
  });
  it("keeps the admitted run in the original lifecycle while suppressing its synthetic prompt", async () => {
    await recover();
    expect(state.gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          sessionId: "generation-1",
          sessionEffects: "visible",
          suppressPromptPersistence: true,
        }),
      }),
    );
    expect(state.steer.mock.calls[0]?.[0]?.transcriptFile).toBeUndefined();
  });
  it("records the attempt before RPC, then retains uncertainty without a second dispatch", async () => {
    state.gateway.mockImplementation(async () => {
      expect(state.store[key].subagentRecovery?.authority?.attempts).toBe(1);
      throw new Error("transport lost before acknowledgement");
    });
    await recover();
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("reconcile");
    expect(state.store[key].abortedLastRun).toBe(true);
    state.store = JSON.parse(JSON.stringify(state.store)) as typeof state.store;
    await recover();
    expect(state.gateway).toHaveBeenCalledTimes(1);
    expect(state.store[key].subagentRecovery?.authority?.attempts).toBe(1);
  });

  it("keeps the registry owner when the scheduled RPC acknowledgement is lost", async () => {
    vi.useFakeTimers();
    try {
      state.gateway.mockRejectedValue(new Error("acknowledgement lost"));
      scheduleOrphanRecovery({ getActiveRuns: () => state.runs, delayMs: 1, maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(100);
      expect(state.gateway).toHaveBeenCalledTimes(1);
      expect(finalizeInterruptedSubagentRun).not.toHaveBeenCalled();
      expect(state.runs.get("original-run")?.endedAt).toBeUndefined();
      expect(state.store[key].subagentRecovery?.authority?.state).toBe("reconcile");
    } finally {
      vi.useRealTimers();
    }
  });

  it("finalizes a known unapplied run when its durable budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      state.store[key].subagentRecovery = {
        automaticAttempts: 2,
        lastAttemptAt: Date.now(),
        lastRunId: "original-run",
      };
      scheduleOrphanRecovery({ getActiveRuns: () => state.runs, delayMs: 1, maxRetries: 0 });
      await vi.advanceTimersByTimeAsync(100);
      expect(state.gateway).not.toHaveBeenCalled();
      expect(finalizeInterruptedSubagentRun).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "original-run",
          error: expect.stringContaining("after 2 attempts"),
        }),
      );
      expect(state.store[key].subagentRecovery?.authority?.state).toBe("wedged");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a committed admission when acknowledgement persistence fails", async () => {
    state.gateway.mockImplementation(async () => {
      state.writeFails = true;
      return { runId: state.store[key].subagentRecovery!.authority!.idempotencyKey };
    });
    const result = await recover();
    expect(result.failedRuns).toEqual([]);
    expect(result.reconciliationRuns).toHaveLength(1);
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("pending");
    expect(state.store[key].abortedLastRun).toBe(true);
  });

  it("claims a concurrent boundary once and acknowledges its admitted owner", async () => {
    let finish!: (value: { runId: string }) => void;
    state.gateway.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = recover();
    await vi.waitFor(() => expect(state.gateway).toHaveBeenCalledTimes(1));
    const second = recover();
    await vi.waitFor(() =>
      expect(state.store[key].subagentRecovery?.authority?.state).toBe("pending"),
    );
    state.store[key].lifecycleRunId = state.store[key].subagentRecovery!.authority!.idempotencyKey;
    state.store[key].abortedLastRun = false;
    finish({ runId: state.store[key].subagentRecovery!.authority!.idempotencyKey });
    await Promise.all([first, second]);
    expect(state.gateway).toHaveBeenCalledTimes(1);
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("accepted");
    expect(state.store[key].abortedLastRun).toBe(false);
  });

  it("does not clear a replacement generation after an old RPC completes", async () => {
    state.gateway.mockImplementation(async () => {
      state.store[key] = {
        sessionId: "generation-2",
        updatedAt: 200,
        status: "running",
        lifecycleRunId: "new-run",
        abortedLastRun: true,
      };
      return { runId: "resumed-run" };
    });
    await recover();
    expect(state.store[key].sessionId).toBe("generation-2");
    expect(state.store[key].abortedLastRun).toBe(true);
    expect(state.store[key].subagentRecovery).toBeUndefined();
    expect(state.steer).not.toHaveBeenCalled();
  });

  it("does not dispatch when the durable admission cannot commit", async () => {
    state.writeFails = true;
    await recover();
    expect(state.gateway).not.toHaveBeenCalled();
    expect(state.store[key].abortedLastRun).toBe(true);
  });

  it("reconciles unknown tool effects and persists the shared authority decision", async () => {
    state.phase = "reconcile";
    await recover();
    expect(state.gateway).not.toHaveBeenCalled();
    expect(state.store[key].subagentRecovery?.authority?.decision.kind).toBe("reconcile");
    expect(state.store[key].subagentRecovery?.authority?.decision.entry).toBe("subagent-orphan");
  });

  it("does not resume a registry run that no longer owns the session lifecycle", async () => {
    state.store[key].lifecycleRunId = "newer-run";
    await recover();
    expect(state.gateway).not.toHaveBeenCalled();
    expect(state.store[key].abortedLastRun).toBe(true);
  });

  it("keeps the default legacy path and its existing accepted-attempt policy", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    const result = await recover();
    expect(result.recovered).toBe(1);
    expect(state.store[key].subagentRecovery?.automaticAttempts).toBe(1);
    expect(state.store[key].subagentRecovery?.authority).toBeUndefined();
  });

  it("reconciles an accepted RPC whose registry owner cannot be remapped", async () => {
    state.remap = false;
    const result = await recover();
    expect(result.recovered).toBe(0);
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("reconcile");
    expect(state.store[key].abortedLastRun).toBe(false);
    await recover();
    expect(state.gateway).toHaveBeenCalledTimes(1);
  });

  it("does not acquire recovery against a closed lifecycle fence", async () => {
    const fence = await sessionAdmissionRegistry.fence({
      agentId: "main",
      canonicalSessionKey: key,
      expectedSessionId: "generation-1",
    });
    try {
      await recover();
      expect(state.gateway).not.toHaveBeenCalled();
      expect(state.store[key].subagentRecovery?.authority).toBeUndefined();
    } finally {
      fence.release();
    }
  });

  it("holds the lifecycle permit until the acknowledgement commits", async () => {
    const identity = {
      agentId: "main",
      canonicalSessionKey: key,
      expectedSessionId: "generation-1",
    };
    let finish!: (value: { runId: string }) => void;
    state.gateway.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recovery = recover();
    await vi.waitFor(() => expect(state.gateway).toHaveBeenCalledTimes(1));
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(1);
    let drained = false;
    const fencing = sessionAdmissionRegistry.fence(identity).then((handle) => {
      drained = true;
      return handle;
    });
    expect(drained).toBe(false);
    state.store[key].lifecycleRunId = state.store[key].subagentRecovery!.authority!.idempotencyKey;
    state.store[key].abortedLastRun = false;
    finish({ runId: state.store[key].subagentRecovery!.authority!.idempotencyKey });
    await recovery;
    const handle = await fencing;
    try {
      expect(state.store[key].subagentRecovery?.authority?.state).toBe("accepted");
      expect(state.store[key].abortedLastRun).toBe(false);
      expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(0);
    } finally {
      handle.release();
    }
  });

  it.each([
    { compacted: false, mode: "authority" },
    { compacted: true, mode: "authority" },
    { compacted: true, mode: "legacy" },
  ])(
    "adopts a lost-ACK run with compaction=$compacted and mode=$mode",
    async ({ compacted, mode }) => {
      state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
        state.store[key].lifecycleRunId = call.params.idempotencyKey;
        state.store[key].startedAt = 150;
        state.store[key].abortedLastRun = false;
        if (compacted) {
          state.store[key].sessionId = "compaction-successor";
          state.store[key].usageFamilySessionIds = ["generation-1", "compaction-successor"];
        }
        throw new Error("accepted response was lost");
      });
      await recover();
      const admittedKey = state.store[key].subagentRecovery!.authority!.idempotencyKey;
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", mode);
      const result = await recover();
      expect(result.recovered).toBe(1);
      expect(state.gateway).toHaveBeenCalledTimes(1);
      expect(state.steer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          previousRunId: "original-run",
          nextRunId: admittedKey,
          startedAt: 150,
        }),
      );
      expect(state.store[key].subagentRecovery?.authority?.state).toBe("accepted");
    },
  );

  it("preserves the next interruption when the admitted run fails before an old acknowledgement", async () => {
    state.gateway.mockImplementation(async (call: { params: { idempotencyKey: string } }) => {
      state.store[key].lifecycleRunId = call.params.idempotencyKey;
      state.store[key].abortedLastRun = true;
      return { runId: call.params.idempotencyKey };
    });
    await recover();
    expect(state.store[key].abortedLastRun).toBe(true);
    expect(state.store[key].subagentRecovery?.authority?.state).toBe("accepted");
  });

  it("preserves uncertainty when the authority mode rolls back to legacy", async () => {
    state.gateway.mockRejectedValue(new Error("acknowledgement lost"));
    await recover();
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    const result = await recover();
    expect(state.gateway).toHaveBeenCalledTimes(1);
    expect(result.reconciliationRuns[0]?.reason).toContain("reconciliation");
    expect(result.failedRuns).toEqual([]);
    expect(state.store[key].subagentRecovery?.authority?.attempts).toBe(1);
  });
});
