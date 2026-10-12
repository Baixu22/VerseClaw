import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  __resetWriteJournals,
  snapshotBeforeWrite,
} from "./tools/write-journal.js";
import {
  applyCheckpointToJournal,
  createCheckpointRollbackDeps,
  resolveCheckpointJournalRoot,
  validateCheckpointRecord,
  type CheckpointRollbackExecutorOptions,
} from "./checkpoint-rollback-executor.js";
import { executeReplayRollback } from "./replay-rollback-authority.js";
import { buildRuntimeResumeCheckpoint } from "./long-task-control/store.js";
import type { LongTaskCheckpointRecord } from "./long-task-control/store.js";

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCheckpointRecord(params: {
  id: string;
  sessionKey: string;
  createdAt: string;
  filesTouched?: string[];
  testsRun?: string[];
  metadata?: Record<string, unknown>;
}): LongTaskCheckpointRecord {
  return {
    id: params.id,
    sessionKey: params.sessionKey,
    trigger: "guide",
    status: "guide",
    checkpoint: buildRuntimeResumeCheckpoint({
      id: params.id,
      sessionKey: params.sessionKey,
      trigger: "guide",
      filesTouched: params.filesTouched ?? [],
      testsRun: params.testsRun ?? [],
      metadata: params.metadata,
      createdAt: Date.parse(params.createdAt),
    }),
    createdAt: Date.parse(params.createdAt),
    updatedAt: Date.parse(params.createdAt),
  };
}

