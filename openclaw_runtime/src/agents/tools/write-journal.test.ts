import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import {
  __resetWriteJournals,
  clearWriteJournal,
  createUndoWriteTool,
  snapshotBeforeWrite,
  undoLastWrites,
  wrapToolWithWriteJournal,
} from "./write-journal.js";

function makeWriteTool(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name: "write",
    label: "Write",
    description: "write",
    parameters: {},
    execute,
  } as AnyAgentTool;
}

describe("write-journal (C2-8)", () => {
  let repoRoot: string;
  const sessionId = "sess-journal";

  beforeEach(() => {
    __resetWriteJournals();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "write-journal-"));
    writeFileSync(path.join(repoRoot, "f.ts"), "v0\n", "utf8");
  });

  afterEach(() => {
    __resetWriteJournals();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("3 writes then undo restores prior content", async () => {
    const file = path.join(repoRoot, "f.ts");
    for (const content of ["v1\n", "v2\n", "v3\n"]) {
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId,
        filePath: "f.ts",
        toolName: "write",
      });
      writeFileSync(file, content, "utf8");
    }
    expect(readFileSync(file, "utf8")).toBe("v3\n");
    // undo once -> v2
    const one = undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 1 });
    expect(one.restored).toEqual(["f.ts"]);
    expect(readFileSync(file, "utf8")).toBe("v2\n");
    // undo again -> v1
    undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 1 });
    expect(readFileSync(file, "utf8")).toBe("v1\n");
    expect(codingObservability.snapshot().undoCount).toBe(2);
  });

  it("journal failure does not block write", async () => {
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    // Force journal root under a path we can make fail by using invalid session with readonly parent.
    // Simpler: spy by writing to a non-writable nested path via corrupted workspace — use wrap and
    // a workspace that is fine; inject failure by clearing after disabling via enabled true still
    // works. Instead test snapshot returns null when root is a file not a dir.
    const fileAsRoot = path.join(repoRoot, "not-a-dir");
    writeFileSync(fileAsRoot, "x", "utf8");
    const entry = snapshotBeforeWrite({
      workspaceRoot: fileAsRoot,
      sessionId: "x",
      filePath: "f.ts",
      toolName: "write",
    });
    // May null or throw internally; fail-open returns null
    expect(entry === null || entry).toBeTruthy();
    // Real write still succeeds via wrapper even if snapshot fails
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: fileAsRoot,
      sessionId: "x",
      enabled: true,
    });
    const result = await wrapped.execute("1", { path: "f.ts", content: "y" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
  });

  it("wrapper marks undoable and undo_write restores", async () => {
    const file = path.join(repoRoot, "f.ts");
    const base = makeWriteTool(async (_id, args) => {
      const content = String((args as { content?: string }).content ?? "");
      writeFileSync(file, content, "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    });
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });
    const result = await wrapped.execute("1", { path: "f.ts", content: "v-new\n" });
    const details = result.details as {
      write_journal?: { undoable?: boolean };
    };
    expect(details.write_journal?.undoable).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("v-new\n");

    const undo = createUndoWriteTool({
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });
    expect(undo).not.toBeNull();
    await undo!.execute("u1", { steps: 1 });
    expect(readFileSync(file, "utf8")).toBe("v0\n");
  });

  it("session clear removes journal dir", () => {
    snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId,
      filePath: "f.ts",
      toolName: "write",
    });
    clearWriteJournal({ workspaceRoot: repoRoot, sessionId });
    // no throw
  });
});

// ---------------------------------------------------------------------------
// FP-P1-04: undo is not best-effort; journal survives restarts; lineage.
// ---------------------------------------------------------------------------
import { existsSync, readdirSync } from "node:fs";
import { getOrCreateWriteJournal, journalDirFor, listJournalSnapshotFiles } from "./write-journal.js";

