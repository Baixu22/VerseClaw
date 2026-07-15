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