describe("checkpoint-rollback-executor (A3)", () => {
  let repoRoot: string;
  // Journal session id must be filesystem-safe (no ':' on Windows); the
  // checkpoint sessionKey is a separate canonical key.
  const sessionKey = "agent::sess-rollback";
  const journalSessionId = "sess-rollback";

  beforeEach(() => {
    __resetWriteJournals();
    repoRoot = mkdtempSync(path.join(tmpdir(), "rollback-exec-"));
  });

  afterEach(() => {
    __resetWriteJournals();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  describe("validateCheckpointRecord", () => {
    it("accepts a structurally valid checkpoint", async () => {
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: "2026-07-31T00:00:00.000Z",
      });
      const result = await validateCheckpointRecord(record);
      expect(result).toEqual({ ok: true });
    });

    it("rejects missing/invalid shape", async () => {
      expect(await validateCheckpointRecord(null)).toEqual({
        ok: false,
        reason: expect.stringContaining("not a usable"),
      });
      expect(await validateCheckpointRecord({ id: "x" })).toEqual({
        ok: false,
        reason: expect.stringContaining("not a usable"),
      });
    });

    it("rejects unparseable createdAt", async () => {
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: "2026-07-31T00:00:00.000Z",
      });
      record.checkpoint.createdAt = "not-a-date";
      const result = await validateCheckpointRecord(record);
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("not a parseable date"),
      });
    });
  });

  describe("applyCheckpointToJournal", () => {
    it("restores files to the checkpoint instant (post-checkpoint writes undone)", async () => {
      const file = path.join(repoRoot, "f.ts");
      writeFileSync(file, "v0\n", "utf8");

      // Write 1: v1 (pre-checkpoint)
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v1\n", "utf8");

      // Ensure the checkpoint instant is strictly AFTER the v1 journal entry
      // (journal timestamps are ms-precision; same-ms writes are ambiguous).
      await sleepMs(5);
      const checkpointAt = new Date().toISOString();
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: checkpointAt,
        filesTouched: ["f.ts"],
      });

      // Write 2: v2 (post-checkpoint)
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v2\n", "utf8");
      expect(readFileSync(file, "utf8")).toBe("v2\n");

      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: journalSessionId,
      });
      expect(outcome.errors).toEqual([]);
      expect(outcome.restored).toEqual(["f.ts"]);
      expect(readFileSync(file, "utf8")).toBe("v1\n");
    });

    it("restores created files (hadPrior=false) by unlinking them", () => {
      // Pre-checkpoint: file exists.
      const existing = path.join(repoRoot, "keep.ts");
      writeFileSync(existing, "keep\n", "utf8");
      const checkpointAt = new Date().toISOString();
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: checkpointAt,
      });

      // Post-checkpoint: create a new file.
      const created = path.join(repoRoot, "new.ts");
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "new.ts",
        toolName: "write",
      });
      writeFileSync(created, "new\n", "utf8");
      expect(readFileSync(created, "utf8")).toBe("new\n");

      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: journalSessionId,
      });
      expect(outcome.errors).toEqual([]);
      expect(outcome.restored).toEqual(["new.ts"]);
      expect(readFileSync(existing, "utf8")).toBe("keep\n");
    });

    it("no-op when no journal entries exist after the checkpoint", async () => {
      writeFileSync(path.join(repoRoot, "f.ts"), "v0\n", "utf8");
      // #176: the journal session id is now required and explicit — the
      // canonical session key is no longer accepted as a fallback. Record one
      // entry that belongs to this session and sits *before* the checkpoint, so
      // the journal genuinely exists while there is nothing to undo.
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      await sleepMs(5);
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: new Date().toISOString(),
      });
      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: journalSessionId,
      });
      expect(outcome.errors).toEqual([]);
      expect(outcome.restored).toEqual([]);
    });

    it("#176 fails closed when the journal id is the canonical key, not the session UUID", () => {
      const file = path.join(repoRoot, "f.ts");
      writeFileSync(file, "v2\n", "utf8");
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: new Date().toISOString(),
        filesTouched: ["f.ts"],
      });

      // `sessionKey` is the canonical key; the journal was actually written
      // under `journalSessionId`. Before #176 this silently resolved to an
      // empty directory and returned `errors: []` (a "successful" restore that
      // restored nothing) — and then created that empty directory, which is
      // itself the wrong journal.
      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: sessionKey,
      });

      expect(outcome.restored).toEqual([]);
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0]).toContain("no_journal_for_session");
      expect(readFileSync(file, "utf8")).toBe("v2\n");
    });

    it("#176 refuses to roll back when no journal session id is supplied", () => {
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: new Date().toISOString(),
        filesTouched: ["f.ts"],
      });

      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
      });

      expect(outcome.restored).toEqual([]);
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0]).toContain("journal_session_id_missing");
    });

    it("uses metadata.journalSeq as the boundary when stamped (partial rollback without same-ms ambiguity)", async () => {
      const file = path.join(repoRoot, "f.ts");
      writeFileSync(file, "v0\n", "utf8");

      // seq 1: pre-boundary write (v1)
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v1\n", "utf8");
      await sleepMs(5);

      // checkpoint stamped with the journal tail seq at its instant (= 1)
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: new Date().toISOString(),
        metadata: { journalSeq: 1 },
      });

      // seq 2: post-boundary write (v2)
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v2\n", "utf8");
      expect(readFileSync(file, "utf8")).toBe("v2\n");

      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: journalSessionId,
      });
      expect(outcome.errors).toEqual([]);
      expect(outcome.restored).toEqual(["f.ts"]);
      // Only the post-boundary write is undone; the pre-boundary write survives.
      expect(readFileSync(file, "utf8")).toBe("v1\n");
    });

    it("ignores a non-numeric journalSeq and falls back to createdAt filtering", async () => {
      const file = path.join(repoRoot, "f.ts");
      writeFileSync(file, "v0\n", "utf8");
      const checkpointAt = new Date().toISOString();
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: checkpointAt,
        metadata: { journalSeq: "not-a-number" as never },
      });
      await sleepMs(5);
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v1\n", "utf8");

      const outcome = applyCheckpointToJournal({
        workspaceRoot: repoRoot,
        checkpoint: record,
        sessionId: journalSessionId,
      });
      expect(outcome.restored).toEqual(["f.ts"]);
      expect(readFileSync(file, "utf8")).toBe("v0\n");
    });
  });

  describe("resolveCheckpointJournalRoot", () => {
    it("prefers the matching worktree root when metadata.worktreeId is set", () => {
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: "2026-07-31T00:00:00.000Z",
        metadata: { worktreeId: "wt-1" },
      });
      const root = resolveCheckpointJournalRoot(record, repoRoot, [
        { id: "wt-1", root: path.join(repoRoot, ".openclaw", "worktrees", "wt-1") } as never,
      ]);
      expect(root).toBe(path.join(repoRoot, ".openclaw", "worktrees", "wt-1"));
    });

    it("falls back to workspace root without worktree metadata", () => {
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: "2026-07-31T00:00:00.000Z",
      });
      expect(resolveCheckpointJournalRoot(record, repoRoot, [])).toBe(repoRoot);
    });
  });

  describe("createCheckpointRollbackDeps + executeReplayRollback", () => {
    it("legacy checkpoint path restores and records outcome", async () => {
      const file = path.join(repoRoot, "f.ts");
      writeFileSync(file, "v0\n", "utf8");
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v1\n", "utf8");
      await sleepMs(5);
      const checkpointAt = new Date().toISOString();
      const record = makeCheckpointRecord({
        id: "c1",
        sessionKey,
        createdAt: checkpointAt,
        filesTouched: ["f.ts"],
      });
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, "v2\n", "utf8");

      const outcomes: string[] = [];
      const deps = createCheckpointRollbackDeps({
        workspaceRoot: repoRoot,
        sessionId: journalSessionId,
        recordOutcome: (result) => outcomes.push(result.ok ? result.mode : `err:${result.reason}`),
      });
      const result = await executeReplayRollback(
        {
          decision: "repair",
          repairStrategy: "replay_rollback",
          reason: "test",
          requestedAtTick: 3,
        },
        { enabled: false, reason: "pilot off" },
        { kind: "checkpoint", checkpointId: "c1" },
        {
          ...deps,
          loadCheckpoint: async () => record,
          validateCheckpoint: async (c) => validateCheckpointRecord(c),
          applyCheckpoint: async (c) => {
            const r = c as LongTaskCheckpointRecord;
            const outcome = applyCheckpointToJournal({
              workspaceRoot: repoRoot,
              checkpoint: r,
              sessionId: journalSessionId,
            });
            if (outcome.errors.length > 0) throw new Error(outcome.errors.join("; "));
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mode).toBe("legacy_checkpoint_fallback");
        expect(result.rolledBackTo).toBe("checkpoint:c1");
      }
      expect(readFileSync(file, "utf8")).toBe("v1\n");
      expect(outcomes).toEqual(["legacy_checkpoint_fallback"]);
    });

    it("event_log target fails explicitly when pilot is disabled (no fake success)", async () => {
      const deps = createCheckpointRollbackDeps({ workspaceRoot: repoRoot });
      const result = await executeReplayRollback(
        {
          decision: "repair",
          repairStrategy: "replay_rollback",
          reason: "test",
          requestedAtTick: 1,
        },
        { enabled: false, reason: "pilot off" },
        { kind: "event_log", fromSequence: 1, toSequence: 5 },
        deps,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("pilot_gate_disabled_with_no_checkpoint");
      }
    });

    it("invalid decision is rejected", async () => {
      const deps = createCheckpointRollbackDeps({ workspaceRoot: repoRoot });
      const result = await executeReplayRollback(
        { decision: "complete" },
        { enabled: true },
        { kind: "checkpoint", checkpointId: "c1" },
        deps,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_decision");
    });
  });

  describe("default recordOutcome (console sink)", () => {
    it("is wired when no explicit sink is given", async () => {
      const options: CheckpointRollbackExecutorOptions = { workspaceRoot: repoRoot };
      const deps = createCheckpointRollbackDeps(options);
      // outcome is recorded without throwing for both ok and error results
      expect(() => deps.recordOutcome({
        ok: true,
        rolledBackTo: "checkpoint:c1",
        mode: "legacy_checkpoint_fallback",
        evidenceSummary: "s",
        durationMs: 1,
      })).not.toThrow();
      expect(() => deps.recordOutcome({
        ok: false,
        reason: "no_checkpoint",
        detail: "d",
        durationMs: 1,
      })).not.toThrow();
    });
  });
});
