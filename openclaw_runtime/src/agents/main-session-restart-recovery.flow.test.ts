import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { recordToolDispatch } from "./execution-phase/tool-boundary.js";
import { readOpenExecutionPhases } from "./execution-phase/store.js";
import { recoveryShadowSink } from "./recovery-authority/shadow.js";
import { recoveryAuthorityV1 } from "./recovery-authority/authority.js";

const recoveryMocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
  messages: [] as unknown[],
  store: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => structuredClone(recoveryMocks.store),
  resolveAllAgentSessionStoreTargetsSync: () => [
    { agentId: "main", storePath: "C:/state/agents/main/sessions/sessions.json" },
  ],
  resolveSessionFilePath: (sessionId: string) => `${sessionId}.jsonl`,
  resolveSessionTranscriptPathInDir: (sessionId: string, sessionsDir: string) =>
    `${sessionsDir}/${sessionId}.jsonl`,
  updateSessionStore: async (
    _storePath: string,
    update: (store: Record<string, Record<string, unknown>>) => void,
  ) => {
    update(recoveryMocks.store);
  },
  updateSessionStoreAtomic: async <T>(
    _storePath: string,
    update: (store: Record<string, Record<string, unknown>>) => T,
  ) => update(recoveryMocks.store),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: recoveryMocks.callGateway,
}));

vi.mock("../gateway/session-utils.fs.js", () => ({
  readSessionMessagesAsync: async () => recoveryMocks.messages,
}));

vi.mock("./session-dirs.js", () => ({
  resolveAgentSessionDirs: async () => ["C:/state/agents/main/sessions"],
}));

import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery.js";

const sessionKey = "agent:main:long-run";

const runningInterruptedSession = () => ({
  sessionId: "long-run",
  updatedAt: 1,
  status: "running",
  abortedLastRun: true,
});

