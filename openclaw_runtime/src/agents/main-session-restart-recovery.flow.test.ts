import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { recordToolDispatch } from "./execution-phase/tool-boundary.js";
import { readOpenExecutionPhases } from "./execution-phase/store.js";
import { recoveryShadowSink } from "./recovery-authority/shadow.js";

const recoveryMocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
  messages: [] as unknown[],
  store: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("../config/sessions.js", () => ({
  loadSessionStore: () => structuredClone(recoveryMocks.store),
  resolveAllAgentSessionStoreTargetsSync: () => [],
  resolveSessionFilePath: (sessionId: string) => `${sessionId}.jsonl`,
  resolveSessionTranscriptPathInDir: (sessionId: string, sessionsDir: string) =>
    `${sessionsDir}/${sessionId}.jsonl`,
  updateSessionStore: async (
    _storePath: string,
    update: (store: Record<string, Record<string, unknown>>) => void,
  ) => {
    update(recoveryMocks.store);
  },
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

function runningInterruptedSession() {
  return {
    sessionId: "long-run",
    updatedAt: 1,
    status: "running",
    abortedLastRun: true,
  };
}

describe("main session restart recovery flow", () => {
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
