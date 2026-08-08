/**
 * Gateway 集成测试: sessions.checkpointDiff / sessions.restoreCheckpoint
 * 真实链路验证(非 mock)——
 *   - 真实 stateDb(OPENCLAW_STATE_DIR 临时目录, 自动建 schema)
 *   - 真实 write-journal(临时工作区文件 + .pre 快照)
 *   - 真实 checkpoint 落库(recordLongTaskCheckpoint)
 *   - 真实 handler 调用(sessionsRunControlHandlers)
 * 验证: checkpoint diff 数据从 db 读取 → journal 对比 → respond 形状。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { sessionsRunControlHandlers } from "./sessions.run-control.js";
import { snapshotBeforeWrite, __resetWriteJournals } from "../../agents/tools/write-journal.js";
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
  const sessionKey = "agent:main:main";
  const journalSessionId = "agent:main:main";

  beforeEach(async () => {
    __resetWriteJournals();
    stateDir = mkdtempSync(path.join(tmpdir(), "gw-state-"));
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "gw-ws-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v0\n", "utf8");
    // Pre-checkpoint write (seq 1): v0 -> v1
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v1\n", "utf8");
    await sleepMs(5);
  });

  afterEach(() => {
    __resetWriteJournals();
    closeOpenClawStateDatabase();
    delete process.env.OPENCLAW_STATE_DIR;
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
        metadata: { journalSeq: 1 },
        createdAt: Date.now(),
      }),
    });
    // Post-checkpoint write (seq 2): v1 -> v2
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v2\n", "utf8");

    const { getLongTaskCheckpointById } = await import("../../agents/long-task-control/store.js");
    const stored = getLongTaskCheckpointById("mission:m1:tick:3");
    const { checkpointContentDiff } = await import("../../agents/checkpoint-diff.js");
    const direct = checkpointContentDiff({ workspaceRoot, checkpoint: stored as never, sessionId: "agent:main:main" });
    expect(direct.errors).toEqual([]);

    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.checkpointDiff"]({
      params: { key: sessionKey, checkpointId: "mission:m1:tick:3" },
      respond,
      context: makeContext(workspaceRoot) as never,
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(true);
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

  it("restores a checkpoint through the real rollback path", async () => {
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
        metadata: { journalSeq: 1 },
        createdAt: Date.now(),
      }),
    });
    // Post-checkpoint write (seq 2): v1 -> v2
    snapshotBeforeWrite({ workspaceRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(path.join(workspaceRoot, "f.ts"), "v2\n", "utf8");

    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.restoreCheckpoint"]({
      params: { key: sessionKey, checkpointId: "mission:m1:tick:2" },
      respond,
      context: makeContext(workspaceRoot) as never,
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(true);
    // The rollback actually restored the file on disk.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(workspaceRoot, "f.ts"), "utf8")).toBe("v1\n");
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
