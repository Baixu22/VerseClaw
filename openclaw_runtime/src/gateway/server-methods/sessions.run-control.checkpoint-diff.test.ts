/**
 * Gateway 集成测试: sessions.checkpointDiff / sessions.restoreCheckpoint
 * 真实链路验证(非 mock)——
 *   - 真实 stateDb(OPENCLAW_STATE_DIR 临时目录, 自动建 schema)
 *   - 真实 write-journal(临时工作区文件 + .pre 快照)
 *   - 真实 checkpoint 落库(recordLongTaskCheckpoint)
 *   - 真实 handler 调用(sessionsRunControlHandlers)
 * 验证: checkpoint diff 数据从 db 读取 → journal 对比 → respond 形状。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import path from "node:path";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { sessionsRunControlHandlers } from "./sessions.run-control.js";
import { snapshotBeforeWrite, __resetWriteJournals, journalDirFor } from "../../agents/tools/write-journal.js";
import { acquirePatchBatchLocks } from "../../agents/apply-patch-batch-lock.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/io.js";
import { loadSessionStore, resolveStorePath, saveSessionStore, updateSessionStore } from "../../config/sessions.js";
import { sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
import {
  buildRuntimeResumeCheckpoint,
  recordLongTaskCheckpoint,
} from "../../agents/long-task-control/store.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

function makeContext(workspaceRoot: string): { getRuntimeConfig: () => OpenClawConfig } {
  return {
    getRuntimeConfig: () =>
      ({
        agents: {
          defaults: {
            missionLoop: { enabled: true },
            workspace: workspaceRoot,
          },
        },
        runtime: {
          mission: { rollback: { enabled: true } },
        },
      }) as unknown as OpenClawConfig,
  };
}

describe("sessions.checkpointDiff gateway integration", () => {
  let stateDir: string;
  let workspaceRoot: string;
  let storePath: string;
  const sessionKey = "agent:main:main";
  // #176: the write-journal is keyed by the session UUID, NOT the canonical
  // session key. The previous fixture used the canonical key for both, which is
  // exactly the mistake production made — so the integration test stayed green
  // while real manual restores rolled back nothing.
  const journalSessionId = "sess-uuid-9f3a1c";
  const identity = { agentId: "main", canonicalSessionKey: sessionKey, expectedSessionId: journalSessionId };

  beforeEach(async () => {
    __resetWriteJournals();
    stateDir = mkdtempSync(path.join(tmpdir(), "gw-state-"));
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "gw-ws-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    setRuntimeConfigSnapshot(makeContext(workspaceRoot).getRuntimeConfig());
    storePath = resolveStorePath(undefined, { agentId: "main" });
    await saveSessionStore(storePath, { [sessionKey]: { sessionId: journalSessionId, updatedAt: Date.now() } });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v0\n", "utf8");
    // Pre-checkpoint write (seq 1): v0 -> v1
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v1\n", "utf8");
    await sleepMs(5);
  });

  afterEach(() => {
    __resetWriteJournals();
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabase();
    clearRuntimeConfigSnapshot();
    vi.unstubAllEnvs();
    for (const dir of [stateDir, workspaceRoot]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep sqlite handles briefly after close; leftover temp
        // dirs are harmless.
      }
    }
  });

  it("returns per-file diffs for a real checkpoint (journal-backed)", async () => {
    // Checkpoint stamped at seq=1 (after the v0->v1 write).
    await recordLongTaskCheckpoint({
      id: "mission:m1:tick:3",
      idempotencyKey: "mission:m1:tick:3",
      sessionKey,
      agentId: "main",
      trigger: "guide",
      status: "guide",
      checkpoint: buildRuntimeResumeCheckpoint({
        id: "mission:m1:tick:3",
        sessionKey,
        trigger: "guide",
        // #176: the checkpoint carries the write-journal identity it describes.
        metadata: { journalSeq: 1, journalSessionId },
        createdAt: Date.now(),
      }),
    });
    // Post-checkpoint write (seq 2): v1 -> v2
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v2\n", "utf8");

    const { getLongTaskCheckpointById } = await import("../../agents/long-task-control/store.js");
    const stored = getLongTaskCheckpointById("mission:m1:tick:3");
    const { checkpointContentDiff } = await import("../../agents/checkpoint-diff.js");
    const direct = checkpointContentDiff({
      workspaceRoot,
      checkpoint: stored as never,
      sessionId: journalSessionId,
    });
    expect(direct.errors).toEqual([]);

    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.checkpointDiff"]({
      params: { key: sessionKey, checkpointId: "mission:m1:tick:3" },
      respond,
      context: makeContext(workspaceRoot) as never,
    } as never);

    expect(calls).toHaveLength(1);
    if (!calls[0]!.ok) {
      throw new Error(`checkpointDiff failed: ${JSON.stringify(calls[0]!.error)}`);
    }
    const payload = calls[0]!.payload as { files: Array<{ filePath: string; status: string; unifiedDiff: string }> };
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]!.filePath).toBe("f.ts");
    expect(payload.files[0]!.status).toBe("modified");
    // Checkpoint-side (v1) vs current (v2): unified diff must show both.
    expect(payload.files[0]!.unifiedDiff).toContain("-v1");
    expect(payload.files[0]!.unifiedDiff).toContain("+v2");
  });

  it("reports NOT_FOUND for an unknown checkpoint", async () => {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.checkpointDiff"]({
      params: { key: sessionKey, checkpointId: "mission:missing:tick:0" },
      respond,
      context: makeContext(workspaceRoot) as never,
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
    const errText =
      typeof calls[0]!.error === "string"
        ? calls[0]!.error
        : JSON.stringify(calls[0]!.error ?? "");
    expect(errText).toContain("not found");
  });

  it.each([undefined, journalSessionId])("restores through the real journal with expectedSessionId=%s", async (expectedSessionId) => {
    await recordLongTaskCheckpoint({
      id: "mission:m1:tick:2",
      idempotencyKey: "mission:m1:tick:2",
      sessionKey,
      agentId: "main",
      trigger: "guide",
      status: "guide",
      checkpoint: buildRuntimeResumeCheckpoint({
        id: "mission:m1:tick:2",
        sessionKey,
        trigger: "guide",
        // #176: the checkpoint carries the write-journal identity it describes.
        metadata: { journalSeq: 1, journalSessionId },
        createdAt: Date.now(),
      }),
    });
    // Post-checkpoint write (seq 2): v1 -> v2
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v2\n", "utf8");

    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.restoreCheckpoint"]({
      params: { key: sessionKey, checkpointId: "mission:m1:tick:2", ...(expectedSessionId ? { expectedSessionId } : {}) },
      respond,
      context: makeContext(workspaceRoot) as never,
    } as never);

    expect(calls).toHaveLength(1);
    if (!calls[0]!.ok) {
      throw new Error(`restoreCheckpoint failed: ${JSON.stringify(calls[0]!.error)}`);
    }
    // The rollback actually restored the file on disk.
    expect(readFileSync(path.join(workspaceRoot, "f.ts"), "utf8")).toBe("v1\n");
    expect(loadSessionStore(storePath)[sessionKey]?.sessionId).toBe(journalSessionId);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  // driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash.
  // These cases use the original session-store, admission, SQLite checkpoint and file-journal owners.
  async function recordRestoreFixture(stampedSessionId: string | undefined = journalSessionId) {
    const id = "mission:guard:tick:2";
    await recordLongTaskCheckpoint({
      id, idempotencyKey: id, sessionKey, agentId: "main", trigger: "guide", status: "guide",
      checkpoint: buildRuntimeResumeCheckpoint({
        id, sessionKey, trigger: "guide", createdAt: Date.now(),
        metadata: { journalSeq: 1, ...(stampedSessionId ? { journalSessionId: stampedSessionId } : {}) },
      }),
    });
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v2\n", "utf8");
    return id;
  }

  function diskState() {
    const journalDir = journalDirFor(workspaceRoot, journalSessionId);
    return {
      file: readFileSync(path.join(workspaceRoot, "f.ts"), "utf8"),
      store: JSON.stringify(loadSessionStore(storePath, { skipCache: true })),
      journal: readdirSync(journalDir).sort().map((name) => [name, readFileSync(path.join(journalDir, name)).toString("hex")]),
    };
  }

  async function restore(checkpointId: string, expectedSessionId?: string, busy = false) {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.restoreCheckpoint"]!({
      params: { key: sessionKey, checkpointId, ...(expectedSessionId ? { expectedSessionId } : {}) }, respond,
      context: {
        ...makeContext(workspaceRoot),
        chatAbortControllers: new Map(busy ? [["run", { sessionKey }]] : []),
      },
    } as never);
    return calls;
  }

  it.each([
    ["stale request", journalSessionId, "retired", "generation-mismatch"],
    ["old checkpoint journal", "retired", journalSessionId, "checkpoint-generation-mismatch"],
    ["unstamped checkpoint", "", journalSessionId, "checkpoint-journal-identity-missing"],
  ])("rejects %s with unchanged files, journal and session store", async (_name, stamp, expected, reason) => {
    const checkpointId = await recordRestoreFixture(stamp);
    const before = diskState();
    const calls = await restore(checkpointId, expected);
    expect(calls).toMatchObject([
      { ok: false, error: { code: "INVALID_REQUEST", details: { reason } } },
    ]);
    if (!stamp) expect(calls[0]?.error).toMatchObject({ message: expect.stringContaining("no recorded write-journal session UUID") });
    expect(diskState()).toEqual(before);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it.each(["run", "permit", "fence"] as const)("refuses restore while the current generation has a busy %s", async (kind) => {
    const checkpointId = await recordRestoreFixture();
    const before = diskState();
    const held = kind === "fence" ? await sessionAdmissionRegistry.fence(identity) : undefined;
    const release = kind === "permit" ? sessionAdmissionRegistry.acquirePermit(identity, "embedded-agent") : undefined;
    try {
      expect(await restore(checkpointId, journalSessionId, kind === "run"))
        .toMatchObject([{ ok: false, error: { code: "UNAVAILABLE" } }]);
      expect(diskState()).toEqual(before);
      if (held) expect(sessionAdmissionRegistry.ownsFence(held)).toBe(true);
    } finally {
      release?.();
      held?.release();
    }
  });

  it("rechecks generation after waiting for the real session-store barrier", async () => {
    const checkpointId = await recordRestoreFixture();
    const before = diskState();
    let unblock!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const otherOwner = updateSessionStore(storePath, async (store) => {
      entered();
      await gate;
      store[sessionKey]!.sessionId = "generation-new";
    });
    await started;
    const pending = restore(checkpointId, journalSessionId);
    try {
      await vi.waitFor(() => expect(sessionAdmissionRegistry.isFenced(identity)).toBe(true));
    } finally {
      unblock();
      await otherOwner;
    }
    expect(await pending).toMatchObject([{ ok: false, error: { details: { reason: "generation-mismatch" } } }]);
    expect(diskState().file).toBe(before.file);
    expect(diskState().journal).toEqual(before.journal);
    expect(loadSessionStore(storePath)[sessionKey]?.sessionId).toBe("generation-new");
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("holds the store barrier and admission fence through the real rollback file lease", async () => {
    const checkpointId = await recordRestoreFixture();
    const releaseFiles = await acquirePatchBatchLocks([path.join(workspaceRoot, "f.ts")]);
    const pending = restore(checkpointId, journalSessionId);
    let nextOwner: Promise<unknown> | undefined;
    let observedFile: string | undefined;
    try {
      await vi.waitFor(() => expect(sessionAdmissionRegistry.isFenced(identity)).toBe(true));
      expect(() => sessionAdmissionRegistry.acquirePermit(identity, "chat-send")).toThrow(/fenced/);
      nextOwner = updateSessionStore(storePath, (store) => {
        observedFile = readFileSync(path.join(workspaceRoot, "f.ts"), "utf8");
        store[sessionKey]!.sessionId = "generation-after-restore";
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(observedFile).toBeUndefined();
      expect(readFileSync(path.join(workspaceRoot, "f.ts"), "utf8")).toBe("v2\n");
    } finally {
      releaseFiles();
      await nextOwner;
    }
    expect(await pending).toMatchObject([{ ok: true }]);
    expect(observedFile).toBe("v1\n");
    expect(loadSessionStore(storePath)[sessionKey]?.sessionId).toBe("generation-after-restore");
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });
});

// Registry dispatch guard: the two checkpoint methods must be exposed through the
// core gateway method whitelist + descriptor table, not just callable directly on
// the handler object. If either chokepoint drifts, createCoreGatewayMethodDescriptors
// throws at startup (handler without descriptor) or the method is unreachable
// (missing whitelist entry -> "unknown method").
describe("sessions checkpoint gateway registry exposure", () => {
  it("exposes restoreCheckpoint and checkpointDiff through core gateway descriptors", async () => {
    const { coreGatewayHandlers } = await import("../server-methods.js");
    const { createCoreGatewayMethodDescriptors } = await import("../methods/core-descriptors.js");
    const descriptors = createCoreGatewayMethodDescriptors(coreGatewayHandlers);
    const names = new Set(descriptors.map((d) => d.name));

    expect(names.has("sessions.restoreCheckpoint")).toBe(true);
    expect(names.has("sessions.checkpointDiff")).toBe(true);
  });

  it("does not throw on unclassified handler drift", async () => {
    const { coreGatewayHandlers } = await import("../server-methods.js");
    const { createCoreGatewayMethodDescriptors } = await import("../methods/core-descriptors.js");
    // createCoreGatewayMethodDescriptors throws if any handler in the lazy map has
    // no matching spec; running it proves every advertised core handler (including
    // the two checkpoint methods) has a descriptor today.
    expect(() => createCoreGatewayMethodDescriptors(coreGatewayHandlers)).not.toThrow();
  });
});
