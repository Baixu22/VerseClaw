import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_MODES } from "../../../packages/gateway-protocol/src/client-info.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  loadSqliteSessionStore,
  mutateSqliteSessionStoreAtomic,
} from "../../config/sessions/store-sqlite.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import {
  buildRecoveryAdmissionKey,
  getRecoveryAdmissionIdentity,
  prepareOwnerRecoveryAdmission,
} from "../../agents/recovery-authority/owner-admission.js";

const mocks = vi.hoisted(() => ({
  cfg: {} as OpenClawConfig,
  loadSessionEntry: vi.fn(),
  ingress: vi.fn(),
  beforeWrite: undefined as undefined | (() => void),
}));
vi.mock("../agent-command.js", () => ({ agentCommandFromIngress: mocks.ingress }));
vi.mock("../session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-utils.js")>()),
  loadSessionEntry: mocks.loadSessionEntry,
}));
vi.mock("../../config/sessions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/sessions.js")>();
  return {
    ...original,
    updateSessionStore: async (...args: Parameters<typeof original.updateSessionStore>) => {
      const interleave = mocks.beforeWrite;
      mocks.beforeWrite = undefined;
      interleave?.();
      return original.updateSessionStore(...args);
    },
  };
});
vi.mock("../session-reset-service.js", () => ({
  emitGatewaySessionEndPluginHook: vi.fn(),
  emitGatewaySessionStartPluginHook: vi.fn(),
  performGatewaySessionReset: vi.fn(),
}));
vi.mock("../session-subagent-reactivation.js", () => ({
  reactivateCompletedSubagentSession: vi.fn(),
}));
vi.mock("../../tasks/detached-task-runtime.js", () => ({
  createRunningTaskRun: vi.fn(),
  finalizeTaskRunByRunId: vi.fn(),
}));

import { agentHandlers } from "./agent.js";

const sessionKey = "agent:main:subagent:recovery-test";
const sessionId = "interrupted-generation";
const ownerId = "original-run";
const idempotencyKey = buildRecoveryAdmissionKey("subagent-orphan", ownerId, sessionId, ownerId);
let dir: string;
let storePath: string;
let params: Record<string, unknown>;

function invocation(request = params, mode: string = GATEWAY_CLIENT_MODES.BACKEND) {
  const respond = vi.fn();
  const context = {
    getRuntimeConfig: () => mocks.cfg,
    dedupe: new Map(),
    chatAbortControllers: new Map(),
    deps: {},
    logGateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getSessionEventSubscriberConnIds: () => new Set<string>(),
    broadcastToConnIds: vi.fn(),
    addChatRun: vi.fn(),
    removeChatRun: vi.fn(),
  };
  const run = () =>
    agentHandlers.agent!({
      params: request,
      respond,
      context,
      client: { connect: { client: { mode } } },
      isWebchatConnect: () => false,
    } as never);
  return { run, respond, context };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.beforeWrite = undefined;
  mocks.ingress.mockResolvedValue({ payloads: [], meta: {} });
  dir = mkdtempSync(join(tmpdir(), "gateway-recovery-admission-"));
  storePath = join(dir, "sessions.json");
  mocks.cfg = {
    agents: { defaults: { model: { primary: "openai/gpt-5.5" } } },
    session: { store: storePath, reset: { mode: "idle", idleMinutes: 1 } },
  };
  const now = Date.now() - 60 * 60 * 1000;
  const prepared = prepareOwnerRecoveryAdmission({
    requestId: idempotencyKey,
    entry: "subagent-orphan",
    owner: { kind: "subagent-run", ownerId, runId: ownerId, sessionKey },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "active-subagent-run",
      admitted: true,
      visibleOutputObserved: false,
    },
    budget: {
      attempts: { current: 0, max: 3 },
      backoff: { initialMs: 5000, multiplier: 2 },
      wedge: { afterAttempts: 3, wedged: false },
    },
    replayClass: "reconcile",
    effect: "not_applied",
    requestedAction: "resume",
    idempotencyKey,
    evidence: [],
    requestedAt: now,
  });
  if (!prepared.admitted) throw new Error("fixture admission was rejected");
  mutateSqliteSessionStoreAtomic(storePath, (store) => {
    store[sessionKey] = {
      sessionId,
      updatedAt: now,
      sessionStartedAt: now,
      lastInteractionAt: now,
      status: "running",
      lifecycleRunId: ownerId,
      abortedLastRun: true,
      subagentRecovery: { authority: prepared.record },
    };
  });
  mocks.loadSessionEntry.mockImplementation(() => ({
    cfg: mocks.cfg,
    storePath,
    canonicalKey: sessionKey,
    entry: loadSqliteSessionStore(storePath)[sessionKey],
  }));
  params = {
    message: "Continue the original durable user intent",
    sessionKey,
    sessionId,
    idempotencyKey,
    recoveryAdmission: getRecoveryAdmissionIdentity(prepared.record),
    deliver: false,
    lane: "subagent",
    sessionEffects: "visible",
    suppressPromptPersistence: true,
    inputProvenance: {
      kind: "inter_session",
      sourceSessionKey: "agent:main:main",
      sourceChannel: "internal",
      sourceTool: "subagent_interrupted_resume",
    },
  };
});

