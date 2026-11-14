import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AcpRuntime, AcpRuntimeHandle } from "@openclaw/acp-core/runtime/types";
import { updateSessionStoreAtomic } from "../../config/sessions/store.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { upsertAcpSessionMeta, readAcpSessionEntry } from "../runtime/session-meta.js";
import { AcpRuntimeError } from "../../runtime/errors.ts";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { closeTrackedSqliteHandlesUnder } from "../../infra/node-sqlite.js";
import { ManagerRuntimeHandleCache } from "./manager.runtime-handle-cache.js";
import { AcpSessionManager } from "./manager.core.js";
import { runManagerTurn } from "./manager.turn-runner.js";
import {
  DEFAULT_DEPS,
  type ActiveTurnState,
  type SessionAcpMeta,
  type WriteManagerSessionMeta,
} from "./manager.types.js";

const key = "agent:main:acp-recovery-proof";
let root: string;
let cfg: OpenClawConfig;
let meta: SessionAcpMeta;
let runtime: AcpRuntime;
let handle: AcpRuntimeHandle;
let runTurnMock: Mock<AcpRuntime["runTurn"]>;
let prepareFreshSessionMock: Mock<NonNullable<AcpRuntime["prepareFreshSession"]>>;
let controls: Mock<Parameters<typeof runManagerTurn>[0]["applyRuntimeControls"]>;
let lostAcknowledgement: "begin" | "boundary" | "admission" | undefined;

function row() {
  return openOpenClawStateDatabase()
    .db.prepare("SELECT * FROM acp_sessions WHERE session_key = ?")
    .get(key) as Record<string, unknown>;
}

function journal() {
  return JSON.parse(String(row().recovery_json)) as {
    attempts: number;
    maxAttempts: number;
    effect: string;
    visibleOutputObserved: boolean;
    authority?: { attempts: number; decision: { authorityId: string; kind: string } };
  };
}

const writeMeta: WriteManagerSessionMeta = async (params) => {
  const saved = await upsertAcpSessionMeta(params);
  if (row().recovery_json) {
    const state = journal();
    const lose =
      (lostAcknowledgement === "begin" && state.attempts === 1 && state.effect === "not_applied") ||
      (lostAcknowledgement === "boundary" && state.effect === "unknown") ||
      (lostAcknowledgement === "admission" &&
        state.attempts === 2 &&
        state.authority?.decision.kind === "resume");
    if (lose) {
      lostAcknowledgement = undefined;
      throw new Error("owner acknowledgement lost");
    }
  }
  return saved;
};

