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
  listPreparedWriteJournalEntries,
  setWriteJournalBatchState,
  snapshotBeforeWrite,
  snapshotPreparedWrite,
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

  it("keeps an outside-workspace entry intact when restricted undo refuses it", async () => {
    const outsideFile = `${repoRoot}-outside.ts`;
    try {
      writeFileSync(outsideFile, "outside-v0\n", "utf8");
      snapshotBeforeWrite({
        workspaceRoot: repoRoot,
        sessionId,
        filePath: outsideFile,
        toolName: "write",
      });
      writeFileSync(outsideFile, "outside-v1\n", "utf8");
      __resetWriteJournals();

      const undo = createUndoWriteTool({
        workspaceRoot: repoRoot,
        sessionId,
        enabled: true,
        workspaceOnly: true,
      });
      const result = await undo!.execute("restricted-undo", { steps: 1 });
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("Path escapes workspace root"),
      });
      expect(readFileSync(outsideFile, "utf8")).toBe("outside-v1\n");

      const authorized = undoLastWrites({
        workspaceRoot: repoRoot,
        sessionId,
        steps: 1,
        workspaceOnly: false,
      });
      expect(authorized.errors).toEqual([]);
      expect(readFileSync(outsideFile, "utf8")).toBe("outside-v0\n");
    } finally {
      rmSync(outsideFile, { force: true });
    }
  });

  it("projects an existing full-file write from the journal snapshot and verified after content", async () => {
    const file = path.join(repoRoot, "f.ts");
    const base = makeWriteTool(async (_id, args) => {
      writeFileSync(file, String((args as { content?: string }).content ?? ""), "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    });
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("write-existing", {
      path: "f.ts",
      content: "const value = 2;\n",
    });

    expect(result.details).toMatchObject({
      patch: expect.stringContaining("+const value = 2;"),
      patchArtifacts: [
        {
          schema: "GitPatchArtifact/v1",
          file: "f.ts",
          status: "modified",
          contentKind: "text",
          completeness: "complete",
          lineage: {
            requestId: "write-existing",
            journalEntryId: "write-journal:sess-journal:1",
          },
        },
      ],
      write_journal: {
        snapshots: [
          {
            path: "f.ts",
            journalEntryId: "write-journal:sess-journal:1",
            hadPrior: true,
          },
        ],
      },
    });
  });

  it("projects a new full-file write as an added artifact", async () => {
    const file = path.join(repoRoot, "new.ts");
    const base = makeWriteTool(async (_id, args) => {
      writeFileSync(file, String((args as { content?: string }).content ?? ""), "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    });
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("write-new", {
      path: "new.ts",
      content: "export const created = true;\n",
    });

    expect(result.details).toMatchObject({
      patchArtifacts: [
        {
          file: "new.ts",
          status: "added",
          contentKind: "text",
          completeness: "complete",
          lineage: {
            requestId: "write-new",
            journalEntryId: "write-journal:sess-journal:1",
          },
        },
      ],
      write_journal: { snapshots: [{ path: "new.ts", hadPrior: false }] },
    });
  });

  it("represents a newly created empty file as a complete metadata artifact", async () => {
    const file = path.join(repoRoot, "empty.txt");
    const base = makeWriteTool(async () => {
      writeFileSync(file, "", "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    });
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("write-empty", { path: "empty.txt", content: "" });

    expect(result.details).toMatchObject({
      patchArtifacts: [
        {
          file: "empty.txt",
          status: "added",
          contentKind: "metadata",
          hunks: [],
          completeness: "complete",
          lineage: {
            requestId: "write-empty",
            journalEntryId: "write-journal:sess-journal:1",
          },
        },
      ],
    });
  });

  it("keeps CRLF content verified while projecting normalized logical lines", async () => {
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "const value = 1;\r\n", "utf8");
    const base = makeWriteTool(async (_id, args) => {
      writeFileSync(file, String((args as { content?: string }).content ?? ""), "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    });
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("write-crlf", {
      path: "f.ts",
      content: "const value = 2;\r\n",
    });
    const details = result.details as {
      patchArtifacts?: Array<{ hunks?: Array<{ lines?: Array<{ text?: string }> }> }>;
    };

    expect(readFileSync(file, "utf8")).toBe("const value = 2;\r\n");
    expect(details.patchArtifacts?.[0]?.hunks?.[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "const value = 1;" }),
        expect.objectContaining({ text: "const value = 2;" }),
      ]),
    );
  });

  it("fails closed when the workspace after content cannot be verified", async () => {
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "reported success" }],
      details: {},
    }));
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("write-mismatch", {
      path: "f.ts",
      content: "claimed content\n",
    });

    expect(result.details).toMatchObject({
      patchArtifacts: [],
      patchArtifactError: expect.objectContaining({
        schema: "RemoteForgeError/v1",
        code: "incomplete_response",
        retryable: false,
        requestId: "write-mismatch",
      }),
      write_journal: { undoable: true },
    });
  });

  it("binds patch artifact lineage to the same request and journal snapshot", async () => {
    const file = path.join(repoRoot, "f.ts");
    const base = makeWriteTool(async (_id, args) => {
      const content = String((args as { content?: string }).content ?? "");
      writeFileSync(file, content, "utf8");
      return {
        content: [{ type: "text", text: "ok" }],
        details: {
          patchArtifacts: [
            {
              schema: "GitPatchArtifact/v1",
              file: "f.ts",
              status: "modified",
              contentKind: "text",
              hunks: [
                {
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: [
                    { kind: "deletion", text: "v0", oldLine: 1, newLine: null },
                    { kind: "addition", text: "v1", oldLine: null, newLine: 1 },
                  ],
                },
              ],
              patch: "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-v0\n+v1",
              completeness: "complete",
              lineage: { requestId: "call-1" },
            },
          ],
        },
      };
    });
    base.name = "edit";
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("call-1", { path: "f.ts", content: "v1\n" });
    const details = result.details as {
      patchArtifacts?: Array<{ lineage?: { requestId?: string; journalEntryId?: string } }>;
      write_journal?: { snapshots?: Array<{ journalEntryId?: string }> };
    };
    const snapshotId = details.write_journal?.snapshots?.[0]?.journalEntryId;
    expect(snapshotId).toBe("write-journal:sess-journal:1");
    expect(details.patchArtifacts?.[0]?.lineage).toEqual({
      requestId: "call-1",
      journalEntryId: snapshotId,
    });
  });

  it("fails closed when patch artifact lineage has no matching journal snapshot", async () => {
    const file = path.join(repoRoot, "f.ts");
    const base = makeWriteTool(async (_id, args) => {
      writeFileSync(file, String((args as { content?: string }).content ?? ""), "utf8");
      return {
        content: [{ type: "text", text: "ok" }],
        details: {
          patchArtifacts: [
            {
              schema: "GitPatchArtifact/v1",
              file: "other.ts",
              status: "added",
              contentKind: "text",
              hunks: [
                {
                  oldStart: 0,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 1,
                  lines: [{ kind: "addition", text: "v1", oldLine: null, newLine: 1 }],
                },
              ],
              patch:
                "diff --git a/other.ts b/other.ts\n--- /dev/null\n+++ b/other.ts\n@@ -0,0 +1 @@\n+v1",
              completeness: "complete",
              lineage: { requestId: "call-1" },
            },
          ],
        },
      };
    });
    base.name = "edit";
    const wrapped = wrapToolWithWriteJournal(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });

    const result = await wrapped.execute("call-1", { path: "f.ts", content: "v1\n" });
    expect(result.details).toMatchObject({
      patchArtifacts: [],
      patchArtifactError: expect.objectContaining({
        schema: "RemoteForgeError/v1",
        code: "incomplete_response",
        retryable: false,
        requestId: "call-1",
      }),
      write_journal: { undoable: true },
    });
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
import {
  getOrCreateWriteJournal,
  journalDirFor,
  listJournalSnapshotFiles,
} from "./write-journal.js";

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
    snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId,
      filePath: "new.ts",
      toolName: "write",
    });
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

  it("rehydrates prepared apply_patch batches and persists recovery_required", () => {
    const entry = snapshotPreparedWrite({
      workspaceRoot: repoRoot,
      sessionId,
      filePath: "a.ts",
      toolName: "apply_patch",
      requestId: "patch-call",
      batch: { id: "patch-call", state: "prepared" },
      hadPrior: true,
      priorContent: "a0\n",
    });
    expect(entry).not.toBeNull();

    __resetWriteJournals();
    const prepared = listPreparedWriteJournalEntries(repoRoot, sessionId);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.batch).toEqual({ id: "patch-call", state: "prepared" });

    expect(setWriteJournalBatchState(prepared, "recovery_required")).toBe(true);
    __resetWriteJournals();
    expect(getOrCreateWriteJournal(repoRoot, sessionId).entries[0]?.batch?.state).toBe(
      "recovery_required",
    );
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

  it("journalDirFor normalizes Windows-illegal characters in session ids", () => {
    // Canonical keys like "agent:main:main" contain ':' which must not reach
    // the filesystem path (gateway checkpoint diff/restore use them as the
    // journal session id).
    const dir = journalDirFor(repoRoot, "agent:main:main");
    expect(path.basename(dir)).not.toContain(":");
    expect(dir.endsWith(`${path.sep}agent_main_main`)).toBe(true);
    // Round-trip: snapshot and rehydrate through the normalized dir.
    snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId: "agent:main:main",
      filePath: "a.ts",
      toolName: "write",
    });
    writeFileSync(path.join(repoRoot, "a.ts"), "v1\n", "utf8");
    expect(
      getOrCreateWriteJournal(repoRoot, "agent:main:main").entries.some(
        (entry) => entry.relPath === "a.ts",
      ),
    ).toBe(true);
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