function mainInvocation() {
  const mainKey = "agent:main:main";
  const mainRun = buildRecoveryAdmissionKey(
    "main-session-restart",
    sessionId,
    sessionId,
    "main-boundary",
  );
  const prepared = prepareOwnerRecoveryAdmission({
    requestId: mainRun,
    entry: "main-session-restart",
    owner: {
      kind: "main-session",
      ownerId: sessionId,
      sessionKey: mainKey,
      runId: "main-original",
    },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "aborted-last-run",
      admitted: true,
      visibleOutputObserved: false,
    },
    budget: {
      attempts: { current: 0, max: 3 },
      backoff: { initialMs: 5000, multiplier: 2 },
      wedge: { afterAttempts: 3, wedged: false },
    },
    replayClass: "reconcile",
    effect: "not_applied",
    requestedAction: "resume",
    idempotencyKey: mainRun,
    evidence: [],
    requestedAt: Date.now(),
  });
  if (!prepared.admitted) throw Error("main fixture was not admitted");
  mutateSqliteSessionStoreAtomic(storePath, (store) => {
    store[mainKey] = {
      sessionId,
      updatedAt: 1,
      status: "running",
      lifecycleRunId: "main-original",
      abortedLastRun: true,
      restartRecovery: {
        sessionId,
        boundary: "main-boundary",
        runId: mainRun,
        attempts: 1,
        state: "admitted",
        authority: prepared.record,
      },
    };
  });
  mocks.loadSessionEntry.mockImplementation(() => ({
    cfg: mocks.cfg,
    storePath,
    canonicalKey: mainKey,
    entry: loadSqliteSessionStore(storePath)[mainKey],
  }));
  const request = {
    ...params,
    sessionKey: mainKey,
    idempotencyKey: mainRun,
    recoveryAdmission: getRecoveryAdmissionIdentity(prepared.record),
    suppressPromptPersistence: true,
  };
  return { ...invocation(request), mainKey, mainRun };
}

it("receives a durable main-session admission without rotating its transcript", async () => {
  const call = mainInvocation();
  await call.run();
  await vi.waitFor(() => expect(mocks.ingress).toHaveBeenCalledTimes(1), { timeout: 5000 });
  expect(loadSqliteSessionStore(storePath)[call.mainKey].sessionId).toBe(sessionId);
  expect(call.respond.mock.calls.some(([ok, value]) => ok && value?.runId === call.mainRun)).toBe(
    true,
  );
});

it.each([
  { owner: "recovery", status: "done" },
  { owner: "original", status: "done" },
  { owner: "original", status: "running" },
] as const)(
  "rejects stale main admission with $owner owner in $status after dedupe is absent",
  async ({ owner, status }) => {
    const call = mainInvocation();
    const lifecycleRunId = owner === "recovery" ? call.mainRun : "main-original";
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store[call.mainKey].status = status;
      store[call.mainKey].lifecycleRunId = lifecycleRunId;
      store[call.mainKey].abortedLastRun = false;
    });
    await expect(call.run()).rejects.toThrow("no longer owns");
    expect(mocks.ingress).not.toHaveBeenCalled();
    expect(loadSqliteSessionStore(storePath)[call.mainKey]).toMatchObject({
      status,
      lifecycleRunId,
    });
  },
);

