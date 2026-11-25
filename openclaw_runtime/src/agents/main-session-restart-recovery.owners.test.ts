import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";

const recoveryMocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
  messages: [] as unknown[],
  store: {} as Record<string, Record<string, unknown>>,
  storesByPath: {} as Record<string, Record<string, Record<string, unknown>>>,
  targets: [] as Array<{ agentId: string; storePath: string }>,
  sessionDirs: ["C:/state/agents/main/sessions"],
}));

vi.mock("../config/sessions.js", () => ({
  loadSessionStore: (storePath: string) =>
    structuredClone(recoveryMocks.storesByPath[resolve(storePath)] ?? recoveryMocks.store),
  resolveAllAgentSessionStoreTargetsSync: () =>
    recoveryMocks.targets.length
      ? recoveryMocks.targets
      : recoveryMocks.sessionDirs.map((sessionsDir) => ({
          agentId: sessionsDir.split(/[\\/]/).at(-2)!,
          storePath: join(sessionsDir, "sessions.json"),
        })),
  resolveSessionFilePath: (sessionId: string) => `${sessionId}.jsonl`,
  resolveSessionTranscriptPathInDir: (sessionId: string, sessionsDir: string) =>
    `${sessionsDir}/${sessionId}.jsonl`,
  updateSessionStore: async (
    storePath: string,
    update: (store: Record<string, Record<string, unknown>>) => void,
  ) => {
    update(recoveryMocks.storesByPath[resolve(storePath)] ?? recoveryMocks.store);
  },
  updateSessionStoreAtomic: async <T>(
    storePath: string,
    update: (store: Record<string, Record<string, unknown>>) => T,
  ) => update(recoveryMocks.storesByPath[resolve(storePath)] ?? recoveryMocks.store),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: recoveryMocks.callGateway,
}));

vi.mock("../gateway/session-utils.fs.js", () => ({
  readSessionMessagesAsync: async () => recoveryMocks.messages,
}));

vi.mock("./session-dirs.js", () => ({
  resolveAgentSessionDirs: async () => recoveryMocks.sessionDirs,
}));

import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery.js";
import { beginMainSessionRun } from "./recovery-authority/main-session-admission.js";

const sessionKey = "agent:main:long-run";

function runningInterruptedSession() {
  return {
    sessionId: "long-run",
    updatedAt: 1,
    status: "running",
    abortedLastRun: true,
  };
}