describe("main session restart recovery flow", () => {
  it("finishes an empty interrupted authority session without retrying its rejected tail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-rejected-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "original",
      recoveryOutput: { sessionId: "long-run", runId: "original", effect: "not_applied" },
    });
    recoveryMocks.messages = [];
    try {
      expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
        failed: 1,
        recovered: 0,
      });
      expect(recoveryMocks.store[sessionKey]).toMatchObject({
        status: "failed",
        abortedLastRun: true,
      });
      expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
        failed: 0,
        recovered: 0,
      });
      expect(recoveryMocks.callGateway).not.toHaveBeenCalled();
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists one recovery key and wedges the same boundary after its finite budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-budget-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    try {
      recoveryMocks.messages = [{ role: "user", content: "pending durable intent", timestamp: 1 }];
      recoveryMocks.callGateway.mockRejectedValue(new Error("ambiguous gateway acknowledgement"));
      for (let attempt = 0; attempt < 4; attempt++)
        await recoverRestartAbortedMainSessions({ stateDir: dir });
      expect(recoveryMocks.callGateway).toHaveBeenCalledTimes(3);
      const keys = recoveryMocks.callGateway.mock.calls.map(([call]) => call.params.idempotencyKey);
      expect(new Set(keys).size).toBe(1);
      expect(recoveryMocks.store[sessionKey]).toMatchObject({
        status: "failed",
        abortedLastRun: true,
        restartRecovery: { attempts: 3, state: "wedged", sessionId: "long-run", runId: keys[0] },
      });
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  beforeEach(() => {
    recoveryMocks.callGateway.mockReset();
    recoveryMocks.callGateway.mockResolvedValue({ runId: "recovered-run" });
    recoveryMocks.messages = [];
    recoveryMocks.store = { [sessionKey]: runningInterruptedSession() };
  });

  it("commits the main authority identity before an admitted continuation RPC", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-authority-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "original-run",
      recoveryOutput: { sessionId: "long-run", runId: "original-run", effect: "not_applied" },
    });
    recoveryMocks.messages = [{ role: "user", content: "original intent", timestamp: 1 }];
    const decide = vi.spyOn(recoveryAuthorityV1, "decide");
    recoveryMocks.callGateway.mockImplementation(async (call) => {
      const saved = recoveryMocks.store[sessionKey].restartRecovery as {
        attempts: number;
        authority: { idempotencyKey: string; attempts: number; state: string };
      };
      expect(saved.attempts).toBe(1);
      expect(saved.authority).toMatchObject({
        idempotencyKey: call.params.idempotencyKey,
        attempts: 1,
        state: "pending",
      });
      expect(call.params).toMatchObject({
        suppressPromptPersistence: true,
        recoveryAdmission: { idempotencyKey: saved.authority.idempotencyKey, attempts: 1 },
      });
      return { runId: call.params.idempotencyKey };
    });
    try {
      await recoverRestartAbortedMainSessions({ stateDir: dir });
      expect(recoveryMocks.callGateway).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({ entry: "main-session-restart" }),
      );
    } finally {
      decide.mockRestore();
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains an unknown main output and pending reply without requesting another model turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-output-unknown-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "original-run",
      recoveryOutput: { sessionId: "long-run", runId: "original-run", effect: "unknown" },
      pendingFinalDelivery: true,
      pendingFinalDeliveryRunId: "original-run",
      pendingFinalDeliveryText: "retained original reply",
    });
    recoveryMocks.messages = [{ role: "user", content: "original intent", timestamp: 1 }];
    try {
      await recoverRestartAbortedMainSessions({ stateDir: dir });
      expect(recoveryMocks.callGateway).not.toHaveBeenCalled();
      expect(recoveryMocks.store[sessionKey]).toMatchObject({
        pendingFinalDelivery: true,
        pendingFinalDeliveryText: "retained original reply",
        restartRecovery: { authority: { state: "reconcile" } },
      });
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains an unresolved main admission when authority mode rolls back to legacy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-rollback-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "original-run",
      recoveryOutput: { sessionId: "long-run", runId: "original-run", effect: "unknown" },
    });
    recoveryMocks.messages = [{ role: "user", content: "original intent", timestamp: 1 }];
    try {
      await recoverRestartAbortedMainSessions({ stateDir: dir });
      const saved = structuredClone(recoveryMocks.store[sessionKey].restartRecovery);
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
      await recoverRestartAbortedMainSessions({ stateDir: dir });
      expect(recoveryMocks.callGateway).not.toHaveBeenCalled();
      expect(recoveryMocks.store[sessionKey].restartRecovery).toEqual(saved);
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the main admission uncertain when the RPC acknowledges a different run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "main-ack-identity-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "original-run",
      recoveryOutput: { sessionId: "long-run", runId: "original-run", effect: "not_applied" },
    });
    recoveryMocks.messages = [{ role: "user", content: "original intent", timestamp: 1 }];
    recoveryMocks.callGateway.mockResolvedValue({ runId: "different-run" });
    try {
      await recoverRestartAbortedMainSessions({ stateDir: dir });
      expect(recoveryMocks.store[sessionKey]).toMatchObject({
        abortedLastRun: true,
        restartRecovery: { attempts: 1, authority: { state: "reconcile" } },
      });
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["aborted", "toolUse"])(
    "resumes an interrupted assistant tail with stopReason=%s",
    async (stopReason) => {
      recoveryMocks.messages = [{ role: "assistant", content: [], stopReason }];

      const result = await recoverRestartAbortedMainSessions({ stateDir: "C:/state" });

      expect(result).toEqual({ recovered: 1, failed: 0, skipped: 0 });
      expect(recoveryMocks.callGateway).toHaveBeenCalledOnce();
      expect(recoveryMocks.callGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "agent",
          params: expect.objectContaining({ sessionKey, sessionId: "long-run", lane: "main" }),
        }),
      );
      expect(recoveryMocks.store[sessionKey]).toMatchObject({
        status: "running",
        abortedLastRun: false,
      });
    },
  );

  it("preserves the recovery marker when the Gateway resume call fails", async () => {
    recoveryMocks.messages = [{ role: "assistant", content: [], stopReason: "aborted" }];
    recoveryMocks.callGateway.mockRejectedValueOnce(new Error("gateway still starting"));

    const result = await recoverRestartAbortedMainSessions({ stateDir: "C:/state" });

    expect(result).toEqual({ recovered: 0, failed: 1, skipped: 0 });
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      status: "running",
      abortedLastRun: true,
    });
  });
  it("records the actual failed resume in shadow without changing the owner outcome", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_SHADOW", "1");
    recoveryMocks.messages = [{ role: "assistant", content: [], stopReason: "aborted" }];
    recoveryMocks.callGateway.mockRejectedValueOnce(new Error("gateway still starting"));
    try {
      expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toEqual({
        recovered: 0,
        failed: 1,
        skipped: 0,
      });
      expect(recoveryShadowSink.snapshot().records.at(-1)?.legacyOutcome).toBe("failed");
      expect(recoveryMocks.store[sessionKey].abortedLastRun).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps completed assistant turns out of automatic replay", async () => {
    recoveryMocks.messages = [{ role: "assistant", content: [], stopReason: "stop" }];

    const result = await recoverRestartAbortedMainSessions({ stateDir: "C:/state" });

    expect(result).toEqual({ recovered: 0, failed: 1, skipped: 0 });
    expect(recoveryMocks.callGateway).not.toHaveBeenCalled();
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      status: "failed",
      abortedLastRun: true,
    });
  });

  it("ignores an older run's pending final regardless of attempt timestamps", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_SHADOW", "1");
    Object.assign(recoveryMocks.store[sessionKey], {
      startedAt: 100,
      lifecycleRunId: "new-user-run",
      pendingFinalDeliveryRunId: "previous-run",
      pendingFinalDelivery: true,
      pendingFinalDeliveryText: "previous response",
      pendingFinalDeliveryCreatedAt: 200,
      pendingFinalDeliveryContext: { channel: "telegram", to: "prior-recipient" },
    });
    recoveryMocks.messages = [{ role: "user", content: "new request", timestamp: 250 }];
    try {
      expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toMatchObject({
        recovered: 1,
      });
      const call = recoveryMocks.callGateway.mock.calls[0][0];
      expect(call.params.message).not.toContain("previous response");
      expect(call.params.deliver).toBe(false);
      expect(call.params.to).toBeUndefined();
      expect(recoveryShadowSink.snapshot().records.at(-1)?.authorityKind).toBe("reconcile");
      expect(recoveryMocks.store[sessionKey].pendingFinalDeliveryText).toBe("previous response");
      expect(recoveryMocks.store[sessionKey].pendingFinalDeliveryAttemptCount).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not overwrite a newer pending final when the resume RPC completes", async () => {
    Object.assign(recoveryMocks.store[sessionKey], {
      startedAt: 100,
      lifecycleRunId: "current-run",
      pendingFinalDeliveryRunId: "current-run",
      pendingFinalDelivery: true,
      pendingFinalDeliveryText: "interrupted response",
      pendingFinalDeliveryCreatedAt: 200,
    });
    recoveryMocks.messages = [{ role: "assistant", stopReason: "aborted", timestamp: 150 }];
    recoveryMocks.callGateway.mockImplementation(async () => {
      Object.assign(recoveryMocks.store[sessionKey], {
        pendingFinalDeliveryText: "new response",
        pendingFinalDeliveryCreatedAt: 300,
        pendingFinalDeliveryRunId: "new-result-run",
      });
      return { runId: "recovered-run" };
    });
    expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toMatchObject({
      recovered: 1,
    });
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      pendingFinalDeliveryText: "new response",
      pendingFinalDeliveryCreatedAt: 300,
    });
    expect(recoveryMocks.store[sessionKey].pendingFinalDeliveryAttemptCount).toBeUndefined();
  });

  it("retains the current interrupted turn's pending delivery", async () => {
    Object.assign(recoveryMocks.store[sessionKey], {
      startedAt: 100,
      lifecycleRunId: "current-run",
      pendingFinalDeliveryRunId: "current-run",
      pendingFinalDelivery: true,
      pendingFinalDeliveryText: "current response",
      pendingFinalDeliveryCreatedAt: 200,
      pendingFinalDeliveryContext: { channel: "telegram", to: "current-recipient" },
    });
    recoveryMocks.messages = [{ role: "assistant", stopReason: "aborted", timestamp: 150 }];
    expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toMatchObject({
      recovered: 1,
    });
    expect(recoveryMocks.callGateway.mock.calls[0][0].params).toMatchObject({
      deliver: true,
      to: "current-recipient",
      message: expect.stringContaining("current response"),
    });
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      pendingFinalDeliveryText: "current response",
      pendingFinalDeliveryAttemptCount: 1,
    });
  });

  it("preserves an older delivery when the newer turn cannot resume", async () => {
    Object.assign(recoveryMocks.store[sessionKey], {
      startedAt: 300,
      lifecycleRunId: "new-user-run",
      pendingFinalDeliveryRunId: "previous-run",
      pendingFinalDelivery: true,
      pendingFinalDeliveryText: "previous response",
      pendingFinalDeliveryCreatedAt: 200,
      pendingFinalDeliveryContext: { channel: "telegram", to: "prior-recipient" },
    });
    recoveryMocks.messages = [{ role: "assistant", stopReason: "error", timestamp: 350 }];
    expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toMatchObject({
      failed: 1,
    });
    expect(recoveryMocks.callGateway).not.toHaveBeenCalled();
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      status: "failed",
      pendingFinalDeliveryText: "previous response",
    });
  });

  it.each(["legacy", "taskflow"])(
    "preserves pending delivery identity through repeated recovery attempts: %s",
    async (writer) => {
      const dir = mkdtempSync(join(tmpdir(), "recovery-delivery-lineage-"));
      vi.stubEnv("OPENCLAW_STATE_DIR", dir);
      vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", writer);
      vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", writer);
      Object.assign(recoveryMocks.store[sessionKey], {
        lifecycleRunId: "original-run",
        startedAt: 100,
        pendingFinalDelivery: true,
        pendingFinalDeliveryText: "still pending",
        pendingFinalDeliveryRunId: "original-run",
        pendingFinalDeliveryCreatedAt: 200,
        pendingFinalDeliveryContext: { channel: "telegram", to: "original-recipient" },
      });
      recoveryMocks.messages = [{ role: "assistant", stopReason: "aborted", timestamp: 150 }];
      recoveryMocks.callGateway.mockImplementation(async (call) => {
        Object.assign(recoveryMocks.store[sessionKey], {
          lifecycleRunId: call.params.idempotencyKey,
          startedAt: 500,
        });
        return { runId: call.params.idempotencyKey };
      });
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          recoveryMocks.store[sessionKey].abortedLastRun = true;
          expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
            recovered: 1,
          });
        }
        for (const [call] of recoveryMocks.callGateway.mock.calls) {
          expect(call.params.message).toContain("still pending");
          expect(call.params).toMatchObject({ deliver: true, to: "original-recipient" });
        }
        expect(recoveryMocks.store[sessionKey].pendingFinalDeliveryText).toBe("still pending");
      } finally {
        closeOpenClawStateDatabase();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("does not carry an unbound pending final just because its timestamp is recent", async () => {
    Object.assign(recoveryMocks.store[sessionKey], {
      lifecycleRunId: "current-run",
      startedAt: 100,
      pendingFinalDelivery: true,
      pendingFinalDeliveryText: "unbound response",
      pendingFinalDeliveryCreatedAt: 999,
      pendingFinalDeliveryContext: { channel: "telegram", to: "unbound-recipient" },
    });
    recoveryMocks.messages = [{ role: "user", content: "new work" }];
    expect(await recoverRestartAbortedMainSessions({ stateDir: "C:/state" })).toMatchObject({
      recovered: 1,
    });
    expect(recoveryMocks.callGateway.mock.calls[0][0].params.message).not.toContain(
      "unbound response",
    );
    expect(recoveryMocks.callGateway.mock.calls[0][0].params.deliver).toBe(false);
    expect(recoveryMocks.store[sessionKey].pendingFinalDeliveryText).toBe("unbound response");
  });

  it.each(["legacy", "taskflow"])(
    "retains pending delivery after a continuation RPC fails before lifecycle start: %s",
    async (writer) => {
      const dir = mkdtempSync(join(tmpdir(), "recovery-delivery-rpc-"));
      vi.stubEnv("OPENCLAW_STATE_DIR", dir);
      vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", writer);
      vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", writer);
      Object.assign(recoveryMocks.store[sessionKey], {
        lifecycleRunId: "original-run",
        pendingFinalDelivery: true,
        pendingFinalDeliveryText: "still pending",
        pendingFinalDeliveryRunId: "original-run",
        pendingFinalDeliveryContext: { channel: "telegram", to: "original-recipient" },
      });
      recoveryMocks.messages = [{ role: "assistant", stopReason: "aborted", timestamp: 100 }];
      recoveryMocks.callGateway.mockImplementation(async (call) => {
        recoveryMocks.store[sessionKey].lifecycleRunId = call.params.idempotencyKey;
        return { runId: call.params.idempotencyKey };
      });
      try {
        expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
          recovered: 1,
        });
        recoveryMocks.store[sessionKey].abortedLastRun = true;
        recoveryMocks.messages = [{ role: "assistant", stopReason: "aborted", timestamp: 200 }];
        recoveryMocks.callGateway.mockRejectedValueOnce(new Error("RPC failed before start"));
        expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
          failed: 1,
        });
        expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toMatchObject({
          recovered: 1,
        });
        const calls = recoveryMocks.callGateway.mock.calls.map(([call]) => call.params);
        expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(1);
        for (const call of calls) {
          expect(call.message).toContain("still pending");
          expect(call).toMatchObject({ deliver: true, to: "original-recipient" });
        }
      } finally {
        closeOpenClawStateDatabase();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("does not clear a newer run's restart marker when an older resume RPC returns", async () => {
    Object.assign(recoveryMocks.store[sessionKey], { lifecycleRunId: "old-run", startedAt: 100 });
    recoveryMocks.messages = [{ role: "user", content: "durable request" }];
    recoveryMocks.callGateway.mockImplementation(async () => {
      Object.assign(recoveryMocks.store[sessionKey], {
        lifecycleRunId: "new-run",
        abortedLastRun: true,
      });
      return { runId: "old-recovery" };
    });
    await recoverRestartAbortedMainSessions({ stateDir: "C:/state" });
    expect(recoveryMocks.store[sessionKey]).toMatchObject({
      lifecycleRunId: "new-run",
      abortedLastRun: true,
    });
  });

  it("authorizes the durable dispatch before requesting the resumed agent run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-owner-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", "taskflow");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", "taskflow");
    try {
      const args = { path: "a", content: "test" };
      recoveryMocks.messages = [
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [{ type: "toolCall", id: "owner-call", name: "write", arguments: args }],
        },
      ];
      recordToolDispatch({
        sessionKey,
        sessionId: "long-run",
        runId: "old-run",
        toolCallId: "owner-call",
        toolName: "write",
        args,
      });
      recoveryMocks.callGateway.mockImplementation(async () => {
        const row = readOpenExecutionPhases(sessionKey)[0];
        expect(row.phase).toBe("dispatched");
        expect(JSON.parse(row.recovery_json).resumeAuthorized).toBe(true);
        return { runId: "recovered-run" };
      });
      expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toEqual({
        recovered: 1,
        failed: 0,
        skipped: 0,
      });
      expect(recoveryMocks.callGateway).toHaveBeenCalledOnce();
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
