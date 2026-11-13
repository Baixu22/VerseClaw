import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsLifecycleHandlers } from "./sessions.lifecycle.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/io.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
import { readTrackedSessionRunState } from "./session-active-runs.js";

const key = "agent:main:workspace-binding";
let root: string;
let storePath: string;
let cfg: OpenClawConfig;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "session-workspace-"));
  storePath = join(root, "agents", "main", "sessions", "sessions.json");
  vi.stubEnv("OPENCLAW_STATE_DIR", root);
  cfg = { session: { store: storePath }, agents: { defaults: { workspace: root } } };
  setRuntimeConfigSnapshot(cfg);
});
afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  clearRuntimeConfigSnapshot();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function call(method: "sessions.create" | "sessions.patch", params: Record<string, unknown>, mode = "backend", running: "visible" | "hidden" | false = false, scopes = ["operator.admin"]) {
  const respond = vi.fn();
  await sessionsLifecycleHandlers[method]({
    params: { key, ...params },
    client: { connect: { client: { mode }, scopes } },
    context: {
      getRuntimeConfig: () => cfg, emit: () => undefined,
      getSessionEventSubscriberConnIds: () => new Set(),
      chatAbortControllers: new Map(running ? [["current-run", { sessionKey: key,
        sessionId: loadSessionStore(storePath, { skipCache: true })[key]?.sessionId,
        controlUiVisible: running !== "hidden", projectSessionActive: running !== "hidden" }]] : []),
    },
    isWebchatConnect: () => false,
    respond,
  } as never);
  expect(respond).toHaveBeenCalledTimes(1);
  return respond.mock.calls[0];
}

async function create() {
  const [ok, payload] = await call("sessions.create", {});
  expect(ok).toBe(true);
  return payload.sessionId as string;
}
const snapshot = () => loadSessionStore(storePath, { skipCache: true });
function otherDirectory() { const other = join(root, "other"); mkdirSync(other); return other; }