it("rejects a replaced main-session generation before agent ingress", async () => {
  const call = mainInvocation();
  mocks.beforeWrite = () =>
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store[call.mainKey].sessionId = "new-main-generation";
    });
  await expect(call.run()).rejects.toThrow("no longer owns");
  expect(mocks.ingress).not.toHaveBeenCalled();
  expect(loadSqliteSessionStore(storePath)[call.mainKey].sessionId).toBe("new-main-generation");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  closeOpenClawAgentDatabasesForTest();
  rmSync(dir, { recursive: true, force: true });
});

describe("agent continuation generation against the real session store", () => {
  beforeEach(() => {
    delete params.recoveryAdmission;
    params.expectedSessionId = sessionId;
    params.idempotencyKey = "completion-generation-pin";
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store[sessionKey].subagentRecovery = undefined;
      store[sessionKey].abortedLastRun = false;
    });
  });
  it('removes an unaccepted controller when pause races admission and lets the same request retry', async () => {
    const path = join(dir, 'workspaces.json');
    const policy = (paused: boolean) => writeFileSync(path, JSON.stringify({ systemControl: {
      revision: paused ? 1 : 2, paused, inFlightPolicy: 'settle-admitted-effects', recentRequests: [],
    } }));
    policy(false); vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', path);
    mocks.beforeWrite = () => policy(true);
    const call = invocation();
    await expect(call.run()).rejects.toThrow('SYSTEM_EXECUTION_PAUSED');
    expect(call.context.chatAbortControllers.size).toBe(0);
    expect(mocks.ingress).not.toHaveBeenCalled();
    policy(false);
    await call.run();
    await vi.waitFor(() => expect(mocks.ingress).toHaveBeenCalledTimes(1));
    expect(call.respond.mock.calls.some(args => (args[1] as { status?: string })?.status === 'accepted')).toBe(true);
  });

  it("resumes an idle expired generation without rotating the transcript", async () => {
    const call = invocation();
    await call.run();
    await vi.waitFor(() => expect(mocks.ingress).toHaveBeenCalledTimes(1));
    expect(mocks.ingress.mock.calls[0][0]).toMatchObject({ sessionId, sessionKey });
    expect(loadSqliteSessionStore(storePath)[sessionKey].sessionId).toBe(sessionId);
  });

  it.each(["replace", "delete"])("rejects a %s before ingress", async (action) => {
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      if (action === "delete") delete store[sessionKey];
      else store[sessionKey].sessionId = "replacement-generation";
    });
    const before = loadSqliteSessionStore(storePath);
    await expect(invocation().run()).rejects.toThrow("AGENT_SESSION_GENERATION_STALE");
    expect(mocks.ingress).not.toHaveBeenCalled();
    expect(loadSqliteSessionStore(storePath)).toEqual(before);
  });

  it("rejects a reset racing the atomic session patch", async () => {
    mocks.beforeWrite = () => mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store[sessionKey].sessionId = "concurrent-generation";
      store[sessionKey].lifecycleRunId = "concurrent-run";
    });
    await expect(invocation().run()).rejects.toThrow("AGENT_SESSION_GENERATION_STALE");
    expect(mocks.ingress).not.toHaveBeenCalled();
    expect(loadSqliteSessionStore(storePath)[sessionKey]).toMatchObject({
      sessionId: "concurrent-generation", lifecycleRunId: "concurrent-run",
    });
  });

  it.each(["before delivery", "during the session update", "after acceptance"])(
    "refuses ingress when a handoff retires the requester %s",
    async (timing) => {
      const ownerPath = join(dir, "workspaces.json");
      writeFileSync(ownerPath, JSON.stringify({ profiles: [] }));
      vi.stubEnv("CLAWX_WORKSPACE_OWNER_PATH", ownerPath);
      const retire = () => writeFileSync(ownerPath, JSON.stringify({ profiles: [{
        id: "project",
        coordinatorBindings: { [sessionKey]: {
          workspaceId: "project", sessionKey, sessionGeneration: sessionId,
          state: "paused", invalidationReason: "handoff-to-new-session",
        } },
      }] }));
      const call = invocation();
      if (timing === "before delivery") retire();
      else if (timing === "during the session update") mocks.beforeWrite = retire;
      else call.respond.mockImplementationOnce(retire);
      const before = loadSqliteSessionStore(storePath);
      if (timing === "after acceptance") {
        await call.run();
        await vi.waitFor(() => expect(call.respond.mock.calls[1]?.[2]?.message).toContain("AGENT_CONTINUATION_OWNER_RETIRED"));
      } else {
        await expect(call.run()).rejects.toThrow("AGENT_CONTINUATION_OWNER_RETIRED");
        expect(loadSqliteSessionStore(storePath)).toEqual(before);
      }
      expect(mocks.ingress).not.toHaveBeenCalled();
      expect(loadSqliteSessionStore(storePath)[sessionKey].sessionId).toBe(sessionId);
    },
  );

  it.each(["key", "id"])("rejects a conflicting %s", async (field) => {
    if (field === "key") delete params.sessionKey;
    else params.sessionId = "foreign-generation";
    const before = loadSqliteSessionStore(storePath);
    await expect(invocation().run()).rejects.toThrow("AGENT_SESSION_GENERATION_STALE");
    expect(mocks.ingress).not.toHaveBeenCalled();
    expect(loadSqliteSessionStore(storePath)).toEqual(before);
  });
});