async function run(
  requestId = "original-request",
  onEvent?: Parameters<typeof runManagerTurn>[0]["input"]["onEvent"],
  text = "original task",
) {
  return runManagerTurn({
    input: { cfg, sessionKey: key, text, mode: "prompt", requestId, onEvent },
    sessionKey: key,
    deps: DEFAULT_DEPS,
    runtimeHandles: new ManagerRuntimeHandleCache(),
    activeTurnBySession: new Map<string, ActiveTurnState>(),
    resolveSession: () => ({
      kind: "ready",
      sessionKey: key,
      meta: readAcpSessionEntry({ cfg, sessionKey: key })!.acp!,
    }),
    ensureRuntimeHandle: async ({ meta: requested }) => {
      if (requested.backend !== meta.backend) {
        await upsertAcpSessionMeta({ cfg, sessionKey: key, mutate: () => requested });
      }
      return { runtime, handle: { ...handle, backend: requested.backend }, meta: requested };
    },
    applyRuntimeControls: controls,
    setSessionState: async ({ state, lastError, clearLastError }) => {
      await writeMeta({
        cfg,
        sessionKey: key,
        mutate: (current) =>
          current
            ? { ...current, state, ...(clearLastError ? { lastError: undefined } : { lastError }) }
            : undefined,
      });
    },
    recordTurnCompletion: vi.fn(),
    reconcileRuntimeSessionIdentifiers: async (params) => ({
      handle: params.handle,
      meta: params.meta,
    }),
    writeSessionMeta: writeMeta,
  });
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "acp-recovery-proof-"));
  const store = path.join(root, "agents", "main", "sessions", "sessions.json");
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
  vi.stubEnv("OPENCLAW_DISABLE_BUNDLED_PLUGINS", "1");
  cfg = { session: { store }, acp: { enabled: true, backend: "fixture" } };
  meta = {
    backend: "fixture",
    agent: "main",
    runtimeSessionName: key,
    mode: "persistent",
    state: "idle",
    lastActivityAt: 1,
    identity: {
      state: "resolved",
      acpxRecordId: "record-old",
      acpxSessionId: "backend-old",
      agentSessionId: "agent-old",
      source: "status",
      lastUpdatedAt: 1,
    },
  };
  handle = {
    sessionKey: key,
    backend: "fixture",
    runtimeSessionName: key,
    backendSessionId: "backend-old",
    agentSessionId: "agent-old",
    acpxRecordId: "record-old",
  };
  runTurnMock = vi.fn(async function* () {
    yield { type: "done" as const };
  });
  prepareFreshSessionMock = vi.fn(async () => {});
  runtime = {
    ensureSession: vi.fn(async () => handle),
    runTurn: runTurnMock,
    prepareFreshSession: prepareFreshSessionMock,
    close: vi.fn(async () => {}),
  } as unknown as AcpRuntime;
  controls = vi.fn<Parameters<typeof runManagerTurn>[0]["applyRuntimeControls"]>(async () => {});
  lostAcknowledgement = undefined;
  await updateSessionStoreAtomic(store, (sessions) => {
    sessions[key] = { sessionId: "session-original", updatedAt: 1 };
  });
  await upsertAcpSessionMeta({ cfg, sessionKey: key, mutate: () => meta });
});

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  closeTrackedSqliteHandlesUnder(root);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("ACP production turn recovery with the existing durable owner", () => {
  it("keeps a live owner's exact journal intact when a peer admission is refused", async () => {
    runTurnMock.mockImplementation(async function* () {
      const before = row().recovery_json;
      await expect(run()).rejects.toThrow("reconciliation");
      expect(row().recovery_json).toBe(before);
      yield { type: "done" };
    });
    await run();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({ effect: "applied", attempts: 1 });
  });
  it.each(["begin", "boundary", "admission"] as const)(
    "releases a committed %s claim when its write acknowledgement is lost",
    async (stage) => {
      lostAcknowledgement = stage;
      if (stage === "admission")
        controls.mockRejectedValue(
          new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"),
        );
      await expect(run()).rejects.toThrow();
      expect(runTurnMock).not.toHaveBeenCalled();
      const state = JSON.parse(String(row().recovery_json));
      expect(state.processId).toBeUndefined();
      expect(state.effect).toBe("not_applied");
      expect(state.attempts).toBe(stage === "admission" ? 2 : 1);
      if (stage !== "admission") {
        await run();
        expect(runTurnMock).toHaveBeenCalledOnce();
      } else {
        await expect(run()).rejects.toThrow();
        expect(runTurnMock).not.toHaveBeenCalled();
      }
    },
  );
  it("does not turn a pre-output backend exit into an unstarted turn", async () => {
    runTurnMock.mockImplementation(async function* () {
      expect(journal()).toMatchObject({ effect: "unknown", attempts: 1 });
      yield await Promise.reject(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    });
    await expect(run()).rejects.toThrow();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(prepareFreshSessionMock).not.toHaveBeenCalled();
    expect(journal()).toMatchObject({
      effect: "unknown",
      attempts: 1,
      authority: { decision: { authorityId: "recovery-authority/v1", kind: "reconcile" } },
    });
  });

  it("retains a newer ACP identity when an old resume failure arrives", async () => {
    runTurnMock.mockImplementation(async function* () {
      await upsertAcpSessionMeta({
        cfg,
        sessionKey: key,
        mutate: (current) =>
          current
            ? {
                ...current,
                identity: {
                  ...meta.identity!,
                  acpxSessionId: "backend-new",
                  agentSessionId: "agent-new",
                },
              }
            : undefined,
      });
      yield await Promise.reject(
        new AcpRuntimeError(
          "ACP_TURN_FAILED",
          "persistent acp session backend-old could not be resumed: resource not found",
        ),
      );
    });
    await expect(run()).rejects.toThrow();
    expect(readAcpSessionEntry({ cfg, sessionKey: key })!.acp!.identity).toMatchObject({
      acpxSessionId: "backend-new",
      agentSessionId: "agent-new",
    });
    expect(prepareFreshSessionMock).not.toHaveBeenCalled();
  });

  it("does not reset its consumed pre-turn budget when the controller is rebuilt", async () => {
    controls.mockRejectedValue(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    await expect(run()).rejects.toThrow();
    await expect(run()).rejects.toThrow();
    expect(controls).toHaveBeenCalledTimes(2);
    expect(runTurnMock).not.toHaveBeenCalled();
    expect(journal()).toMatchObject({
      attempts: 2,
      maxAttempts: 2,
      effect: "not_applied",
      authority: { attempts: 2, decision: { kind: "wedge" } },
    });
  });

  it("publishes an output only after its durable unknown boundary is recorded", async () => {
    runTurnMock.mockImplementation(async function* () {
      yield { type: "text_delta", stream: "output", text: "answer" };
      yield await Promise.reject(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    });
    const onEvent = vi.fn(async (event) => {
      if (event.type === "text_delta")
        expect(journal()).toMatchObject({ effect: "unknown", visibleOutputObserved: true });
    });
    await expect(run("original-request", onEvent)).rejects.toThrow();
    expect(onEvent).toHaveBeenCalledOnce();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal().authority?.decision.kind).toBe("reconcile");
  });

  it("blocks backend fallback after a runtime turn has entered its uncertain boundary", async () => {
    cfg = { ...cfg, acp: { ...cfg.acp, fallbacks: ["backup"] } };
    runTurnMock.mockImplementation(async function* () {
      yield await Promise.reject(
        new AcpRuntimeError("ACP_TURN_FAILED", "backend temporarily unavailable"),
      );
    });
    await expect(run()).rejects.toThrow();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({ effect: "unknown", attempts: 1, maxAttempts: 4 });
  });

  it("commits a fallback admission before a core-proven unstarted turn continues", async () => {
    cfg = { ...cfg, acp: { ...cfg.acp, fallbacks: ["backup"] } };
    controls.mockRejectedValueOnce(
      new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "backend temporarily unavailable"),
    );
    runTurnMock.mockImplementation(async function* () {
      expect(journal()).toMatchObject({
        attempts: 2,
        maxAttempts: 4,
        authority: { attempts: 2, decision: { kind: "resume" } },
      });
      yield { type: "done" };
    });
    await run();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({ effect: "applied", attempts: 2 });
  });

  it("settles a completed request without entering its runtime again", async () => {
    await run();
    await run();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({
      effect: "applied",
      attempts: 1,
      authority: { decision: { kind: "settle" } },
    });
  });

  it("rejects a reused request ID with changed content and preserves the completed request", async () => {
    await run();
    await expect(run("original-request", undefined, "different task")).rejects.toThrow();
    await run();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({ effect: "applied", attempts: 1 });
  });

  it("rejects terminal publication from a replaced Session generation", async () => {
    runTurnMock.mockImplementation(async function* () {
      await updateSessionStoreAtomic(cfg.session!.store!, (sessions) => {
        sessions[key] = { sessionId: "session-new", updatedAt: 2 };
      });
      yield { type: "done" };
    });
    const onEvent = vi.fn();
    await expect(run("original-request", onEvent)).rejects.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(readAcpSessionEntry({ cfg, sessionKey: key })!.entry!.sessionId).toBe("session-new");
    expect(row().session_id).toBe("session-original");
    expect(journal().effect).toBe("unknown");
  });

  it("stops before runtime effects when the owner journal cannot commit", async () => {
    openOpenClawStateDatabase().db.exec(
      "CREATE TRIGGER block_acp_recovery BEFORE UPDATE OF recovery_json ON acp_sessions BEGIN SELECT RAISE(ABORT, 'journal failure'); END",
    );
    await expect(run()).rejects.toThrow("journal failure");
    expect(runTurnMock).not.toHaveBeenCalled();
    expect(controls).not.toHaveBeenCalled();
  });

  it("keeps an existing uncertain intent protected after rollback to legacy", async () => {
    runTurnMock.mockImplementation(async function* () {
      yield await Promise.reject(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    });
    await expect(run()).rejects.toThrow();
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    await expect(run()).rejects.toThrow("reconciliation");
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal().effect).toBe("unknown");
  });

  it("keeps the original legacy early-exit retry when no gated owner exists", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    runTurnMock.mockImplementation(async function* () {
      yield await Promise.reject(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    });
    await expect(run()).rejects.toThrow();
    expect(runTurnMock).toHaveBeenCalledTimes(2);
    expect(row().recovery_json).toBeNull();
  });

  it("routes the public manager entry through the same persisted authority", async () => {
    runTurnMock.mockImplementation(async function* () {
      yield await Promise.reject(new AcpRuntimeError("ACP_TURN_FAILED", "acpx exited with code 1"));
    });
    const backend = { id: "fixture", runtime };
    const manager = new AcpSessionManager({
      ...DEFAULT_DEPS,
      requireRuntimeBackend: () => backend,
      getRuntimeBackend: () => backend,
    });
    await expect(
      manager.runTurn({
        cfg,
        sessionKey: key,
        requestId: "public-entry",
        text: "original task",
        mode: "prompt",
      }),
    ).rejects.toThrow();
    expect(runTurnMock).toHaveBeenCalledOnce();
    expect(journal()).toMatchObject({
      effect: "unknown",
      authority: { decision: { authorityId: "recovery-authority/v1", kind: "reconcile" } },
    });
  });
});
