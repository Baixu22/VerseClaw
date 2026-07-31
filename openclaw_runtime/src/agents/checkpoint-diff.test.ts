/**
 * Checkpoint content diff 数据层测试(能力3 Cline checkpoint-diff parity)。
 * 验证: diff 条目选择与 applyCheckpointToJournal 一致(seq 边界)、
 * modified/created 状态、unified diff 内容、无变化跳过、快照丢失报错。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  __resetWriteJournals,
  snapshotBeforeWrite,
} from "./tools/write-journal.js";
import { checkpointContentDiff } from "./checkpoint-diff.js";
import { buildRuntimeResumeCheckpoint } from "./long-task-control/store.js";
import type { LongTaskCheckpointRecord } from "./long-task-control/store.js";

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCheckpointRecord(
  createdAt: string,
  metadata?: Record<string, unknown>,
): LongTaskCheckpointRecord {
  return {
    id: "c-diff",
    sessionKey: "agent::sess-diff",
    trigger: "guide",
    status: "guide",
    checkpoint: buildRuntimeResumeCheckpoint({
      id: "c-diff",
      sessionKey: "agent::sess-diff",
      trigger: "guide",
      metadata,
      createdAt: Date.parse(createdAt),
    }),
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(createdAt),
  };
}

describe("checkpointContentDiff (Cline checkpoint-diff parity)", () => {
  let repoRoot: string;
  const journalSessionId = "sess-diff";

  beforeEach(() => {
    __resetWriteJournals();
    repoRoot = mkdtempSync(path.join(tmpdir(), "cp-diff-"));
  });

  afterEach(() => {
    __resetWriteJournals();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("surfaces post-boundary modifications with a unified diff", async () => {
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    // Pre-checkpoint write (seq 1)
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(file, "v1\n", "utf8");
    await sleepMs(5);
    const record = makeCheckpointRecord(new Date().toISOString(), { journalSeq: 1 });
    // Post-checkpoint write (seq 2)
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(file, "v2\n", "utf8");

    const diff = checkpointContentDiff({ workspaceRoot: repoRoot, checkpoint: record, sessionId: journalSessionId });
    expect(diff.errors).toEqual([]);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.filePath).toBe("f.ts");
    expect(diff.files[0]!.status).toBe("modified");
    // Checkpoint-side content is the pre-image of the post-boundary write:
    // unified diff shows checkpoint-instant (v1) vs current (v2).
    expect(diff.files[0]!.unifiedDiff).toContain("-v1");
    expect(diff.files[0]!.unifiedDiff).toContain("+v2");
  });

  it("marks files created after the boundary as created", async () => {
    const record = makeCheckpointRecord(new Date().toISOString(), { journalSeq: 0 });
    await sleepMs(5);
    const created = path.join(repoRoot, "new.ts");
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "new.ts", toolName: "write" });
    writeFileSync(created, "hello\n", "utf8");

    const diff = checkpointContentDiff({ workspaceRoot: repoRoot, checkpoint: record, sessionId: journalSessionId });
    expect(diff.errors).toEqual([]);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.filePath).toBe("new.ts");
    expect(diff.files[0]!.status).toBe("created");
    expect(diff.files[0]!.unifiedDiff).toContain("hello");
  });

  it("skips files unchanged since the checkpoint instant", async () => {
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v1\n", "utf8");
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(file, "v1\n", "utf8"); // same content, no-op rewrite
    await sleepMs(5);
    // Boundary after the entry: seq=1 entry is pre-boundary → not in scope.
    const record = makeCheckpointRecord(new Date().toISOString(), { journalSeq: 1 });

    const diff = checkpointContentDiff({ workspaceRoot: repoRoot, checkpoint: record, sessionId: journalSessionId });
    expect(diff.errors).toEqual([]);
    expect(diff.files).toEqual([]);
  });

  it("reports snapshot loss as an error without fabricating a diff", async () => {
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(file, "v1\n", "utf8");
    await sleepMs(5);
    const record = makeCheckpointRecord(new Date().toISOString(), { journalSeq: 0 });
    // Remove the .pre snapshot so the checkpoint-side content is unavailable.
    const { getOrCreateWriteJournal } = await import("./tools/write-journal.js");
    const journal = getOrCreateWriteJournal(repoRoot, journalSessionId);
    const entry = journal.entries.find((e) => e.relPath === "f.ts");
    expect(entry).toBeDefined();
    rmSync(entry!.snapshotPath, { force: true });

    const diff = checkpointContentDiff({ workspaceRoot: repoRoot, checkpoint: record, sessionId: journalSessionId });
    expect(diff.files).toEqual([]);
    expect(diff.errors.length).toBeGreaterThan(0);
    expect(diff.errors[0]).toContain("snapshot missing");
  });

  it("falls back to createdAt filtering when the checkpoint has no journalSeq stamp", async () => {
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    const checkpointAt = new Date().toISOString();
    const record = makeCheckpointRecord(checkpointAt);
    await sleepMs(5);
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId: journalSessionId, filePath: "f.ts", toolName: "write" });
    writeFileSync(file, "v1\n", "utf8");

    const diff = checkpointContentDiff({ workspaceRoot: repoRoot, checkpoint: record, sessionId: journalSessionId });
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.status).toBe("modified");
    expect(existsSync(path.join(repoRoot, "f.ts"))).toBe(true);
  });
});