describe("agent receiver recovery admission against the real session store", () => {
  it("continues an expired admitted session without rotating its transcript generation", async () => {
    const call = invocation();
    await call.run();
    expect(call.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ runId: idempotencyKey, status: "accepted" }),
      undefined,
      expect.anything(),
    );
    await vi.waitFor(
      () =>
        expect(mocks.ingress.mock.calls, JSON.stringify(call.respond.mock.calls)).toHaveLength(1),
      { timeout: 5000 },
    );
    expect(mocks.ingress.mock.calls[0][0]).toMatchObject({
      sessionId,
      sessionKey,
      suppressPromptPersistence: true,
      preserveUserFacingSessionModelState: true,
    });
    expect(loadSqliteSessionStore(storePath)[sessionKey].sessionId).toBe(sessionId);
  });

  it.each(["generation", "attempt", "epoch", "lifecycle", "state"])(
    "rejects a replaced %s before dispatch",
    async (replacement) => {
      mutateSqliteSessionStoreAtomic(storePath, (store) => {
        const entry = store[sessionKey];
        if (replacement === "generation") entry.sessionId = "replacement-generation";
        const recovery = entry.subagentRecovery!;
        if (replacement === "attempt") recovery.authority = { ...recovery.authority!, attempts: 2 };
        if (replacement === "epoch")
          recovery.authority = { ...recovery.authority!, ownerEpoch: "replacement" };
        if (replacement === "lifecycle") entry.lifecycleRunId = "replacement-run";
        if (replacement === "state")
          recovery.authority = { ...recovery.authority!, state: "settled" };
      });
      const before = loadSqliteSessionStore(storePath);
      await expect(invocation().run()).rejects.toThrow("no longer owns the requested session");
      expect(mocks.ingress).not.toHaveBeenCalled();
      expect(loadSqliteSessionStore(storePath)).toEqual(before);
    },
  );

  it("checks the owner again when it changes before the fresh-store patch", async () => {
    mocks.beforeWrite = () =>
      mutateSqliteSessionStoreAtomic(storePath, (store) => {
        store[sessionKey].sessionId = "concurrent-generation";
        store[sessionKey].lifecycleRunId = "concurrent-run";
      });
    await expect(invocation().run()).rejects.toThrow("no longer owns the requested session");
    expect(mocks.ingress).not.toHaveBeenCalled();
    expect(loadSqliteSessionStore(storePath)[sessionKey]).toMatchObject({
      sessionId: "concurrent-generation",
      lifecycleRunId: "concurrent-run",
    });
  });

  it("rejects recovery admission from a non-backend caller", async () => {
    const call = invocation(params, GATEWAY_CLIENT_MODES.UI);
    await call.run();
    expect(call.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(mocks.ingress).not.toHaveBeenCalled();
  });

  it.each(["sessionKey", "sessionId"])("requires the admitted %s", async (field) => {
    delete params[field];
    const call = invocation();
    await call.run();
    expect(call.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(mocks.ingress).not.toHaveBeenCalled();
  });

  it("requires visible lifecycle effects for an admitted continuation", async () => {
    params.sessionEffects = "internal";
    const call = invocation();
    await call.run();
    expect(call.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(mocks.ingress).not.toHaveBeenCalled();
  });
});