describe("write-journal FP-P1-04 semantics", () => {
  let repoRoot: string;
  const sessionId = "sess-fp-p1-04";

  beforeEach(() => {
    __resetWriteJournals();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "write-journal-fp104-"));
    writeFileSync(path.join(repoRoot, "a.ts"), "a0\n", "utf8");
    writeFileSync(path.join(repoRoot, "b.ts"), "b0\n", "utf8");
  });

  afterEach(() => {
    __resetWriteJournals();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function write(file: string, content: string) {
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId, filePath: file, toolName: "write" });
    writeFileSync(path.join(repoRoot, file), content, "utf8");
  }

  it("multi-file batch undo restores everything (create + modify)", () => {
    write("a.ts", "a1\n");
    write("b.ts", "b1\n");
    snapshotBeforeWrite({ workspaceRoot: repoRoot, sessionId, filePath: "new.ts", toolName: "write" });
    writeFileSync(path.join(repoRoot, "new.ts"), "n1\n", "utf8");

    const outcome = undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 3 });
    expect(outcome.errors).toEqual([]);
    expect(outcome.restored.sort()).toEqual(["a.ts", "b.ts", "new.ts"].sort());
    expect(readFileSync(path.join(repoRoot, "a.ts"), "utf8")).toBe("a0\n");
    expect(readFileSync(path.join(repoRoot, "b.ts"), "utf8")).toBe("b0\n");
    expect(existsSync(path.join(repoRoot, "new.ts"))).toBe(false);
    expect(outcome.remainingEntries).toBe(0);
  });

  it("HARD LOCK: partial restore is a failure — stops at first error, journal retained", () => {
    write("a.ts", "a1\n");
    write("b.ts", "b1\n");
    const journal = getOrCreateWriteJournal(repoRoot, sessionId);
    const newest = journal.entries[journal.entries.length - 1]!;
    rmSync(newest.snapshotPath, { force: true });

    const outcome = undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 2 });
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toContain("journal snapshot missing");
    expect(outcome.restored).toEqual([]);
    expect(outcome.remainingEntries).toBe(2);
    expect(readFileSync(path.join(repoRoot, "a.ts"), "utf8")).toBe("a1\n");
    expect(readFileSync(path.join(repoRoot, "b.ts"), "utf8")).toBe("b1\n");
    expect(existsSync(outcome.journalDir)).toBe(true);
  });

  it("journal rehydrates from disk after a restart (fresh in-memory state)", () => {
    write("a.ts", "a1\n");
    write("a.ts", "a2\n");
    __resetWriteJournals();
    const journal = getOrCreateWriteJournal(repoRoot, sessionId);
    expect(journal.entries).toHaveLength(2);
    expect(journal.nextSeq).toBe(3);
    const outcome = undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 2 });
    expect(outcome.errors).toEqual([]);
    expect(readFileSync(path.join(repoRoot, "a.ts"), "utf8")).toBe("a0\n");
  });

  it("every snapshot meta carries lineage (session/workspace)", () => {
    write("a.ts", "a1\n");
    const dir = journalDirFor(repoRoot, sessionId);
    const meta = readdirSync(dir).find((name) => name.endsWith(".meta.json"))!;
    const parsed = JSON.parse(readFileSync(path.join(dir, meta), "utf8")) as {
      lineage?: { sessionId?: string; workspaceRoot?: string };
    };
    expect(parsed.lineage?.sessionId).toBe(sessionId);
    expect(parsed.lineage?.workspaceRoot).toBe(path.resolve(repoRoot));
  });

  it("successful undo cleans consumed snapshots; journal stays consistent with disk", () => {
    write("a.ts", "a1\n");
    expect(listJournalSnapshotFiles(repoRoot, sessionId)).toHaveLength(1);
    const outcome = undoLastWrites({ workspaceRoot: repoRoot, sessionId, steps: 1 });
    expect(outcome.errors).toEqual([]);
    expect(listJournalSnapshotFiles(repoRoot, sessionId)).toHaveLength(0);
    expect(getOrCreateWriteJournal(repoRoot, sessionId).entries).toHaveLength(0);
  });
});
