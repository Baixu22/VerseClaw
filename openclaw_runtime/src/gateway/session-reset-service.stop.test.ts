/**
 * Phase 1 stop-pipeline tests: `sessions.stop` reuses the canonical finalizer
 * front (fence -> queues -> abort -> children -> wait -> drain) and never
 * mutates the session store.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  addSession,
  deleteSession,
  resetProcessRegistryForTests,
  type ProcessSession,
} from "../agents/bash-process-registry.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";
import { stopSessionRuntime } from "./session-reset-service.js";

const identity: SessionAdmissionIdentity = {
  agentId: "agent-a",
  canonicalSessionKey: "agent:agent-a:main",
  expectedSessionId: "session-stop-1",
};

const target = {
  agentId: "agent-a",
  storePath: "/tmp/phase1-stop-store.json",
  canonicalKey: identity.canonicalSessionKey,
  storeKeys: [identity.canonicalSessionKey],
};

const entry = {
  sessionId: identity.expectedSessionId,
  sessionFile: "/tmp/phase1-stop-session.jsonl",
};

function makeSession(params: {
  id: string;
  lifecycleCancel?: () => void;
  lifecycleExitPromise?: Promise<unknown>;
  lifecycleOwner?: ProcessSession["lifecycleOwner"];
}): ProcessSession {
  const now = Date.now();
  return {
    id: params.id,
    command: "stop-fixture",
    scopeKey: identity.canonicalSessionKey,
    sessionKey: identity.canonicalSessionKey,
    lifecycleOwner: params.lifecycleOwner ?? "native",
    lifecycleAgentId: identity.agentId,
    lifecycleCanonicalSessionKey: identity.canonicalSessionKey,
    lifecycleExpectedSessionId: identity.expectedSessionId,
    lifecycleCancel: params.lifecycleCancel,
    lifecycleExitPromise: params.lifecycleExitPromise,
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

afterEach(() => {
  resetProcessRegistryForTests();
  sessionAdmissionRegistry.clearForTests();
});

describe("stopSessionRuntime", () => {
  it("releases the fence after a successful no-mutation stop", async () => {
    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: identity.canonicalSessionKey,
      target,
      entry,
    });
    expect(result).toEqual({ ok: true, key: identity.canonicalSessionKey });
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("observes the admission fence during owner cancel (fence-before-drain order)", async () => {
    let fenceClosedDuringCancel = false;
    addSession(
      makeSession({
        id: "fenced-cancel",
        lifecycleCancel: () => {
          fenceClosedDuringCancel = sessionAdmissionRegistry.isFenced(identity);
        },
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: identity.canonicalSessionKey,
      target,
      entry,
    });
    expect(result.ok).toBe(true);
    expect(fenceClosedDuringCancel).toBe(true);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("releases the fence and returns the sessions.* error shape when drain fails", async () => {
    addSession(
      makeSession({
        id: "unknown-owner",
        lifecycleOwner: "verseshell",
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: identity.canonicalSessionKey,
      target,
      entry,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "UNAVAILABLE" });
      expect(result.error.message).toContain("drain failed");
    }
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
    deleteSession("unknown-owner");
  });

  it("returns the standard sessions.* error shape when the identity is already fenced", async () => {
    const fence = await sessionAdmissionRegistry.fence(identity);
    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: identity.canonicalSessionKey,
      target,
      entry,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "UNAVAILABLE" });
      expect(result.error.message).toContain("fenced by another lifecycle operation");
    }
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(true);
    fence.release();
  });

  it("releases the fence when an owner cancel throws unexpectedly", async () => {
    addSession(
      makeSession({
        id: "throwing-cancel",
        lifecycleCancel: () => {
          throw new Error("owner cancel failed");
        },
        lifecycleExitPromise: Promise.resolve(),
      }),
    );
    await expect(
      stopSessionRuntime({
        cfg: {} as OpenClawConfig,
        key: identity.canonicalSessionKey,
        target,
        entry,
      }),
    ).rejects.toThrow("owner cancel failed");
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("rejects a missing generation instead of fabricating an identity", async () => {
    const result = await stopSessionRuntime({
      cfg: {} as OpenClawConfig,
      key: identity.canonicalSessionKey,
      target,
      entry: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_REQUEST");
    }
  });
});
