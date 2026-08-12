import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
