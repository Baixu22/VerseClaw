/**
 * #178: the gateway `sessions.compactRange` handler resolves the located
 * boundary against the active transcript branch and then delegates to the single
 * `sessions.compact` path (so the validated pipeline + checkpoint are shared).
 * This covers the handler's own logic: fail-closed responses and the exact
 * params it hands to the delegate.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { tmpdir } from "node:os";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/io.js";
import { loadSessionStore, saveSessionStore, updateSessionStore } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
import {
  captureCompactionCheckpointSnapshotAsync,
  forkCompactionCheckpointTranscriptAsync,
  persistSessionCompactionCheckpoint,
} from "../session-compaction-checkpoints.js";
import {
  getContextFamilyLifecycleAuditSnapshot,
  resetContextFamilyLifecycleAudit,
} from "../../context-engine/registry/context-item-registry.js";

const transcriptMocks = vi.hoisted(() => ({ readTranscriptFileState: vi.fn() }));
const effectMocks = vi.hoisted(() => ({
  compact: vi.fn(), operation: vi.fn(), changed: vi.fn(), checkpoint: vi.fn(),
}));

vi.mock("../../agents/embedded-agent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/embedded-agent.js")>()),
  compactEmbeddedAgentSession: effectMocks.compact,
}));
vi.mock("../../agents/embedded-agent-runner/transcript-file-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/embedded-agent-runner/transcript-file-state.js")>()),
  readTranscriptFileState: transcriptMocks.readTranscriptFileState,
}));
vi.mock("./sessions.shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessions.shared.js")>()),
  emitSessionOperation: effectMocks.operation,
}));
vi.mock("./session-change-event.js", () => ({ emitSessionsChanged: effectMocks.changed }));
vi.mock("../../agents/long-task-control/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/long-task-control/store.js")>()),
  getLatestLongTaskLedgerRootId: () => null,
  recordLongTaskCheckpoint: effectMocks.checkpoint,
}));

import { sessionsCompactionHandlers } from "./sessions.compaction.js";

// driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash.
// Store/admission/file effects are real. The model result and range read are injected.
const key = "agent:main:main";
const sessionId = "sess-1";
const identity = { agentId: "main", canonicalSessionKey: key, expectedSessionId: sessionId };
let directory: string;
let storePath: string;
let transcriptPath: string;
let cfg: OpenClawConfig;

beforeEach(async () => {
  vi.clearAllMocks();
  resetContextFamilyLifecycleAudit();
  directory = mkdtempSync(path.join(tmpdir(), "compact-range-handler-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", directory);
  storePath = path.join(directory, "agents", "main", "sessions", "sessions.json");
  transcriptPath = path.join(path.dirname(storePath), `${sessionId}.jsonl`);
  mkdirSync(path.dirname(storePath), { recursive: true });
  cfg = { session: { store: storePath }, agents: { defaults: { workspace: directory } } };
  setRuntimeConfigSnapshot(cfg);
  writeFileSync(transcriptPath, [
    { type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: directory },
    { type: "message", id: "e1", parentId: null, message: { role: "user", content: "one" } },
    { type: "message", id: "e2", parentId: "e1", message: { role: "assistant", content: "two" } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await saveSessionStore(storePath, {
    [key]: { sessionId, sessionFile: transcriptPath, updatedAt: Date.now(), totalTokens: 900 },
  });
  transcriptMocks.readTranscriptFileState.mockResolvedValue({ getBranch: () => [{ id: "e1" }, { id: "e2" }] });
  effectMocks.compact.mockResolvedValue({ ok: true, compacted: true, result: { tokensAfter: 100 } });
});

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearRuntimeConfigSnapshot();
  resetContextFamilyLifecycleAudit();
  rmSync(directory, { recursive: true, force: true });
});

async function invoke(method: "sessions.compact" | "sessions.compactRange" | "sessions.compaction.restore" | "sessions.compactionStatus", params: Record<string, unknown>, busy = false) {
  const { calls, respond } = makeRespond();
  await sessionsCompactionHandlers[method]!({
    params: { key, ...params }, respond, client: null, isWebchatConnect: () => false,
    context: {
      getRuntimeConfig: () => cfg,
      chatAbortControllers: new Map(busy ? [["run", { sessionKey: key }]] : []),
    },
  } as never);
  return calls;
}

function diskState() {
  return {
    store: JSON.stringify(loadSessionStore(storePath, { skipCache: true })), transcript: readFileSync(transcriptPath, "utf8"),
    files: readdirSync(path.dirname(storePath)).sort(),
  };
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("#178 sessions.compactRange handler", () => {
  let delegate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delegate = vi.fn(async () => undefined);
    vi.spyOn(sessionsCompactionHandlers, "sessions.compact").mockImplementation(delegate);
  });

  function call(params: Record<string, unknown>) {
    const { calls, respond } = makeRespond();
    return {
      respond: () => sessionsCompactionHandlers["sessions.compactRange"]!({
        params,
        respond,
        context: { getRuntimeConfig: () => cfg },
      } as never),
      calls,
    };
  }

  it("delegates a fromLeafId boundary as keepFromEntryId", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }, { id: "e2" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", fromLeafId: "e1" });
    await respond();
    expect(calls).toHaveLength(0);
    expect(delegate).toHaveBeenCalledTimes(1);
    expect(delegate.mock.calls[0]![0]).toMatchObject({
      params: { key: "agent:main:main", keepFromEntryId: "e1", expectedSessionId: sessionId },
    });
  });

  it("resolves toLeafId to the next branch entry before delegating", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
    });
    const { respond } = call({ key: "agent:main:main", toLeafId: "e1" });
    await respond();
    expect(delegate.mock.calls[0]![0]).toMatchObject({
      params: { keepFromEntryId: "e2" },
    });
  });

  it("fails closed without delegating when the boundary is off-branch", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", fromLeafId: "ghost" });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect((calls[0]!.error as { code: string }).code).toBe("INVALID_REQUEST");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("fails closed when toLeafId is the transcript tail", async () => {
    transcriptMocks.readTranscriptFileState.mockResolvedValue({
      getBranch: () => [{ id: "e1" }],
    });
    const { respond, calls } = call({ key: "agent:main:main", toLeafId: "e1" });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect((calls[0]!.error as { details?: { reason?: string } }).details?.reason).toBe(
      "boundary-is-tail",
    );
    expect(delegate).not.toHaveBeenCalled();
  });

  it("rejects supplying both boundaries", async () => {
    const { respond, calls } = call({
      key: "agent:main:main",
      fromLeafId: "e1",
      toLeafId: "e2",
    });
    await respond();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    expect(delegate).not.toHaveBeenCalled();
  });
});

describe("U5 original compaction checkpoint owner", () => {
  it("stores a successor checkpoint using its source snapshot while the original fence is held", async () => {
    const snapshot = await captureCompactionCheckpointSnapshotAsync({ sessionFile: transcriptPath });
    expect(snapshot?.sessionId).toBe(sessionId);
    const successor = await forkCompactionCheckpointTranscriptAsync({ sourceFile: transcriptPath, sourceLeafId: "e2" });
    expect(successor).not.toBeNull();
    const held = await sessionAdmissionRegistry.fence(identity);
    try {
      const checkpoint = await persistSessionCompactionCheckpoint({
        cfg, sessionKey: key, sessionId: successor!.sessionId, reason: "manual", snapshot: snapshot!,
        postSessionFile: successor!.sessionFile, postLeafId: "e2",
      });
      expect(checkpoint).toMatchObject({
        preCompaction: { sessionId }, postCompaction: { sessionId: successor!.sessionId },
      });
      expect(loadSessionStore(storePath)[key]).toMatchObject({ sessionId, compactionCheckpoints: [checkpoint] });
      expect(getContextFamilyLifecycleAuditSnapshot({ sessionId: successor!.sessionId }).events)
        .toEqual(expect.arrayContaining([expect.objectContaining({ reason: "compaction_checkpoint_created" })]));
      expect(sessionAdmissionRegistry.ownsFence(held)).toBe(true);
    } finally {
      held.release();
    }
  });

  it.each([false, true])("refuses a stale snapshot without store/audit effects (missing=%s)", async (missing) => {
    const snapshot = await captureCompactionCheckpointSnapshotAsync({ sessionFile: transcriptPath });
    await updateSessionStore(storePath, (store) => {
      if (missing) delete store[key];
      else store[key]!.sessionId = "generation-new";
    });
    const before = diskState();
    const audit = getContextFamilyLifecycleAuditSnapshot().events;
    // The post ID equals the new entry: only snapshot.sessionId is a valid CAS source.
    expect(await persistSessionCompactionCheckpoint({
      cfg, sessionKey: key, sessionId: "generation-new", reason: "manual", snapshot: snapshot!,
      postSessionFile: transcriptPath, postLeafId: "e2",
    })).toBeNull();
    expect(diskState()).toEqual(before);
    expect(getContextFamilyLifecycleAuditSnapshot().events).toEqual(audit);
  });

  it("keeps an explicit global agent through persistence and real transcript restore", async () => {
    cfg = {
      session: { store: path.join(directory, "global", "{agentId}", "sessions.json") },
      agents: { defaults: { workspace: directory }, list: [{ id: "main", default: true }, { id: "reviewer" }] },
    };
    setRuntimeConfigSnapshot(cfg);
    const mainStore = cfg.session!.store!.replace("{agentId}", "main");
    const reviewerStore = cfg.session!.store!.replace("{agentId}", "reviewer");
    const reviewerTranscript = path.join(path.dirname(reviewerStore), `${sessionId}.jsonl`);
    mkdirSync(path.dirname(reviewerStore), { recursive: true });
    writeFileSync(reviewerTranscript, readFileSync(transcriptPath));
    await saveSessionStore(mainStore, { global: { sessionId: "main-generation", updatedAt: Date.now() } });
    await saveSessionStore(reviewerStore, { global: { sessionId, sessionFile: reviewerTranscript, updatedAt: Date.now() } });
    const mainBefore = JSON.stringify(loadSessionStore(mainStore, { skipCache: true }));
    const snapshot = await captureCompactionCheckpointSnapshotAsync({ sessionFile: reviewerTranscript });
    const checkpoint = await persistSessionCompactionCheckpoint({
      cfg, sessionKey: "global", agentId: "reviewer", sessionId, reason: "manual", snapshot: snapshot!,
      postSessionFile: reviewerTranscript, postLeafId: "e2",
    });
    expect(checkpoint).not.toBeNull();
    expect(loadSessionStore(reviewerStore).global?.compactionCheckpoints).toEqual([checkpoint]);
    const calls = await invoke("sessions.compaction.restore", {
      key: "global", agentId: "reviewer", expectedSessionId: sessionId, checkpointId: checkpoint!.checkpointId,
    });
    expect(calls).toMatchObject([{ ok: true, payload: { key: "global" } }]);
    expect(loadSessionStore(reviewerStore).global?.sessionId).not.toBe(sessionId);
    expect(JSON.stringify(loadSessionStore(mainStore, { skipCache: true }))).toBe(mainBefore);
    expect(effectMocks.changed).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      sessionKey: "global", agentId: "reviewer", reason: "checkpoint-restore",
    }));
  });
});

describe("U5 compaction transcript restore generation", () => {
  async function checkpointId() {
    const snapshot = await captureCompactionCheckpointSnapshotAsync({ sessionFile: transcriptPath });
    const checkpoint = await persistSessionCompactionCheckpoint({
      cfg, sessionKey: key, sessionId, reason: "manual", snapshot: snapshot!,
      postSessionFile: transcriptPath, postLeafId: "e2",
    });
    expect(checkpoint).not.toBeNull();
    return checkpoint!.checkpointId;
  }

  it.each([sessionId, undefined])("forks and publishes the real transcript with expectedSessionId=%s", async (expectedSessionId) => {
    const id = await checkpointId();
    const before = readFileSync(transcriptPath, "utf8");
    const calls = await invoke("sessions.compaction.restore", {
      checkpointId: id, ...(expectedSessionId ? { expectedSessionId } : {}),
    });
    expect(calls).toMatchObject([{ ok: true }]);
    const current = loadSessionStore(storePath)[key]!;
    expect(current.sessionId).not.toBe(sessionId);
    const lines = readFileSync(current.sessionFile!, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ id: current.sessionId, parentSession: transcriptPath });
    expect(lines.slice(1).map((entry) => entry.id)).toEqual(["e1", "e2"]);
    expect(readFileSync(transcriptPath, "utf8")).toBe(before);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("rejects an old generation before creating a transcript", async () => {
    const id = await checkpointId();
    const before = diskState();
    expect(await invoke("sessions.compaction.restore", { checkpointId: id, expectedSessionId: "retired" }))
      .toMatchObject([{ ok: false, error: { details: { reason: "generation-mismatch" } } }]);
    expect(diskState()).toEqual(before);
    expect(effectMocks.changed).not.toHaveBeenCalled();
  });

  it.each(["run", "permit", "fence"] as const)("rejects restore with an existing %s owner", async (kind) => {
    const id = await checkpointId();
    const before = diskState();
    const held = kind === "fence" ? await sessionAdmissionRegistry.fence(identity) : undefined;
    const release = kind === "permit" ? sessionAdmissionRegistry.acquirePermit(identity, "embedded-agent") : undefined;
    try {
      expect(await invoke("sessions.compaction.restore", { checkpointId: id, expectedSessionId: sessionId }, kind === "run"))
        .toMatchObject([{ ok: false, error: { code: "UNAVAILABLE" } }]);
      expect(diskState()).toEqual(before);
      if (held) expect(sessionAdmissionRegistry.ownsFence(held)).toBe(true);
    } finally {
      release?.();
      held?.release();
    }
  });

  it("rechecks generation in the store queue before forking", async () => {
    const id = await checkpointId();
    const beforeFiles = readdirSync(path.dirname(storePath)).sort();
    let unblock!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const otherOwner = updateSessionStore(storePath, async (store) => {
      entered();
      await gate;
      store[key]!.sessionId = "generation-new";
    });
    await started;
    const pending = invoke("sessions.compaction.restore", { checkpointId: id, expectedSessionId: sessionId });
    try {
      await vi.waitFor(() => expect(sessionAdmissionRegistry.isFenced(identity)).toBe(true));
    } finally {
      unblock();
      await otherOwner;
    }
    expect(await pending).toMatchObject([{ ok: false, error: { details: { reason: "generation-mismatch" } } }]);
    expect(loadSessionStore(storePath)[key]?.sessionId).toBe("generation-new");
    expect(readdirSync(path.dirname(storePath)).sort()).toEqual(beforeFiles);
    expect(effectMocks.changed).not.toHaveBeenCalled();
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("refuses transcript restore while the compact handler owns the same generation fence", async () => {
    const id = await checkpointId();
    effectMocks.compact.mockImplementationOnce(async () => {
      const before = diskState();
      expect(await invoke("sessions.compaction.restore", { checkpointId: id, expectedSessionId: sessionId }))
        .toMatchObject([{ ok: false, error: { code: "UNAVAILABLE" } }]);
      expect(diskState()).toEqual(before);
      return { ok: true, compacted: true, result: { tokensAfter: 100 } };
    });
    expect(await invoke("sessions.compact", { expectedSessionId: sessionId, force: true }))
      .toMatchObject([{ ok: true, payload: { compacted: true } }]);
    expect(loadSessionStore(storePath)[key]?.sessionId).toBe(sessionId);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });
});

describe("U5 compaction generation effects", () => {
  it.each([
    ["sessions.compact", { force: true }],
    ["sessions.compact", { maxLines: 1 }],
    ["sessions.compactRange", { fromLeafId: "e1" }],
  ] as const)("rejects stale %s before transcript/model/store effects (%j)", async (method, extra) => {
    const before = diskState();
    const calls = await invoke(method, { ...extra, expectedSessionId: "retired-generation" });
    expect(calls).toMatchObject([{ ok: false, error: { code: "INVALID_REQUEST", details: { reason: "generation-mismatch" } } }]);
    expect(diskState()).toEqual(before);
    expect(effectMocks.compact).not.toHaveBeenCalled();
    expect(transcriptMocks.readTranscriptFileState).not.toHaveBeenCalled();
    expect(effectMocks.operation).not.toHaveBeenCalled();
  });

  it("pins the range read so a generation change before delegation performs no compaction", async () => {
    transcriptMocks.readTranscriptFileState.mockImplementationOnce(async () => {
      // Fault injection after boundary read, before compact owner entry.
      await updateSessionStore(storePath, (store) => { store[key]!.sessionId = "generation-new"; });
      return { getBranch: () => [{ id: "e1" }, { id: "e2" }] };
    });
    const before = readFileSync(transcriptPath, "utf8");
    expect(await invoke("sessions.compactRange", { fromLeafId: "e1", expectedSessionId: sessionId }))
      .toMatchObject([{ ok: false, error: { details: { reason: "generation-mismatch" } } }]);
    expect(effectMocks.compact).not.toHaveBeenCalled();
    expect(readFileSync(transcriptPath, "utf8")).toBe(before);
    expect(loadSessionStore(storePath)[key]?.sessionId).toBe("generation-new");
  });

  it.each([sessionId, undefined])("commits current generation with expectedSessionId=%s", async (expectedSessionId) => {
    effectMocks.compact.mockImplementationOnce(async () => {
      expect(() => sessionAdmissionRegistry.acquirePermit(identity, "chat-send")).toThrow(/fenced/);
      return { ok: true, compacted: true, result: { tokensAfter: 100, sessionId: "compaction-successor" } };
    });
    expect(await invoke("sessions.compact", { force: true, ...(expectedSessionId ? { expectedSessionId } : {}) }))
      .toMatchObject([{ ok: true, payload: { compacted: true } }]);
    expect(loadSessionStore(storePath)[key]).toMatchObject({ sessionId: "compaction-successor", totalTokens: 100, compactionCount: 1 });
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("rejects an asynchronous result when another owner changed the physical generation", async () => {
    let committedByOtherOwner: ReturnType<typeof diskState>;
    effectMocks.compact.mockImplementationOnce(async () => {
      // Inject a direct store-owner write during the model await, bypassing lifecycle fencing to exercise CAS.
      await updateSessionStore(storePath, (store) => {
        store[key] = { sessionId: "generation-new", sessionFile: "new.jsonl", updatedAt: Date.now(), totalTokens: 777, compactionCount: 7 };
      });
      committedByOtherOwner = diskState();
      return { ok: true, compacted: true, result: { sessionId: "late-successor", tokensAfter: 1 } };
    });
    expect(await invoke("sessions.compact", { expectedSessionId: sessionId, force: true }))
      .toMatchObject([{ ok: false, error: { details: { reason: "generation-mismatch" } } }]);
    expect(diskState()).toEqual(committedByOtherOwner!);
    expect(effectMocks.changed).not.toHaveBeenCalled();
    expect(effectMocks.checkpoint).not.toHaveBeenCalled();
    expect(effectMocks.operation).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ completed: true }));
    expect(effectMocks.operation).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ phase: "end", completed: false, reason: "generation-mismatch" }));
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("runs a current range through the real compact handler and store commit", async () => {
    expect(await invoke("sessions.compactRange", { fromLeafId: "e1", expectedSessionId: sessionId }))
      .toMatchObject([{ ok: true, payload: { compacted: true } }]);
    expect(effectMocks.compact).toHaveBeenCalledWith(expect.objectContaining({ sessionId, keepFromEntryId: "e1" }));
    expect(loadSessionStore(storePath)[key]).toMatchObject({ sessionId, totalTokens: 100, compactionCount: 1 });
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it.each(["run", "permit", "fence"] as const)("refuses current generation with busy %s", async (kind) => {
    const before = diskState();
    const held = kind === "fence" ? await sessionAdmissionRegistry.fence(identity) : undefined;
    const release = kind === "permit" ? sessionAdmissionRegistry.acquirePermit(identity, "embedded-agent") : undefined;
    try {
      expect(await invoke("sessions.compactionStatus", {}, kind === "run"))
        .toMatchObject([{ ok: true, payload: { canCompact: false, inProgress: true, reason: "active_run" } }]);
      expect(await invoke("sessions.compactRange", { fromLeafId: "e1", expectedSessionId: sessionId }, kind === "run"))
        .toMatchObject([{ ok: false, error: { code: "UNAVAILABLE" } }]);
      expect(diskState()).toEqual(before);
      expect(effectMocks.compact).not.toHaveBeenCalled();
      if (held) expect(sessionAdmissionRegistry.ownsFence(held)).toBe(true);
    } finally {
      release?.();
      held?.release();
    }
    expect(await invoke("sessions.compactionStatus", {}))
      .toMatchObject([{ ok: true, payload: { canCompact: true, inProgress: false } }]);
  });

  it("retains the real legacy maxLines file operation for the current generation", async () => {
    const before = readFileSync(transcriptPath, "utf8");
    const calls = await invoke("sessions.compact", { expectedSessionId: sessionId, maxLines: 1 });
    expect(calls).toMatchObject([{ ok: true, payload: { compacted: true, kept: 1 } }]);
    expect(readFileSync(transcriptPath, "utf8")).not.toBe(before);
    expect(loadSessionStore(storePath)[key]?.sessionId).toBe(sessionId);
    expect(effectMocks.compact).not.toHaveBeenCalled();
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });
});