describe("sessions.patch backend workspace binding", () => {
  it("distinguishes old-generation and unidentified active controllers", () => {
    const query = { requestedKey: key, canonicalKey: key, expectedSessionId: "current", includeHidden: true };
    expect(readTrackedSessionRunState({ ...query, context: { chatAbortControllers: new Map([["old", { sessionKey: key, sessionId: "old" }]]) } } as never)).toBe("idle");
    expect(readTrackedSessionRunState({ ...query, context: { chatAbortControllers: new Map([["unknown", { sessionKey: key }]]) } } as never)).toBe("unknown");
  });
  it("persists a canonical existing workspace for backend callers", async () => {
    const sessionId = await create();
    const [ok, , error] = await call("sessions.patch", { workspaceDir: join(root, "."), expectedSessionId: sessionId });
    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(loadSessionStore(storePath, { skipCache: true })[key]?.workspaceDir).toBe(realpathSync(root));
  });

  it("rejects a workspace override from a non-backend client", async () => {
    const sessionId = await create();
    const before = snapshot();
    const [ok, , error] = await call("sessions.patch", { workspaceDir: root, expectedSessionId: sessionId }, "ui");
    expect(ok).toBe(false);
    expect(error.message).toContain("reserved for backend callers");
    expect(snapshot()).toEqual(before);
  });

  it("requires authenticated admin scope for a backend workspace override", async () => {
    const sessionId = await create();
    const before = snapshot();
    const [ok, , error] = await call("sessions.patch", { workspaceDir: root, expectedSessionId: sessionId }, "backend", false, ["operator.write"]);
    expect(ok).toBe(false);
    expect(error.message).toContain("operator.admin");
    expect(snapshot()).toEqual(before);
  });

  it("adopts the same generation idempotently and rejects a stale generation", async () => {
    const sessionId = await create();
    const [ok, adopted] = await call("sessions.patch", { workspaceDir: otherDirectory(), expectedSessionId: sessionId });
    expect(ok).toBe(true);
    expect(adopted.entry.sessionId).toBe(sessionId);
    const before = loadSessionStore(storePath, { skipCache: true });
    const [staleOk, , error] = await call("sessions.patch", { workspaceDir: root, expectedSessionId: "stale-generation" });
    expect(staleOk).toBe(false);
    expect(error.message).toBe("SESSION_GENERATION_CHANGED");
    expect(loadSessionStore(storePath, { skipCache: true })).toEqual(before);
  });

  it("validates an alias before migrating its canonical key", async () => {
    const sessionId = await create();
    const alias = key.toUpperCase();
    await updateSessionStore(storePath, store => { store[alias] = store[key]; delete store[key]; });
    const before = snapshot();
    const [staleOk] = await call("sessions.patch", { workspaceDir: root, expectedSessionId: "stale-generation" });
    expect(staleOk).toBe(false);
    expect(snapshot()).toEqual(before);
    const [ok, patched] = await call("sessions.patch", { workspaceDir: root, expectedSessionId: sessionId });
    expect(ok).toBe(true);
    expect(patched.entry.sessionId).toBe(sessionId);
    expect(Object.keys(snapshot())).toEqual([key]);
  });

  it.each(["visible", "hidden"] as const)("preserves the current directory when a %s run blocks a switch", async (running) => {
    const sessionId = await create();
    const other = otherDirectory();
    const before = loadSessionStore(storePath, { skipCache: true });
    const [ok, , error] = await call("sessions.patch", { workspaceDir: other, expectedSessionId: sessionId }, "backend", running);
    expect(ok).toBe(false);
    expect(error.message).toBe("SESSION_WORKSPACE_SWITCH_BLOCKED");
    expect(loadSessionStore(storePath, { skipCache: true })).toEqual(before);
  });

  it("rejects a missing directory before creating a session", async () => {
    const [ok] = await call("sessions.patch", { workspaceDir: join(root, "missing"), expectedSessionId: "missing-session" });
    expect(ok).toBe(false);
    expect(loadSessionStore(storePath, { skipCache: true })[key]).toBeUndefined();
  });

  it("requires the physical generation before binding a directory", async () => {
    const sessionId = await create();
    const before = snapshot();
    const [ok, , error] = await call("sessions.patch", { workspaceDir: root });
    expect(ok).toBe(false); expect(error.message).toContain("expectedSessionId");
    expect(snapshot()).toEqual(before); expect(snapshot()[key].sessionId).toBe(sessionId);
  });

  it("rejects a file as a workspace directory", async () => {
    const sessionId = await create();
    const before = snapshot();
    const [ok, , error] = await call("sessions.patch", { workspaceDir: snapshot()[key].sessionFile, expectedSessionId: sessionId });
    expect(ok).toBe(false); expect(error.message).toContain("not a directory");
    expect(snapshot()).toEqual(before);
  });

  it("releases its admission fence after the workspace metadata commits", async () => {
    const sessionId = await create();
    const identity = { agentId: "main", canonicalSessionKey: key, expectedSessionId: sessionId };
    const [ok] = await call("sessions.patch", { workspaceDir: otherDirectory(), expectedSessionId: sessionId });
    expect(ok).toBe(true);
    expect(sessionAdmissionRegistry.snapshot(identity)).toMatchObject({ active: 0, fenced: false });
    const release = sessionAdmissionRegistry.acquirePermit(identity, "reply-turn");
    release();
  });

  it("preserves the existing identity and transcript pointer during metadata binding", async () => {
    const sessionId = await create();
    await updateSessionStore(storePath, store => { store[key] = { ...store[key], sessionFile: root, label: "Existing history" }; });
    const [ok, patched] = await call("sessions.patch", { workspaceDir: otherDirectory(), expectedSessionId: sessionId });
    expect(ok).toBe(true);
    expect(patched.entry).toMatchObject({ sessionId, sessionFile: root, label: "Existing history" });
    expect(Object.keys(snapshot())).toEqual([key]);
  });

  it("rejects an in-flight admission without closing or releasing its permit", async () => {
    const sessionId = await create();
    const identity = { agentId: "main", canonicalSessionKey: key, expectedSessionId: sessionId };
    const release = sessionAdmissionRegistry.acquirePermit(identity, "reply-turn");
    try {
      const before = snapshot();
      const [ok, , error] = await call("sessions.patch", { workspaceDir: otherDirectory(), expectedSessionId: sessionId });
      expect(ok).toBe(false); expect(error.message).toBe("SESSION_WORKSPACE_SWITCH_BLOCKED");
      expect(snapshot()).toEqual(before);
      expect(sessionAdmissionRegistry.snapshot(identity)).toMatchObject({ active: 1, fenced: false });
    } finally { release(); }
  });

  it("normalizes both sides of an alias while retaining the active generation", async () => {
    const sessionId = await create();
    const target = otherDirectory(), alias = join(root, "alias");
    symlinkSync(target, alias, "junction");
    await updateSessionStore(storePath, store => { store[key] = { ...store[key], workspaceDir: alias }; });
    const identity = { agentId: "main", canonicalSessionKey: key, expectedSessionId: sessionId };
    const release = sessionAdmissionRegistry.acquirePermit(identity, "reply-turn");
    try {
      const [ok, patched] = await call("sessions.patch", { workspaceDir: target, expectedSessionId: sessionId }, "backend", "visible");
      expect(ok).toBe(true);
      expect(patched.entry).toMatchObject({ sessionId, workspaceDir: realpathSync(target) });
      expect(sessionAdmissionRegistry.snapshot(identity)).toMatchObject({ active: 1, fenced: false });
    } finally { release(); }
  });
});