describe("main session restart recovery owners", () => {
  beforeEach(() => {
    recoveryMocks.callGateway.mockReset();
    recoveryMocks.callGateway.mockResolvedValue({ runId: "recovered-run" });
    recoveryMocks.messages = [];
    recoveryMocks.store = { [sessionKey]: runningInterruptedSession() };
    recoveryMocks.storesByPath = {};
    recoveryMocks.targets = [];
    recoveryMocks.sessionDirs = ["C:/state/agents/main/sessions"];
  });

  it.each([
    ["legacy", "discovered"],
    ["legacy", "configured"],
    ["authority", "discovered"],
    ["authority", "configured"],
  ])("recovers both global owners in %s mode from %s stores", async (mode, layout) => {
    const dir = mkdtempSync(join(tmpdir(), "main-global-owners-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", dir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", mode);
    vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", mode === "authority" ? "taskflow" : "legacy");
    vi.stubEnv("OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER", mode === "authority" ? "taskflow" : "legacy");
    const cfg = { agents: { list: [{ id: "main", default: true }, { id: "reviewer" }] } };
    const targets = ["main", "reviewer"].map((agentId) => ({
      agentId,
      storePath:
        layout === "configured"
          ? join(dir, "custom", `${agentId}.json`)
          : join(dir, "agents", agentId, "sessions", "sessions.json"),
    }));
    recoveryMocks.store = {};
    recoveryMocks.targets = layout === "configured" ? targets : [];
    recoveryMocks.sessionDirs =
      layout === "discovered" ? targets.map((target) => join(target.storePath, "..")) : [];
    recoveryMocks.storesByPath = Object.fromEntries(
      targets.map(({ agentId, storePath }) => [
        resolve(storePath),
        {
          global: {
            ...runningInterruptedSession(),
            sessionId: `${agentId}-generation`,
            lifecycleRunId: `${agentId}-run`,
            recoveryOutput: {
              sessionId: `${agentId}-generation`,
              runId: `${agentId}-run`,
              effect: "not_applied",
            },
          },
        },
      ]),
    );
    recoveryMocks.messages = [{ role: "user", content: "Continue the interrupted task" }];
    recoveryMocks.callGateway.mockImplementation(async ({ params }) => {
      expect(params).toMatchObject({
        sessionKey: "global",
        sessionId: `${params.agentId}-generation`,
      });
      expect(["main", "reviewer"]).toContain(params.agentId);
      if (mode === "authority") {
        await beginMainSessionRun({
          storePath: targets.find((target) => target.agentId === params.agentId)!.storePath,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          runId: params.idempotencyKey,
          expectedRunId: `${params.agentId}-run`,
          startedAt: Date.now(),
          recoveryAdmission: params.recoveryAdmission,
        });
      }
      return { runId: params.idempotencyKey };
    });
    const resumedSessionKeys = new Set<string>();
    try {
      expect(
        await recoverRestartAbortedMainSessions({
          stateDir: dir,
          resumedSessionKeys,
          ...(layout === "configured" ? { cfg } : {}),
        }),
      ).toEqual({ recovered: 2, failed: 0, skipped: 0 });
      expect(
        recoveryMocks.callGateway.mock.calls
          .map(([call]) => call.params.agentId)
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(["main", "reviewer"]);
      for (const store of Object.values(recoveryMocks.storesByPath)) {
        store.global.abortedLastRun = true;
      }
      expect(
        await recoverRestartAbortedMainSessions({
          stateDir: dir,
          resumedSessionKeys,
          ...(layout === "configured" ? { cfg } : {}),
        }),
      ).toEqual({ recovered: 0, failed: 0, skipped: 2 });
      expect(recoveryMocks.callGateway).toHaveBeenCalledTimes(2);
    } finally {
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["legacy", "authority"])(
    "routes a global failure notice to its owner in %s mode",
    async (mode) => {
      const dir = mkdtempSync(join(tmpdir(), "main-global-notice-"));
      vi.stubEnv("OPENCLAW_STATE_DIR", dir);
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", mode);
      vi.stubEnv("OPENCLAW_EXECUTION_PHASE_WRITER", mode === "authority" ? "taskflow" : "legacy");
      vi.stubEnv(
        "OPENCLAW_TASK_LOOP_LIFECYCLE_WRITER",
        mode === "authority" ? "taskflow" : "legacy",
      );
      recoveryMocks.sessionDirs = [join(dir, "agents", "reviewer", "sessions")];
      recoveryMocks.store = {
        global: {
          ...runningInterruptedSession(),
          sessionId: "reviewer-generation",
          lifecycleRunId: "reviewer-run",
          recoveryOutput: {
            sessionId: "reviewer-generation",
            runId: "reviewer-run",
            effect: "not_applied",
          },
          deliveryContext: { channel: "telegram", to: "owner-chat", accountId: "reviewer-account" },
        },
      };
      recoveryMocks.messages = [];
      try {
        expect(await recoverRestartAbortedMainSessions({ stateDir: dir })).toEqual({
          recovered: 0,
          failed: 1,
          skipped: 0,
        });
        expect(recoveryMocks.callGateway).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            method: "message.action",
            params: expect.objectContaining({
              agentId: "reviewer",
              sessionKey: "global",
              sessionId: "reviewer-generation",
              channel: "telegram",
              accountId: "reviewer-account",
              params: expect.objectContaining({ to: "owner-chat" }),
            }),
          }),
        );
      } finally {
        closeOpenClawStateDatabase();
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("does not deduplicate a replacement session generation with a previously resumed one", async () => {
    recoveryMocks.messages = [{ role: "user", content: "Continue the interrupted task" }];
    const resumedSessionKeys = new Set<string>();
    expect((await recoverRestartAbortedMainSessions({ resumedSessionKeys })).recovered).toBe(1);
    recoveryMocks.store[sessionKey] = { ...runningInterruptedSession(), sessionId: "replacement" };
    expect((await recoverRestartAbortedMainSessions({ resumedSessionKeys })).recovered).toBe(1);
    expect(recoveryMocks.callGateway).toHaveBeenCalledTimes(2);
  });
});
